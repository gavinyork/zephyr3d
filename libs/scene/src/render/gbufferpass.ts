import { LightPass } from './lightpass';
import { MaterialVaryingFlags, QUEUE_OPAQUE, RENDER_PASS_TYPE_GBUFFER } from '../values';
import type { DrawContext } from './drawable';
import type { Camera } from '../camera';
import type { RenderQueue } from './render_queue';
import { Vector4 } from '@zephyr3d/base';
import { ShaderHelper } from '../material/shader/helper';

/**
 * GBuffer pass scaffold.
 *
 * Stage-1 keeps current material lighting behavior and only renders opaque lists,
 * while preserving SSR roughness/normal MRT outputs for deferred/hybrid paths.
 * @internal
 */
export class GBufferPass extends LightPass {
  constructor() {
    super();
    this._type = RENDER_PASS_TYPE_GBUFFER;
    this._clearColor = Vector4.zero();
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${ctx.materialFlags}:${ctx.motionVectors ? 1 : 0}`;
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, camera: Camera, renderQueue: RenderQueue) {
    ctx.renderPassHash = null;
    ctx.env = ctx.scene.env;
    ctx.drawEnvLight = false;
    ctx.flip = this.isAutoFlip(ctx);
    ctx.queue = QUEUE_OPAQUE;
    ctx.oit = null;
    const items = renderQueue.itemList;
    if (!items?.opaque) {
      return;
    }
    ctx.currentShadowLight = null;
    ctx.lightBlending = false;
    ctx.materialFlags &= ~MaterialVaryingFlags.APPLY_FOG;
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx, camera);
    const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
    ctx.device.setBindGroup(0, bindGroup);
    ShaderHelper.setCameraUniforms(bindGroup, ctx, camera, !!ctx.device.getFramebuffer());
    const reverseWinding = camera.worldMatrixDet < 0;
    for (const lit of items.opaque.lit) {
      this.drawItemList(lit, ctx, reverseWinding);
    }
    for (const unlit of items.opaque.unlit) {
      this.drawItemList(unlit, ctx, reverseWinding);
    }
  }
}
