import { RenderPass } from './renderpass';
import { QUEUE_OPAQUE, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT } from '../values';
import { Application } from '../app';
import { Vector4 } from '@zephyr3d/base';
import type { RenderItemListBundle, RenderQueue } from './render_queue';
import type { PunctualLight } from '../scene/light';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Forward render pass
 * @internal
 */
export class LightPass extends RenderPass {
  /** @internal */
  protected _shadowMapHash: string;
  /**
   * Creates an instance of ForwardRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_LIGHT);
    this._shadowMapHash = null;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `lp:${this._shadowMapHash}:${ctx.env.getHash(ctx)}`;
  }
  /** @internal */
  protected renderLightPass(ctx: DrawContext, itemList: RenderItemListBundle, lights: PunctualLight[], flags: any) {
    const device = Application.instance.device;
    const baseLightPass = !ctx.lightBlending;
    ctx.drawEnvLight =
      baseLightPass &&
      ctx.env.light.type !== 'none' &&
      (ctx.env.light.envLight.hasRadiance() || ctx.env.light.envLight.hasIrradiance());
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const info = this.getGlobalBindGroupInfo(ctx);
    if (!flags.cameraSet[ctx.renderPassHash]) {
      ShaderHelper.setCameraUniforms(info.bindGroup, ctx.camera, ctx.flip, !!device.getFramebuffer());
      flags.cameraSet[ctx.renderPassHash] = 1;
    }
    if (ctx.currentShadowLight) {
      ShaderHelper.setLightUniformsShadow(info.bindGroup, ctx, lights[0]);
    } else {
      if (!flags.lightSet[ctx.renderPassHash]) {
        ShaderHelper.setLightUniforms(
          info.bindGroup,
          ctx,
          ctx.clusteredLight.clusterParam,
          ctx.clusteredLight.countParam,
          ctx.clusteredLight.lightBuffer,
          ctx.clusteredLight.lightIndexTexture
        );
        flags.lightSet[ctx.renderPassHash] = 1;
      }
    }
    if (ctx.applyFog && !flags.fogSet[ctx.renderPassHash]) {
      ShaderHelper.setFogUniforms(
        info.bindGroup,
        ctx.env.sky.mappedFogType,
        baseLightPass ? ctx.env.sky.fogColor : Vector4.zero(),
        ctx.env.sky.fogParams,
        ctx.env.sky.aerialPerspectiveDensity * ctx.env.sky.aerialPerspectiveDensity,
        ctx.env.sky.getAerialPerspectiveLUT(ctx)
      );
      flags.fogSet[ctx.renderPassHash] = 1;
    }
    device.setBindGroup(0, info.bindGroup);
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const lit of itemList.lit) {
      this.drawItemList(device, lit, ctx, reverseWinding)
    }
    if (!ctx.lightBlending) {
      for (const unlit of itemList.unlit) {
        this.drawItemList(device, unlit, ctx, reverseWinding);
      }
    }
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.applyFog = null;
    ctx.renderQueue = renderQueue;
    ctx.renderPassHash = null;
    ctx.env = ctx.scene.env;
    ctx.drawEnvLight = false;
    ctx.flip = this.isAutoFlip();
    renderQueue.sortItems();

    const flags: any = {
      lightSet: {},
      cameraSet: {},
      fogSet: {}
    };
    const orders = Object.keys(renderQueue.items)
      .map((val) => Number(val))
      .sort((a, b) => a - b);
    for (let i = 0; i < 2; i++) {
      ctx.applyFog = i === 1 && ctx.env.sky.fogType !== 'none' ? ctx.env.sky.fogType : null;
      ctx.queue = i === 0 ? QUEUE_OPAQUE : QUEUE_TRANSPARENT;
      for (const order of orders) {
        const items = renderQueue.items[order];
        const lists = [items.opaque, items.transparent];
        let lightIndex = 0;
        if (ctx.shadowMapInfo) {
          for (const k of ctx.shadowMapInfo.keys()) {
            ctx.currentShadowLight = k;
            ctx.lightBlending = lightIndex > 0;
            this._shadowMapHash = ctx.shadowMapInfo.get(k).shaderHash;
            this.renderLightPass(ctx, lists[i], [k], flags);
            lightIndex++;
          }
        }
        if (lightIndex === 0 || renderQueue.unshadowedLights.length > 0) {
          ctx.currentShadowLight = null;
          ctx.lightBlending = lightIndex > 0;
          this._shadowMapHash = '';
          this.renderLightPass(ctx, lists[i], renderQueue.unshadowedLights, flags);
        }
      }
      if (i === 0) {
        ctx.env.sky.skyWorldMatrix = ctx.scene.rootNode.worldMatrix;
        ctx.env.sky.renderSky(ctx);
      }
      ctx.compositor?.drawPostEffects(ctx, i === 0, ctx.linearDepthTexture);
      if (i === 0) {
        ctx.env.sky.renderFog(ctx);
      }
    }
    ctx.renderQueue = null;
  }
}
