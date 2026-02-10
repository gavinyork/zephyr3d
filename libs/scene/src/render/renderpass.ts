import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, Vector4 } from '@zephyr3d/base';
import { CullVisitor } from './cull_visitor';
import type { RenderItemListInfo, RenderQueueItem } from './render_queue';
import { RenderQueue } from './render_queue';
import type { Camera } from '../camera/camera';
import type { DrawContext } from './drawable';
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
  render(
    ctx: DrawContext,
    renderCamera?: Nullable<Camera>,
    cullCamera?: Nullable<Camera>,
    renderQueue?: RenderQueue
  ) {
    ctx.renderPass = this;
    this.drawScene(ctx, renderCamera ?? ctx.camera, cullCamera ?? renderCamera ?? ctx.camera, renderQueue);
  }
  /** @internal */
  getGlobalBindGroupHash(ctx: DrawContext, camera: Camera) {
    return `${this.constructor.name}:${this._getGlobalBindGroupHash(ctx, camera)}`;
  }
  /** @internal */
  protected abstract _getGlobalBindGroupHash(ctx: DrawContext, camera: Camera): string;
  /** @internal */
  protected abstract renderItems(ctx: DrawContext, renderCamera: Camera, renderQueue: RenderQueue): void;
  /** @internal */
  protected drawScene(ctx: DrawContext, renderCamera: Camera, cullCamera: Camera, renderQueue?: RenderQueue) {
    const device = ctx.device;
    this.clearFramebuffer();
    const rq = renderQueue ?? this.cullScene(ctx, cullCamera);
    if (rq) {
      const windingReversed = device.isWindingOrderReversed();
      device.reverseVertexWindingOrder(this.isAutoFlip(ctx) ? !windingReversed : windingReversed);
      this.renderItems(ctx, renderCamera, rq);
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
    renderQueue: Nullable<RenderQueue>,
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
      item.drawable.draw(ctx, renderQueue, recording ? undefined : hash);
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
          itemList.renderQueue,
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
          itemList.renderQueue,
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
          itemList.renderQueue,
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
          itemList.renderQueue,
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
          itemList.renderQueue,
          itemList.instanceRenderBundle ?? null,
          reverseWinding,
          hash
        );
      }
    }
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
