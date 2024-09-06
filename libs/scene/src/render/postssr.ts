import type { AbstractDevice, BindGroup, GPUProgram, Texture2D, TextureSampler } from '@zephyr3d/device';
import { isFloatTextureFormat } from '@zephyr3d/device';
import { AbstractPostEffect } from '../posteffect/posteffect';
import { CopyBlitter } from '../blitter';
import type { DrawContext } from '../render';

/**
 * The ScreenSpaceReflections post effect
 * @internal
 */
export class SSR extends AbstractPostEffect {
  private static _program: GPUProgram = null;
  private static _programHiZ: GPUProgram = null;
  private static _nearestSampler: TextureSampler = null;
  private _bindgroup: BindGroup;
  private _bindgroupHiZ: BindGroup;
  private _copyBlitter: CopyBlitter;
  private _supported: boolean;
  /**
   * Creates an instance of SSR post effect
   */
  constructor() {
    super();
    this._supported = true;
    this._opaque = true;
    this._copyBlitter = new CopyBlitter();
    this._bindgroup = null;
    this._bindgroupHiZ = null;
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
    this._prepare(device, inputColorTexture);
    this._copyBlitter.srgbOut = srgbOutput;
    this._copyBlitter.blit(inputColorTexture, device.getFramebuffer(), SSR._nearestSampler);
  }
  /** @internal */
  private _prepare(device: AbstractDevice, srcTexture: Texture2D) {
    const fb = device.getFramebuffer();
    const isFloatFramebuffer = fb && isFloatTextureFormat(fb.getColorAttachments()[0].format);
    this._supported = !isFloatFramebuffer || device.getDeviceCaps().framebufferCaps.supportFloatBlending;
    if (this._supported) {
      if (!SSR._nearestSampler) {
        SSR._nearestSampler = device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipFilter: 'none',
          addressU: 'clamp',
          addressV: 'clamp'
        });
      }
      function createProgram(HiZ: boolean) {
        return device.buildRenderProgram({
          vertex(pb) {
            this.flip = pb.int().uniform(0);
            this.$inputs.pos = pb.vec2().attrib('position');
            this.$outputs.uv = pb.vec2();
            pb.main(function () {
              this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
              this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
              this.$if(pb.notEqual(this.flip, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            });
          },
          fragment(pb) {
            this.$outputs.outColor = pb.vec4();
            pb.main(function () {
              this.$outputs.outColor = pb.vec4(1, 0, 0, 1);
            });
          }
        });
      }
      if (!SSR._program) {
        SSR._program = createProgram(false);
        SSR._programHiZ = createProgram(true);
      }
      if (!this._bindgroup) {
        this._bindgroup = device.createBindGroup(SSR._program.bindGroupLayouts[0]);
        this._bindgroupHiZ = device.createBindGroup(SSR._programHiZ.bindGroupLayouts[0]);
      }
    }
  }
  /** {@inheritDoc AbstractPostEffect.dispose} */
  dispose(): void {
    super.dispose();
    this._bindgroup?.dispose();
    this._bindgroup = null;
  }
}
