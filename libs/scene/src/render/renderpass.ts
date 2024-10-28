import { Vector4 } from '@zephyr3d/base';
import { CullVisitor } from './cull_visitor';
import { Application } from '../app';
import type { RenderItemListInfo, RenderQueueItem } from './render_queue';
import { RenderQueue } from './render_queue';
import type { Camera } from '../camera/camera';
import type { DrawContext } from './drawable';
import type { AbstractDevice, BindGroup } from '@zephyr3d/device';
import { ShaderHelper } from '../material/shader/helper';
import { RenderBundleWrapper } from './renderbundle_wrapper';
import { MaterialVaryingFlags } from '../values';

/**
 * Base class for any kind of render passes
 * @public
 */
export abstract class RenderPass {
  /** @internal */
  protected _type: number;
  /** @internal */
  protected _globalBindGroups: Record<string, BindGroup>;
  /** @internal */
  protected _clearColor: Vector4;
  /** @internal */
  protected _clearDepth: number;
  /** @internal */
  protected _clearStencil: number;
  /**
   * Creates an instanceof RenderPass
   * @param type - Render pass type
   */
  constructor(type: number) {
    this._type = type;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clearDepth = 1;
    this._clearStencil = 0;
    this._globalBindGroups = {};
  }
  /** Color value that is used to clear the frame buffer  */
  get clearColor(): Vector4 {
    return this._clearColor;
  }
  set clearColor(color: Vector4) {
    this._clearColor = color ?? null;
  }
  /** Depth value that is used to clear the frame buffer */
  get clearDepth(): number {
    return this._clearDepth;
  }
  set clearDepth(depth: number) {
    this._clearDepth = depth ?? null;
  }
  /** Stencil value that is used to clear the frame buffer */
  get clearStencil(): number {
    return this._clearStencil;
  }
  set clearStencil(stencil: number) {
    this._clearStencil = stencil ?? null;
  }
  /**
   * The render pass type
   */
  get type(): number {
    return this._type;
  }
  /** @internal */
  isAutoFlip(ctx: DrawContext): boolean {
    return !!(ctx.device.getFramebuffer() && ctx.device.type === 'webgpu');
  }
  /**
   * Renders a scene
   * @param ctx - Drawing context
   */
  render(ctx: DrawContext, cullCamera?: Camera, renderQueue?: RenderQueue) {
    ctx.renderPass = this;
    this.drawScene(ctx, cullCamera ?? ctx.camera, renderQueue);
  }
  /** @internal */
  protected getGlobalBindGroup(ctx: DrawContext): BindGroup {
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
  /**
   * Disposes the render pass
   */
  dispose() {
    this._globalBindGroups = {};
  }
  /** @internal */
  getGlobalBindGroupHash(ctx: DrawContext) {
    return `${this.constructor.name}:${this._getGlobalBindGroupHash(ctx)}`;
  }
  /** @internal */
  protected abstract _getGlobalBindGroupHash(ctx: DrawContext);
  /** @internal */
  protected abstract renderItems(ctx: DrawContext, renderQueue: RenderQueue);
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
  cullScene(ctx: DrawContext, cullCamera: Camera): RenderQueue {
    if (cullCamera) {
      const renderQueue = new RenderQueue(this);
      const cullVisitor = new CullVisitor(this, cullCamera, renderQueue, ctx.primaryCamera);
      if (ctx.scene.octree) {
        ctx.scene.octree.getRootNode().traverse(cullVisitor);
      } else {
        ctx.scene.rootNode.traverse(cullVisitor);
      }
      return renderQueue.end(cullCamera);
    }
    return null;
  }
  /** @internal */
  protected drawItem(
    device: AbstractDevice,
    item: RenderQueueItem,
    ctx: DrawContext,
    reverseWinding: boolean
  ) {
    const reverse = reverseWinding !== item.drawable.getXForm().worldMatrixDet < 0;
    if (reverse) {
      device.reverseVertexWindingOrder(!device.isWindingOrderReversed());
    }
    item.drawable.draw(ctx);
    if (reverse) {
      device.reverseVertexWindingOrder(!device.isWindingOrderReversed());
    }
  }
  /** @internal */
  private internalDrawItemList(
    ctx: DrawContext,
    items: RenderQueueItem[],
    renderBundle: RenderBundleWrapper,
    reverseWinding: boolean,
    hash: string
  ) {
    let recording = false;
    if (renderBundle && ctx.primaryCamera.commandBufferReuse) {
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
      const reverse = reverseWinding !== item.drawable.getXForm().worldMatrixDet < 0;
      if (reverse) {
        ctx.device.reverseVertexWindingOrder(!ctx.device.isWindingOrderReversed());
      }
      if (recording) {
        RenderBundleWrapper.addObject(item.drawable, renderBundle, hash);
        RenderBundleWrapper.addObject(item.drawable.getMaterial(), renderBundle, hash);
      }
      item.drawable.draw(ctx);
      if (reverse) {
        ctx.device.reverseVertexWindingOrder(!ctx.device.isWindingOrderReversed());
      }
    }
    if (renderBundle && ctx.primaryCamera.commandBufferReuse) {
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
        this.internalDrawItemList(ctx, itemList.itemList, itemList.renderBundle, reverseWinding, hash);
      }
      if (itemList.skinItemList.length > 0) {
        ctx.materialFlags |= MaterialVaryingFlags.SKIN_ANIMATION;
        ctx.materialFlags &= ~(MaterialVaryingFlags.MORPH_ANIMATION | MaterialVaryingFlags.INSTANCING);
        itemList.materialList.forEach((mat) => mat.apply(ctx));
        this.internalDrawItemList(
          ctx,
          itemList.skinItemList,
          itemList.skinRenderBundle,
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
          itemList.morphRenderBundle,
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
          itemList.skinAndMorphRenderBundle,
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
          itemList.instanceRenderBundle,
          reverseWinding,
          hash
        );
        /*
        for (const item of itemList.instanceItemList) {
          ctx.instanceData = item.instanceData;
          const reverse = reverseWinding !== item.drawable.getXForm().worldMatrixDet < 0;
          if (reverse) {
            device.reverseVertexWindingOrder(!device.isWindingOrderReversed());
          }
          item.drawable.draw(ctx);
          if (reverse) {
            device.reverseVertexWindingOrder(!device.isWindingOrderReversed());
          }
        }
        */
      }
    }
    ctx.renderQueue = null;
  }
  /** @internal */
  private clearFramebuffer() {
    Application.instance.device.clearFrameBuffer(this._clearColor, this._clearDepth, this._clearStencil);
  }
}
