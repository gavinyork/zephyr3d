import { LightPass } from './lightpass';
import { ShadowMapPass } from './shadowmap_pass';
import { DepthPass } from './depthpass';
import { isPowerOf2, Matrix4x4, nextPowerOf2, Vector3, Vector4 } from '@zephyr3d/base';
import type { ColorState, FrameBuffer, Texture2D, TextureFormat } from '@zephyr3d/device';
import { Application } from '../app/app';
import { CopyBlitter } from '../blitter';
import type { DrawContext } from './drawable';
import type { RenderQueue } from './render_queue';
import type { PunctualLight, Scene } from '../scene';
import type { PickResult } from '../camera';
import { Camera } from '../camera';
import { PostEffectLayer } from '../posteffect/posteffect';
import type { Compositor } from '../posteffect';
import { ClusteredLight } from './cluster_light';
import { GlobalBindGroupAllocator } from './globalbindgroup_allocator';
import { ObjectColorPass } from './objectcolorpass';
import { buildHiZ } from './hzb';
import { MaterialVaryingFlags } from '../values';
import { fetchSampler } from '../utility/misc';

/**
 * Forward render scheme
 * @internal
 */
export class SceneRenderer {
  /** @internal */
  private static _pickCamera = new Camera(null);
  /** @internal */
  private static _scenePass = new LightPass();
  /** @internal */
  private static _depthPass = new DepthPass();
  /** @internal */
  private static _shadowMapPass = new ShadowMapPass();
  /** @internal */
  private static _objectColorPass = new ObjectColorPass();
  /** @internal */
  private static _frontDepthColorState: ColorState = null;
  /** @internal */
  private static _backDepthColorState: ColorState = null;
  /** @internal */
  private static _clusters: ClusteredLight[] = [];
  /** lighting render pass */
  static get sceneRenderPass(): LightPass {
    return this._scenePass;
  }
  /** depth render pass */
  static get depthRenderPass(): DepthPass {
    return this._depthPass;
  }
  /** shadow map render pass */
  static get shadowMapRenderPass(): ShadowMapPass {
    return this._shadowMapPass;
  }
  /** @internal */
  static setClearColor(color: Vector4): void {
    this._scenePass.clearColor = color;
  }
  /** @internal */
  static getClusteredLight(): ClusteredLight {
    if (this._clusters.length > 0) {
      return this._clusters.pop();
    }
    return new ClusteredLight();
  }
  /** @internal */
  static freeClusteredLight(clusteredLight: ClusteredLight) {
    this._clusters.push(clusteredLight);
  }
  /**
   * Renders a scene by given camera
   * @param scene - The scene tondered
   * @param camera - The camera that will be used to render the scene
   * @param compositor - The compositor that will be used to apply postprocess effects
   */
  static renderScene(scene: Scene, camera: Camera, compositor?: Compositor): void {
    const device = Application.instance.device;
    const colorFormat = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
      ? 'rgba16f'
      : 'rgba8unorm';
    const depthFormat = device.getDeviceCaps().framebufferCaps.supportDepth32floatStencil8
      ? 'd32fs8'
      : 'd24s8';
    const globalBindGroupAllocator = GlobalBindGroupAllocator.get();
    scene.frameUpdate();
    if (camera && !device.isContextLost()) {
      const defaultViewport = !camera.viewport && !camera.scissor;
      const renderX = camera.viewport ? device.screenToDevice(camera.viewport[0]) : 0;
      const renderY = camera.viewport ? device.screenToDevice(camera.viewport[1]) : 0;
      const renderWidth = camera.viewport
        ? device.screenToDevice(camera.viewport[2])
        : device.getDrawingBufferWidth();
      const renderHeight = camera.viewport
        ? device.screenToDevice(camera.viewport[3])
        : device.getDrawingBufferHeight();
      if (renderWidth <= 0 || renderHeight <= 0) {
        camera.getPickResultResolveFunc()?.(null);
        return;
      }
      const tmpFramebuffer = defaultViewport
        ? null
        : device.pool.fetchTemporalFramebuffer(false, renderWidth, renderHeight, colorFormat, depthFormat);
      const originFramebuffer = device.getFramebuffer();
      if (tmpFramebuffer) {
        device.pushDeviceStates();
        device.setFramebuffer(tmpFramebuffer);
      }
      const SSR = camera.SSR && scene.env.light.envLight && scene.env.light.envLight.hasRadiance();
      const ctx: DrawContext = {
        device,
        scene,
        renderWidth,
        renderHeight,
        primaryCamera: camera,
        picking: false,
        oit: null,
        motionVectors: camera.TAA,
        HiZ: camera.HiZ && device.type !== 'webgl',
        HiZTexture: null,
        globalBindGroupAllocator,
        camera,
        compositor,
        timestamp: device.frameInfo.frameTimestamp,
        queue: 0,
        lightBlending: false,
        renderPass: null,
        renderPassHash: null,
        applyFog: null,
        flip: false,
        depthFormat,
        colorFormat,
        drawEnvLight: false,
        env: null,
        materialFlags: 0,
        TAA: camera.TAA,
        SSR,
        SSRCalcThickness: SSR && camera.ssrCalcThickness,
        SSRRoughnessTexture: device.pool.fetchTemporalTexture2D(
          true,
          'rgba8unorm',
          renderWidth,
          renderHeight
        ),
        SSRNormalTexture: device.pool.fetchTemporalTexture2D(true, 'rgba8unorm', renderWidth, renderHeight),
        finalFramebuffer: device.getFramebuffer(),
        intermediateFramebuffer: null
      };
      this._renderScene(ctx);
      if (tmpFramebuffer) {
        device.popDeviceStates();
        const oversizedViewport =
          renderX < 0 ||
          renderY < 0 ||
          renderX + renderWidth > device.getDrawingBufferWidth() ||
          renderY + renderHeight > device.getDrawingBufferHeight();
        const blitter = new CopyBlitter();
        if (oversizedViewport) {
          blitter.destRect = [renderX, renderY, renderWidth, renderHeight];
        } else {
          blitter.viewport = camera.viewport;
        }
        blitter.scissor = camera.scissor;
        blitter.blit(
          tmpFramebuffer.getColorAttachments()[0],
          originFramebuffer ?? null,
          fetchSampler('clamp_nearest_nomip')
        );
        device.pool.releaseFrameBuffer(tmpFramebuffer);
      }
    }
    GlobalBindGroupAllocator.release(globalBindGroupAllocator);
  }
  private static renderSceneDepth(ctx: DrawContext, renderQueue: RenderQueue, depthFramebuffer: FrameBuffer) {
    const transmission = !!depthFramebuffer;
    if (!depthFramebuffer) {
      const format: TextureFormat =
        ctx.device.type === 'webgl'
          ? ctx.SSRCalcThickness
            ? 'rgba16f'
            : 'rgba8unorm'
          : ctx.SSRCalcThickness
          ? 'rg32f'
          : 'r32f';
      const mvFormat: TextureFormat = ctx.device.type === 'webgl' ? 'rgba16f' : 'rgba16f';
      if (!ctx.finalFramebuffer) {
        depthFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
          true,
          ctx.renderWidth,
          ctx.renderHeight,
          ctx.motionVectors ? [format, mvFormat] : format,
          ctx.depthFormat,
          ctx.HiZ
        );
      } else {
        const originDepth = ctx.finalFramebuffer?.getDepthAttachment();
        depthFramebuffer = originDepth?.isTexture2D()
          ? ctx.device.pool.fetchTemporalFramebuffer(
              true,
              originDepth.width,
              originDepth.height,
              ctx.motionVectors ? [format, mvFormat] : format,
              originDepth,
              ctx.HiZ
            )
          : ctx.device.pool.fetchTemporalFramebuffer(
              true,
              ctx.renderWidth,
              ctx.renderHeight,
              ctx.motionVectors ? [format, mvFormat] : format,
              ctx.depthFormat,
              ctx.HiZ
            );
      }
    }
    ctx.device.pushDeviceStates();
    ctx.device.setFramebuffer(depthFramebuffer);
    this._depthPass.encodeDepth = depthFramebuffer.getColorAttachments()[0].format === 'rgba8unorm';
    this._depthPass.clearColor = transmission
      ? null
      : this._depthPass.encodeDepth
      ? new Vector4(0, 0, 0, 1)
      : new Vector4(1, 1, 1, 1);
    this._depthPass.clearDepth = transmission ? null : 1;
    this._depthPass.transmission = transmission;
    if (ctx.SSRCalcThickness && !transmission) {
      if (!this._backDepthColorState) {
        this._backDepthColorState = ctx.device.createColorState().setColorMask(false, true, false, false);
      }
      if (!this._frontDepthColorState) {
        this._frontDepthColorState = ctx.device.createColorState().setColorMask(true, false, false, false);
      }
      ctx.forceColorState = this._backDepthColorState;
      ctx.forceCullMode = 'front';
      this._depthPass.renderBackface = true;
      this._depthPass.transmission = false;
      this._depthPass.render(ctx, null, renderQueue);
      this._depthPass.clearColor = null;
      this._depthPass.renderBackface = false;
      ctx.forceColorState = this._frontDepthColorState;
      ctx.forceCullMode = null;
    }
    this._depthPass.render(ctx, null, renderQueue);
    ctx.forceColorState = null;
    ctx.device.popDeviceStates();

    if (!transmission) {
      ctx.motionVectorTexture = ctx.motionVectors
        ? (depthFramebuffer.getColorAttachments()[1] as Texture2D)
        : null;
      ctx.linearDepthTexture = depthFramebuffer.getColorAttachments()[0] as Texture2D;
      ctx.depthTexture = depthFramebuffer.getDepthAttachment() as Texture2D;
      if (ctx.HiZ) {
        let w = isPowerOf2(ctx.linearDepthTexture.width)
          ? ctx.linearDepthTexture.width
          : nextPowerOf2(ctx.linearDepthTexture.width);
        let h = isPowerOf2(ctx.linearDepthTexture.height)
          ? ctx.linearDepthTexture.height
          : nextPowerOf2(ctx.linearDepthTexture.height);
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        w = ctx.linearDepthTexture.width;
        h = ctx.linearDepthTexture.height;
        const HiZFrameBuffer = ctx.device.pool.fetchTemporalFramebuffer(
          true,
          w,
          h,
          ctx.linearDepthTexture.format,
          null,
          true
        );
        buildHiZ(ctx.depthTexture, HiZFrameBuffer);
        ctx.HiZTexture = HiZFrameBuffer.getColorAttachments()[0] as Texture2D;
      }
    }
    return depthFramebuffer;
  }
  /** @internal */
  protected static _renderScene(ctx: DrawContext): void {
    const device = ctx.device;

    // Cull scene and gather lights
    const renderQueue = this._scenePass.cullScene(ctx, ctx.camera);
    ctx.sunLight = renderQueue.sunLight;
    ctx.clusteredLight = this.getClusteredLight();
    ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);

    /*
    const useScatter =
      ctx.scene.env.sky.skyType === 'scatter' ||
      ctx.scene.env.sky.skyType === 'scatter-nocloud' ||
      ctx.scene.env.sky.fogType === 'scatter';
    if (useScatter) {
      ctx.scene.env.sky.renderAtmosphereLUTs(ctx);
    }
    const sunLightColor = ctx.sunLight && useScatter ? new Vector4(ctx.sunLight.diffuseAndIntensity) : null;
    // Apply sun
    if (sunLightColor) {
      const sunTransmittance = ctx.scene.env.sky.sunTransmittance(ctx.sunLight);
      ctx.sunLight.color = Vector4.mul(
        ctx.sunLight.color,
        new Vector4(sunTransmittance.x, sunTransmittance.y, sunTransmittance.z, 1)
      );
    }
    */

    // Do GPU ray picking if required
    const pickResolveFunc = ctx.camera.getPickResultResolveFunc();
    if (pickResolveFunc) {
      this.renderObjectColors(ctx, pickResolveFunc, renderQueue);
    }

    // Render shadow maps
    this.renderShadowMaps(ctx, renderQueue.shadowedLights);

    // Render scene depth first
    const depthFramebuffer = this.renderSceneDepth(ctx, renderQueue, null);
    if (ctx.depthTexture === ctx.finalFramebuffer?.getDepthAttachment()) {
      ctx.intermediateFramebuffer = ctx.finalFramebuffer;
    } else {
      // TODO: fetch resizable framebuffer if ctx.defaultViewport is true
      ctx.intermediateFramebuffer = device.pool.fetchTemporalFramebuffer(
        false,
        ctx.depthTexture.width,
        ctx.depthTexture.height,
        ctx.colorFormat,
        ctx.depthTexture
      );
    }
    if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
      device.pushDeviceStates();
      device.setFramebuffer(ctx.intermediateFramebuffer);
    } else {
      device.setViewport(null);
      device.setScissor(null);
    }
    this._scenePass.transmission = false; // transmission
    this._scenePass.clearDepth = ctx.depthTexture ? null : 1;
    this._scenePass.clearStencil = ctx.depthTexture ? null : 0;
    if (ctx.SSR && !renderQueue.needSceneColor()) {
      ctx.materialFlags |= MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
    }
    ctx.compositor?.begin(ctx);
    if (renderQueue.needSceneColor()) {
      const compositor = ctx.compositor;
      ctx.compositor = null;
      const sceneColorFramebuffer = device.pool.fetchTemporalFramebuffer(
        true,
        ctx.depthTexture.width,
        ctx.depthTexture.height,
        ctx.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS
          ? [
              ctx.colorFormat,
              device.getFramebuffer().getColorAttachments()[1],
              device.getFramebuffer().getColorAttachments()[2]
            ]
          : ctx.colorFormat,
        ctx.depthTexture,
        true
      );
      device.pushDeviceStates();
      device.setFramebuffer(sceneColorFramebuffer);
      this._scenePass.transmission = false;
      this._scenePass.render(ctx, null, renderQueue);
      device.popDeviceStates();
      ctx.sceneColorTexture = sceneColorFramebuffer.getColorAttachments()[0] as Texture2D;
      new CopyBlitter().blit(
        ctx.sceneColorTexture,
        device.getFramebuffer() ?? null,
        fetchSampler('clamp_nearest_nomip')
      );
      this._scenePass.transmission = true;
      this._scenePass.clearColor = null;
      this._scenePass.clearDepth = null;
      this._scenePass.clearStencil = null;
      ctx.compositor = compositor;
    }
    this._scenePass.render(ctx, null, renderQueue);
    if (renderQueue.needSceneColor()) {
      this.renderSceneDepth(ctx, renderQueue, depthFramebuffer);
    }
    ctx.compositor?.drawPostEffects(ctx, PostEffectLayer.end, ctx.linearDepthTexture);
    ctx.compositor?.end(ctx);
    renderQueue.dispose();
    ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;

    if (ctx.intermediateFramebuffer && ctx.intermediateFramebuffer !== ctx.finalFramebuffer) {
      const blitter = new CopyBlitter();
      blitter.srgbOut = !ctx.finalFramebuffer;
      const srcTex = ctx.intermediateFramebuffer.getColorAttachments()[0] as Texture2D;
      blitter.blit(srcTex, ctx.finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
      device.popDeviceStates();
      device.pool.releaseFrameBuffer(ctx.intermediateFramebuffer);
    }
    //ShadowMapper.releaseTemporalResources(ctx);
    this.freeClusteredLight(ctx.clusteredLight);

    /*
    // Restore sun color
    if (sunLightColor) {
      ctx.sunLight.color.set(sunLightColor);
    }
    */
  }
  /** @internal */
  private static renderShadowMaps(ctx: DrawContext, lights: PunctualLight[]) {
    ctx.renderPass = this._shadowMapPass;
    ctx.device.pushDeviceStates();
    for (const light of lights) {
      light.shadow.render(ctx, this._shadowMapPass);
    }
    ctx.device.popDeviceStates();
  }
  /** @internal */
  private static renderObjectColors(
    ctx: DrawContext,
    pickResolveFunc: (result: PickResult) => void,
    renderQueue: RenderQueue
  ) {
    const camera = ctx.camera;
    ctx.renderPass = this._objectColorPass;
    ctx.device.pushDeviceStates();
    const fb = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      1,
      1,
      ['rgba8unorm', 'rgba32f'],
      ctx.depthFormat,
      false
    );
    ctx.device.setViewport(camera.viewport);
    const vp = ctx.device.getViewport();
    const windowX = camera.getPickPosX() / vp.width;
    const windowY = (vp.height - camera.getPickPosY() - 1) / vp.height;
    const windowW = 1 / vp.width;
    const windowH = 1 / vp.height;
    camera.worldMatrix.decompose(
      this._pickCamera.scale,
      this._pickCamera.rotation,
      this._pickCamera.position
    );
    let left = camera.getProjectionMatrix().getLeftPlane();
    let right = camera.getProjectionMatrix().getRightPlane();
    let bottom = camera.getProjectionMatrix().getBottomPlane();
    let top = camera.getProjectionMatrix().getTopPlane();
    const near = camera.getProjectionMatrix().getNearPlane();
    const far = camera.getProjectionMatrix().getFarPlane();
    const width = right - left;
    const height = top - bottom;
    left += width * windowX;
    bottom += height * windowY;
    right = left + width * windowW;
    top = bottom + height * windowH;
    this._pickCamera.setProjectionMatrix(
      camera.isPerspective()
        ? Matrix4x4.frustum(left, right, bottom, top, near, far)
        : Matrix4x4.ortho(left, right, bottom, top, near, far)
    );
    ctx.device.setFramebuffer(fb);
    this._objectColorPass.clearColor = Vector4.zero();
    this._objectColorPass.clearDepth = 1;
    const rq = this._objectColorPass.cullScene(ctx, this._pickCamera);
    ctx.camera = this._pickCamera;
    this._objectColorPass.render(ctx, null, rq);
    ctx.camera = camera;
    ctx.device.popDeviceStates();
    const colorTex = fb.getColorAttachments()[0];
    const distanceTex = fb.getColorAttachments()[1];
    const colorPixels = new Uint8Array(4);
    const distancePixels = new Float32Array(4);
    const device = ctx.device;
    Promise.all([
      colorTex.readPixels(0, 0, 1, 1, 0, 0, colorPixels),
      distanceTex.readPixels(0, 0, 1, 1, 0, 0, distancePixels)
    ])
      .then(() => {
        const drawable = renderQueue.getDrawableByColor(colorPixels);
        pickResolveFunc(
          drawable
            ? {
                distance: distancePixels[3],
                intersectedPoint: new Vector3(distancePixels[0], distancePixels[1], distancePixels[2]),
                drawable,
                target: drawable.getPickTarget()
              }
            : null
        );
        device.pool.releaseFrameBuffer(fb);
      })
      .catch((err) => {
        camera.getPickResultResolveFunc()?.(null);
        device.pool.releaseFrameBuffer(fb);
      });
  }
}
