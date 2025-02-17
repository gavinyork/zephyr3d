import { RenderPass } from './renderpass';
import { MaterialVaryingFlags, QUEUE_OPAQUE, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT } from '../values';
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
  /** @internal */
  protected _transmission: boolean;
  /**
   * Creates an instance of ForwardRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_LIGHT);
    this._shadowMapHash = null;
  }
  /** @internal */
  get transmission(): boolean {
    return this._transmission;
  }
  set transmission(val: boolean) {
    this._transmission = val;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    return `${this._shadowMapHash}:${ctx.oit?.calculateHash() ?? ''}:${ctx.env.getHash(ctx)}:${
      ctx.linearDepthTexture?.uid ?? 0
    }:${ctx.sceneColorTexture?.uid ?? 0}`;
  }
  /** @internal */
  protected renderLightPass(
    ctx: DrawContext,
    itemList: RenderItemListBundle,
    lights: PunctualLight[],
    flags: any
  ) {
    const baseLightPass = !ctx.lightBlending;
    ctx.drawEnvLight =
      baseLightPass &&
      ctx.env.light.type !== 'none' &&
      (ctx.env.light.envLight.hasRadiance() || ctx.env.light.envLight.hasIrradiance());
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
    if (!flags.cameraSet[ctx.renderPassHash]) {
      ShaderHelper.setCameraUniforms(bindGroup, ctx, !!ctx.device.getFramebuffer());
      flags.cameraSet[ctx.renderPassHash] = 1;
    }
    if (ctx.currentShadowLight) {
      ShaderHelper.setLightUniformsShadow(bindGroup, ctx, lights[0]);
    } else {
      if (!flags.lightSet[ctx.renderPassHash]) {
        ShaderHelper.setLightUniforms(
          bindGroup,
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
        bindGroup,
        ctx.env.sky.mappedFogType,
        baseLightPass ? ctx.env.sky.fogColor : Vector4.zero(),
        ctx.env.sky.fogParams,
        ctx.env.sky.aerialPerspectiveDensity * ctx.env.sky.aerialPerspectiveDensity,
        ctx.env.sky.getAerialPerspectiveLUT(ctx)
      );
      flags.fogSet[ctx.renderPassHash] = 1;
    }
    ctx.device.setBindGroup(0, bindGroup);
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const lit of itemList.lit) {
      this.drawItemList(lit, ctx, reverseWinding);
    }
    if (!ctx.lightBlending) {
      for (const unlit of itemList.unlit) {
        this.drawItemList(unlit, ctx, reverseWinding);
      }
    }
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.applyFog = null;
    ctx.renderPassHash = null;
    ctx.env = ctx.scene.env;
    ctx.drawEnvLight = false;
    ctx.flip = this.isAutoFlip(ctx);
    const ssr = !!(ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS);
    const tmpFramebuffer = ssr
      ? ctx.device.pool.fetchTemporalFramebuffer(
          false,
          ctx.device.getDrawingBufferWidth(),
          ctx.device.getDrawingBufferHeight(),
          ctx.device.getFramebuffer().getColorAttachments()[0],
          ctx.device.getFramebuffer().getDepthAttachment()
        )
      : null;
    const oit =
      renderQueue.drawTransparent &&
      ctx.primaryCamera.oit &&
      ctx.primaryCamera.oit.supportDevice(ctx.device.type)
        ? ctx.primaryCamera.oit
        : null;
    if (!oit && renderQueue.drawTransparent) {
      renderQueue.sortTransparentItems(ctx.primaryCamera.getWorldPosition());
    }
    const flags: any = {
      lightSet: {},
      cameraSet: {},
      fogSet: {}
    };
    const items = renderQueue.itemList;
    const lists = this._transmission
      ? [items?.transmission, items?.transmission_trans, items?.transparent]
      : [items?.opaque, items?.transparent];
    for (let i = 0; i < 2; i++) {
      if (lists[i]) {
        ctx.applyFog = i === 1 && ctx.env.sky.fogType !== 'none' ? ctx.env.sky.fogType : null;
        ctx.queue = i === 0 ? QUEUE_OPAQUE : QUEUE_TRANSPARENT;
        ctx.oit = i === 0 || !items ? null : oit;
        const numOitPasses = ctx.oit ? ctx.oit.begin(ctx) : 1;
        for (let p = 0; p < numOitPasses; p++) {
          if (ctx.oit) {
            if (!ctx.oit.beginPass(ctx, p)) {
              continue;
            }
          }
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
            if (ctx.lightBlending && tmpFramebuffer) {
              ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
              ctx.device.pushDeviceStates();
              ctx.device.setFramebuffer(tmpFramebuffer);
            }
            this.renderLightPass(ctx, lists[i], renderQueue.unshadowedLights, flags);
            if (ctx.lightBlending && tmpFramebuffer) {
              ctx.materialFlags |= MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
              ctx.device.popDeviceStates();
            }
          }
          if (ctx.oit) {
            ctx.oit.endPass(ctx, p);
          }
        }
        if (ctx.oit) {
          ctx.oit.end(ctx);
        }
      }
      if (i === 0 && !ctx.sceneColorTexture) {
        if (tmpFramebuffer) {
          ctx.device.pushDeviceStates();
          ctx.device.setFramebuffer(tmpFramebuffer);
        }
        ctx.env.sky.skyWorldMatrix = ctx.scene.rootNode.worldMatrix;
        ctx.env.sky.renderSky(ctx);
        if (tmpFramebuffer) {
          ctx.device.popDeviceStates();
        }
      }
      if (!renderQueue.needSceneColor() || ctx.sceneColorTexture) {
        if (i === 0) {
          if (tmpFramebuffer) {
            ctx.device.pushDeviceStates();
            ctx.device.setFramebuffer(tmpFramebuffer);
          }
          ctx.env.sky.renderFog(ctx);
          if (tmpFramebuffer) {
            ctx.device.popDeviceStates();
          }
        }
        ctx.compositor?.drawPostEffects(ctx, i === 0, ctx.linearDepthTexture);
      }
    }
    if (tmpFramebuffer) {
      ctx.device.pool.releaseFrameBuffer(tmpFramebuffer);
    }
  }
}
