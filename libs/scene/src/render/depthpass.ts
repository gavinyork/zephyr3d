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
  /**
   * Creates an instance of DepthRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_DEPTH);
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return '';
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.applyFog = null;
    ctx.drawEnvLight = false;
    ctx.env = null;
    ctx.flip = this.isAutoFlip();
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
    ctx.device.setBindGroup(0, bindGroup);
    ShaderHelper.setCameraUniforms(bindGroup, ctx.camera, ctx.flip, true);
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const order of Object.keys(renderQueue.items)
      .map((val) => Number(val))
      .sort((a, b) => a - b)) {
      const renderItems = renderQueue.items[order];
      for (const lit of renderItems.opaque.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of renderItems.opaque.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
}
