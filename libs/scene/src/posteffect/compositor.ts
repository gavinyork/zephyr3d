import { Application } from "../app";
import { linearToGamma } from "../shaders/misc";
import type { DrawContext } from "../render";
import { TemporalCache } from "../render";
import type { AbstractDevice, BindGroup, FrameBuffer, GPUProgram, RenderStateSet, Texture2D, TextureSampler, VertexLayout } from "@zephyr3d/device";
import type { AbstractPostEffect } from "./posteffect";

/**
 * Posteffect rendering context
 * @public
 */
export interface CompositorContext {
  msFramebuffer?: FrameBuffer;
  pingpongFramebuffers: FrameBuffer[];
  finalFramebuffer: FrameBuffer;
  writeIndex: number;
}
/**
 * Post processing compositor
 * @public
 */
export class Compositor {
  /** @internal */
  protected _postEffectsOpaque: AbstractPostEffect[];
  /** @internal */
  protected _postEffectsTransparency: AbstractPostEffect[];
  /** @internal */
  private static _blitSampler: TextureSampler = null;
  /** @internal */
  private static _blitProgram: GPUProgram = null;
  /** @internal */
  private static _blitBindgroup: BindGroup = null;
  /** @internal */
  private static _blitRenderStates: RenderStateSet = null;
  /** @internal */
  private static _blitVertexLayout: VertexLayout = null;
  /**
   * Creates an instance of Compositor
   */
  constructor() {
    this._postEffectsOpaque = [];
    this._postEffectsTransparency = [];
  }
  /** @internal */
  requireLinearDepth(): boolean {
    for (const postEffect of this._postEffectsOpaque) {
      if (postEffect.requireLinearDepthTexture()) {
        return true;
      }
    }
    for (const postEffect of this._postEffectsTransparency) {
      if (postEffect.requireLinearDepthTexture()) {
        return true;
      }
    }
    return false;
  }
  /**
   * Adds a posteffect
   *
   * @param postEffect - The post effect to add
   * @param opaque - true if the post effect should be applied after the opaque pass and before the transparent pass, otherwise the post effect should be applied after the transparent pass
   */
  appendPostEffect(postEffect: AbstractPostEffect): void {
    if (postEffect) {
      if (this._postEffectsOpaque.indexOf(postEffect) >= 0 || this._postEffectsTransparency.indexOf(postEffect) >= 0) {
        console.error(`Posteffect cannot be added to same compositor multiple times`);
        return;
      }
      const postEffects = postEffect.opaque ? this._postEffectsOpaque : this._postEffectsTransparency;
      postEffects.push(postEffect);
    }
  }
  /**
   * Removes a posteffect that was previously added
   *
   * @param postEffect - The posteffect to be remove.
   */
  removePostEffect(postEffect: AbstractPostEffect): void {
    for (const list of [this._postEffectsOpaque, this._postEffectsTransparency]) {
      const index = list.indexOf(postEffect);
      if (index >= 0) {
        list.splice(index, 1);
        return;
      }
    }
  }
  /**
   * Gets all post effects
   */
  getPostEffects(): AbstractPostEffect[] {
    return [...this._postEffectsOpaque, ...this._postEffectsTransparency];
  }
  /** @internal */
  begin(ctx: DrawContext) {
    const device = Application.instance.device;
    const format = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm';
    const finalFramebuffer = device.getFramebuffer();
    const depth = finalFramebuffer?.getDepthAttachment() as Texture2D;
    let pingpongFramebuffers: FrameBuffer[];
    let msFramebuffer: FrameBuffer = null;
    if (ctx.primaryCamera.sampleCount > 1) {
      msFramebuffer = depth
        ? TemporalCache.getFramebufferVariantSizeWithDepth(depth, 1, format, '2d', false, ctx.primaryCamera.sampleCount)
        : TemporalCache.getFramebufferVariantSize(ctx.viewportWidth, ctx.viewportHeight, 1, format, ctx.depthFormat, '2d', '2d', false, ctx.primaryCamera.sampleCount);
    }
    if (ctx.defaultViewport) {
      pingpongFramebuffers = [
        depth
          ? TemporalCache.getFramebufferVariantSizeWithDepth(depth, 1, format, '2d', false, 1)
          : TemporalCache.getFramebufferVariantSize(ctx.viewportWidth, ctx.viewportHeight, 1, format, ctx.depthFormat, '2d', '2d', false, 1),
        depth
          ? TemporalCache.getFramebufferVariantSizeWithDepth(depth, 1, format, '2d', false, 1)
          : TemporalCache.getFramebufferVariantSize(ctx.viewportWidth, ctx.viewportHeight, 1, format, ctx.depthFormat, '2d', '2d', false, 1),
      ]
    } else {
      pingpongFramebuffers = [
        depth
          ? TemporalCache.getFramebufferFixedSizeWithDepth(depth, 1, format, '2d', false, 4)
          : TemporalCache.getFramebufferFixedSize(ctx.viewportWidth, ctx.viewportHeight, 1, format, ctx.depthFormat, '2d', '2d', false, 4),
        depth
          ? TemporalCache.getFramebufferFixedSizeWithDepth(depth, 1, format, '2d', false, 4)
          : TemporalCache.getFramebufferFixedSize(ctx.viewportWidth, ctx.viewportHeight, 1, format, ctx.depthFormat, '2d', '2d', false, 4),
      ]
    }
    let writeIndex: number;
    if (msFramebuffer) {
      writeIndex = 3;
      device.setFramebuffer(msFramebuffer);
    } else {
      writeIndex = 0;
      device.setFramebuffer(pingpongFramebuffers[writeIndex]);
    }
    device.setViewport(null);
    device.setScissor(null);
    ctx.compositorContex = {
      finalFramebuffer,
      pingpongFramebuffers,
      msFramebuffer,
      writeIndex
    };
  }
  /** @internal */
  drawPostEffects(ctx: DrawContext, opaque: boolean, sceneDepthTexture: Texture2D) {
    const postEffects = opaque ? this._postEffectsOpaque : this._postEffectsTransparency;
    if (postEffects.length > 0) {
      const device = Application.instance.device;
      for (let i = 0; i < postEffects.length; i++) {
        const postEffect = postEffects[i];
        if (!postEffect.enabled) {
          continue;
        }
        const inputTexture = device.getFramebuffer().getColorAttachments()[0] as Texture2D;
        const isLast = this.isLastPostEffect(opaque, i);
        const finalEffect = isLast && (!postEffect.requireDepthAttachment() || !!ctx.compositorContex.finalFramebuffer);
        if (finalEffect) {
          device.setFramebuffer(ctx.compositorContex.finalFramebuffer);
          device.setViewport(null);
          device.setScissor(null);
        } else {
          ctx.compositorContex.writeIndex = (1 + ctx.compositorContex.writeIndex) % 2;
          device.setFramebuffer(ctx.compositorContex.pingpongFramebuffers[ctx.compositorContex.writeIndex]);
          device.setViewport(null);
          device.setScissor(null);
        }
        postEffect.apply(ctx, inputTexture, sceneDepthTexture, !device.getFramebuffer());
      }
    }
  }
  /** @internal */
  end(ctx: DrawContext) {
    const device = Application.instance.device;
    if (device.getFramebuffer() !== ctx.compositorContex.finalFramebuffer) {
      const srcTex = device.getFramebuffer().getColorAttachments()[0] as Texture2D;
      device.setFramebuffer(ctx.compositorContex.finalFramebuffer);
      device.setViewport(null);
      device.setScissor(null);
      Compositor._blit(device, srcTex, !ctx.compositorContex.finalFramebuffer);
    }
    TemporalCache.releaseFramebuffer(ctx.compositorContex.pingpongFramebuffers[0]);
    TemporalCache.releaseFramebuffer(ctx.compositorContex.pingpongFramebuffers[1]);
    if (ctx.compositorContex.msFramebuffer) {
      TemporalCache.releaseFramebuffer(ctx.compositorContex.msFramebuffer);
    }
    ctx.compositorContex = null;
  }
  /** @internal */
  private isLastPostEffect(opaque: boolean, index: number) {
    const list = opaque ? this._postEffectsOpaque : this._postEffectsTransparency;
    for (let i = index; i < list.length; i++) {
      if (list[i].enabled) {
        return false;
      }
    }
    if (opaque) {
      for (let i = 0; i < this._postEffectsTransparency.length; i++) {
        if (this._postEffectsTransparency[i].enabled) {
          return false;
        }
      }
    }
    return true;
  }
  /** @internal */
  needDrawPostEffects(): boolean {
    for (let i = 0; i < this._postEffectsOpaque.length; i++) {
      if (this._postEffectsOpaque[i].enabled) {
        return true;
      }
    }
    for (let i = 0; i < this._postEffectsTransparency.length; i++) {
      if (this._postEffectsTransparency[i].enabled) {
        return true;
      }
    }
    return false;
  }
  /** @internal */
  static _blit(device: AbstractDevice, srcTex: Texture2D, srgbOutput: boolean) {
    if (!this._blitProgram) {
      this._blitProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          this.flip = pb.int().uniform(0);
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if (pb.notEqual(this.flip, 0), function(){
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srgbOutput = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function(){
            this.$outputs.outColor = pb.textureSample(this.srcTex, this.$inputs.uv);
            this.$if(pb.notEqual(this.srgbOutput, 0), function(){
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.$outputs.outColor.rgb), 1);
            })
          });
        }
      });
      this._blitBindgroup = device.createBindGroup(this._blitProgram.bindGroupLayouts[0]);
      this._blitVertexLayout = device.createVertexLayout({
        vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])) }]
      });
      this._blitSampler = device.createSampler({
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipFilter: 'none',
        addressU: 'clamp',
        addressV: 'clamp'
      });
      this._blitRenderStates = device.createRenderStateSet();
      this._blitRenderStates.useRasterizerState().setCullMode('none');
      this._blitRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    this._blitBindgroup.setTexture('srcTex', srcTex, this._blitSampler);
    this._blitBindgroup.setValue('srgbOutput', srgbOutput ? 1 : 0);
    this._blitBindgroup.setValue('flip', device.type === 'webgpu' && !!device.getFramebuffer() ? 1 : 0)
    device.setRenderStates(this._blitRenderStates);
    device.setProgram(this._blitProgram);
    device.setBindGroup(0, this._blitBindgroup);
    device.setVertexLayout(this._blitVertexLayout);
    device.draw('triangle-strip', 0, 4);
  }
}