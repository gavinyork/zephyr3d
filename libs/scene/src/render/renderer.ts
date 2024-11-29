import { LightPass } from './lightpass';
import { ShadowMapPass } from './shadowmap_pass';
import { DepthPass } from './depthpass';
import { isPowerOf2, nextPowerOf2, Vector4 } from '@zephyr3d/base';
import type { ColorState, FrameBuffer, Texture2D, TextureFormat } from '@zephyr3d/device';
import { Application } from '../app';
import { CopyBlitter } from '../blitter';
import type { DrawContext } from './drawable';
import { ShadowMapper } from '../shadow';
import type { RenderQueue } from './render_queue';
import type { PunctualLight, Scene } from '../scene';
import type { PickResult } from '../camera';
import { PerspectiveCamera, type Camera } from '../camera';
import { Compositor } from '../posteffect';
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
  private static _defaultCompositor = new Compositor();
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
    const ctx: DrawContext = {
      device,
      scene,
      primaryCamera: camera,
      picking: false,
      oit: null,
      motionVectors: camera.TAA,
      HiZ: camera.HiZ && device.type !== 'webgl',
      HiZTexture: null,
      globalBindGroupAllocator: GlobalBindGroupAllocator.get(),
      camera,
      compositor: compositor ?? this._defaultCompositor,
      timestamp: device.frameInfo.frameTimestamp,
      queue: 0,
      lightBlending: false,
      renderPass: null,
      renderPassHash: null,
      applyFog: null,
      flip: false,
      depthFormat: device.getDeviceCaps().framebufferCaps.supportDepth32floatStencil8 ? 'd32fs8' : 'd24s8',
      colorFormat: device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm',
      drawEnvLight: false,
      env: null,
      materialFlags: 0,
      TAA: camera.TAA
    };
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
      const tmpFramebuffer = defaultViewport
        ? null
        : device.pool.fetchTemporalFramebuffer(
            false,
            renderWidth,
            renderHeight,
            ctx.colorFormat,
            ctx.depthFormat
          );
      const originFramebuffer = device.getFramebuffer();
      if (tmpFramebuffer) {
        device.pushDeviceStates();
        device.setFramebuffer(tmpFramebuffer);
      }
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
    GlobalBindGroupAllocator.release(ctx.globalBindGroupAllocator);
  }
  /** @internal */
  protected static _renderSceneDepth(
    ctx: DrawContext,
    renderQueue: RenderQueue,
    depthFramebuffer: FrameBuffer,
    renderBackfaceDepth?: boolean
  ) {
    const device = ctx.device;
    device.pushDeviceStates();
    device.setFramebuffer(depthFramebuffer);
    this._depthPass.encodeDepth = depthFramebuffer.getColorAttachments()[0].format === 'rgba8unorm';
    this._depthPass.clearColor = this._depthPass.encodeDepth
      ? new Vector4(0, 0, 0, 1)
      : new Vector4(1, 1, 1, 1);
    this._depthPass.clearDepth = 1;
    if (renderBackfaceDepth) {
      if (!this._backDepthColorState) {
        this._backDepthColorState = device.createColorState().setColorMask(false, true, false, false);
      }
      if (!this._frontDepthColorState) {
        this._frontDepthColorState = device.createColorState().setColorMask(true, false, false, false);
      }
      ctx.forceColorState = this._backDepthColorState;
      ctx.forceCullMode = 'front';
      this._depthPass.renderBackface = true;
      this._depthPass.render(ctx, null, renderQueue);
      this._depthPass.clearColor = null;
      this._depthPass.renderBackface = false;
      ctx.forceColorState = this._frontDepthColorState;
      ctx.forceCullMode = null;
    }
    this._depthPass.render(ctx, null, renderQueue);
    ctx.forceColorState = null;
    device.popDeviceStates();
  }
  /** @internal */
  protected static _renderScene(ctx: DrawContext): void {
    const device = ctx.device;
    const SSR =
      ctx.primaryCamera.SSR && ctx.scene.env.light.envLight && ctx.scene.env.light.envLight.hasRadiance();
    const SSRCalcThickness = SSR && ctx.primaryCamera.ssrCalcThickness;
    const finalFramebuffer = device.getFramebuffer();
    const drawingBufferWidth = device.getDrawingBufferWidth();
    const drawingBufferHeight = device.getDrawingBufferHeight();
    let tempFramebuffer: FrameBuffer = null;
    let depthFramebuffer: FrameBuffer = null;

    if (ctx.camera.enablePicking) {
      this.renderObjectColors(ctx);
    }
    let HiZFrameBuffer: FrameBuffer = null;
    const renderQueue = this._scenePass.cullScene(ctx, ctx.camera);
    ctx.sunLight = renderQueue.sunLight;
    ctx.clusteredLight = this.getClusteredLight();
    ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);
    this.renderShadowMaps(ctx, renderQueue.shadowedLights);
    const sampleCount = ctx.compositor ? 1 : ctx.primaryCamera.sampleCount;
    if (
      SSR ||
      ctx.primaryCamera.depthPrePass ||
      renderQueue.needSceneColor ||
      ctx.scene.env.needSceneDepthTexture() ||
      ctx.motionVectors ||
      ctx.HiZ ||
      ctx.primaryCamera.oit ||
      ctx.compositor.requireLinearDepth(ctx)
    ) {
      const format: TextureFormat =
        device.type === 'webgl'
          ? SSRCalcThickness
            ? 'rgba16f'
            : 'rgba8unorm'
          : SSRCalcThickness
          ? 'rg32f'
          : 'r32f';
      const mvFormat: TextureFormat = device.type === 'webgl' ? 'rgba8unorm' : 'rg16f';
      if (!finalFramebuffer) {
        depthFramebuffer = device.pool.fetchTemporalFramebuffer(
          true,
          drawingBufferWidth,
          drawingBufferHeight,
          ctx.motionVectors ? [format, mvFormat] : format,
          ctx.depthFormat,
          ctx.HiZ
        );
      } else {
        const originDepth = finalFramebuffer?.getDepthAttachment();
        depthFramebuffer = originDepth?.isTexture2D()
          ? device.pool.fetchTemporalFramebuffer(
              true,
              originDepth.width,
              originDepth.height,
              ctx.motionVectors ? [format, mvFormat] : format,
              originDepth,
              ctx.HiZ
            )
          : device.pool.fetchTemporalFramebuffer(
              true,
              device.getDrawingBufferWidth(),
              device.getDrawingBufferHeight(),
              ctx.motionVectors ? [format, mvFormat] : format,
              ctx.depthFormat,
              ctx.HiZ
            );
      }
      this._renderSceneDepth(ctx, renderQueue, depthFramebuffer, SSRCalcThickness);
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
        HiZFrameBuffer = device.pool.fetchTemporalFramebuffer(
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
      if (ctx.depthTexture === finalFramebuffer?.getDepthAttachment()) {
        tempFramebuffer = finalFramebuffer;
      } else {
        // TODO: fetch resizable framebuffer if ctx.defaultViewport is true
        tempFramebuffer = device.pool.fetchTemporalFramebuffer(
          false,
          ctx.depthTexture.width,
          ctx.depthTexture.height,
          ctx.colorFormat,
          ctx.depthTexture,
          false,
          sampleCount
        );
      }
    } else {
      ctx.linearDepthTexture = null;
      ctx.depthTexture = null;
      tempFramebuffer = finalFramebuffer;
    }
    if (tempFramebuffer && tempFramebuffer !== finalFramebuffer) {
      device.pushDeviceStates();
      device.setFramebuffer(tempFramebuffer);
    } else {
      device.setViewport(null);
      device.setScissor(null);
    }
    this._scenePass.transmission = false; // transmission
    this._scenePass.clearDepth = ctx.depthTexture ? null : 1;
    this._scenePass.clearStencil = ctx.depthTexture ? null : 0;
    if (SSR && !renderQueue.needSceneColor) {
      ctx.materialFlags |= MaterialVaryingFlags.SSR_STORE_ROUGHNESS;
    }
    ctx.compositor?.begin(ctx);
    if (renderQueue.needSceneColor) {
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
    ctx.compositor?.end(ctx);
    renderQueue.dispose();
    ctx.materialFlags &= ~MaterialVaryingFlags.SSR_STORE_ROUGHNESS;

    if (tempFramebuffer && tempFramebuffer !== finalFramebuffer) {
      const blitter = new CopyBlitter();
      blitter.srgbOut = !finalFramebuffer;
      const srcTex = tempFramebuffer.getColorAttachments()[0] as Texture2D;
      blitter.blit(srcTex, finalFramebuffer ?? null, fetchSampler('clamp_nearest_nomip'));
      device.popDeviceStates();

      device.pool.releaseFrameBuffer(tempFramebuffer);
    }
    ShadowMapper.releaseTemporalResources(ctx);
    this.freeClusteredLight(ctx.clusteredLight);
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
  private static renderObjectColors(ctx: DrawContext) {
    if (!(ctx.camera instanceof PerspectiveCamera)) {
      return;
    }
    ctx.renderPass = this._objectColorPass;
    ctx.device.pushDeviceStates();
    const fb = ctx.device.pool.fetchTemporalFramebuffer(false, 1, 1, 'rgba8unorm', ctx.depthFormat, false);
    ctx.device.setViewport(ctx.camera.viewport);
    const savedViewport = ctx.camera.viewport;
    const savedScissor = ctx.camera.scissor;
    const savedWindow = ctx.camera.window;
    const vp = ctx.device.getViewport();
    const windowX = ctx.camera.pickPosX / vp.width;
    const windowY = (vp.height - ctx.camera.pickPosY - 1) / vp.height;
    const windowW = 1 / vp.width;
    const windowH = 1 / vp.height;
    ctx.camera.viewport = null;
    ctx.camera.scissor = null;
    ctx.camera.window = [windowX, windowY, windowW, windowH];
    ctx.device.setFramebuffer(fb);
    this._objectColorPass.clearColor = Vector4.zero();
    this._objectColorPass.clearDepth = 1;
    const renderQueue = this._objectColorPass.cullScene(ctx, ctx.camera);
    this._objectColorPass.render(ctx, ctx.camera, renderQueue);
    ctx.camera.viewport = savedViewport;
    ctx.camera.scissor = savedScissor;
    ctx.camera.window = savedWindow;
    ctx.device.popDeviceStates();
    const tex = fb.getColorAttachments()[0];
    const pixels = new Uint8Array(4);
    const camera = ctx.camera;
    const device = ctx.device;
    camera.pickResultAsync = new Promise<PickResult>((resolve, reject) => {
      tex
        .readPixels(0, 0, 1, 1, 0, 0, pixels)
        .then(() => {
          const drawable = renderQueue.getDrawableByColor(pixels);
          camera.pickResult =
            drawable && drawable.getPickTarget()?.node?.pickable
              ? { drawable, target: drawable.getPickTarget() }
              : null;
          device.pool.releaseFrameBuffer(fb);
          resolve(camera.pickResult);
        })
        .catch((err) => {
          reject(err);
        });
    });
    /*
    tex.readPixels(0, 0, 1, 1, 0, 0, pixels).then(() => {
      const drawable = renderQueue.getDrawableByColor(pixels);
      camera.pickResult =
        drawable && drawable.getPickTarget()?.pickable ? { drawable, node: drawable.getPickTarget() } : null;
      device.pool.releaseFrameBuffer(fb);
    });
    */
  }
}
