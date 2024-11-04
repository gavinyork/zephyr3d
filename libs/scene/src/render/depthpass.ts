import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_DEPTH } from '../values';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Depth render pass
 *
 * Scene depth render pass
 *
 * @public
 */
export class DepthPass extends RenderPass {
  private _renderBackface: boolean;
  private _encodeDepth: boolean;
  /**
   * Creates an instance of DepthRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_DEPTH);
    this._renderBackface = false;
    this._encodeDepth = false;
  }
  get renderBackface(): boolean {
    return this._renderBackface;
  }
  set renderBackface(val: boolean) {
    this._renderBackface = !!val;
  }
  get encodeDepth(): boolean {
    return this._encodeDepth;
  }
  set encodeDepth(val: boolean) {
    this._encodeDepth = !!val;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${Number(this._renderBackface)}:${Number(this._encodeDepth)}`;
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.applyFog = null;
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setCameraUniforms(bindGroup, ctx.camera, ctx.flip, true);
      const reverseWinding = ctx.camera.worldMatrixDet < 0;
      for (const lit of items.opaque.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of items.opaque.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
}
