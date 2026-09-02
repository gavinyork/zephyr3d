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

/** Default for {@link MotionBlur.maxBlurLength}. @internal */
const DEFAULT_MAX_BLUR_LENGTH = 40;

/**
 * Sample spacing along a streak, in pixels. The taps are not dithered, so this
 * is all that stands between a long streak and ghosting.
 * @internal
 */
const TARGET_STEP_PX = 3.3;

/**
 * Cost ceiling, and the one place the spacing above is allowed to slip. Past
 * `MAX_WALK_STEPS * TARGET_STEP_PX` per direction the taps thin out and long
 * streaks ghost, which caps the usable {@link MotionBlur.maxBlurLength} at
 * roughly 210 px on a fully biased shutter, twice that on a centred one.
 * @internal
 */
const MIN_WALK_STEPS = 4;
const MAX_WALK_STEPS = 64;

/**
 * Velocity tile size, which is also the furthest a point may throw its streak:
 * NeighborMax dilates across one tile, so anything that can reach a pixel has
 * to live within a tile of it. A centred shutter spends that reach both ways
 * and affords twice the tile size; a fully biased one spends it all one way.
 * @internal
 */
function tileSizeFor(maxBlurLength: number, shutterBias: number): number {
  return Math.max(2, Math.ceil(maxBlurLength * Math.max(shutterBias, 1 - shutterBias)));
}

/**
 * Steps for a walk spanning `spanPx` pixels, at {@link TARGET_STEP_PX} stride.
 * Per direction rather than per pair: the bias splits the streak unevenly, and
 * a direction with no share must take no steps (see the walk).
 * @internal
 */
function walkStepsFor(spanPx: number): number {
  if (spanPx <= 0) {
    return 0;
  }
  return Math.min(MAX_WALK_STEPS, Math.max(MIN_WALK_STEPS, Math.ceil(spanPx / TARGET_STEP_PX)));
}

/**
 * Sentinel velocity emitted by materials opting out of temporal reuse
 * ({@link MeshMaterial.disableTAA} writes `(6e4, 6e4)`). Read literally it
 * would smear those pixels across the screen. Same threshold
 * `temporalResolve()` tests against.
 * @internal
 */
const MV_SENTINEL = 5e4;

/**
 * View-space depth gap past which two samples count as separate surfaces.
 * Small on purpose: the test is meant to be near-binary, with the ramp only
 * softening near-coplanar cases.
 * @internal
 */
const SOFT_Z_EXTENT = 0.01;

/** Half the separation between the two walks per direction. @internal */
const RIBBON_WIDTH = 3;

/** Velocity tiles keep the sign of the motion, so a signed float format. @internal */
const TILE_FORMAT: TextureFormat = 'rgba16f';

const FUNC_PROCESS_VELOCITY = 'Z_mbProcessVelocity';

/**
 * Raw motion vector to the velocity the filter works with: sentinel rejected,
 * scaled by strength, clamped to the longest reconstructible streak. Every
 * pass must apply exactly this, or the dilated and per-pixel velocities
 * disagree and the weights break.
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
 * The reconstruction filter of McGuire et al., "A Reconstruction Filter for
 * Plausible Motion Blur" (2012), with the tap path walking the velocity field
 * rather than a straight line so that rotating geometry does not tear.
 *
 * Velocity is dilated over tiles first (TileMax, then NeighborMax) so a static
 * pixel still blurs when fast geometry passes near it. That dilation is what
 * makes moving *objects* streak over the background: reading only the velocity
 * under the current pixel reproduces camera motion, where the field is smooth
 * screen-wide, but leaves moving objects with hard edges.
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
  private _maxBlurLength: number;
  /** @internal */
  private readonly _texSize: Vector2;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    this._intensity = 1;
    this._shutterBias = 0.5;
    this._maxBlurLength = DEFAULT_MAX_BLUR_LENGTH;
    this._texSize = new Vector2();
    // End layer, so the display chain runs after the TAA resolve (see
    // Camera.setupPostEffects). Motion vectors are unaffected: the blackboard
    // handle is final before either post chain is built.
    this._layer = PostEffectLayer.end;
  }
  /**
   * Motion blur strength, the fraction of the frame interval the shutter is
   * open. 1 blurs over a whole frame of movement (a 360 degree shutter), 0.5
   * over half of it (the cinematic 180 degree shutter), 0 disables the effect.
   *
   * @remarks
   * Motion vectors already carry one frame of displacement, so this is a plain
   * dimensionless factor and must not be scaled by frame time again. The
   * result is capped by {@link MotionBlur.maxBlurLength} whatever the strength.
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
   * - `0` trails the streak entirely behind, which is what a shutter closing
   *   on the current frame produces and reads as the object dragging a tail.
   * - `0.5` (the default) centres it, as McGuire et al. describe: nothing lags,
   *   at the cost of blurring into where the object has not been yet.
   * - `1` puts it entirely ahead. Offered for symmetry, rarely wanted.
   *
   * @remarks
   * This slides the streak without lengthening it;
   * {@link MotionBlur.maxBlurLength} is honoured at any bias, paid for with a
   * coarser tile grid towards the extremes.
   */
  get shutterBias() {
    return this._shutterBias;
  }
  set shutterBias(val: number) {
    this._shutterBias = Math.min(1, Math.max(0, val));
  }
  /**
   * Longest streak the filter will reconstruct, in pixels at render
   * resolution. Velocity beyond this is clamped: the direction survives, the
   * length does not.
   *
   * @remarks
   * This is the ceiling {@link MotionBlur.strength} runs into: an object
   * crossing `V` pixels per frame stops responding once `V * strength` reaches
   * it. The clamp is per pixel, so fast objects saturate first and pushing
   * strength further only flattens the fast/slow difference. Raise this instead.
   *
   * Cost is linear in it - 28 samples per pixel at the default 40, 100 at 160,
   * since step counts are derived from the length to keep the sampling dense.
   * The quality limit comes sooner though: a tile is as wide as the reach, so
   * raising this spreads the dilated velocity further and a fast object starts
   * dragging nearby slow geometry into its blur.
   */
  get maxBlurLength() {
    return this._maxBlurLength;
  }
  set maxBlurLength(val: number) {
    this._maxBlurLength = Math.max(1, val);
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
    // Tile size follows the requested streak length, and is what every pass
    // this frame sizes itself against. Read once here so the tile textures, the
    // shader loop bounds and the velocity clamp cannot disagree.
    const tileSize = tileSizeFor(this._maxBlurLength, this._shutterBias);
    const tileCountX = Math.max(1, Math.ceil(s.width / tileSize));
    const tileCountY = Math.max(1, Math.ceil(s.height / tileSize));

    // 1. TileMax, separable: rows then columns. max() is separable, so the two
    //    passes together cover the tile far more cheaply than a 2D reduction.
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
            tileCountX,
            tileSize
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
            tileCountY,
            tileSize
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 2. NeighborMax: max over the 3x3 tile neighbourhood, so a background-only
    //    tile learns about the fast geometry beside it and the streak may cross
    //    the silhouette.
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
   * Reconstruction needs the dilated tiles that {@link MotionBlur.setup} builds
   * and this single-pass entry cannot. Only reached without motion vectors,
   * where no blur is the right answer anyway.
   */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, _sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.passThrough(ctx, inputColorTexture, srgbOutput);
  }
  /** @internal */
  private _tileMaxH(
    device: AbstractDevice,
    motionVectorTexture: Texture2D,
    target: Texture2D,
    tileCountX: number,
    tileSize: number
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
    bindGroup.setValue('tileSize', tileSize);
    bindGroup.setValue('strength', this._intensity);
    bindGroup.setValue('maxBlurLength', this._maxBlurLength);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    device.setProgram(MotionBlur._programTileMaxH);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _tileMaxV(
    device: AbstractDevice,
    srcTexture: Texture2D,
    target: Texture2D,
    tileCountY: number,
    tileSize: number
  ) {
    this._prepareTileMax(device);
    device.setFramebuffer([target]);
    device.setViewport(null);
    device.setScissor(null);
    const bindGroup = MotionBlur._bindgroupTileMaxV!;
    bindGroup.setTexture('srcTexture', srcTexture, fetchSampler('clamp_nearest_nomip'));
    this._texSize.setXY(srcTexture.width, srcTexture.height);
    bindGroup.setValue('srcSize', this._texSize);
    bindGroup.setValue('tileCount', tileCountY);
    bindGroup.setValue('tileSize', tileSize);
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
    // Taps land on sub-pixel offsets, so colour is filtered. Velocity and depth
    // stay point-sampled: interpolating either across a silhouette invents a
    // surface at neither depth, moving at neither speed.
    bindGroup.setTexture('inputTexture', inputColorTexture, fetchSampler('clamp_linear_nomip'));
    bindGroup.setTexture('motionVectorTexture', motionVectorTexture, nearest);
    bindGroup.setTexture('linearDepthTexture', linearDepthTexture, nearest);
    bindGroup.setTexture('neighborMaxTexture', neighborMaxTexture, nearest);
    this._texSize.setXY(motionVectorTexture.width, motionVectorTexture.height);
    bindGroup.setValue('texSize', this._texSize);
    bindGroup.setValue('strength', this._intensity);
    bindGroup.setValue('maxBlurLength', this._maxBlurLength);
    bindGroup.setValue('shutterBias', this._shutterBias);
    // Split the streak between the two directions and give each the steps its
    // own share needs. The strides are resolved here rather than in the shader
    // so that a direction with no share divides by nothing.
    const spanBack = this._maxBlurLength * this._shutterBias;
    const spanFwd = this._maxBlurLength * (1 - this._shutterBias);
    const stepsBack = walkStepsFor(spanBack);
    const stepsFwd = walkStepsFor(spanFwd);
    bindGroup.setValue('stepsBack', stepsBack);
    bindGroup.setValue('stepsFwd', stepsFwd);
    bindGroup.setValue('dtBack', stepsBack > 0 ? this._shutterBias / stepsBack : 0);
    bindGroup.setValue('dtFwd', stepsFwd > 0 ? (1 - this._shutterBias) / stepsFwd : 0);
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
          this.tileSize = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // Destination is one texel per tile column but keeps the source
            // height, so the row index maps straight through.
            this.$l.tileX = pb.floor(pb.mul(this.$inputs.uv.x, this.tileCount));
            this.$l.srcY = pb.floor(pb.mul(this.$inputs.uv.y, this.srcSize.y));
            this.$l.baseX = pb.mul(this.tileX, this.tileSize);
            this.$l.best = pb.vec2(0);
            this.$l.bestLen = pb.float(0);
            this.$for(pb.float('i'), 0, this.tileSize, function () {
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
          this.tileSize = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // Source already holds one texel per tile column, so the column
            // index maps straight through and only rows are reduced here.
            this.$l.srcX = pb.floor(pb.mul(this.$inputs.uv.x, this.srcSize.x));
            this.$l.tileY = pb.floor(pb.mul(this.$inputs.uv.y, this.tileCount));
            this.$l.baseY = pb.mul(this.tileY, this.tileSize);
            this.$l.best = pb.vec2(0);
            this.$l.bestLen = pb.float(0);
            this.$for(pb.float('i'), 0, this.tileSize, function () {
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
        this.stepsBack = pb.float().uniform(0);
        this.stepsFwd = pb.float().uniform(0);
        this.dtBack = pb.float().uniform(0);
        this.dtFwd = pb.float().uniform(0);
        this.cameraFar = pb.float().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();

        // Coverage of a streak of length `len` at a point `dist` away. The half
        // pixel floor keeps a static sample from dividing by zero.
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
        // Velocity to advance the walk by: the field where there is one, else the
        // dilated vector. That fallback is what starts a walk at all - a
        // background pixel has no velocity of its own to leave on.
        pb.func('Z_mbFlowAt', [pb.vec2('uv'), pb.vec2('vFallback')], function () {
          this.$l.v = processVelocity(
            this,
            pb.textureSampleLevel(this.motionVectorTexture, this.uv, 0).xy,
            this.texSize,
            this.strength,
            this.maxBlurLength
          );
          this.$l.len = pb.length(pb.mul(this.v, this.texSize));
          this.$return(this.$choice(pb.greaterThan(this.len, 0.5), this.v, this.vFallback));
        });
        // One tap of the reconstruction filter, returning the weighted colour
        // in rgb and the weight in a.
        pb.func(
          'Z_mbTap',
          [pb.vec2('sampleUV'), pb.float('dist'), pb.float('zC'), pb.float('lenC')],
          function () {
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
          // Dilated tile velocity: non-zero even where the pixel is static but
          // fast geometry passes close by.
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
            // Floored at half a pixel, as the paper floors the stored velocity:
            // a sharp centre needs a large but finite self weight.
            this.$l.lenC = pb.max(pb.length(pb.mul(this.vC, this.texSize)), 0.5);
            this.$l.zC = this.Z_mbLinearDepth(this.uv);
            // The sharper this pixel is, the more of its own colour it keeps.
            this.$l.weight = pb.div(1, this.lenC);
            this.$l.sum = pb.mul(this.sourceSample.rgb, this.weight);
            // Four walks leave the pixel: backwards into the points arriving
            // here during the shutter, forwards into the ones this pixel's
            // motion carries it onto, each doubled across the streak.
            //
            // They follow the velocity field rather than a straight line. A
            // point Y covers this pixel only if X - Y runs along Y's own
            // velocity; translation makes that locus a line, self-rotation
            // curves it into an arc, and a straight walk cuts across the arc,
            // catching a different set of points at every pixel - the crack a
            // spinning object shows. Re-reading the field each step follows the
            // arc, and reduces to the straight line when the field is uniform.
            //
            // The doubling averages over silhouette tangency, where a lone walk
            // loses several taps at once for a one-pixel shift. Its offset is
            // perpendicular to the motion, which a blur must not smear along,
            // so it stays as narrow as the tangency allows.
            //
            // shutterBias splits the streak between the two directions, each
            // getting steps in proportion. A direction with no share must take
            // none: zero-length steps park every tap on the centre at distance
            // zero, where cone, cylinder and the depth test all peak, spending
            // the heaviest weight in the filter on the pixel's own colour.
            this.$l.nrmN = pb.normalize(this.vN);
            this.$l.lane = pb.div(
              pb.mul(pb.vec2(pb.neg(this.nrmN.y), this.nrmN.x), RIBBON_WIDTH),
              this.texSize
            );
            this.$l.posBack = this.uv;
            this.$l.posFwd = this.uv;
            this.$l.posBack2 = this.uv;
            this.$l.posFwd2 = this.uv;
            // Arc length walked, in pixels: the weights compare it against a
            // sample speed, so it must follow the curve, not the chord.
            this.$l.arcBack = pb.float(0);
            this.$l.arcFwd = pb.float(0);
            this.$l.arcBack2 = pb.float(0);
            this.$l.arcFwd2 = pb.float(0);
            // Direction carried between steps, seeded with the dilated vector.
            // Carried rather than re-seeded so that leaving the geometry again
            // does not kink the path mid-arc.
            this.$l.flowBack = this.vN;
            this.$l.flowFwd = this.vN;
            this.$l.flowBack2 = this.vN;
            this.$l.flowFwd2 = this.vN;
            // The lanes separate with distance rather than running parallel:
            // coincident at the pixel, where sharpness shows, and a few pixels
            // apart far along the streak, where the tangency needs averaging.
            this.$for(pb.float('i'), 0, this.stepsBack, function () {
              this.$l.spread = pb.mul(this.lane, pb.div(pb.add(this.i, 1), this.stepsBack));

              this.flowBack = this.Z_mbFlowAt(this.posBack, this.flowBack);
              this.$l.stepBack = pb.mul(this.flowBack, pb.neg(this.dtBack));
              this.posBack = pb.clamp(pb.add(this.posBack, this.stepBack), pb.vec2(0), pb.vec2(1));
              this.arcBack = pb.add(this.arcBack, pb.length(pb.mul(this.stepBack, this.texSize)));
              this.$l.tapBack = this.Z_mbTap(
                pb.add(this.posBack, this.spread),
                this.arcBack,
                this.zC,
                this.lenC
              );

              this.flowBack2 = this.Z_mbFlowAt(this.posBack2, this.flowBack2);
              this.$l.stepBack2 = pb.mul(this.flowBack2, pb.neg(this.dtBack));
              this.posBack2 = pb.clamp(pb.add(this.posBack2, this.stepBack2), pb.vec2(0), pb.vec2(1));
              this.arcBack2 = pb.add(this.arcBack2, pb.length(pb.mul(this.stepBack2, this.texSize)));
              this.$l.tapBack2 = this.Z_mbTap(
                pb.sub(this.posBack2, this.spread),
                this.arcBack2,
                this.zC,
                this.lenC
              );

              this.sum = pb.add(this.sum, this.tapBack.rgb, this.tapBack2.rgb);
              this.weight = pb.add(this.weight, this.tapBack.a, this.tapBack2.a);
            });
            this.$for(pb.float('i'), 0, this.stepsFwd, function () {
              this.$l.spread = pb.mul(this.lane, pb.div(pb.add(this.i, 1), this.stepsFwd));

              this.flowFwd = this.Z_mbFlowAt(this.posFwd, this.flowFwd);
              this.$l.stepFwd = pb.mul(this.flowFwd, this.dtFwd);
              this.posFwd = pb.clamp(pb.add(this.posFwd, this.stepFwd), pb.vec2(0), pb.vec2(1));
              this.arcFwd = pb.add(this.arcFwd, pb.length(pb.mul(this.stepFwd, this.texSize)));
              this.$l.tapFwd = this.Z_mbTap(
                pb.add(this.posFwd, this.spread),
                this.arcFwd,
                this.zC,
                this.lenC
              );

              this.flowFwd2 = this.Z_mbFlowAt(this.posFwd2, this.flowFwd2);
              this.$l.stepFwd2 = pb.mul(this.flowFwd2, this.dtFwd);
              this.posFwd2 = pb.clamp(pb.add(this.posFwd2, this.stepFwd2), pb.vec2(0), pb.vec2(1));
              this.arcFwd2 = pb.add(this.arcFwd2, pb.length(pb.mul(this.stepFwd2, this.texSize)));
              this.$l.tapFwd2 = this.Z_mbTap(
                pb.sub(this.posFwd2, this.spread),
                this.arcFwd2,
                this.zC,
                this.lenC
              );

              this.sum = pb.add(this.sum, this.tapFwd.rgb, this.tapFwd2.rgb);
              this.weight = pb.add(this.weight, this.tapFwd.a, this.tapFwd2.a);
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
