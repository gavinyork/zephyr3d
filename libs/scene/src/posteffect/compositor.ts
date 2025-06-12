import { linearToGamma } from '../shaders/misc';
import type { DrawContext } from '../render';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D,
  VertexLayout
} from '@zephyr3d/device';
import type { AbstractPostEffect } from './posteffect';
import { PostEffectLayer } from './posteffect';
import { MaterialVaryingFlags } from '../values';
import { fetchSampler } from '../utility/misc';
import { DRef } from '../app';

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
  protected _postEffects: DRef<AbstractPostEffect>[][];
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
    this._postEffects = [];
    this._postEffects[PostEffectLayer.opaque] = [];
    this._postEffects[PostEffectLayer.transparent] = [];
    this._postEffects[PostEffectLayer.end] = [];
    this._finalFramebuffer = null;
    this._prevInputTexture = null;
    this._prevFrameBuffer = null;
  }
  /** @internal */
  requireLinearDepth(ctx: DrawContext): boolean {
    for (const list of this._postEffects) {
      for (const postEffect of list) {
        if (postEffect.get().requireLinearDepthTexture(ctx)) {
          return true;
        }
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
      for (const list of this._postEffects) {
        if (list.findIndex((val) => val.get() === postEffect) >= 0) {
          console.error(`Posteffect cannot be added to same compositor multiple times`);
          return;
        }
      }
      this._postEffects[postEffect.layer].push(new DRef(postEffect));
    }
  }
  /**
   * Removes a posteffect that was previously added
   *
   * @param postEffect - The posteffect to be remove.
   */
  removePostEffect(postEffect: AbstractPostEffect): void {
    for (const list of this._postEffects) {
      const index = list.findIndex((val) => val.get() === postEffect);
      if (index >= 0) {
        list[index].dispose();
        list.splice(index, 1);
        return;
      }
    }
  }
  /**
   * Removes all post effects
   */
  clear(): void {
    for (const list of this._postEffects) {
      for (const p of list) {
        p.dispose();
      }
      list.splice(0, list.length);
    }
  }
  /** @internal */
  begin(ctx: DrawContext) {
    const device = ctx.device;
    this._finalFramebuffer = device.getFramebuffer();
    const ssr = !!(ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS);
    if (this._postEffects.every((list) => list.length === 0)) {
      return;
    }
    const format = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm';
    const depth = this._finalFramebuffer?.getDepthAttachment() as Texture2D;
    const w = depth ? depth.width : device.getDrawingBufferWidth();
    const h = depth ? depth.height : device.getDrawingBufferHeight();
    //const fmt2: TextureFormat = ssr ? (device.type === 'webgl' ? format : 'rgba8unorm') : format;
    const tmpFramebuffer = device.pool.fetchTemporalFramebuffer(
      true,
      w,
      h,
      ssr ? [format, ctx.SSRRoughnessTexture, ctx.SSRNormalTexture] : format,
      depth ?? ctx.depthFormat
    );
    device.setFramebuffer(tmpFramebuffer);
  }
  /** @internal */
  drawPostEffects(ctx: DrawContext, layer: PostEffectLayer, sceneDepthTexture: Texture2D) {
    const postEffects = this._postEffects[layer];
    if (postEffects.length > 0) {
      const device = ctx.device;
      const inputFramebuffer = device.getFramebuffer();
      const inputTexture = inputFramebuffer.getColorAttachments()[0] as Texture2D;
      let tmpTexture: Texture2D = null;
      for (let i = 0; i < postEffects.length; i++) {
        const postEffect = postEffects[i].get();
        if (!postEffect.enabled) {
          continue;
        }
        if (this._prevFrameBuffer) {
          device.pool.releaseFrameBuffer(this._prevFrameBuffer);
          this._prevFrameBuffer = null;
        }
        const isLast = this.isLastPostEffect(layer, i);
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
  }
  /** @internal */
  private isLastPostEffect(layer: PostEffectLayer, index: number) {
    for (let i = layer; i < this._postEffects.length; i++) {
      const start = i === layer ? index + 1 : 0;
      for (let j = start; j < this._postEffects[i].length; j++) {
        if (this._postEffects[i][j].get().enabled) {
          return false;
        }
      }
    }
    return true;
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
