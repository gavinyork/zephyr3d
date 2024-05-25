import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_OBJECT_COLOR } from '../values';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Object color render pass
 * @internal
 */
export class ObjectColorPass extends RenderPass {
  /**
   * Creates an instance of ForwardRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_OBJECT_COLOR);
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return 'ocp';
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.applyFog = null;
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.picking = true;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setCameraUniforms(bindGroup, ctx.camera, ctx.flip, true);
      const reverseWinding = ctx.camera.worldMatrixDet < 0;
      for (const list of [items.opaque, items.transmission, items.transparent]) {
        if (list) {
          for (const lit of list.lit) {
            this.drawItemList(lit, ctx, reverseWinding);
          }
          for (const unlit of list.unlit) {
            this.drawItemList(unlit, ctx, reverseWinding);
          }
        }
      }
      ctx.picking = false;
    }
  }
}
