import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type {
  AbstractDevice,
  BindGroup,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { FrameResources } from '../render/rendergraph/blackboard';
import type { RGHandle } from '../render/rendergraph/types';

/**
 * Edge length in pixels of a velocity tile, which is also the furthest a point
 * may throw its streak: NeighborMax dilates across one tile, so anything a
 * pixel can be reached by has to live within a tile of it. McGuire et al.
 * suggest 20 and the reconstruction guarantee is stated in terms of exactly
 * this equality.
 * @internal
 */
const TILE_SIZE = 20;

/**
 * Longest streak the filter can reconstruct at a given shutter bias, in pixels.
 *
 * The binding constraint is reach, not length: a tap may not travel further
 * than {@link TILE_SIZE} from the pixel, or it leaves the region NeighborMax
 * searched and the streak silently loses its tail. A centred shutter spends
 * that budget symmetrically and so affords twice the tile size, but a shutter
 * pushed fully to one end spends it all in one direction and affords only the
 * tile size itself. Halving the streak is the price of the trailing look; the
 * alternative would be widening the NeighborMax kernel.
 * @internal
 */
function maxBlurLength(shutterBias: number): number {
  return TILE_SIZE / Math.max(shutterBias, 1 - shutterBias);
}

/**
 * Taps taken along the reconstruction line, excluding the centre pixel, which
 * is accumulated separately with its own weight. Kept even so that no tap lands
 * exactly on the centre and none has to be skipped.
 *
 * The paper suggests 15 samples in total. This is 24 plus the centre, because
 * the taps here are not jittered (see the sample loop) and undithered taps have
 * to be dense enough to not ghost on their own: 24 keeps the spacing under
 * 1.7 px even at the maximum streak length.
 * @internal
 */
const NUM_TAPS = 24;

/**
 * Velocity written by materials that opt out of temporal reuse
 * ({@link MeshMaterial.disableTAA} emits `(6e4, 6e4)`). Same threshold
 * `temporalResolve()` tests against; without it the filter would read the
 * sentinel as an enormous velocity and smear those pixels across the screen.
 * @internal
 */
const MV_SENTINEL = 5e4;

/**
 * Depth difference in view-space units past which two samples are considered
 * to be on separate surfaces. Small on purpose: the comparison is meant to be
 * an almost binary foreground/background test, and the ramp only softens the
 * transition between near-coplanar surfaces.
 * @internal
 */
const SOFT_Z_EXTENT = 0.01;

/** Velocity tiles keep the sign of the motion, so a signed float format. @internal */
const TILE_FORMAT: TextureFormat = 'rgba16f';

const FUNC_PROCESS_VELOCITY = 'Z_mbProcessVelocity';

/**
 * Turns a raw motion vector sample into the velocity the filter works with:
 * sentinel rejected, scaled by the shutter strength and clamped to the longest
 * reconstructible streak. Every pass must apply exactly this transform,
 * otherwise the dilated tile velocities and the per-pixel velocities disagree
 * and the weights break.
 * @internal
 */
function processVelocity(
  scope: PBInsideFunctionScope,
  raw: PBShaderExp,
  texSize: PBShaderExp,
  strength: PBShaderExp,
  maxLength: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  pb.func(
    FUNC_PROCESS_VELOCITY,
    [pb.vec2('raw'), pb.vec2('texSize'), pb.float('strength'), pb.float('maxLength')],
    function () {
      this.$l.sentinel = pb.and(
        pb.greaterThanEqual(this.raw.x, MV_SENTINEL),
        pb.greaterThanEqual(this.raw.y, MV_SENTINEL)
      );
      this.$l.v = this.$choice(this.sentinel, pb.vec2(0), pb.mul(this.raw, this.strength));
      this.$l.len = pb.length(pb.mul(this.v, this.texSize));
      // Branchless clamp: the factor is 1 while the velocity is within budget.
      this.$return(pb.mul(this.v, pb.div(this.maxLength, pb.max(this.len, this.maxLength))));
    }
  );
  return scope[FUNC_PROCESS_VELOCITY](raw, texSize, strength, maxLength) as PBShaderExp;
}

/**
 * The motion blur post effect
 *
 * @remarks
 * Implements the reconstruction filter of McGuire et al., "A Reconstruction
 * Filter for Plausible Motion Blur" (2012). Velocity is dilated over
 * {@link TILE_SIZE}-pixel tiles first (TileMax, then NeighborMax), so a pixel
 * that is itself static still gets blurred when fast geometry passes near it.
 * That dilation is what makes moving *objects* streak over the background;
 * a filter that only reads the velocity under the current pixel can reproduce
 * camera motion, where the velocity field is smooth over the whole screen, but
 * leaves moving objects with hard edges.
 *
 * @public
 */
export class MotionBlur extends AbstractPostEffect {
  private static _programTileMaxH: Nullable<GPUProgram> = null;
  private static _bindgroupTileMaxH: Nullable<BindGroup> = null;
  private static _programTileMaxV: Nullable<GPUProgram> = null;
  private static _bindgroupTileMaxV: Nullable<BindGroup> = null;
  private static _programNeighborMax: Nullable<GPUProgram> = null;
  private static _bindgroupNeighborMax: Nullable<BindGroup> = null;
  private static _programMotionBlur: Nullable<GPUProgram> = null;
  private static _bindgroupMotionBlur: Nullable<BindGroup> = null;
  /** @internal */
  private _intensity: number;
  /** @internal */
  private _shutterBias: number;
  /** @internal */
  private readonly _texSize: Vector2;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    this._intensity = 1;
    this._shutterBias = 0.5;
    this._texSize = new Vector2();
    // End layer: the display chain runs after the TAA resolve (see Camera.setupPostEffects).
    // Motion vectors are unaffected by the move -- the blackboard handle is final before
    // either post chain is built.
    this._layer = PostEffectLayer.end;
  }
  /**
   * Motion blur strength, the fraction of the frame interval the shutter is
   * open. 1 blurs over a whole frame of movement (a 360 degree shutter), 0.5
   * over half of it (the cinematic 180 degree shutter), 0 disables the effect.
   *
   * @remarks
   * The motion vectors already carry the displacement accumulated over one
   * frame, so this is a plain dimensionless factor and must not be scaled by
   * the frame time again. The streak length is capped whatever the strength;
   * see {@link MotionBlur.shutterBias} for what the cap is and why it moves.
   */
  get strength() {
    return this._intensity;
  }
  set strength(val: number) {
    this._intensity = val;
  }
  /**
   * How much of the streak lies ahead of where the object is now, as a fraction
   * of its length. Clamped to [0, 1].
   *
   * - `0` leaves the whole streak trailing behind the object. This is what a
   *   shutter that closes on the current frame actually produces, since the
   *   motion vector runs from the previous frame to this one, and it reads as
   *   the object dragging a tail.
   * - `0.5` (the default) centres the streak on the current position, which is
   *   what McGuire et al. describe and what most implementations ship. Nothing
   *   lags, at the cost of the object blurring into where it has not been yet.
   * - `1` puts the streak entirely ahead. Offered for symmetry; it looks like
   *   the object is anticipating its own motion and is rarely what anyone wants.
   *
   * @remarks
   * Biasing the shutter does not lengthen the streak, it only slides it. It
   * does change how far a single tap reaches, though, and reach is what the
   * velocity dilation bounds: a centred shutter splits its budget over both
   * directions and so allows a streak of `2 * TILE_SIZE` pixels, while a fully
   * biased one spends the whole budget one way and allows `TILE_SIZE`. So the
   * maximum blur halves as this moves away from 0.5. Nothing breaks at the
   * boundary - the velocity is simply clamped harder.
   */
  get shutterBias() {
    return this._shutterBias;
  }
  set shutterBias(val: number) {
    this._shutterBias = Math.min(1, Math.max(0, val));
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireMotionVectorTexture} */
  requireMotionVectorTexture() {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.setup} */
  setup(s: PostEffectSetupContext): RGHandle {
    const { graph, ctx, blackboard } = s;
    const motionVectorHandle = blackboard.get(FrameResources.MotionVector);
    const linearDepthHandle = blackboard.get(FrameResources.LinearDepth);
    if (!motionVectorHandle || !linearDepthHandle || this._intensity <= 0) {
      // Without velocity or depth there is nothing to reconstruct from; the
      // legacy path degrades to a pass-through.
      return this._setupFromApply(s);
    }
    const tileCountX = Math.max(1, Math.ceil(s.width / TILE_SIZE));
    const tileCountY = Math.max(1, Math.ceil(s.height / TILE_SIZE));

    // 1. TileMax, separable: max velocity over each TILE_SIZE-wide row segment,
    //    then over each TILE_SIZE-tall column segment. max() is separable, so
    //    the two passes together give the max over the whole tile at a fraction
    //    of the samples a single 2D reduction would need per invocation.
    const tileMaxHHandle = graph.addPass('MotionBlur:TileMaxH', (builder) => {
      builder.read(motionVectorHandle);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      const out = builder.createTexture({
        format: TILE_FORMAT,
        sizeMode: 'absolute',
        width: tileCountX,
        height: s.height,
        label: 'MotionBlur:tileMaxH'
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          this._tileMaxH(
            device,
            rg.getTexture<Texture2D>(motionVectorHandle),
            rg.getTexture<Texture2D>(out),
            tileCountX
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    const tileMaxHandle = graph.addPass('MotionBlur:TileMaxV', (builder) => {
      builder.read(tileMaxHHandle);
      const out = builder.createTexture({
        format: TILE_FORMAT,
        sizeMode: 'absolute',
        width: tileCountX,
        height: tileCountY,
        label: 'MotionBlur:tileMax'
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          this._tileMaxV(
            device,
            rg.getTexture<Texture2D>(tileMaxHHandle),
            rg.getTexture<Texture2D>(out),
            tileCountY
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 2. NeighborMax: max over the 3x3 tile neighbourhood, so a tile that holds
    //    only background still learns about the fast geometry next to it and
    //    the streak is allowed to cross the silhouette.
    const neighborMaxHandle = graph.addPass('MotionBlur:NeighborMax', (builder) => {
      builder.read(tileMaxHandle);
      const out = builder.createTexture({
        format: TILE_FORMAT,
        sizeMode: 'absolute',
        width: tileCountX,
        height: tileCountY,
        label: 'MotionBlur:neighborMax'
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          this._neighborMax(device, rg.getTexture<Texture2D>(tileMaxHandle), rg.getTexture<Texture2D>(out));
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 3. Reconstruction.
    return graph.addPass('PostEffect:MotionBlur', (builder) => {
      builder.read(s.input);
      builder.read(motionVectorHandle);
      builder.read(linearDepthHandle);
      builder.read(neighborMaxHandle);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      for (const binding of s.historyReads) {
        builder.read(binding.handle);
      }
      const output = s.createOutput(builder);
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(output.framebuffer ? rg.getFramebuffer(output.framebuffer) : null);
          // A framebuffer bind may be a backend no-op when the requested target is already
          // current. Never let a previous multi-resolution effect (for example Bloom) leak its
          // smaller viewport/scissor into this fullscreen pass.
          device.setViewport(null);
          device.setScissor(null);
          this._reconstruct(
            ctx,
            rg.getTexture<Texture2D>(s.input),
            rg.getTexture<Texture2D>(motionVectorHandle),
            rg.getTexture<Texture2D>(linearDepthHandle),
            rg.getTexture<Texture2D>(neighborMaxHandle),
            output.srgbOutput
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return output.color;
    });
  }
  /**
   * {@inheritDoc AbstractPostEffect.apply}
   *
   * @remarks
   * Reconstruction needs the dilated velocity tiles built by {@link MotionBlur.setup},
   * which the single-pass apply() entry cannot produce. This path is only
   * reached when motion vectors are unavailable, where no blur is the correct
   * answer anyway.
   */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, _sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.passThrough(ctx, inputColorTexture, srgbOutput);
  }
  /** @internal */
  private _tileMaxH(
    device: AbstractDevice,
    motionVectorTexture: Texture2D,
    target: Texture2D,
    tileCountX: number
  ) {
    this._prepareTileMax(device);
    device.setFramebuffer([target]);
    device.setViewport(null);
    device.setScissor(null);
    const bindGroup = MotionBlur._bindgroupTileMaxH!;
    bindGroup.setTexture('srcTexture', motionVectorTexture, fetchSampler('clamp_nearest_nomip'));
    this._texSize.setXY(motionVectorTexture.width, motionVectorTexture.height);
    bindGroup.setValue('srcSize', this._texSize);
    bindGroup.setValue('tileCount', tileCountX);
    bindGroup.setValue('strength', this._intensity);
    bindGroup.setValue('maxBlurLength', maxBlurLength(this._shutterBias));
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(MotionBlur._programTileMaxH);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _tileMaxV(device: AbstractDevice, srcTexture: Texture2D, target: Texture2D, tileCountY: number) {
    this._prepareTileMax(device);
    device.setFramebuffer([target]);
    device.setViewport(null);
    device.setScissor(null);
    const bindGroup = MotionBlur._bindgroupTileMaxV!;
    bindGroup.setTexture('srcTexture', srcTexture, fetchSampler('clamp_nearest_nomip'));
    this._texSize.setXY(srcTexture.width, srcTexture.height);
    bindGroup.setValue('srcSize', this._texSize);
    bindGroup.setValue('tileCount', tileCountY);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(MotionBlur._programTileMaxV);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _neighborMax(device: AbstractDevice, srcTexture: Texture2D, target: Texture2D) {
    this._prepareNeighborMax(device);
    device.setFramebuffer([target]);
    device.setViewport(null);
    device.setScissor(null);
    const bindGroup = MotionBlur._bindgroupNeighborMax!;
    bindGroup.setTexture('srcTexture', srcTexture, fetchSampler('clamp_nearest_nomip'));
    this._texSize.setXY(srcTexture.width, srcTexture.height);
    bindGroup.setValue('srcSize', this._texSize);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(MotionBlur._programNeighborMax);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _reconstruct(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    motionVectorTexture: Texture2D,
    linearDepthTexture: Texture2D,
    neighborMaxTexture: Texture2D,
    srgbOutput: boolean
  ) {
    const device = ctx.device;
    this._prepareReconstruct(device);
    const bindGroup = MotionBlur._bindgroupMotionBlur!;
    const nearest = fetchSampler('clamp_nearest_nomip');
    // Colour is filtered because the taps land on sub-pixel offsets: with point
    // sampling a tap straddling a silhouette flips between the two surfaces
    // wholesale, and the per-pixel jitter turns that into visible speckle along
    // every blurred edge. Velocity and depth stay point-sampled - interpolating
    // either across a silhouette invents a surface that is at neither depth and
    // moving at neither speed.
    bindGroup.setTexture('inputTexture', inputColorTexture, fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('motionVectorTexture', motionVectorTexture, nearest);
    bindGroup.setTexture('linearDepthTexture', linearDepthTexture, nearest);
    bindGroup.setTexture('neighborMaxTexture', neighborMaxTexture, nearest);
    this._texSize.setXY(motionVectorTexture.width, motionVectorTexture.height);
    bindGroup.setValue('texSize', this._texSize);
    bindGroup.setValue('strength', this._intensity);
    bindGroup.setValue('maxBlurLength', maxBlurLength(this._shutterBias));
    bindGroup.setValue('shutterBias', this._shutterBias);
    // Linear depth is stored normalized against the far plane; the filter
    // compares depths in view-space units so the extent above is scene units.
    bindGroup.setValue('cameraFar', ctx.camera.getFarPlane());
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(MotionBlur._programMotionBlur);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepareTileMax(device: AbstractDevice) {
    if (!MotionBlur._programTileMaxH) {
      MotionBlur._programTileMaxH = device.buildRenderProgram({
        vertex: fullscreenVertex,
        fragment(pb) {
          this.srcTexture = pb.tex2D().uniform(0);
          this.srcSize = pb.vec2().uniform(0);
          this.tileCount = pb.float().uniform(0);
          this.strength = pb.float().uniform(0);
          this.maxBlurLength = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // Destination is one texel per tile column but keeps the source
            // height, so the row index maps straight through.
            this.$l.tileX = pb.floor(pb.mul(this.$inputs.uv.x, this.tileCount));
            this.$l.srcY = pb.floor(pb.mul(this.$inputs.uv.y, this.srcSize.y));
            this.$l.baseX = pb.mul(this.tileX, TILE_SIZE);
            this.$l.best = pb.vec2(0);
            this.$l.bestLen = pb.float(0);
            this.$for(pb.float('i'), 0, TILE_SIZE, function () {
              this.$l.srcUV = pb.div(
                pb.add(pb.vec2(pb.add(this.baseX, this.i), this.srcY), pb.vec2(0.5)),
                this.srcSize
              );
              // The sampler clamps, so a partial tile at the right edge just
              // re-reads its last texel, which cannot change a maximum.
              this.$l.raw = pb.textureSampleLevel(this.srcTexture, this.srcUV, 0).xy;
              this.$l.v = processVelocity(this, this.raw, this.srcSize, this.strength, this.maxBlurLength);
              this.$l.len = pb.dot(this.v, this.v);
              this.$if(pb.greaterThan(this.len, this.bestLen), function () {
                this.bestLen = this.len;
                this.best = this.v;
              });
            });
            this.$outputs.outColor = pb.vec4(this.best, 0, 1);
          });
        }
      })!;
      MotionBlur._programTileMaxH.name = '@MotionBlurTileMaxH';
      MotionBlur._bindgroupTileMaxH = device.createBindGroup(MotionBlur._programTileMaxH.bindGroupLayouts[0]);
    }
    if (!MotionBlur._programTileMaxV) {
      MotionBlur._programTileMaxV = device.buildRenderProgram({
        vertex: fullscreenVertex,
        fragment(pb) {
          this.srcTexture = pb.tex2D().uniform(0);
          this.srcSize = pb.vec2().uniform(0);
          this.tileCount = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // Source already holds one texel per tile column, so the column
            // index maps straight through and only rows are reduced here.
            this.$l.srcX = pb.floor(pb.mul(this.$inputs.uv.x, this.srcSize.x));
            this.$l.tileY = pb.floor(pb.mul(this.$inputs.uv.y, this.tileCount));
            this.$l.baseY = pb.mul(this.tileY, TILE_SIZE);
            this.$l.best = pb.vec2(0);
            this.$l.bestLen = pb.float(0);
            this.$for(pb.float('i'), 0, TILE_SIZE, function () {
              this.$l.srcUV = pb.div(
                pb.add(pb.vec2(this.srcX, pb.add(this.baseY, this.i)), pb.vec2(0.5)),
                this.srcSize
              );
              // Already processed by the horizontal pass, so taken verbatim.
              this.$l.v = pb.textureSampleLevel(this.srcTexture, this.srcUV, 0).xy;
              this.$l.len = pb.dot(this.v, this.v);
              this.$if(pb.greaterThan(this.len, this.bestLen), function () {
                this.bestLen = this.len;
                this.best = this.v;
              });
            });
            this.$outputs.outColor = pb.vec4(this.best, 0, 1);
          });
        }
      })!;
      MotionBlur._programTileMaxV.name = '@MotionBlurTileMaxV';
      MotionBlur._bindgroupTileMaxV = device.createBindGroup(MotionBlur._programTileMaxV.bindGroupLayouts[0]);
    }
  }
  /** @internal */
  private _prepareNeighborMax(device: AbstractDevice) {
    if (MotionBlur._programNeighborMax) {
      return;
    }
    MotionBlur._programNeighborMax = device.buildRenderProgram({
      vertex: fullscreenVertex,
      fragment(pb) {
        this.srcTexture = pb.tex2D().uniform(0);
        this.srcSize = pb.vec2().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.best = pb.vec2(0);
          this.$l.bestLen = pb.float(0);
          // Unrolled: the 3x3 offsets are compile-time constants, so this
          // avoids a nested dynamic loop for nine taps.
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nName = `n${dy + 1}${dx + 1}`;
              const lenName = `len${dy + 1}${dx + 1}`;
              this.$l[nName] = pb.textureSampleLevel(
                this.srcTexture,
                pb.add(this.$inputs.uv, pb.div(pb.vec2(dx, dy), this.srcSize)),
                0
              ).xy;
              this.$l[lenName] = pb.dot(this[nName], this[nName]);
              this.$if(pb.greaterThan(this[lenName], this.bestLen), function () {
                this.bestLen = this[lenName];
                this.best = this[nName];
              });
            }
          }
          this.$outputs.outColor = pb.vec4(this.best, 0, 1);
        });
      }
    })!;
    MotionBlur._programNeighborMax.name = '@MotionBlurNeighborMax';
    MotionBlur._bindgroupNeighborMax = device.createBindGroup(
      MotionBlur._programNeighborMax.bindGroupLayouts[0]
    );
  }
  /** @internal */
  private _prepareReconstruct(device: AbstractDevice) {
    if (MotionBlur._programMotionBlur) {
      return;
    }
    MotionBlur._programMotionBlur = device.buildRenderProgram({
      vertex: fullscreenVertex,
      fragment(pb) {
        this.inputTexture = pb.tex2D().uniform(0);
        this.motionVectorTexture = pb.tex2D().uniform(0);
        this.linearDepthTexture = pb.tex2D().uniform(0);
        this.neighborMaxTexture = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.strength = pb.float().uniform(0);
        this.maxBlurLength = pb.float().uniform(0);
        this.shutterBias = pb.float().uniform(0);
        this.cameraFar = pb.float().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();

        // How much of a streak of length `len` still covers a point `dist`
        // pixels away. Velocities are floored at half a pixel so a static
        // sample cannot divide by zero; at that length the cone is already
        // zero everywhere outside the pixel itself.
        pb.func('Z_mbCone', [pb.float('dist'), pb.float('len')], function () {
          this.$return(pb.clamp(pb.sub(1, pb.div(this.dist, pb.max(this.len, 0.5))), 0, 1));
        });
        // Coverage of a streak that passes over the point rather than ending
        // on it, used when both samples are blurry.
        pb.func('Z_mbCylinder', [pb.float('dist'), pb.float('len')], function () {
          this.$l.r = pb.max(this.len, 0.5);
          this.$return(pb.sub(1, pb.smoothStep(pb.mul(this.r, 0.95), pb.mul(this.r, 1.05), this.dist)));
        });
        // 1 when za is in front of zb, 0 when clearly behind it.
        pb.func('Z_mbSoftDepthCompare', [pb.float('za'), pb.float('zb')], function () {
          this.$return(pb.clamp(pb.sub(1, pb.div(pb.sub(this.za, this.zb), SOFT_Z_EXTENT)), 0, 1));
        });
        pb.func('Z_mbLinearDepth', [pb.vec2('uv')], function () {
          // Motion vectors are unavailable on WebGL, so this effect never runs
          // against the RGBA-packed depth variant that backend uses.
          this.$return(pb.mul(pb.textureSampleLevel(this.linearDepthTexture, this.uv, 0).r, this.cameraFar));
        });
        // One tap of the reconstruction filter, returning the weighted colour
        // in rgb and the weight in a.
        pb.func(
          'Z_mbTap',
          [
            pb.vec2('uv'),
            pb.vec2('vStep'),
            pb.float('t'),
            pb.float('lenStep'),
            pb.float('zC'),
            pb.float('lenC')
          ],
          function () {
            this.$l.sampleUV = pb.clamp(pb.add(this.uv, pb.mul(this.vStep, this.t)), pb.vec2(0), pb.vec2(1));
            // The offset is vStep * t, so its pixel length follows directly
            // from the length of the velocity we stepped along.
            this.$l.dist = pb.mul(pb.abs(this.t), this.lenStep);
            this.$l.zS = this.Z_mbLinearDepth(this.sampleUV);
            this.$l.vS = processVelocity(
              this,
              pb.textureSampleLevel(this.motionVectorTexture, this.sampleUV, 0).xy,
              this.texSize,
              this.strength,
              this.maxBlurLength
            );
            this.$l.lenS = pb.length(pb.mul(this.vS, this.texSize));
            // f: the sample sits in front of the centre, so its own blur is
            // allowed to spill onto the centre. b: the centre is in front and
            // blurry, so it gathers whatever is behind it.
            this.$l.f = this.Z_mbSoftDepthCompare(this.zS, this.zC);
            this.$l.b = this.Z_mbSoftDepthCompare(this.zC, this.zS);
            this.$l.alpha = pb.add(
              pb.mul(this.f, this.Z_mbCone(this.dist, this.lenS)),
              pb.mul(this.b, this.Z_mbCone(this.dist, this.lenC)),
              pb.mul(this.Z_mbCylinder(this.dist, this.lenS), this.Z_mbCylinder(this.dist, this.lenC), 2)
            );
            this.$l.colorS = pb.textureSampleLevel(this.inputTexture, this.sampleUV, 0).rgb;
            this.$return(pb.vec4(pb.mul(this.colorS, this.alpha), this.alpha));
          }
        );

        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.sourceSample = pb.textureSampleLevel(this.inputTexture, this.uv, 0);
          this.$l.color = this.sourceSample.rgb;
          // Dilated velocity of the tile neighbourhood: non-zero even where the
          // pixel itself is static but fast geometry passes close by.
          this.$l.vN = pb.textureSampleLevel(this.neighborMaxTexture, this.uv, 0).xy;
          this.$l.lenN = pb.length(pb.mul(this.vN, this.texSize));
          this.$if(pb.greaterThan(this.lenN, 0.5), function () {
            this.$l.vC = processVelocity(
              this,
              pb.textureSampleLevel(this.motionVectorTexture, this.uv, 0).xy,
              this.texSize,
              this.strength,
              this.maxBlurLength
            );
            // Floored at half a pixel, as the paper floors the stored velocity
            // itself: a sharp centre must still get a finite, large self weight
            // rather than an infinite one.
            this.$l.lenC = pb.max(pb.length(pb.mul(this.vC, this.texSize)), 0.5);
            this.$l.zC = this.Z_mbLinearDepth(this.uv);
            // The sharper this pixel is, the more of its own colour it keeps.
            this.$l.weight = pb.div(1, this.lenC);
            this.$l.sum = pb.mul(this.sourceSample.rgb, this.weight);
            // Every tap walks the dilated tile velocity, never this pixel's own.
            // That is what lets a static pixel gather from the moving geometry
            // beside it, and it is the whole reason the dilation exists: a pixel
            // stepping along its own velocity would, where that velocity is
            // zero, sample nothing but itself.
            this.$for(pb.float('i'), 0, NUM_TAPS / 2, function () {
              this.$l.k0 = pb.mul(this.i, 2);
              // t spans a unit interval against a whole-frame velocity, the same
              // sweep as the paper's [-1, 1] against the half velocity it
              // stores: one frame of movement at strength 1. shutterBias slides
              // that interval without resizing it, from [0, 1] (streak wholly
              // behind the object) through [-0.5, 0.5] (centred, the paper's
              // placement) to [-1, 0].
              //
              // The taps run downstream while the streak they paint runs
              // upstream, which is the usual gather/scatter inversion: a pixel
              // that the object has already left finds that object ahead of it.
              //
              // Deliberately unjittered, which the paper is not. Dithering the
              // tap positions trades ghosting for noise, and the noise is worse
              // here than the arithmetic suggests: a tap's weight is built from
              // the velocity and depth *at the tap*, both necessarily
              // point-sampled, so a sub-pixel shift flips them across a
              // silhouette wholesale. Measured on post-motionblur-object it put
              // a +/-12% one-pixel speckle along every blurred edge, and
              // filtering the colour does not touch it because the jump is in
              // the weight. NUM_TAPS is raised instead, to keep the taps dense
              // enough that there is no ghosting left to dither away.
              this.$l.t0 = pb.sub(pb.div(pb.add(this.k0, 1), NUM_TAPS + 1), this.shutterBias);
              this.$l.t1 = pb.sub(pb.div(pb.add(this.k0, 2), NUM_TAPS + 1), this.shutterBias);
              this.$l.tap0 = this.Z_mbTap(this.uv, this.vN, this.t0, this.lenN, this.zC, this.lenC);
              this.$l.tap1 = this.Z_mbTap(this.uv, this.vN, this.t1, this.lenN, this.zC, this.lenC);
              this.sum = pb.add(this.sum, this.tap0.rgb, this.tap1.rgb);
              this.weight = pb.add(this.weight, this.tap0.a, this.tap1.a);
            });
            this.color = pb.div(this.sum, pb.max(this.weight, 1e-5));
          });
          this.$if(pb.notEqual(this.srgbOut, 0), function () {
            this.color = linearToGamma(this, this.color);
          });
          this.$outputs.outColor = pb.vec4(this.color, this.sourceSample.a);
        });
      }
    })!;
    MotionBlur._programMotionBlur.name = '@MotionBlur';
    MotionBlur._bindgroupMotionBlur = device.createBindGroup(
      MotionBlur._programMotionBlur.bindGroupLayouts[0]
    );
  }
}

/**
 * Shared fullscreen quad vertex stage. `uv` is derived from the attribute and
 * so is unaffected by the flip, which keeps every pass in this effect writing
 * and sampling the same orientation on both backends.
 * @internal
 */
function fullscreenVertex(this: PBGlobalScope, pb: ProgramBuilder): void {
  this.flip = pb.int().uniform(0);
  this.$inputs.pos = pb.vec2().attrib('position');
  this.$outputs.uv = pb.vec2();
  pb.main(function () {
    this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
    this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
    this.$if(pb.notEqual(this.flip, 0), function () {
      this.$builtins.position.y = pb.neg(this.$builtins.position.y);
    });
  });
}
