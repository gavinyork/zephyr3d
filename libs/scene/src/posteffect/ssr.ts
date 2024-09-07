import { AbstractPostEffect } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D, TextureSampler } from '@zephyr3d/device';
import type { DrawContext } from '../render';

/**
 * SSR post effect
 *
 * @remarks
 * Internal used in light pass
 *
 * @internal
 */
export class SSR extends AbstractPostEffect {
  private static _program: GPUProgram = null;
  private static _sampler: TextureSampler = null;
  private _roughnessTex: Texture2D;
  private _bindgroup: BindGroup;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._opaque = true;
    this._bindgroup = null;
    this._roughnessTex = null;
  }
  get roughnessTexture() {
    return this._roughnessTex;
  }
  set roughnessTexture(tex: Texture2D) {
    this._roughnessTex = tex;
  }
  /** {@inheritDoc AbstractPostEffect.dispose} */
  dispose() {
    super.dispose();
    this._bindgroup?.dispose();
    this._bindgroup = null;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    this._prepare(device);
    this._bindgroup.setTexture('colorTex', inputColorTexture, SSR._sampler);
    this._bindgroup.setTexture('roughnessTex', this._roughnessTex, SSR._sampler);
    this._bindgroup.setValue('flip', this.needFlip(device) ? 1 : 0);
    this._bindgroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    device.setProgram(SSR._program);
    device.setBindGroup(0, this._bindgroup);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice) {
    if (!SSR._program) {
      SSR._program = device.buildRenderProgram({
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
          this.colorTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.roughnessTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.color = pb.textureSample(this.roughnessTex, this.$inputs.uv);
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = this.color;
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color.rgb), this.color.a);
            });
          });
        }
      });
    }
    if (!SSR._sampler) {
      SSR._sampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none',
        addressU: 'clamp',
        addressV: 'clamp'
      });
    }
    if (!this._bindgroup) {
      this._bindgroup = device.createBindGroup(SSR._program.bindGroupLayouts[0]);
    }
  }
}
