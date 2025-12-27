import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import type { Nullable } from '@zephyr3d/base';

/**
 * Grayscale post effect
 * @public
 */
export class Grayscale extends AbstractPostEffect {
  private static _program: Nullable<GPUProgram> = null;
  private static _bindgroup: Nullable<BindGroup> = null;
  /**
   * Creates an instance of grayscale post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.transparent;
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
    this._prepare(device);
    Grayscale._bindgroup!.setTexture('srcTex', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    Grayscale._bindgroup!.setValue('flip', this.needFlip(device) ? 1 : 0);
    Grayscale._bindgroup!.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(Grayscale._program);
    device.setBindGroup(0, Grayscale._bindgroup!);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice) {
    if (!Grayscale._program) {
      Grayscale._program = device.buildRenderProgram({
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
          this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.color = pb.textureSample(this.srcTex, this.$inputs.uv);
            this.$l.grayscaleColor = pb.vec3(pb.dot(this.$l.color.rgb, pb.vec3(0.299, 0.587, 0.114)));
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.grayscaleColor, this.color.a);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.grayscaleColor), this.color.a);
            });
          });
        }
      })!;
      Grayscale._program.name = '@Grayscale';
      Grayscale._bindgroup = device.createBindGroup(Grayscale._program.bindGroupLayouts[0]);
    }
  }
}
