import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_OBJECT_COLOR } from '../values';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import type { Camera } from '../camera';

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
  protected _getGlobalBindGroupHash(_ctx: DrawContext) {
    return '';
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, camera: Camera, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.fogFlags = 0;
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx, camera);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setCameraUniforms(bindGroup, ctx, camera, true);
      const reverseWinding = camera.worldMatrixDet < 0;
      for (const list of [items.opaque, items.transmission, items.transparent, items.transmission_trans]) {
        if (list) {
          for (const lit of list.lit) {
            this.drawItemList(lit, ctx, reverseWinding);
          }
          for (const unlit of list.unlit) {
            this.drawItemList(unlit, ctx, reverseWinding);
          }
        }
      }
    }
  }
}
