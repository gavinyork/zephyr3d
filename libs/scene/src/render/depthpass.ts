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
    return '';
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.target = null;
    ctx.applyFog = false;
    ctx.drawEnvLight = false;
    ctx.env = null;
    ctx.renderPassHash = null;
    ctx.flip = this.isAutoFlip();
    const device = Application.instance.device;
    const bindGroup = this.getGlobalBindGroupInfo(ctx).bindGroup;
    device.setBindGroup(0, bindGroup);
    ShaderHelper.setCameraUniforms(bindGroup, ctx, true);
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const order of Object.keys(renderQueue.items)
      .map((val) => Number(val))
      .sort((a, b) => a - b)) {
      const renderItems = renderQueue.items[order];
      for (const item of renderItems.opaqueList) {
        ctx.instanceData = item.instanceData;
        ctx.target = item.drawable;
        this.drawItem(device, item, ctx, reverseWinding);
      }
    }
  }
}
