import { Vector4 } from '@zephyr3d/base';
import { CullVisitor } from './cull_visitor';
import { Application } from '../app';
import type { RenderItemListInfo, RenderQueueItem } from './render_queue';
import { RenderQueue } from './render_queue';
import type { Camera } from '../camera/camera';
import type { DrawContext } from './drawable';
import type { AbstractDevice, BindGroup, BindGroupLayout, RenderStateSet } from '@zephyr3d/device';
import { ShaderHelper } from '../material/shader/helper';
import { RenderBundleWrapper } from './renderbundle_wrapper';

/**
 * Base class for any kind of render passes
 * @public
 */
export abstract class RenderPass {
  /** @internal */
  protected _type: number;
  /** @internal */
  protected _globalBindGroups: Record<string, { bindGroup: BindGroup; layout: BindGroupLayout }>;
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
  isAutoFlip(): boolean {
    return !!(Application.instance.device.getFramebuffer() && Application.instance.device.type === 'webgpu');
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
  applyRenderStates(device: AbstractDevice, stateSet: RenderStateSet, ctx: DrawContext) {
    device.setRenderStates(stateSet);
  }
  /** @internal */
  protected getGlobalBindGroupInfo(ctx: DrawContext): { bindGroup: BindGroup; layout: BindGroupLayout } {
    const hash = this.getGlobalBindGroupHash(ctx);
    let bindGroup = this._globalBindGroups[hash];
    if (!bindGroup) {
      //const programBuilder = new ProgramBuilder(Application.instance.device);
      const ret = Application.instance.device.programBuilder.buildRender({
        vertex(pb) {
          ShaderHelper.prepareVertexShader(pb, ctx);
          pb.main(function () {});
        },
        fragment(pb) {
          ShaderHelper.prepareFragmentShader(pb, ctx);
          pb.main(function () {});
        }
      });
      bindGroup = {
        bindGroup: Application.instance.device.createBindGroup(ret[2][0]),
        layout: ret[2][0]
      };
      this._globalBindGroups[hash] = bindGroup;
    }
    if (bindGroup.bindGroup.disposed) {
      bindGroup.bindGroup.reload();
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
    const device = Application.instance.device;
    this.clearFramebuffer();
    const rq = renderQueue ?? this.cullScene(ctx, cullCamera);
    if (rq) {
      const windingReversed = device.isWindingOrderReversed();
      device.reverseVertexWindingOrder(this.isAutoFlip() ? !windingReversed : windingReversed);
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
  private internalDrawItemList(device: AbstractDevice, ctx: DrawContext, items: RenderQueueItem[], renderBundle: RenderBundleWrapper, reverseWinding: boolean, hash: string) {
    if (renderBundle) {
      const bundle = renderBundle.getRenderBundle(hash);
      if (bundle) {
        device.executeRenderBundle(bundle);
        return;
      }
      renderBundle.beginRenderBundle();
    }
    for (const item of items) {
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
    if (renderBundle) {
      renderBundle.endRenderBundle(hash);
    }
  }
  /** @internal */
  protected drawItemList(
    device: AbstractDevice,
    itemList: RenderItemListInfo,
    ctx: DrawContext,
    reverseWinding: boolean
  ) {
    ctx.renderQueue = itemList.renderQueue;
    ctx.instanceData = null;
    const windingHash = reverseWinding ? '1' : '0';
    const bindGroupHash = device.getBindGroup(0)[0].getGPUId();
    const framebufferHash = device.getFramebuffer()?.getHash() ?? '';
    const hash = `${windingHash}-${bindGroupHash}-${framebufferHash}-${ctx.renderPassHash}`;
    if (itemList) {
      if (itemList.itemList.length > 0) {
        ctx.skinAnimation = false;
        ctx.instancing = false;
        itemList.materialList.forEach(mat => mat.apply(ctx));
        this.internalDrawItemList(device, ctx, itemList.itemList, itemList.renderBundle, reverseWinding, hash);
        /*
        for (const item of itemList.itemList) {
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
      if (itemList.skinItemList.length > 0) {
        ctx.skinAnimation = true;
        ctx.instancing = false;
        itemList.materialList.forEach(mat => mat.apply(ctx));
        this.internalDrawItemList(device, ctx, itemList.skinItemList, itemList.skinRenderBundle, reverseWinding, hash);
        /*
        for (const item of itemList.skinItemList) {
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
      if (itemList.instanceItemList.length > 0) {
        ctx.skinAnimation = false;
        ctx.instancing = true;
        itemList.materialList.forEach(mat => mat.apply(ctx));
        this.internalDrawItemList(device, ctx, itemList.instanceItemList, itemList.instanceRenderBundle, reverseWinding, hash);
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
