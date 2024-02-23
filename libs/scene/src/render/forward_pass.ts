import { RenderPass } from './renderpass';
import { RENDER_PASS_TYPE_FORWARD } from '../values';
import { Application } from '../app';
import { Vector4 } from '@zephyr3d/base';
import type { RenderQueueItem, RenderQueue } from './render_queue';
import type { Camera } from '../camera/camera';
import type { AbstractDevice, RenderStateSet } from '@zephyr3d/device';
import type { PunctualLight } from '../scene/light';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';

/**
 * Forward render pass
 * @internal
 */
export class ForwardRenderPass extends RenderPass {
  /** @internal */
  protected _overridenState: RenderStateSet;
  /** @internal */
  protected _overridenStateTrans: RenderStateSet;
  /** @internal */
  protected _shadowMapHash: string;
  /**
   * Creates an instance of ForwardRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_FORWARD);
    this._overridenState = null;
    this._overridenStateTrans = null;
    this._shadowMapHash = null;
  }
  /** @internal */
  applyRenderStates(device: AbstractDevice, stateSet: RenderStateSet, ctx: DrawContext) {
    const overridenStateSet = ctx.userData as RenderStateSet;
    if (overridenStateSet) {
      const depthState = overridenStateSet.depthState;
      const blendingState = overridenStateSet.blendingState;
      overridenStateSet.copyFrom(stateSet);
      overridenStateSet.useBlendingState(blendingState);
      if (depthState) {
        overridenStateSet.useDepthState(depthState);
      }
      stateSet = overridenStateSet;
    }
    device.setRenderStates(stateSet);
  }
  /** @internal */
  private get overridenState(): RenderStateSet {
    if (!this._overridenState) {
      this._overridenState = Application.instance.device.createRenderStateSet();
      this._overridenState.useBlendingState().enable(true).setBlendFunc('one', 'one');
    }
    return this._overridenState;
  }
  /** @internal */
  private get overridenStateTrans(): RenderStateSet {
    if (!this._overridenStateTrans) {
      this._overridenStateTrans = Application.instance.device.createRenderStateSet();
      this._overridenStateTrans.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      this._overridenStateTrans.useDepthState().enableTest(true).enableWrite(false);
    }
    return this._overridenStateTrans;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext) {
    //return `${ctx.environment?.constructor.name || ''}:${this._shadowMapHash}`;
    //const envLightHash = ctx.drawEnvLight ? ctx.env.light.type : 'none';
    //const fogHash = ctx.applyFog ? ctx.env.sky.fogType ?? 'none' : 'none';
    return `${this._shadowMapHash}:${ctx.env.getHash(ctx)}`;
  }
  /** @internal */
  protected renderLightPass(
    camera: Camera,
    renderQueue: RenderQueue,
    ctx: DrawContext,
    items: RenderQueueItem[],
    lights: PunctualLight[],
    trans: boolean,
    blend: boolean
  ) {
    const device = Application.instance.device;
    const baseLightPass = !blend;
    ctx.drawEnvLight =
      baseLightPass &&
      ctx.env.light.type !== 'none' &&
      (ctx.env.light.envLight.hasRadiance() || ctx.env.light.envLight.hasIrradiance());
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx);
    const info = this.getGlobalBindGroupInfo(ctx);
    ShaderHelper.setCameraUniforms(info.bindGroup, ctx, !!device.getFramebuffer());
    if (ctx.currentShadowLight) {
      ShaderHelper.setLightUniformsShadow(info.bindGroup, ctx, lights[0]);
    } else {
      ShaderHelper.setLightUniforms(
        info.bindGroup,
        ctx,
        ctx.clusteredLight.clusterParam,
        ctx.clusteredLight.countParam,
        ctx.clusteredLight.lightBuffer,
        ctx.clusteredLight.lightIndexTexture
      );
    }
    if (ctx.applyFog) {
      ShaderHelper.setFogUniforms(
        info.bindGroup,
        ctx.env.sky.mappedFogType,
        baseLightPass ? ctx.env.sky.fogColor : Vector4.zero(),
        ctx.env.sky.fogParams,
        ctx.env.sky.getAerialPerspectiveLUT(ctx)
      );
    }
    device.setBindGroup(0, info.bindGroup);
    if (blend) {
      ctx.userData = this.overridenState;
    } else if (trans) {
      ctx.userData = this.overridenStateTrans;
    }
    const reverseWinding = ctx.camera.worldMatrixDet < 0;
    for (const item of items) {
      // unlit objects should only be drawn once
      if (!blend || !item.drawable.isUnlit()) {
        ctx.instanceData = item.instanceData;
        ctx.target = item.drawable;
        this.drawItem(device, item, ctx, reverseWinding);
      }
    }
  }
  /** @internal */
  protected renderItems(ctx: DrawContext, renderQueue: RenderQueue) {
    ctx.applyFog = false;
    ctx.target = null;
    ctx.renderPassHash = null;
    ctx.env = ctx.scene.env;
    ctx.drawEnvLight = false;
    ctx.flip = this.isAutoFlip();
    renderQueue.sortItems();

    const orders = Object.keys(renderQueue.items)
      .map((val) => Number(val))
      .sort((a, b) => a - b);
    for (let i = 0; i < 2; i++) {
      ctx.applyFog = i === 1 && ctx.env.sky.fogType !== 'none';
      for (const order of orders) {
        const items = renderQueue.items[order];
        const lists = [items.opaqueList, items.transList];
        const list = lists[i];
        let lightIndex = 0;
        if (ctx.shadowMapInfo) {
          for (const k of ctx.shadowMapInfo.keys()) {
            ctx.currentShadowLight = k;
            this._shadowMapHash = ctx.shadowMapInfo.get(k).shaderHash;
            this.renderLightPass(ctx.camera, renderQueue, ctx, list, [k], i > 0, lightIndex > 0);
            lightIndex++;
          }
        }
        if (lightIndex === 0 || renderQueue.unshadowedLights.length > 0) {
          ctx.currentShadowLight = null;
          this._shadowMapHash = '';
          this.renderLightPass(
            ctx.camera,
            renderQueue,
            ctx,
            list,
            renderQueue.unshadowedLights,
            i > 0,
            lightIndex > 0
          );
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
  }
}
