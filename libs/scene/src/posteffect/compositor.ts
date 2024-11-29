import { linearToGamma } from '../shaders/misc';
import type { DrawContext } from '../render';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  TextureFormat,
  VertexLayout
} from '@zephyr3d/device';
import type { AbstractPostEffect } from './posteffect';
import { MaterialVaryingFlags } from '../values';
import { SSR } from './ssr';
import { fetchSampler } from '../utility/misc';
import { TAA } from './taa';

/**
 * Posteffect rendering context
 * @public
 */
export interface CompositorContext {
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
  private static _SSRPostEffect: SSR = null;
  /** @internal */
  private static _TAAPostEffect: TAA = null;
  /** @internal */
  protected _postEffectsOpaque: AbstractPostEffect<any>[];
  /** @internal */
  protected _postEffectsTransparency: AbstractPostEffect<any>[];
  /** @internal */
  private _finalFramebuffer: FrameBuffer;
  /** @internal */
  private _prevInputTexture: Texture2D;
  /** @internal */
  private _prevFrameBuffer: FrameBuffer;
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
    this._finalFramebuffer = null;
    this._prevInputTexture = null;
    this._prevFrameBuffer = null;
  }
  /** @internal */
  requireLinearDepth(ctx: DrawContext): boolean {
    for (const postEffect of this._postEffectsOpaque) {
      if (postEffect.requireLinearDepthTexture(ctx)) {
        return true;
      }
    }
    for (const postEffect of this._postEffectsTransparency) {
      if (postEffect.requireLinearDepthTexture(ctx)) {
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
  appendPostEffect(postEffect: AbstractPostEffect<any>): void {
    if (postEffect) {
      if (
        this._postEffectsOpaque.indexOf(postEffect) >= 0 ||
        this._postEffectsTransparency.indexOf(postEffect) >= 0
      ) {
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
  removePostEffect(postEffect: AbstractPostEffect<any>): void {
    for (const list of [this._postEffectsOpaque, this._postEffectsTransparency]) {
      const index = list.indexOf(postEffect);
      if (index >= 0) {
        list.splice(index, 1);
        return;
      }
    }
  }
  /**
   * Removes all post effects
   */
  clear(): void {
    this._postEffectsOpaque = [];
    this._postEffectsTransparency = [];
  }
  /**
   * Gets all post effects
   */
  getPostEffects(): AbstractPostEffect<any>[] {
    return [...this._postEffectsOpaque, ...this._postEffectsTransparency];
  }
  /** @internal */
  begin(ctx: DrawContext) {
    const device = ctx.device;
    this._finalFramebuffer = device.getFramebuffer();
    const ssr = !!(ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS);
    if (
      this._postEffectsOpaque.length === 0 &&
      this._postEffectsTransparency.length === 0 &&
      ctx.primaryCamera.sampleCount === 1 &&
      !ssr &&
      !ctx.TAA
    ) {
      return;
    }
    const format = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm';
    const depth = this._finalFramebuffer?.getDepthAttachment() as Texture2D;
    const w = depth ? depth.width : device.getDrawingBufferWidth();
    const h = depth ? depth.height : device.getDrawingBufferHeight();
    const fmt2: TextureFormat = ssr ? (device.type === 'webgl' ? format : 'rgba8unorm') : format;
    const tmpFramebuffer = device.pool.fetchTemporalFramebuffer(
      true,
      w,
      h,
      ssr ? [format, fmt2, fmt2] : format,
      depth ?? ctx.depthFormat,
      ssr,
      ctx.primaryCamera.sampleCount
    );
    device.setFramebuffer(tmpFramebuffer);
    if (ssr) {
      if (!Compositor._SSRPostEffect) {
        Compositor._SSRPostEffect = new SSR();
      }
      Compositor._SSRPostEffect.roughnessTexture = tmpFramebuffer.getColorAttachments()[1] as Texture2D;
      Compositor._SSRPostEffect.normalTexture = tmpFramebuffer.getColorAttachments()[2] as Texture2D;
      this._postEffectsOpaque.unshift(Compositor._SSRPostEffect);
    }
    if (ctx.TAA) {
      if (!Compositor._TAAPostEffect) {
        Compositor._TAAPostEffect = new TAA();
      }
      this._postEffectsOpaque.push(Compositor._TAAPostEffect);
    }
  }
  /** @internal */
  drawPostEffects(ctx: DrawContext, opaque: boolean, sceneDepthTexture: Texture2D) {
    const postEffects = opaque ? this._postEffectsOpaque : this._postEffectsTransparency;
    if (postEffects.length > 0) {
      const device = ctx.device;
      const inputFramebuffer = device.getFramebuffer();
      const inputTexture = inputFramebuffer.getColorAttachments()[0] as Texture2D;
      let tmpTexture: Texture2D = null;
      for (let i = 0; i < postEffects.length; i++) {
        const postEffect = postEffects[i];
        if (!postEffect.enabled) {
          continue;
        }
        if (this._prevFrameBuffer) {
          device.pool.releaseFrameBuffer(this._prevFrameBuffer);
          this._prevFrameBuffer = null;
        }
        const isLast = this.isLastPostEffect(opaque, i);
        const finalEffect = isLast && (!postEffect.requireDepthAttachment(ctx) || !!this._finalFramebuffer);
        if (finalEffect) {
          device.setFramebuffer(this._finalFramebuffer);
        } else {
          this._prevFrameBuffer = device.pool.fetchTemporalFramebuffer(
            false,
            inputFramebuffer.getWidth(),
            inputFramebuffer.getHeight(),
            'rgba16f',
            inputFramebuffer.getDepthAttachment() ?? null
          );
          device.setFramebuffer(this._prevFrameBuffer);
        }
        const inputColorTexture = tmpTexture ?? inputTexture;
        postEffect.apply(ctx, inputColorTexture, sceneDepthTexture, !device.getFramebuffer());
        if (this._prevInputTexture) {
          device.pool.releaseTexture(this._prevInputTexture);
          this._prevInputTexture = null;
        }
        if (this._prevFrameBuffer) {
          tmpTexture = this._prevFrameBuffer.getColorAttachments()[0] as Texture2D;
          device.pool.retainTexture(tmpTexture);
          this._prevInputTexture = tmpTexture;
        }
      }
    }
  }
  /** @internal */
  end(ctx: DrawContext) {
    const device = ctx.device;
    if (device.getFramebuffer() !== this._finalFramebuffer) {
      const srcTex = device.getFramebuffer().getColorAttachments()[0] as Texture2D;
      device.setFramebuffer(this._finalFramebuffer);
      device.setViewport(null);
      device.setScissor(null);
      Compositor._blit(device, srcTex, !this._finalFramebuffer);
    }
    if (this._prevInputTexture) {
      device.pool.releaseTexture(this._prevInputTexture);
      this._prevInputTexture = null;
    }
    if (this._prevFrameBuffer) {
      device.pool.releaseFrameBuffer(this._prevFrameBuffer);
      this._prevFrameBuffer = null;
    }
    if (this._postEffectsOpaque[0] === Compositor._SSRPostEffect) {
      this._postEffectsOpaque.shift();
    }
    if (this._postEffectsOpaque[this._postEffectsOpaque.length - 1] === Compositor._TAAPostEffect) {
      this._postEffectsOpaque.pop();
    }
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
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.srgbOutput = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$outputs.outColor = pb.textureSample(this.srcTex, this.$inputs.uv);
            this.$if(pb.notEqual(this.srgbOutput, 0), function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.$outputs.outColor.rgb), 1);
            });
          });
        }
      });
      this._blitBindgroup = device.createBindGroup(this._blitProgram.bindGroupLayouts[0]);
      this._blitVertexLayout = device.createVertexLayout({
        vertexBuffers: [
          {
            buffer: device.createVertexBuffer(
              'position_f32x2',
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
            )
          }
        ]
      });
      this._blitRenderStates = device.createRenderStateSet();
      this._blitRenderStates.useRasterizerState().setCullMode('none');
      this._blitRenderStates.useDepthState().enableTest(false).enableWrite(false);
    }
    this._blitBindgroup.setTexture('srcTex', srcTex, fetchSampler('clamp_nearest_nomip'));
    this._blitBindgroup.setValue('srgbOutput', srgbOutput ? 1 : 0);
    this._blitBindgroup.setValue('flip', device.type === 'webgpu' && !!device.getFramebuffer() ? 1 : 0);
    device.setRenderStates(this._blitRenderStates);
    device.setProgram(this._blitProgram);
    device.setBindGroup(0, this._blitBindgroup);
    device.setVertexLayout(this._blitVertexLayout);
    device.draw('triangle-strip', 0, 4);
  }
}
