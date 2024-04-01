import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_DEPTH } from '../values';
import { Application } from '../app';
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
  /**
   * Creates an instance of DepthRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_DEPTH);
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return 'dp';
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.renderQueue = renderQueue;
    ctx.applyFog = null;
    ctx.drawEnvLight = false;
    ctx.env = null;
    ctx.renderPassHash = null;
    ctx.flip = this.isAutoFlip();
    const device = Application.instance.device;
    const bindGroup = this.getGlobalBindGroupInfo(ctx).bindGroup;
    device.setBindGroup(0, bindGroup);
    ShaderHelper.setCameraUniforms(bindGroup, ctx.camera, ctx.flip, true);
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const order of Object.keys(renderQueue.items)
      .map((val) => Number(val))
      .sort((a, b) => a - b)) {
      const renderItems = renderQueue.items[order];
      for (const lit of renderItems.opaque.lit) {
        this.drawItemList(device, lit, ctx, reverseWinding);
      }
      for (const unlit of renderItems.opaque.unlit) {
        this.drawItemList(device, unlit, ctx, reverseWinding);
      }
    }
    ctx.renderQueue = null;
  }
}
