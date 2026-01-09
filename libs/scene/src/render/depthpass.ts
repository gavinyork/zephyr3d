import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_DEPTH } from '../values';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import type { Camera } from '../camera';

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
  private _transmission: boolean;
  /**
   * Creates an instance of DepthRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_DEPTH);
    this._renderBackface = false;
    this._encodeDepth = false;
    this._transmission = false;
  }
  get transmission() {
    return this._transmission;
  }
  set transmission(val: boolean) {
    this._transmission = val;
  }
  get renderBackface() {
    return this._renderBackface;
  }
  set renderBackface(val) {
    this._renderBackface = !!val;
  }
  get encodeDepth() {
    return this._encodeDepth;
  }
  set encodeDepth(val) {
    this._encodeDepth = !!val;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${Number(this._renderBackface)}:${Number(this._encodeDepth)}:${Number(ctx.motionVectors)}`;
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderCamera: Camera, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.fogFlags = 0;
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx, renderCamera);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setCameraUniforms(bindGroup, ctx, renderCamera, true);
      const reverseWinding = ctx.camera.worldMatrixDet < 0;
      const list = this._transmission ? items.transmission : items.opaque;
      for (const lit of list.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of list.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
}
