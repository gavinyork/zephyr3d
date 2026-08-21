import { DEPTH_FARTHEST, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderHelper } from '../material';
import { SKIN_SSS_LDR_ENCODE_RANGE } from '../material/skin';
import { SubsurfaceProfile } from '../material/subsurfaceprofile';
import { burleyDiffusionWeight } from '../shaders/diffusion';
import { linearToGamma } from '../shaders/misc';
import { fetchSampler } from '../utility/misc';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';

/** Taps per side of the separable kernel. The full kernel is `2 * TAPS + 1` wide. */
const SKIN_SSS_TAPS = 8;

/**
 * Stylized screen-space skin scattering pass.
 *
 * @remarks
 * {@link SkinMaterial} writes the diffusible part of its lit color - the stylized diffuse ramp
 * plus back-lit transmission, without specular - into a side buffer. This pass diffuses that
 * buffer with a channel-dependent kernel and swaps it back in:
 *
 * ```
 * result = base + (diffused - original) * scatterTint * strength + diffused * glow
 * ```
 *
 * Because the term added back replaces exactly the term subtracted, the redistribution is energy
 * conserving: light that appears on the dark side of the terminator is light that left the lit
 * side, rather than light invented on top of a finished image. With `scatterTint` white and
 * `glow` zero the total radiance is preserved to within the kernel's normalization error.
 *
 * Two things follow from that formulation and are worth knowing:
 *
 * - Nothing happens where the diffusion changes nothing, so a disabled or zero-radius pass is a
 *   true no-op, and quantization from an 8-bit side buffer largely cancels between the subtracted
 *   and added terms instead of banding across the whole face.
 * - `scatterTint` colors only the light that actually moved. Tinting the whole diffuse - what the
 *   material used to do with `scatterColor` - is what made the old look read as red haze.
 *
 * Stylization survives in two places. The material owns the direct lighting ramp (wrap, softness,
 * shadow tint, brightening) and this pass diffuses whatever ramp it produced; and {@link profile}
 * selects the channel radii, so the `wax` and `jade` presets are as reachable as `skin`.
 *
 * This is intentionally separate from the profile-based {@link SSS} pass, which supports per-pixel
 * profiles via a profile-slot MRT. Here a single global profile lives in uniforms.
 *
 * @public
 */
export class SkinSSS extends AbstractPostEffect {
  private static _blurProgram: GPUProgram | null = null;
  private static _combineProgram: GPUProgram | null = null;
  private _blurBindGroupH: BindGroup | null;
  private _blurBindGroupV: BindGroup | null;
  private _combineBindGroup: BindGroup | null;
  private _profile: SubsurfaceProfile | null;
  private _strength: number;
  private _glow: number;
  private _opacity: number;
  private _sampleStep: number;
  private _depthScale: number;
  private _colorBoost: number;
  private _scatterRadius: number;
  private _smoothness: number;
  private readonly _scatterTint: Vector4;
  private readonly _channelRadius: Vector3;
  private readonly _channelFalloff: Vector3;
  private readonly _blurDirection: Vector2;
  private readonly _radiusParams: Vector4;
  private readonly _targetSize: Vector4;
  private readonly _cameraNearFar: Vector2;

  constructor() {
    super();
    this._layer = PostEffectLayer.opaque;
    this._blurBindGroupH = null;
    this._blurBindGroupV = null;
    this._combineBindGroup = null;
    this._profile = null;
    this._strength = 1;
    this._glow = 0;
    this._opacity = 0.18;
    this._sampleStep = 3;
    this._depthScale = 80;
    this._colorBoost = 1;
    this._scatterRadius = 0.02;
    this._smoothness = 0;
    this._scatterTint = new Vector4(1, 1, 1, 1);
    this._channelRadius = new Vector3(1, 1, 1);
    this._channelFalloff = new Vector3(1, 1, 1);
    this._blurDirection = new Vector2();
    this._radiusParams = new Vector4();
    this._targetSize = new Vector4();
    this._cameraNearFar = new Vector2();
  }

  /**
   * Subsurface profile supplying the per-channel scatter radii and falloff.
   *
   * @remarks
   * Defaults to {@link SubsurfaceProfile.getDefaultSkinProfile} when unset. Only the channel
   * ratios of `scatterRadius` and the `falloffColor` are read; the absolute distance comes from
   * {@link SkinSSS.scatterRadius}, so switching profiles changes the color of the bleed without
   * changing how far it reaches.
   *
   * The channel ratios are what make skin read as skin - red travels several times further than
   * blue, which is the red-to-orange-to-yellow gradient at the terminator. They are also the main
   * stylization lever: the `wax` and `jade` presets are the same code path with different ratios.
   */
  get profile(): SubsurfaceProfile | null {
    return this._profile;
  }
  set profile(val: SubsurfaceProfile | null) {
    this._profile = val ?? null;
  }

  /** Final blend strength of the conserving redistribution. 1 fully diffuses the skin diffuse. */
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = Math.max(0, val ?? 0);
  }

  /**
   * Additive, deliberately non-conserving bleed layered on top of the conserving result.
   *
   * @remarks
   * 0 (the default) keeps the pass energy conserving. Raising it adds the diffused term a second
   * time without subtracting anything, which is the glow-heavy look the pass produced before it
   * conserved energy; around 1 approximates it. Use it when the art direction wants skin to read
   * as lit from within rather than as a physical surface.
   */
  get glow() {
    return this._glow;
  }
  set glow(val) {
    this._glow = Math.max(0, val ?? 0);
  }

  /**
   * Tint applied to the redistributed light.
   *
   * @remarks
   * White (the default) leaves the pass energy conserving. A warm tint pushes the classic reddish
   * terminator further than the profile's channel radii do on their own. Because it multiplies
   * only the difference between the diffused and original diffuse, it cannot wash the whole
   * surface - only the light that moved.
   */
  get scatterTint(): Vector4 {
    return this._scatterTint;
  }
  set scatterTint(val: Vector4) {
    this._scatterTint.set(val);
  }

  /** Skin mask coverage threshold. Scattering fades in as the blurred mask coverage exceeds this. */
  get opacity() {
    return this._opacity;
  }
  set opacity(val) {
    this._opacity = Math.max(0, Math.min(1, val ?? 0));
  }

  /**
   * Maximum pixel spacing between blur taps. Caps the projected scatter radius for close-ups.
   *
   * @remarks
   * With `SKIN_SSS_TAPS` taps per side the kernel reaches `sampleStep * SKIN_SSS_TAPS` pixels, so
   * this is the real limit on scatter width. The separable form makes taps cheap enough that the
   * default no longer has to be tight: the old single-pass 9x9 kernel capped out at 8 pixels, and
   * a face in close-up projects a 2 cm scatter radius far past that - the shot that needs the most
   * scattering used to get the least.
   */
  get sampleStep() {
    return this._sampleStep;
  }
  set sampleStep(val) {
    this._sampleStep = Math.max(0.25, Math.min(6, val ?? 0.25));
  }

  /** World-space scatter radius. The blur width shrinks with distance to keep this constant. */
  get scatterRadius() {
    return this._scatterRadius;
  }
  set scatterRadius(val) {
    this._scatterRadius = Math.max(0, val ?? 0);
  }

  /**
   * Skin smoothing amount ("beauty filter"). Blends the lit color toward a mask- and depth-weighted
   * blur of itself on skin pixels, removing pore and albedo detail while facial features stay sharp
   * wherever the skin mask excludes them (eyes, brows, lips). 0 disables smoothing.
   *
   * @remarks
   * This is separate from the diffusion and stacks on top of it. The diffusion blurs *lighting*
   * only; albedo detail such as pores and blemishes passes through it untouched, which is correct
   * but is not what a beauty filter is for.
   */
  get smoothness() {
    return this._smoothness;
  }
  set smoothness(val) {
    this._smoothness = Math.max(0, Math.min(1, val ?? 0));
  }

  /** Depth rejection scale. The reference shader uses 80. */
  get depthScale() {
    return this._depthScale;
  }
  set depthScale(val) {
    this._depthScale = Math.max(0, val ?? 0);
  }

  /** Multiplier applied to the diffused irradiance before compositing. */
  get colorBoost() {
    return this._colorBoost;
  }
  set colorBoost(val) {
    this._colorBoost = Math.max(0, val ?? 0);
  }

  requireLinearDepthTexture() {
    return true;
  }

  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    if (!ctx.SkinSSSTexture || this._strength <= 0) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
      return;
    }
    const device = ctx.device;
    const outputFramebuffer = device.getFramebuffer();
    const skinTex = ctx.SkinSSSTexture;
    if (!SkinSSS._blurProgram) {
      SkinSSS._blurProgram = this.createBlurProgram(ctx);
    }
    if (!SkinSSS._combineProgram) {
      SkinSSS._combineProgram = this.createCombineProgram(ctx);
    }
    const blurProgram = SkinSSS._blurProgram;
    const combineProgram = SkinSSS._combineProgram;
    if (!this._blurBindGroupH) {
      // Two bind groups rather than one program per direction: the only thing
      // that differs is the step vector, and rewriting it between draws would
      // race the first draw's read of it.
      this._blurBindGroupH = device.createBindGroup(blurProgram.bindGroupLayouts[0]);
      this._blurBindGroupV = device.createBindGroup(blurProgram.bindGroupLayouts[0]);
    }
    if (!this._combineBindGroup) {
      this._combineBindGroup = device.createBindGroup(combineProgram.bindGroupLayouts[0]);
    }

    const profile = this._profile ?? SubsurfaceProfile.getDefaultSkinProfile();
    const radius = profile.scatterRadius;
    const maxChannel = Math.max(radius.x, radius.y, radius.z, 1e-5);
    this._channelRadius.setXYZ(radius.x / maxChannel, radius.y / maxChannel, radius.z / maxChannel);
    const falloff = profile.falloffColor;
    this._channelFalloff.setXYZ(falloff.x, falloff.y, falloff.z);

    // Pixels per world unit at unit view depth. The shader divides by view depth
    // so the footprint stays a constant world-space radius.
    const projScale = 0.5 * inputColorTexture.height * ctx.camera.getProjectionMatrix().m11;
    this._radiusParams.setXYZW(
      this._scatterRadius * projScale,
      ctx.camera.isPerspective() ? 1 : 0,
      this._sampleStep,
      this._depthScale
    );
    this._targetSize.setXYZW(
      inputColorTexture.width,
      inputColorTexture.height,
      1 / inputColorTexture.width,
      1 / inputColorTexture.height
    );
    this._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    const encodeScale = skinTex.format === 'rgba8unorm' ? SKIN_SSS_LDR_ENCODE_RANGE : 1;

    const blurH = device.pool.fetchTemporalFramebuffer(
      false,
      skinTex.width,
      skinTex.height,
      skinTex.format,
      null,
      false
    );
    const blurV = device.pool.fetchTemporalFramebuffer(
      false,
      skinTex.width,
      skinTex.height,
      skinTex.format,
      null,
      false
    );

    device.setFramebuffer(blurH);
    this.blur(ctx, blurProgram, this._blurBindGroupH!, skinTex, sceneDepthTexture, true);
    device.setFramebuffer(blurV);
    this.blur(
      ctx,
      blurProgram,
      this._blurBindGroupV!,
      blurH.getColorAttachments()[0] as Texture2D,
      sceneDepthTexture,
      false
    );

    device.setFramebuffer(outputFramebuffer);
    this.combine(
      ctx,
      combineProgram,
      inputColorTexture,
      skinTex,
      blurV.getColorAttachments()[0] as Texture2D,
      sceneDepthTexture,
      encodeScale,
      srgbOutput
    );

    device.pool.releaseFrameBuffer(blurH);
    device.pool.releaseFrameBuffer(blurV);
  }

  private blur(
    ctx: DrawContext,
    program: GPUProgram,
    bindGroup: BindGroup,
    source: Texture2D,
    sceneDepthTexture: Texture2D,
    horizontal: boolean
  ) {
    const device = ctx.device;
    this._blurDirection.setXY(horizontal ? 1 : 0, horizontal ? 0 : 1);
    bindGroup.setTexture('skinTex', source, fetchSampler('clamp_linear'));
    bindGroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('cameraNearFar', this._cameraNearFar);
    bindGroup.setValue('targetSize', this._targetSize);
    bindGroup.setValue('radiusParams', this._radiusParams);
    bindGroup.setValue('channelRadius', this._channelRadius);
    bindGroup.setValue('channelFalloff', this._channelFalloff);
    bindGroup.setValue('blurDirection', this._blurDirection);
    bindGroup.setValue('flip', 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }

  private combine(
    ctx: DrawContext,
    program: GPUProgram,
    colorTexture: Texture2D,
    skinTexture: Texture2D,
    blurredTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    encodeScale: number,
    srgbOutput: boolean
  ) {
    const device = ctx.device;
    const bindGroup = this._combineBindGroup!;
    bindGroup.setTexture('colorTex', colorTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture('skinTex', skinTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture('blurredTex', blurredTexture, fetchSampler('clamp_linear'));
    bindGroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setValue('cameraNearFar', this._cameraNearFar);
    bindGroup.setValue('targetSize', this._targetSize);
    bindGroup.setValue('radiusParams', this._radiusParams);
    bindGroup.setValue('scatterTint', this._scatterTint);
    bindGroup.setValue('strength', this._strength);
    bindGroup.setValue('glow', this._glow);
    bindGroup.setValue('opacity', this._opacity);
    bindGroup.setValue('colorBoost', this._colorBoost);
    bindGroup.setValue('encodeScale', encodeScale);
    bindGroup.setValue('smoothness', this._smoothness);
    bindGroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    this.drawFullscreenQuad();
  }

  /** Shared fullscreen vertex stage for both passes. */
  private static fullscreenVertex(pb: any) {
    pb.getGlobalScope().flip = pb.int().uniform(0);
    pb.getGlobalScope().$inputs.pos = pb.vec2().attrib('position');
    pb.getGlobalScope().$outputs.uv = pb.vec2();
    pb.main(function (this: any) {
      this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
      this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
      this.$if(pb.notEqual(this.flip, 0), function (this: any) {
        this.$builtins.position.y = pb.neg(this.$builtins.position.y);
      });
    });
  }

  private createBlurProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.skinTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        // x: world scatter radius in pixels at unit depth, y: 1 for perspective,
        // z: max tap spacing, w: depth rejection scale.
        this.radiusParams = pb.vec4().uniform(0);
        this.channelRadius = pb.vec3().uniform(0);
        this.channelFalloff = pb.vec3().uniform(0);
        this.blurDirection = pb.vec2().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.center = pb.textureSampleLevel(this.skinTex, this.uv, 0);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$outputs.outColor = this.center;
          // Background, or a pixel no skin material wrote: nothing to diffuse.
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.center.a, 1e-4)),
            function () {
              this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
              // Per-channel radius in pixels. Red reaches several times further
              // than blue, which is the whole point - a shared radius is what
              // makes Gaussian SSS read as a flat haze.
              this.$l.viewScale = pb.max(pb.mix(pb.float(1), this.centerDepth, this.radiusParams.y), 1e-4);
              this.$l.radiusPx = pb.div(pb.mul(this.channelRadius, this.radiusParams.x), this.viewScale);
              // Burley shaping distance per channel; falloff tightens or widens
              // the profile without changing its reach.
              this.$l.shape = pb.vec3(
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.x, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.y, 0.05, 1)),
                pb.mix(0.72, 1.46, pb.clamp(this.channelFalloff.z, 0.05, 1))
              );
              this.$l.shapeDist = pb.max(pb.mul(this.radiusPx, this.shape), pb.vec3(1e-3));
              // Tap spacing follows the widest channel so the longest tail is
              // resolved; the narrower channels simply weight down sooner.
              this.$l.maxRadiusPx = pb.max(pb.max(this.radiusPx.x, this.radiusPx.y), this.radiusPx.z);
              this.$l.stepPx = pb.clamp(pb.div(this.maxRadiusPx, SKIN_SSS_TAPS), 0, this.radiusParams.z);
              this.$l.stepUV = pb.mul(this.blurDirection, this.stepPx, this.targetSize.zw);
              this.$l.sum = pb.vec3(0);
              this.$l.weightSum = pb.vec3(0);
              this.$l.coverage = pb.float(0);
              this.$l.coverageWeight = pb.float(0);
              this.$for(pb.int('i'), -SKIN_SSS_TAPS, SKIN_SSS_TAPS + 1, function () {
                this.$l.fi = pb.float(this.i);
                this.$l.sampleUV = pb.clamp(
                  pb.add(this.uv, pb.mul(this.stepUV, this.fi)),
                  pb.vec2(0),
                  pb.vec2(1)
                );
                this.$l.dist = pb.mul(pb.abs(this.fi), this.stepPx);
                this.$l.w = pb.vec3(
                  burleyDiffusionWeight(this, this.dist, this.shapeDist.x),
                  burleyDiffusionWeight(this, this.dist, this.shapeDist.y),
                  burleyDiffusionWeight(this, this.dist, this.shapeDist.z)
                );
                this.$l.sampleDepth01 = this.readDepth01(this.sampleUV);
                this.$l.sampleDepth = pb.max(pb.mul(this.sampleDepth01, this.cameraNearFar.y), 1e-4);
                this.$l.depthWeight = pb.clamp(
                  pb.sub(
                    1,
                    pb.div(
                      pb.mul(pb.abs(pb.sub(this.centerDepth, this.sampleDepth)), this.radiusParams.w),
                      this.centerDepth
                    )
                  ),
                  0,
                  1
                );
                this.depthWeight = pb.mul(
                  this.depthWeight,
                  this.depthWeight,
                  pb.sub(3, pb.mul(this.depthWeight, 2))
                );
                this.$l.tapWeight = pb.mul(this.w, this.depthWeight);
                this.$l.tapSample = pb.textureSampleLevel(this.skinTex, this.sampleUV, 0);
                // Non-skin taps are excluded from the numerator *and* the
                // denominator. Leaving them in the denominator - as this pass
                // used to - drags the diffuse toward zero near every silhouette,
                // which was a mild darkening under the old additive composite
                // but would eat real light now that the term is subtracted back
                // out of the base color.
                this.$l.isSkin = pb.float(pb.greaterThan(this.tapSample.a, 1e-4));
                this.sum = pb.add(this.sum, pb.mul(this.tapSample.rgb, this.tapWeight, this.isSkin));
                this.weightSum = pb.add(this.weightSum, pb.mul(this.tapWeight, this.isSkin));
                // Coverage keeps its own accumulator: it is the skin fraction of
                // the neighbourhood, so it must count every tap in the
                // denominator, skin or not.
                this.coverage = pb.add(
                  this.coverage,
                  pb.mul(this.tapWeight.x, this.isSkin, this.tapSample.a)
                );
                this.coverageWeight = pb.add(this.coverageWeight, this.tapWeight.x);
              });
              this.$l.diffused = pb.div(this.sum, pb.max(this.weightSum, pb.vec3(1e-6)));
              this.$outputs.outColor = pb.vec4(
                this.diffused,
                pb.div(this.coverage, pb.max(this.coverageWeight, 1e-6))
              );
            }
          );
        });
      }
    })!;
    program.name = '@SkinSSSBlur';
    return program;
  }

  private createCombineProgram(ctx: DrawContext) {
    const program = ctx.device.buildRenderProgram({
      vertex(pb) {
        SkinSSS.fullscreenVertex(pb);
      },
      fragment(pb) {
        this.colorTex = pb.tex2D().uniform(0);
        this.skinTex = pb.tex2D().uniform(0);
        this.blurredTex = pb.tex2D().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.targetSize = pb.vec4().uniform(0);
        this.radiusParams = pb.vec4().uniform(0);
        this.scatterTint = pb.vec4().uniform(0);
        this.strength = pb.float().uniform(0);
        this.glow = pb.float().uniform(0);
        this.opacity = pb.float().uniform(0);
        this.colorBoost = pb.float().uniform(0);
        this.encodeScale = pb.float().uniform(0);
        this.smoothness = pb.float().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.func('readDepth01', [pb.vec2('uv')], function () {
          this.$return(ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0));
        });
        pb.main(function () {
          this.$l.uv = this.$inputs.uv;
          this.$l.baseColor = pb.textureSampleLevel(this.colorTex, this.uv, 0);
          this.$l.result = this.baseColor.rgb;
          this.$l.centerSkin = pb.textureSampleLevel(this.skinTex, this.uv, 0);
          this.$l.centerDepth01 = this.readDepth01(this.uv);
          this.$if(
            pb.and(pb.lessThan(this.centerDepth01, 1), pb.greaterThan(this.centerSkin.a, 1e-4)),
            function () {
              this.$l.blurred = pb.textureSampleLevel(this.blurredTex, this.uv, 0);
              // Both buffers carry the same LDR encoding, so decode once here.
              this.$l.original = pb.mul(this.centerSkin.rgb, this.encodeScale);
              this.$l.diffused = pb.mul(this.blurred.rgb, this.encodeScale, this.colorBoost);
              this.$l.coverage = pb.smoothStep(this.opacity, pb.add(this.opacity, 0.35), this.blurred.a);
              // Energy conserving core: swap the original diffuse for the
              // diffused one. The added term is exactly the subtracted term, so
              // brightening the dark side of the terminator darkens the lit side
              // by the same amount rather than adding light to the frame.
              this.$l.redistributed = pb.mul(
                pb.sub(this.diffused, this.original),
                this.scatterTint.rgb,
                this.strength,
                this.coverage
              );
              this.result = pb.add(this.baseColor.rgb, this.redistributed);
              // Explicit, opt-in departure from conservation.
              this.$if(pb.greaterThan(this.glow, 0), function () {
                this.result = pb.add(
                  this.result,
                  pb.mul(this.diffused, this.scatterTint.rgb, this.glow, this.coverage)
                );
              });
              // Beauty filter. Unlike the diffusion above this blurs the shaded
              // color itself, so it removes albedo detail (pores, blemishes)
              // that scattering physically leaves alone. Uniform branch: free
              // when disabled.
              this.$if(pb.greaterThan(this.smoothness, 0), function () {
                this.$l.centerDepth = pb.max(pb.mul(this.centerDepth01, this.cameraNearFar.y), 1e-4);
                this.$l.viewScale = pb.max(pb.mix(pb.float(1), this.centerDepth, this.radiusParams.y), 1e-4);
                this.$l.smoothStepPx = pb.clamp(
                  pb.div(pb.mul(this.radiusParams.x, 0.5), this.viewScale),
                  0,
                  this.radiusParams.z
                );
                this.$l.colorSum = pb.vec3(0);
                this.$l.colorWeight = pb.float(0);
                this.$for(pb.int('y'), -2, 3, function () {
                  this.$for(pb.int('x'), -2, 3, function () {
                    this.$l.offset = pb.mul(
                      pb.vec2(pb.float(this.x), pb.float(this.y)),
                      this.smoothStepPx,
                      this.targetSize.zw
                    );
                    this.$l.sampleUV = pb.clamp(pb.add(this.uv, this.offset), pb.vec2(0), pb.vec2(1));
                    // The skin mask is the edge stop, so eyes, brows and lips
                    // (mask 0) never bleed onto the surrounding skin.
                    this.$l.maskSample = pb.textureSampleLevel(this.skinTex, this.sampleUV, 0).a;
                    this.$l.w = pb.float(pb.greaterThan(this.maskSample, 1e-4));
                    this.colorSum = pb.add(
                      this.colorSum,
                      pb.mul(pb.textureSampleLevel(this.colorTex, this.sampleUV, 0).rgb, this.w)
                    );
                    this.colorWeight = pb.add(this.colorWeight, this.w);
                  });
                });
                this.$if(pb.greaterThan(this.colorWeight, 1e-4), function () {
                  this.result = pb.mix(
                    this.result,
                    pb.div(this.colorSum, this.colorWeight),
                    pb.mul(this.smoothness, this.coverage, this.centerSkin.a)
                  );
                });
              });
              // Precision can push the subtraction a hair below zero.
              this.result = pb.max(this.result, pb.vec3(0));
            }
          );
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.result, this.baseColor.a);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.result), this.baseColor.a);
          });
        });
      }
    })!;
    program.name = '@SkinSSSCombine';
    return program;
  }
}
