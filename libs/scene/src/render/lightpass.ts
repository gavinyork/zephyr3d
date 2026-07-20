import { RenderPass } from './renderpass';
import { MaterialVaryingFlags, QUEUE_OPAQUE, QUEUE_TRANSPARENT, RENDER_PASS_TYPE_LIGHT } from '../values';
import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { RenderItemListBundle, RenderQueue } from './render_queue';
import type { PunctualLight } from '../scene/light';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import type { Camera } from '../camera';

const SURFACE_MRT_FLAGS =
  MaterialVaryingFlags.SSR_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_DIFFUSE |
  MaterialVaryingFlags.SSS_STORE_NORMAL |
  MaterialVaryingFlags.SSS_STORE_TRANSMISSION |
  MaterialVaryingFlags.SKIN_SSS_STORE;
const ADDITIVE_LIGHT_PASS_OMIT_MRT_FLAGS =
  MaterialVaryingFlags.SSR_STORE_ROUGHNESS |
  MaterialVaryingFlags.SSS_STORE_PROFILE |
  MaterialVaryingFlags.SSS_STORE_NORMAL;

/**
 * Forward render pass
 * @internal
 */
export class LightPass extends RenderPass {
  /** @internal */
  protected _shadowMapHash: Nullable<string>;
  /** @internal */
  protected _transmission: boolean;
  /** @internal */
  protected _renderOpaque: boolean;
  /** @internal */
  protected _renderTransparent: boolean;
  /**
   * Creates an instance of ForwardRenderPass
   */
  constructor() {
    super(RENDER_PASS_TYPE_LIGHT);
    this._shadowMapHash = null;
    this._transmission = false;
    this._renderOpaque = true;
    this._renderTransparent = true;
    this._clearColor = Vector4.zero();
  }
  /** @internal */
  get transmission() {
    return this._transmission;
  }
  set transmission(val) {
    this._transmission = val;
  }
  /** @internal */
  get renderOpaque() {
    return this._renderOpaque;
  }
  set renderOpaque(val: boolean) {
    this._renderOpaque = !!val;
  }
  /** @internal */
  get renderTransparent() {
    return this._renderTransparent;
  }
  set renderTransparent(val: boolean) {
    this._renderTransparent = !!val;
  }
  /** @internal */
  protected getAdditiveLightPassColorAttachments(ctx: DrawContext, materialFlags: number) {
    const framebuffer = ctx.device.getFramebuffer();
    if (!framebuffer) {
      return null;
    }
    const attachments: any[] = [framebuffer.getColorAttachments()[0]];
    if (materialFlags & MaterialVaryingFlags.SSS_STORE_DIFFUSE) {
      attachments.push(ctx.SSSDiffuseTexture!);
    }
    if (materialFlags & MaterialVaryingFlags.SSS_STORE_TRANSMISSION) {
      attachments.push(ctx.SSSTransmissionTexture!);
    }
    if (materialFlags & MaterialVaryingFlags.SKIN_SSS_STORE) {
      attachments.push(ctx.SkinSSSTexture!);
    }
    return attachments.length === 1 ? attachments[0] : attachments;
  }
  /** @internal */
  protected selectTransparentOITShadowLight(ctx: DrawContext, renderQueue: RenderQueue) {
    const shadowMapInfo = ctx.shadowMapInfo;
    if (!shadowMapInfo || shadowMapInfo.size === 0) {
      return null;
    }
    if (renderQueue.primaryDirectionalLight && shadowMapInfo.has(renderQueue.primaryDirectionalLight)) {
      return renderQueue.primaryDirectionalLight;
    }
    if (renderQueue.primaryTransmissionLight && shadowMapInfo.has(renderQueue.primaryTransmissionLight)) {
      return renderQueue.primaryTransmissionLight;
    }
    for (const light of renderQueue.shadowedLights) {
      if (shadowMapInfo.has(light)) {
        return light;
      }
    }
    return shadowMapInfo.keys().next().value ?? null;
  }
  /** @internal */
  protected _getGlobalBindGroupHash(ctx: DrawContext, camera: Camera) {
    return `${this._shadowMapHash}:${ctx.currentShadowLight?.runtimeId ?? 0}:${
      ctx.lightBlending ? 1 : 0
    }:${camera.oit?.calculateHash() ?? ''}:${ctx.env!.getHash(
      ctx
    )}:${ctx.materialFlags}:${ctx.linearDepthTexture?.uid ?? 0}:${ctx.sceneColorTexture?.uid ?? 0}:${
      ctx.HiZTexture?.uid ?? 0
    }:${ctx.screenSpaceShadowMask ? 1 : 0}`;
  }
  /** @internal */
  protected renderLightPass(
    ctx: DrawContext,
    camera: Camera,
    itemList: RenderItemListBundle,
    lights: PunctualLight[],
    flags: any
  ) {
    const baseLightPass = !ctx.lightBlending;
    ctx.drawEnvLight =
      baseLightPass &&
      ctx.env!.light.type !== 'none' &&
      (ctx.env!.light.envLight.hasRadiance() || ctx.env!.light.envLight.hasIrradiance());
    ctx.renderPassHash = this.getGlobalBindGroupHash(ctx, camera);
    const bindGroup = ctx.globalBindGroupAllocator.getGlobalBindGroup(ctx);
    if (!flags.cameraSet[ctx.renderPassHash]) {
      ShaderHelper.setCameraUniforms(bindGroup, ctx, camera, !!ctx.device.getFramebuffer());
      flags.cameraSet[ctx.renderPassHash] = 1;
    }
    if (ctx.currentShadowLight) {
      ShaderHelper.setLightUniformsShadow(bindGroup, ctx, lights[0]);
    } else {
      if (!flags.lightSet[ctx.renderPassHash]) {
        ShaderHelper.setLightUniforms(
          bindGroup,
          ctx,
          ctx.clusteredLight!.clusterParam,
          ctx.clusteredLight!.countParam,
          ctx.clusteredLight!.lightBuffer!,
          ctx.clusteredLight!.lightIndexTexture!
        );
        flags.lightSet[ctx.renderPassHash] = 1;
      }
      // Bind the per-queue cluster shadow-mask mode every call (not cached with
      // lightSet): the same clustered program/bind group may serve both the opaque
      // (sample mask) and transparent (skip shadow lights) queues.
      if (ctx.screenSpaceShadowMask) {
        ShaderHelper.setShadowMaskMode(bindGroup, !!ctx.shadowMaskClusterSample);
      }
    }
    if (ctx.materialFlags & MaterialVaryingFlags.APPLY_FOG && !flags.fogSet[ctx.renderPassHash]) {
      ShaderHelper.setFogUniforms(
        bindGroup,
        ctx.env!.sky.skyType === 'scatter' ? 1 : 0,
        ctx.env!.sky.mappedFogType,
        baseLightPass ? 0 : 1,
        ctx.env!.sky.atmosphereParams,
        ctx.env!.sky.heightFogParams,
        ctx.env!.sky.getAerialPerspectiveLUT(ctx),
        ctx.env!.sky.getSkyDistantLightLUT(ctx)
      );
      flags.fogSet[ctx.renderPassHash] = 1;
    }
    ctx.device.setBindGroup(0, bindGroup);
    const reverseWinding = camera.worldMatrixDet < 0;
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
  protected renderItems(ctx: DrawContext, camera: Camera, renderQueue: RenderQueue) {
    ctx.renderPassHash = null;
    ctx.env = ctx.scene.env;
    ctx.drawEnvLight = false;
    ctx.flip = this.isAutoFlip(ctx);
    const surfaceMRT = ctx.materialFlags & SURFACE_MRT_FLAGS;
    const additiveOpaqueMaterialFlags = ctx.materialFlags & ~ADDITIVE_LIGHT_PASS_OMIT_MRT_FLAGS;
    const additiveTransparentMaterialFlags = ctx.materialFlags & ~SURFACE_MRT_FLAGS;
    const tmpFramebuffer = surfaceMRT
      ? ctx.device.pool.fetchTemporalFramebuffer(
          false,
          ctx.device.getDrawingBufferWidth(),
          ctx.device.getDrawingBufferHeight(),
          this.getAdditiveLightPassColorAttachments(ctx, additiveOpaqueMaterialFlags)!,
          ctx.device.getFramebuffer()!.getDepthAttachment()
        )
      : null;
    const needsTransparentSingleColorFramebuffer =
      !!tmpFramebuffer && tmpFramebuffer.getColorAttachments().length > 1;
    const transparentTmpFramebuffer = needsTransparentSingleColorFramebuffer
      ? ctx.device.pool.fetchTemporalFramebuffer(
          false,
          ctx.device.getDrawingBufferWidth(),
          ctx.device.getDrawingBufferHeight(),
          this.getAdditiveLightPassColorAttachments(ctx, additiveTransparentMaterialFlags)!,
          ctx.device.getFramebuffer()!.getDepthAttachment()
        )
      : tmpFramebuffer;
    const oit =
      renderQueue.drawTransparent && camera.oit && camera.oit.supportDevice(ctx.device.type)
        ? camera.oit
        : null;
    // Sort only when this invocation actually draws the transparent queue.
    // The opaque pass (and the SSS-profile pass) run with _renderTransparent
    // === false; without this guard they would sort the transparent lists
    // pointlessly, and the real transparent pass would then sort them again.
    if (!oit && renderQueue.drawTransparent && this._renderTransparent) {
      renderQueue.sortTransparentItems(camera.getWorldPosition());
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
    for (let i = 0; i < lists.length; i++) {
      const isOpaquePass = i === 0;
      if ((isOpaquePass && !this._renderOpaque) || (!isOpaquePass && !this._renderTransparent)) {
        continue;
      }
      if (lists[i]) {
        ctx.queue = i === 0 ? QUEUE_OPAQUE : QUEUE_TRANSPARENT;
        // The screen-space shadow mask is only valid for the opaque depth-prepass
        // geometry: lists[0] in non-transmission mode. For that queue, shadow lights
        // are lit via the clustered pass sampling the mask (additive passes skipped).
        // Every other queue (transparent/OIT hair, transmission) keeps the inline
        // additive shadow path, where shadows are sampled per-fragment at the real
        // surface depth.
        const useShadowMaskQueue = ctx.screenSpaceShadowMask && !this._transmission && i === 0;
        ctx.shadowMaskClusterSample = useShadowMaskQueue;
        ctx.oit = i === 0 || !items ? null : oit;
        const isolateTransparentABufferLightPasses =
          !!ctx.oit && ctx.queue === QUEUE_TRANSPARENT && ctx.oit.getType() === 'ab';
        if ((ctx.queue === QUEUE_TRANSPARENT || this._transmission) && ctx.scene.env.sky.fogPresents) {
          ctx.materialFlags |= MaterialVaryingFlags.APPLY_FOG;
        }
        const numOitPasses = ctx.oit ? ctx.oit.begin(ctx) : 1;
        for (let p = 0; p < numOitPasses; p++) {
          if (ctx.oit && !isolateTransparentABufferLightPasses) {
            if (!ctx.oit.beginPass(ctx, p)) {
              continue;
            }
          }
          const runLightPass = (lights: PunctualLight[]) => {
            if (ctx.oit && isolateTransparentABufferLightPasses) {
              if (!ctx.oit.beginPass(ctx, p)) {
                return;
              }
              this.renderLightPass(ctx, camera, lists[i]!, lights, flags);
              ctx.oit.endPass(ctx, p);
            } else {
              this.renderLightPass(ctx, camera, lists[i]!, lights, flags);
            }
          };
          const runAdditiveLightPass = (lights: PunctualLight[]) => {
            const passFramebuffer =
              ctx.queue === QUEUE_TRANSPARENT ? transparentTmpFramebuffer : tmpFramebuffer;
            if (ctx.lightBlending && passFramebuffer && !ctx.oit) {
              const savedMaterialFlags = ctx.materialFlags;
              ctx.materialFlags =
                ctx.queue === QUEUE_TRANSPARENT
                  ? savedMaterialFlags & ~SURFACE_MRT_FLAGS
                  : savedMaterialFlags & ~ADDITIVE_LIGHT_PASS_OMIT_MRT_FLAGS;
              ctx.device.pushDeviceStates();
              ctx.device.setFramebuffer(passFramebuffer);
              try {
                runLightPass(lights);
              } finally {
                ctx.materialFlags = savedMaterialFlags;
                ctx.device.popDeviceStates();
              }
            } else {
              runLightPass(lights);
            }
          };
          let lightIndex = 0;
          // Run the per-shadowed-light additive passes unless this queue uses the
          // screen-space shadow mask (opaque). Transparent/transmission queues keep
          // the inline additive shadow path even when the mask is enabled.
          if (!useShadowMaskQueue && ctx.shadowMapInfo) {
            for (const k of ctx.shadowMapInfo.keys()) {
              ctx.currentShadowLight = k;
              ctx.lightBlending = lightIndex > 0;
              this._shadowMapHash = ctx.shadowMapInfo.get(k)!.shaderHash;
              runAdditiveLightPass([k]);
              lightIndex++;
            }
          }
          if (lightIndex === 0 || renderQueue.unshadowedLights.length > 0) {
            ctx.currentShadowLight = null;
            ctx.lightBlending = lightIndex > 0;
            this._shadowMapHash = '';
            runAdditiveLightPass(renderQueue.unshadowedLights);
          }
          if (ctx.oit && !isolateTransparentABufferLightPasses) {
            ctx.oit.endPass(ctx, p);
          }
        }
        if (ctx.oit) {
          ctx.oit.end(ctx);
        }
        ctx.materialFlags &= ~MaterialVaryingFlags.APPLY_FOG;
      }
      if (i === 0 && !ctx.sceneColorTexture) {
        if (tmpFramebuffer) {
          ctx.device.pushDeviceStates();
          ctx.device.setFramebuffer(tmpFramebuffer);
        }
        ctx.env.sky.renderSky(ctx);
        if (ctx.env.sky.fogPresents) {
          ctx.env.sky.renderFog(camera);
        }
        if (tmpFramebuffer) {
          ctx.device.popDeviceStates();
        }
      }
      // Post effects of all layers are built as render graph passes; the
      // opaque-layer chain runs between the opaque and transparent passes.
    }
    if (tmpFramebuffer) {
      ctx.device.pool.releaseFrameBuffer(tmpFramebuffer);
    }
    if (transparentTmpFramebuffer && transparentTmpFramebuffer !== tmpFramebuffer) {
      ctx.device.pool.releaseFrameBuffer(transparentTmpFramebuffer);
    }
    ctx.oit = null;
  }
}
