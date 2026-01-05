import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, Vector4 } from '@zephyr3d/base';
import { CullVisitor } from './cull_visitor';
import type { RenderItemListInfo, RenderQueueItem } from './render_queue';
import { RenderQueue } from './render_queue';
import type { Camera } from '../camera/camera';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import { RenderBundleWrapper } from './renderbundle_wrapper';
import { MaterialVaryingFlags } from '../values';
import type { BindGroup } from '@zephyr3d/device';
import { getDevice } from '../app/api';

/**
 * Base class for any kind of render passes
 * @public
 */
export abstract class RenderPass extends Disposable {
  /** @internal */
  protected _type: number;
  /** @internal */
  protected _globalBindGroups: Record<string, BindGroup>;
  /** @internal */
  protected _clearColor: Nullable<Vector4>;
  /** @internal */
  protected _clearDepth: Nullable<number>;
  /** @internal */
  protected _clearStencil: Nullable<number>;
  /**
   * Creates an instanceof RenderPass
   * @param type - Render pass type
   */
  constructor(type: number) {
    super();
    this._type = type;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clearDepth = 1;
    this._clearStencil = 0;
    this._globalBindGroups = {};
  }
  /** Color value that is used to clear the frame buffer  */
  get clearColor(): Nullable<Immutable<Vector4>> {
    return this._clearColor;
  }
  set clearColor(color: Nullable<Immutable<Vector4>>) {
    this._clearColor = color;
  }
  /** Depth value that is used to clear the frame buffer */
  get clearDepth() {
    return this._clearDepth;
  }
  set clearDepth(depth) {
    this._clearDepth = depth;
  }
  /** Stencil value that is used to clear the frame buffer */
  get clearStencil() {
    return this._clearStencil;
  }
  set clearStencil(stencil) {
    this._clearStencil = stencil;
  }
  /**
   * The render pass type
   */
  get type() {
    return this._type;
  }
  /** @internal */
  isAutoFlip(ctx: DrawContext) {
    return !!(ctx.device.getFramebuffer() && ctx.device.type === 'webgpu');
  }
  /**
   * Renders a scene
   * @param ctx - Drawing context
   */
  render(ctx: DrawContext, cullCamera?: Nullable<Camera>, renderQueue?: RenderQueue) {
    ctx.renderPass = this;
    this.drawScene(ctx, cullCamera ?? ctx.camera, renderQueue);
  }
  /** @internal */
  protected getGlobalBindGroup(ctx: DrawContext) {
    const hash = this.getGlobalBindGroupHash(ctx);
    let bindGroup = this._globalBindGroups[hash];
    if (!bindGroup) {
      const ret = ctx.device.programBuilder.buildRender({
        vertex(pb) {
          ShaderHelper.prepareVertexShader(pb, ctx);
          pb.main(function () {});
        },
        fragment(pb) {
          ShaderHelper.prepareFragmentShader(pb, ctx);
          pb.main(function () {});
        }
      });
      bindGroup = ctx.device.createBindGroup(ret[2][0]);
      this._globalBindGroups[hash] = bindGroup;
    }
    return bindGroup;
  }
  /** @internal */
  getGlobalBindGroupHash(ctx: DrawContext) {
    return `${this.constructor.name}:${this._getGlobalBindGroupHash(ctx)}`;
  }
  /** @internal */
  protected abstract _getGlobalBindGroupHash(ctx: DrawContext): string;
  /** @internal */
  protected abstract renderItems(ctx: DrawContext, renderQueue: RenderQueue): void;
  /** @internal */
  protected drawScene(ctx: DrawContext, cullCamera: Camera, renderQueue?: RenderQueue) {
    const device = ctx.device;
    this.clearFramebuffer();
    const rq = renderQueue ?? this.cullScene(ctx, cullCamera);
    if (rq) {
      const windingReversed = device.isWindingOrderReversed();
      device.reverseVertexWindingOrder(this.isAutoFlip(ctx) ? !windingReversed : windingReversed);
      this.renderItems(ctx, rq);
      device.reverseVertexWindingOrder(windingReversed);
      if (rq !== renderQueue) {
        rq.dispose();
      }
    }
  }
  /**
   * Culls a scene by a given camera
   * @param ctx - The draw context
   * @param cullCamera - The camera that will be used to cull the scene
   * @returns The cull result
   */
  cullScene(ctx: DrawContext, cullCamera: Camera) {
    const renderQueue = new RenderQueue(this);
    const cullVisitor = new CullVisitor(this, cullCamera, renderQueue);
    if (ctx.scene.octree) {
      ctx.scene.octree.getRootNode().traverse(cullVisitor);
    } else {
      ctx.scene.rootNode.traverse(cullVisitor);
    }
    renderQueue.end(cullCamera);
    ctx.sunLight = renderQueue.sunLight;
    return renderQueue;
  }
  /** @internal */
  private internalDrawItemList(
    ctx: DrawContext,
    items: RenderQueueItem[],
    renderBundle: Nullable<RenderBundleWrapper>,
    reverseWinding: boolean,
    hash: string
  ) {
    let recording = false;
    if (renderBundle && ctx.camera.commandBufferReuse) {
      const bundle = renderBundle.getRenderBundle(hash);
      if (bundle) {
        ctx.device.executeRenderBundle(bundle);
        return;
      }
      recording = true;
      renderBundle.beginRenderBundle();
    }
    for (const item of items) {
      ctx.instanceData = item.instanceData;
      const reverse = reverseWinding !== item.drawable.getNode().worldMatrixDet < 0;
      if (reverse) {
        ctx.device.reverseVertexWindingOrder(!ctx.device.isWindingOrderReversed());
      }
      if (recording) {
        RenderBundleWrapper.addDrawable(
          item.drawable,
          item.drawable.getMaterial()?.coreMaterial!,
          item.drawable.getPrimitive()!,
          renderBundle!,
          hash
        );
      }
      item.drawable.draw(ctx, recording ? undefined : hash);
      if (reverse) {
        ctx.device.reverseVertexWindingOrder(!ctx.device.isWindingOrderReversed());
      }
    }
    if (renderBundle && ctx.camera.commandBufferReuse) {
      renderBundle.endRenderBundle(hash);
    }
  }
  /** @internal */
  protected drawItemList(itemList: RenderItemListInfo, ctx: DrawContext, reverseWinding: boolean) {
    ctx.renderQueue = itemList.renderQueue;
    ctx.instanceData = null;
    const windingHash = reverseWinding ? '1' : '0';
    const bindGroupHash = ctx.device.getBindGroup(0)[0].getGPUId();
    const framebufferHash = ctx.device.getFramebuffer()?.getHash() ?? '';
    const ctxHash = `${ctx.sceneColorTexture?.uid ?? 0}-${ctx.linearDepthTexture?.uid ?? 0}`;
    const hash = `${windingHash}-${bindGroupHash}-${framebufferHash}-${ctxHash}-${ctx.renderPassHash}`;
    if (itemList) {
      if (itemList.itemList.length > 0) {
        ctx.materialFlags &= ~(
          MaterialVaryingFlags.SKIN_ANIMATION |
          MaterialVaryingFlags.INSTANCING |
          MaterialVaryingFlags.MORPH_ANIMATION
        );
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.itemList,
          itemList.renderBundle ?? null,
          reverseWinding,
          hash
        );
      }
      if (itemList.skinItemList.length > 0) {
        ctx.materialFlags |= MaterialVaryingFlags.SKIN_ANIMATION;
        ctx.materialFlags &= ~(MaterialVaryingFlags.MORPH_ANIMATION | MaterialVaryingFlags.INSTANCING);
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.skinItemList,
          itemList.skinRenderBundle ?? null,
          reverseWinding,
          hash
        );
      }
      if (itemList.morphItemList.length > 0) {
        ctx.materialFlags |= MaterialVaryingFlags.MORPH_ANIMATION;
        ctx.materialFlags &= ~(MaterialVaryingFlags.SKIN_ANIMATION | MaterialVaryingFlags.INSTANCING);
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.morphItemList,
          itemList.morphRenderBundle ?? null,
          reverseWinding,
          hash
        );
      }
      if (itemList.skinAndMorphItemList.length > 0) {
        ctx.materialFlags |= MaterialVaryingFlags.SKIN_ANIMATION | MaterialVaryingFlags.MORPH_ANIMATION;
        ctx.materialFlags &= ~MaterialVaryingFlags.INSTANCING;
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.skinAndMorphItemList,
          itemList.skinAndMorphRenderBundle ?? null,
          reverseWinding,
          hash
        );
      }
      if (itemList.instanceItemList.length > 0) {
        ctx.materialFlags |= MaterialVaryingFlags.INSTANCING;
        ctx.materialFlags &= ~(MaterialVaryingFlags.SKIN_ANIMATION | MaterialVaryingFlags.MORPH_ANIMATION);
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.instanceItemList,
          itemList.instanceRenderBundle ?? null,
          reverseWinding,
          hash
        );
      }
    }
    ctx.renderQueue = null;
  }
  /**
   * Disposes the render pass
   */
  protected onDispose() {
    super.onDispose();
    this._globalBindGroups = {};
  }
  /** @internal */
  private clearFramebuffer() {
    if (this._clearColor || this._clearDepth || this._clearStencil) {
      getDevice().clearFrameBuffer(this._clearColor, this._clearDepth, this._clearStencil);
    }
  }
}
