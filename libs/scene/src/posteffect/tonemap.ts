import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';

/**
 * The tonemap post effect
 * @public
 */
export class Tonemap extends AbstractPostEffect {
  private static _programTonemap: Nullable<GPUProgram> = null;
  private static _bindgroupTonemap: Nullable<BindGroup> = null;
  private _exposure: number;
  /**
   * Creates an instance of tonemap post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.transparent;
    this._exposure = 1;
  }
  /** Exposure value */
  get exposure(): number {
    return this._exposure;
  }
  set exposure(val: number) {
    this._exposure = val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
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
    Tonemap._bindgroupTonemap!.setValue('exposure', this._exposure);
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
            this.$l.color = pb.mul(this.vSample.rgb, pb.div(this.exposure, 0.6));
            this.color = pb.mul(this.ACESInputMat, this.color);
            this.color = this.RRTAndODTFit(this.color);
            this.color = pb.mul(this.ACESOutputMat, this.color);
            this.color = pb.clamp(this.color, pb.vec3(0), pb.vec3(1));
            this.$if(pb.notEqual(this.srgbOut, 0), function () {
              this.$l.color = linearToGamma(this, this.color);
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
