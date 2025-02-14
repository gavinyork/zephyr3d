import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../values';
import type { PunctualLight } from '../scene/light';
import type { RenderQueue } from './render_queue';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Shadow map render pass
 *
 * @public
 */
export class ShadowMapPass extends RenderPass {
  /** @internal */
  protected _currentLight: PunctualLight;
  /**
   * Creates an instance of ShadowMapPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_SHADOWMAP);
    this._currentLight = null;
  }
  /** The light that will be used to render shadow map */
  get light(): PunctualLight {
    return this._currentLight;
  }
  set light(light: PunctualLight) {
    this._currentLight = light;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${ctx.shadowMapInfo.get(this.light).shaderHash}`;
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    const items = renderQueue.itemList;
    if (items) {
      ctx.drawEnvLight = false;
      ctx.env = null;
      ctx.applyFog = null;
      ctx.flip = this.isAutoFlip(ctx);
      ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
      const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
      ctx.device.setBindGroup(0, bindGroup);
      ShaderHelper.setLightUniformsShadowMap(bindGroup, ctx, this._currentLight);
      ShaderHelper.setCameraUniforms(bindGroup, ctx, true);
      const reverseWinding = ctx.camera.worldMatrixDet < 0;
      for (const lit of items.opaque.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of items.opaque.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
      for (const lit of items.transmission.lit) {
        this.drawItemList(lit, ctx, reverseWinding);
      }
      for (const unlit of items.transmission.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
}
