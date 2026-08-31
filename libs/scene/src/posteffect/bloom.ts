import type { AbstractDevice, BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import type { PostEffectSetupContext } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { DrawContext } from '../render';
import type { Nullable } from '@zephyr3d/base';
import { Vector2, Vector4 } from '@zephyr3d/base';
import type { RGHandle } from '../render/rendergraph/types';

/**
 * The bloom post effect
 * @public
 */
export class Bloom extends AbstractPostEffect {
  static readonly className = 'Bloom' as const;
  /** Largest finite IEEE-754 half-float value used by the HDR post-effect chain. */
  private static readonly HALF_FLOAT_MAX = 65504;
  private static _programDownsampleH: Nullable<GPUProgram> = null;
  private static _programDownsampleV: Nullable<GPUProgram> = null;
  private static _programUpsample: Nullable<GPUProgram> = null;
  private static _programFinalCompose: Nullable<GPUProgram> = null;
  private static _programPrefilter: Nullable<GPUProgram> = null;
  private static _renderStateAdditive: Nullable<RenderStateSet> = null;
  private static _bindgroupDownsampleH: Nullable<BindGroup> = null;
  private static _bindgroupDownsampleV: Nullable<BindGroup> = null;
  private static _bindgroupUpsample: Nullable<BindGroup> = null;
  private static _bindgroupFinalCompose: Nullable<BindGroup> = null;
  private static _bindgroupPrefilter: Nullable<BindGroup> = null;
  private readonly _thresholdValue: Vector4;
  private readonly _invTexSize: Vector2;
  private _maxDownsampleLevels: number;
  private _downsampleLimit: number;
  private _threshold: number;
  private _thresholdKnee: number;
  private _intensity: number;
  private _filterRadius: number;
  private _karisAverage: boolean;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    // End layer, so the pyramid is built from the TAA-resolved frame rather than the
    // jittered one (see Camera.setupPostEffects). Bloom does not read depth, so nothing
    // here depends on the transmission depth rewrite the transparent layer sits ahead of.
    this._layer = PostEffectLayer.end;
    this._thresholdValue = new Vector4();
    this._invTexSize = new Vector2();
    this._maxDownsampleLevels = 4;
    this._downsampleLimit = 32;
    this._threshold = 0.8;
    this._thresholdKnee = 0;
    this._intensity = 1;
    this._filterRadius = 1;
    this._karisAverage = true;
  }
  /** The maximum downsample levels */
  get maxDownsampleLevel() {
    return this._maxDownsampleLevels;
  }
  set maxDownsampleLevel(val) {
    this._maxDownsampleLevels = val;
  }
  /** Downsample resolution limitation */
  get downsampleLimit() {
    return this._downsampleLimit;
  }
  set downsampleLimit(val) {
    this._downsampleLimit = val;
  }
  /**
   * Luminance above which a pixel starts to bloom.
   *
   * @remarks
   * Compared against the value in the color buffer, whose meaning depends on the scene's lighting
   * mode -- the same number is a different physical brightness in each:
   *
   * - `legacy`: the buffer is display-referred, so the default 0.8 means "near white".
   * - `physical`: the buffer holds camera pre-exposed luminance. 0.8 then corresponds to
   *   `0.8 / cameraExposure` cd/m², which at the Sunny-16 reference is ~30,700 cd/m² -- almost
   *   exactly a white surface in direct sunlight (~31,800). Little in an ordinary daylight scene is
   *   brighter than that, so only genuine emitters and specular highlights bloom.
   *
   * Physical scenes that want a more pronounced glow should lower this: ~0.3 makes a white surface
   * bloom, ~0.15 catches everything above mid-gray. Because the buffer is pre-exposed, a fixed
   * threshold tracks the camera -- stopping down dims the scene and reduces what blooms, as it
   * would on a real sensor.
   */
  get threshold() {
    return this._threshold;
  }
  set threshold(val) {
    this._threshold = val;
  }
  /** Bloom threshold knee */
  get thresholdKnee() {
    return this._thresholdKnee;
  }
  set thresholdKnee(val) {
    this._thresholdKnee = val;
  }
  /** Bloom intensity */
  get intensity() {
    return this._intensity;
  }
  set intensity(val) {
    this._intensity = val;
  }
  /**
   * Radius of the 3x3 tent filter used when upsampling the pyramid, in source texels.
   *
   * @remarks
   * 1 is the natural width and what the Call of Duty presentation uses. Raising it spreads each
   * level further and softens the halo, at the cost of the tent's taps drifting apart: past ~2 the
   * three lobes stop overlapping and the filter reintroduces the very grid pattern it exists to
   * remove. Lowering it toward 0 collapses the filter back to a plain bilinear tap and the blocky
   * banding returns.
   */
  get filterRadius() {
    return this._filterRadius;
  }
  set filterRadius(val) {
    this._filterRadius = Math.max(0, val);
  }
  /**
   * Whether the first downsample weights its taps by `1 / (1 + luma)` (the "Karis average").
   *
   * @remarks
   * Suppresses the fireflies a single blown-out specular texel produces: without it, such a texel
   * dominates its 2x2 group and flickers as the surface moves, since whether a normal map lands on
   * NdotL ~ 1 changes frame to frame. The trade is a slightly dimmer, slightly tighter halo,
   * because the weighting deliberately holds the brightest samples back. Turn it off for a static
   * scene that wants maximum reach and has no high-frequency speculars to stabilize.
   */
  get karisAverage() {
    return this._karisAverage;
  }
  set karisAverage(val) {
    this._karisAverage = !!val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.setup}
   *
   * Native multi-pass implementation: prefilter, one pass per pyramid level
   * (separable blur), one additive upsample pass per level, and a final
   * compose pass. Pyramid sizes are computed at build time with the same math
   * as {@link Bloom.apply}, so both paths produce identical results.
   */
  setup(s: PostEffectSetupContext): RGHandle {
    const { graph, ctx } = s;
    const format = s.colorFormat;
    // Mirror apply()'s runtime sizing math at build time.
    const prefilterWidth = Math.max(s.width >> 1, 1);
    const prefilterHeight = Math.max(s.height >> 1, 1);
    const t = Math.max(2, this._downsampleLimit);
    const levels: Array<{ width: number; height: number }> = [];
    {
      let w = Math.max(t, prefilterWidth >> 1);
      let h = Math.max(t, prefilterHeight >> 1);
      let maxLevels = Math.max(this._maxDownsampleLevels, 1);
      while ((w >= t || h >= t) && maxLevels > 0) {
        levels.push({ width: w, height: h });
        maxLevels--;
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
      }
    }
    if (levels.length === 0) {
      // Degenerate viewport: no pyramid possible, bloom contributes nothing.
      return s.input;
    }

    // 1. Prefilter (threshold/knee) at half resolution.
    const prefilterHandle = graph.addPass('Bloom:Prefilter', (builder) => {
      builder.read(s.input);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      const out = builder.createTexture({
        format,
        sizeMode: 'absolute',
        width: prefilterWidth,
        height: prefilterHeight,
        label: 'Bloom:prefilter'
      });
      builder.setExecute((rg) => {
        const device = ctx.device;
        const inputTexture = rg.getTexture<Texture2D>(s.input);
        this._prepare(device, inputTexture);
        device.pushDeviceStates();
        try {
          this.prefilter(device, inputTexture, rg.getTexture<Texture2D>(out));
        } finally {
          device.popDeviceStates();
        }
      });
      return out;
    });

    // 2. Downsample pyramid: one pass per level (separable blur through a
    // pass-local intermediate texture).
    const levelHandles: RGHandle[] = [];
    let sourceHandle = prefilterHandle;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      const src = sourceHandle;
      const levelHandle = graph.addPass(`Bloom:Downsample${i}`, (builder) => {
        builder.read(src);
        const middle = builder.createTexture({
          format,
          sizeMode: 'absolute',
          width: level.width,
          height: level.height,
          label: `Bloom:downsample${i}:middle`
        });
        const out = builder.createTexture({
          format,
          sizeMode: 'absolute',
          width: level.width,
          height: level.height,
          label: `Bloom:downsample${i}`
        });
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            const middleTexture = rg.getTexture<Texture2D>(middle);
            this.blurH(device, rg.getTexture<Texture2D>(src), middleTexture);
            this.blurV(device, middleTexture, rg.getTexture<Texture2D>(out));
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
      levelHandles.push(levelHandle);
      sourceHandle = levelHandle;
    }

    // 3. Upsample: additively blend each level into the level above (in-place
    // write, so each pass produces a new version of the target texture).
    for (let i = levels.length - 2; i >= 0; i--) {
      const src = levelHandles[i + 1];
      const dst = levelHandles[i];
      levelHandles[i] = graph.addPass(`Bloom:Upsample${i}`, (builder) => {
        builder.read(src);
        builder.read(dst);
        const out = builder.write(dst);
        builder.setExecute((rg) => {
          const device = ctx.device;
          device.pushDeviceStates();
          try {
            this._prepare(device, rg.getTexture<Texture2D>(src));
            this.upsampleInto(device, rg.getTexture<Texture2D>(src), rg.getTexture<Texture2D>(out));
          } finally {
            device.popDeviceStates();
          }
        });
        return out;
      });
    }

    // 4. Compose: scene color + bloom * intensity.
    const bloomHandle = levelHandles[0];
    return graph.addPass('Bloom:Compose', (builder) => {
      builder.read(s.input);
      builder.read(bloomHandle);
      for (const dep of s.dependencies) {
        builder.read(dep);
      }
      const output = s.createOutput(builder);
      builder.setExecute((rg) => {
        const device = ctx.device;
        device.pushDeviceStates();
        try {
          device.setFramebuffer(output.framebuffer ? rg.getFramebuffer(output.framebuffer) : null);
          device.setViewport(null);
          device.setScissor(null);
          this.finalCompose(
            device,
            rg.getTexture<Texture2D>(s.input),
            rg.getTexture<Texture2D>(bloomHandle),
            output.srgbOutput
          );
        } finally {
          device.popDeviceStates();
        }
      });
      return output.color;
    });
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, _sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const downsampleTextures: Texture2D[] = [];
    this._prepare(device, inputColorTexture);
    device.pushDeviceStates();
    const w = Math.max(inputColorTexture.width >> 1, 1);
    const h = Math.max(inputColorTexture.height >> 1, 1);
    const colorTex = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);
    this.prefilter(device, inputColorTexture, colorTex);
    this.downsample(device, colorTex, downsampleTextures);
    this.upsample(device, downsampleTextures);
    device.popDeviceStates();
    this.finalCompose(device, inputColorTexture, downsampleTextures[0], srgbOutput);
    for (const tex of downsampleTextures) {
      device.pool.releaseTexture(tex);
    }
    device.pool.releaseTexture(colorTex);
  }
  /** @internal */
  prefilter(device: AbstractDevice, srcTexture: Texture2D, rt: Texture2D) {
    this._thresholdValue.x = this._threshold * this._threshold;
    this._thresholdValue.y = this._thresholdValue.x * this._thresholdKnee;
    this._thresholdValue.z = 2 * this._thresholdValue.y;
    this._thresholdValue.w = 0.25 / (this._thresholdValue.y + 0.00001);
    this._thresholdValue.y -= this._thresholdValue.x;
    device.setFramebuffer([rt]);
    device.setViewport(null);
    device.setScissor(null);
    device.setProgram(Bloom._programPrefilter);
    device.setBindGroup(0, Bloom._bindgroupPrefilter!);
    Bloom._bindgroupPrefilter!.setTexture('tex', srcTexture);
    Bloom._bindgroupPrefilter!.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    Bloom._bindgroupPrefilter!.setValue('threshold', this._thresholdValue);
    // Half-texel diagonals of the *source*, so each fetch lands on a 2x2 group boundary.
    this._invTexSize.setXY(1 / srcTexture.width, 1 / srcTexture.height);
    Bloom._bindgroupPrefilter!.setValue('invTexSize', this._invTexSize);
    Bloom._bindgroupPrefilter!.setValue('karis', this._karisAverage ? 1 : 0);
    this.drawFullscreenQuad();
  }
  /** @internal */
  finalCompose(device: AbstractDevice, srcTexture: Texture2D, bloomTexture: Texture2D, srgbOutput: boolean) {
    device.setProgram(Bloom._programFinalCompose);
    device.setBindGroup(0, Bloom._bindgroupFinalCompose!);
    Bloom._bindgroupFinalCompose!.setTexture('srcTex', srcTexture);
    Bloom._bindgroupFinalCompose!.setTexture('bloomTex', bloomTexture);
    Bloom._bindgroupFinalCompose!.setValue('intensity', this._intensity);
    // Legacy lighting puts Bloom last in the chain (see Camera.syncPostProcessingMode), so this
    // pass may be the one writing the sRGB screen. Without this the whole frame is handed to the
    // display scene-linear and everything darkens the moment bloom is switched on.
    Bloom._bindgroupFinalCompose!.setValue('srgbOut', srgbOutput ? 1 : 0);
    Bloom._bindgroupFinalCompose!.setValue(
      'flip',
      device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0
    );
    this.drawFullscreenQuad();
  }
  /** @internal */
  upsample(device: AbstractDevice, textures: Texture2D[]) {
    for (let i = textures.length - 2; i >= 0; i--) {
      this.upsampleInto(device, textures[i + 1], textures[i]);
    }
  }
  /** @internal */
  private upsampleInto(device: AbstractDevice, srcTexture: Texture2D, dstTexture: Texture2D) {
    device.setProgram(Bloom._programUpsample);
    device.setBindGroup(0, Bloom._bindgroupUpsample!);
    Bloom._bindgroupUpsample!.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    Bloom._bindgroupUpsample!.setTexture('tex', srcTexture);
    // Tent offsets are in source-texel units, so the filter widens with the level it reads
    // from and every level contributes a similarly shaped blur in screen space.
    this._invTexSize.setXY(1 / srcTexture.width, 1 / srcTexture.height);
    Bloom._bindgroupUpsample!.setValue('invTexSize', this._invTexSize);
    Bloom._bindgroupUpsample!.setValue('radius', this._filterRadius);
    device.setFramebuffer([dstTexture]);
    device.setViewport(null);
    device.setScissor(null);
    this.drawFullscreenQuad(Bloom._renderStateAdditive!);
  }
  /** @internal */
  private blurH(device: AbstractDevice, srcTexture: Texture2D, dstTexture: Texture2D) {
    this._invTexSize.setXY(1 / srcTexture.width, 1 / srcTexture.height);
    device.setFramebuffer([dstTexture]);
    device.setViewport(null);
    device.setScissor(null);
    device.setProgram(Bloom._programDownsampleH);
    device.setBindGroup(0, Bloom._bindgroupDownsampleH!);
    Bloom._bindgroupDownsampleH!.setTexture('tex', srcTexture);
    Bloom._bindgroupDownsampleH!.setValue('invTexSize', this._invTexSize);
    Bloom._bindgroupDownsampleH!.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private blurV(device: AbstractDevice, srcTexture: Texture2D, dstTexture: Texture2D) {
    this._invTexSize.setXY(1 / srcTexture.width, 1 / srcTexture.height);
    device.setFramebuffer([dstTexture]);
    device.setViewport(null);
    device.setScissor(null);
    device.setProgram(Bloom._programDownsampleV);
    device.setBindGroup(0, Bloom._bindgroupDownsampleV!);
    Bloom._bindgroupDownsampleV!.setTexture('tex', srcTexture);
    Bloom._bindgroupDownsampleV!.setValue('invTexSize', this._invTexSize);
    Bloom._bindgroupDownsampleV!.setValue('flip', device.type === 'webgpu' ? 1 : 0);
    this.drawFullscreenQuad();
  }
  /** @internal */
  downsample(device: AbstractDevice, inputColorTexture: Texture2D, textures: Texture2D[]) {
    const t = Math.max(2, this._downsampleLimit);
    let w = Math.max(t, inputColorTexture.width >> 1);
    let h = Math.max(t, inputColorTexture.height >> 1);
    let maxLevels = Math.max(this._maxDownsampleLevels, 1);
    let sourceTex = inputColorTexture;
    while ((w >= t || h >= t) && maxLevels > 0) {
      const tex = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);
      textures.push(tex);

      const texMiddle = device.pool.fetchTemporalTexture2D(false, inputColorTexture.format, w, h, false);

      this.blurH(device, sourceTex, texMiddle);
      this.blurV(device, texMiddle, tex);

      maxLevels--;
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      sourceTex = tex;

      device.pool.releaseTexture(texMiddle);
    }
  }
  /** @internal */
  private _prepare(device: AbstractDevice, _srcTexture: Texture2D) {
    if (!Bloom._programFinalCompose) {
      Bloom._programFinalCompose = device.buildRenderProgram({
        vertex(pb) {
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
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().uniform(0);
          this.bloomTex = pb.tex2D().uniform(0);
          this.intensity = pb.float().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.srcSample = pb.textureSampleLevel(this.srcTex, this.$inputs.uv, 0);
            this.$l.bloomSample = pb.textureSampleLevel(this.bloomTex, this.$inputs.uv, 0);
            // Both inputs are camera pre-exposed (~1.0), so no unit conversion is needed.
            //
            // Sanitize each input explicitly rather than relying on clamp() to absorb a NaN: for a
            // NaN operand clamp only yields 0 because max(NaN, 0) happens to return its second
            // argument on most hardware, which the spec does not require. The scene color reaches
            // this pass without going through the prefilter, so this is its only guard.
            this.$l.src = this.$choice(
              pb.all(pb.lessThan(pb.abs(this.srcSample.rgb), pb.vec3(1e30))),
              this.srcSample.rgb,
              pb.vec3(0)
            );
            this.$l.bloom = this.$choice(
              pb.all(pb.lessThan(pb.abs(this.bloomSample.rgb), pb.vec3(1e30))),
              this.bloomSample.rgb,
              pb.vec3(0)
            );
            // The clamp then only guards the half-float write against accumulated overshoot.
            this.$l.composed = pb.clamp(
              pb.add(this.src, pb.mul(this.bloom, this.intensity)),
              pb.vec3(0),
              pb.vec3(Bloom.HALF_FLOAT_MAX)
            );
            // Only when this pass writes the screen directly; intermediate targets stay linear.
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.composed = linearToGamma(this, pb.clamp(this.composed, pb.vec3(0), pb.vec3(1)));
            });
            this.$outputs.outColor = pb.vec4(this.composed, 1);
          });
        }
      })!;
      Bloom._programFinalCompose.name = '@Bloom_FinalCompose';
      Bloom._bindgroupFinalCompose = device.createBindGroup(Bloom._programFinalCompose.bindGroupLayouts[0]);
    }
    if (!Bloom._programPrefilter) {
      Bloom._programPrefilter = device.buildRenderProgram({
        vertex(pb) {
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
        },
        fragment(pb) {
          this.tex = pb.tex2D().uniform(0);
          this.threshold = pb.vec4().uniform(0);
          this.invTexSize = pb.vec2().uniform(0);
          this.karis = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // This pass is also the first (full -> half resolution) downsample, which is where the
            // Call of Duty presentation puts the Karis average: a lone very bright texel -- a
            // specular hit where a normal map happens to put NdotL near 1 -- otherwise dominates
            // its 2x2 group, and flickers violently as the surface moves. Weighting each tap by
            // 1/(1+luma) lets the group's dimmer texels hold that spike down.
            //
            // The four taps sit at half-texel diagonals so each bilinear fetch already averages a
            // 2x2 block of the source, giving 4 groups (16 source texels) for 4 fetches.
            this.$l.raw = pb.vec4(0);
            this.$if(pb.notEqual(this.karis, 0), function () {
              this.$l.o = pb.mul(this.invTexSize, 0.5);
              this.$l.acc = pb.vec3(0);
              this.$l.wsum = pb.float(0);
              const quad: [number, number][] = [
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1]
              ];
              for (const [dx, dy] of quad) {
                this.$l.s = pb.textureSampleLevel(
                  this.tex,
                  pb.add(this.$inputs.uv, pb.mul(this.o, pb.vec2(dx, dy))),
                  0
                ).rgb;
                // Reject non-finite taps here too; see the guard below for why.
                this.s = this.$choice(
                  pb.all(pb.lessThan(pb.abs(this.s), pb.vec3(1e30))),
                  pb.clamp(this.s, pb.vec3(0), pb.vec3(Bloom.HALF_FLOAT_MAX)),
                  pb.vec3(0)
                );
                // Karis weight uses perceived luminance, matching the original.
                this.$l.w = pb.div(1, pb.add(1, pb.dot(this.s, pb.vec3(0.2126, 0.7152, 0.0722))));
                this.acc = pb.add(this.acc, pb.mul(this.s, this.w));
                this.wsum = pb.add(this.wsum, this.w);
              }
              this.raw = pb.vec4(pb.div(this.acc, pb.max(this.wsum, 0.0001)), 1);
            }).$else(function () {
              this.raw = pb.textureSampleLevel(this.tex, this.$inputs.uv, 0);
            });
            // Reject non-finite input before any arithmetic. An Inf makes the contribution below
            // evaluate Inf/Inf = NaN, and a NaN survives every subsequent operation: the separable
            // blur smears it across the coarsest mip and the upsample chain expands that single
            // texel into a 2^maxDownsampleLevels black block on screen.
            //
            // Non-finite samples are dropped rather than clamped. With CPU pre-exposure the HDR
            // target sits near 1.0, so an Inf/NaN here means an upstream pass (SSR, SSGI, TAA
            // reprojection) produced garbage; contributing nothing is the conservative choice and
            // matches how SSGI sanitizes its own ray payloads. Finite values are still clamped so
            // the additive upsample cannot overflow the half-float target either.
            this.$l.finite = pb.all(pb.lessThan(pb.abs(this.raw.rgb), pb.vec3(1e30)));
            this.$l.p = this.$choice(
              this.finite,
              pb.clamp(this.raw.rgb, pb.vec3(0), pb.vec3(Bloom.HALF_FLOAT_MAX)),
              pb.vec3(0)
            );
            this.$l.brightness = pb.max(pb.max(this.p.r, this.p.g), this.p.b);
            this.$l.soft = pb.clamp(pb.add(this.brightness, this.threshold.y), 0, this.threshold.z);
            this.soft = pb.mul(this.soft, this.soft, this.threshold.w);
            this.$l.contrib = pb.div(
              pb.max(this.soft, pb.sub(this.brightness, this.threshold.x)),
              pb.max(this.brightness, 0.00001)
            );
            this.$outputs.outColor = pb.vec4(pb.mul(this.p, this.contrib), 1);
          });
        }
      })!;
      Bloom._programPrefilter.name = '@Bloom_Prefilter';
      Bloom._bindgroupPrefilter = device.createBindGroup(Bloom._programPrefilter.bindGroupLayouts[0]);
    }
    if (!Bloom._programUpsample) {
      Bloom._programUpsample = device.buildRenderProgram({
        vertex(pb) {
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
        },
        fragment(pb) {
          this.tex = pb.tex2D().uniform(0);
          this.invTexSize = pb.vec2().uniform(0);
          this.radius = pb.float().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            // 3x3 tent filter, the upsample kernel from "Next Generation Post Processing in
            // Call of Duty: Advanced Warfare". A bare bilinear tap here is what produced the
            // blocky halo: one coarse texel covers a large screen area, so the level's square
            // texel grid survives magnification and shows up as axis-aligned banding. The tent
            // weights (1 2 1 / 2 4 2 / 1 2 1) / 16 reconstruct a smooth ramp between texels.
            this.$l.o = pb.mul(this.invTexSize, this.radius);
            this.$l.sum = pb.vec3(0);
            const taps: [number, number, number][] = [
              [-1, -1, 1],
              [0, -1, 2],
              [1, -1, 1],
              [-1, 0, 2],
              [0, 0, 4],
              [1, 0, 2],
              [-1, 1, 1],
              [0, 1, 2],
              [1, 1, 1]
            ];
            for (const [dx, dy, w] of taps) {
              this.sum = pb.add(
                this.sum,
                pb.mul(
                  pb.textureSampleLevel(this.tex, pb.add(this.$inputs.uv, pb.mul(this.o, pb.vec2(dx, dy))), 0)
                    .rgb,
                  w / 16
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.sum, 1);
          });
        }
      })!;
      Bloom._programUpsample.name = '@Bloom_Upsample';
      Bloom._bindgroupUpsample = device.createBindGroup(Bloom._programUpsample.bindGroupLayouts[0]);
    }
    if (!Bloom._programDownsampleH) {
      const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
      const weights = [
        0.01621622, 0.05405405, 0.12162162, 0.19459459, 0.22702703, 0.19459459, 0.12162162, 0.05405405,
        0.01621622
      ];
      Bloom._programDownsampleH = device.buildRenderProgram({
        vertex(pb) {
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
        },
        fragment(pb) {
          this.invTexSize = pb.vec2().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.sum = pb.vec3(0);
            this.$l.offset = pb.float();
            for (let i = 0; i < 9; i++) {
              this.offset = pb.mul(this.invTexSize.x, offsets[i] * 2);
              this.sum = pb.add(
                this.sum,
                pb.mul(
                  pb.textureSampleLevel(this.tex, pb.add(this.$inputs.uv, pb.vec2(this.offset, 0)), 0).rgb,
                  weights[i]
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.sum, 1);
          });
        }
      })!;
      Bloom._programDownsampleH.name = '@Bloom_DownsampleH';
      Bloom._bindgroupDownsampleH = device.createBindGroup(Bloom._programDownsampleH.bindGroupLayouts[0]);
    }
    if (!Bloom._programDownsampleV) {
      const offsets = [-3.23076923, -1.38461538, 0.0, 1.38461538, 3.23076923];
      const weights = [0.07027027, 0.31621622, 0.22702703, 0.31621622, 0.07027027];
      Bloom._programDownsampleV = device.buildRenderProgram({
        vertex(pb) {
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
        },
        fragment(pb) {
          this.invTexSize = pb.vec2().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.sum = pb.vec3(0);
            this.$l.offset = pb.float();
            for (let i = 0; i < 5; i++) {
              this.offset = pb.mul(this.invTexSize.y, offsets[i]);
              this.sum = pb.add(
                this.sum,
                pb.mul(
                  pb.textureSampleLevel(this.tex, pb.add(this.$inputs.uv, pb.vec2(0, this.offset)), 0).rgb,
                  weights[i]
                )
              );
            }
            this.$outputs.outColor = pb.vec4(this.sum, 1);
          });
        }
      })!;
      Bloom._programDownsampleV.name = '@Bloom_DownsampleV';
      Bloom._bindgroupDownsampleV = device.createBindGroup(Bloom._programDownsampleV.bindGroupLayouts[0]);
    }
    if (!Bloom._renderStateAdditive) {
      Bloom._renderStateAdditive = device.createRenderStateSet();
      Bloom._renderStateAdditive.useRasterizerState().setCullMode('none');
      Bloom._renderStateAdditive.useDepthState().enableTest(false).enableWrite(false);
      Bloom._renderStateAdditive
        .useBlendingState()
        .enable(true)
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('one', 'zero');
    }
  }
}
