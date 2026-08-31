import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import { SSR_interleavedGradientNoise } from '../shaders/ssr';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';

/**
 * The tonemap post effect
 * @public
 */
export class Tonemap extends AbstractPostEffect {
  /**
   * @internal
   *
   * ACES input calibration. Matches Filament's `ACESLegacy` tone mapper, which pre-scales its input
   * by `1 / 0.6` before the RRT+ODT fit. Applied in every lighting mode, independent of exposure.
   */
  static readonly ACES_INPUT_SCALE = 1 / 0.6;
  private static _programTonemap: Nullable<GPUProgram> = null;
  private static _bindgroupTonemap: Nullable<BindGroup> = null;
  private _exposure: number;
  private _dither: boolean;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    // End layer: the display chain runs after the TAA resolve (see Camera.setupPostEffects).
    this._layer = PostEffectLayer.end;
    this._exposure = 1;
    this._dither = true;
  }
  /**
   * Whether to dither the result before it is quantized to an 8-bit target.
   *
   * @remarks
   * Costs a handful of ALU operations and removes the banding that shallow gradients -- bloom
   * halos, smooth skies, fog -- otherwise show once rounded to 8 bits. The added noise is +-1 code
   * value, below the visible threshold on any ordinary display. Only applied when this pass writes
   * the final 8-bit target; a half-float intermediate is left untouched.
   *
   * Turn it off when capturing frames for pixel comparison, where reproducible output matters more
   * than smooth gradients.
   */
  get dither() {
    return this._dither;
  }
  set dither(val) {
    this._dither = !!val;
  }
  /**
   * Exposure multiplier applied before the ACES curve.
   *
   * @remarks
   * Physical lighting pre-exposes every light quantity on the CPU, so this stays at 1 there and
   * only legacy uses it as a brightness control.
   */
  get exposure() {
    return this._exposure;
  }
  set exposure(val) {
    this._exposure = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment() {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    this._prepare(device, inputColorTexture);
    this._tonemap(device, inputColorTexture, srgbOutput);
  }
  /** @internal */
  private _tonemap(device: AbstractDevice, inputColorTexture: Texture2D, sRGBOutput: boolean) {
    Tonemap._bindgroupTonemap!.setValue('srgbOut', sRGBOutput ? 1 : 0);
    // Only dither when this pass feeds an 8-bit target. Writing into a half-float intermediate
    // (an effect still follows) has ~11 bits of mantissa to spare, so noise there is pure loss.
    Tonemap._bindgroupTonemap!.setValue('dither', this._dither && sRGBOutput ? 1 : 0);
    Tonemap._bindgroupTonemap!.setValue('exposure', this._exposure * Tonemap.ACES_INPUT_SCALE);
    Tonemap._bindgroupTonemap!.setValue('flip', this.needFlip(device) ? 1 : 0);
    Tonemap._bindgroupTonemap!.setTexture('tex', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    device.setProgram(Tonemap._programTonemap);
    device.setBindGroup(0, Tonemap._bindgroupTonemap!);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice, _srcTexture: Texture2D) {
    if (!Tonemap._programTonemap) {
      Tonemap._programTonemap = device.buildRenderProgram({
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
          this.srgbOut = pb.int().uniform(0);
          this.exposure = pb.float().uniform(0);
          this.dither = pb.int().uniform(0);
          this.tex = pb.tex2D().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('RRTAndODTFit', [pb.vec3('v')], function () {
            this.$l.a = pb.sub(pb.mul(this.v, pb.add(this.v, pb.vec3(0.0245786))), pb.vec3(0.000090537));
            this.$l.b = pb.add(
              pb.mul(this.v, pb.add(pb.mul(this.v, 0.983729), pb.vec3(0.432951))),
              pb.vec3(0.238081)
            );
            this.$return(pb.div(this.a, this.b));
          });
          pb.main(function () {
            this.$l.vSample = pb.textureSample(this.tex, this.$inputs.uv);
            this.$l.ACESInputMat = pb.mat3(
              0.59719,
              0.076,
              0.0284,
              0.35458,
              0.90834,
              0.13383,
              0.04823,
              0.01566,
              0.83777
            );
            this.$l.ACESOutputMat = pb.mat3(
              1.60475,
              -0.10208,
              -0.00327,
              -0.53108,
              1.10813,
              -0.07276,
              -0.07367,
              -0.00605,
              1.07602
            );
            this.$l.color = pb.mul(this.vSample.rgb, this.exposure);
            this.color = pb.mul(this.ACESInputMat, this.color);
            this.color = this.RRTAndODTFit(this.color);
            this.color = pb.mul(this.ACESOutputMat, this.color);
            this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.color = linearToGamma(this, this.color);
            });
            // Dither before the 8-bit write. This pass ends the HDR chain, so it is where a
            // shallow gradient gets quantized -- and a bloom halo is the shallowest gradient the
            // renderer produces: it can fall by less than 1/255 over several pixels, which
            // rounding turns into wide flat bands. Offsetting each pixel by well under one code
            // value before rounding trades those bands for noise below the visible threshold.
            //
            // The offset is a triangular PDF (sum of two uniforms), which is what audio and video
            // dithering use: unlike a single uniform it leaves no residual correlation between the
            // quantization error and the signal, so the bands do not merely move.
            this.$if(pb.notEqual(this.dither, 0), function () {
              // Interleaved gradient noise, the same helper the SSR and eye passes use. Two
              // decorrelated samples (the second offset by a half-period) sum to the triangular
              // distribution; (n1 + n2 - 1) then spans [-1, 1], scaled here to +-1 code value.
              this.$l.n1 = SSR_interleavedGradientNoise(this, this.$builtins.fragCoord.xy, 0);
              this.$l.n2 = SSR_interleavedGradientNoise(
                this,
                pb.add(this.$builtins.fragCoord.xy, pb.vec2(37, 17)),
                0
              );
              this.color = pb.add(this.color, pb.vec3(pb.div(pb.sub(pb.add(this.n1, this.n2), 1), 255)));
              this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
            });
            this.$outputs.outColor = pb.vec4(this.color, 1);
          });
        }
      })!;
      Tonemap._programTonemap.name = '@Tonemap';
      Tonemap._bindgroupTonemap = device.createBindGroup(Tonemap._programTonemap.bindGroupLayouts[0]);
    }
  }
}
