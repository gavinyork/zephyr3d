import { LightPass } from './lightpass';
import { ShadowMapPass } from './shadowmap_pass';
import { DepthPass } from './depthpass';
import { Vector4 } from '@zephyr3d/base';
import type { FrameBuffer, Texture2D, TextureFormat } from '@zephyr3d/device';
import { Application } from '../app';
import { CopyBlitter } from '../blitter';
import type { DrawContext } from './drawable';
import { ShadowMapper } from '../shadow';
import type { RenderQueue } from './render_queue';
import type { PunctualLight, Scene } from '../scene';
import type { PickResult } from '../camera';
import { PerspectiveCamera, type Camera } from '../camera';
import type { Compositor } from '../posteffect';
import { ClusteredLight } from './cluster_light';
import { GlobalBindGroupAllocator } from './globalbindgroup_allocator';
import { ObjectColorPass } from './objectcolorpass';

/**
 * Forward render scheme
 * @internal
 */
export class SceneRenderer {
  /** @internal */
  private static _scenePass = new LightPass();
  /** @internal */
  private static _depthPass = new DepthPass();
  /** @internal */
  private static _shadowMapPass = new ShadowMapPass();
  /** @internal */
  private static _objectColorPass = new ObjectColorPass();
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
   * @param scene - The scene to be rendered
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
      globalBindGroupAllocator: GlobalBindGroupAllocator.get(),
      camera,
      compositor: compositor?.needDrawPostEffects() ? compositor : null,
      timestamp: device.frameInfo.frameTimestamp,
      queue: 0,
      lightBlending: false,
      renderPass: null,
      renderPassHash: null,
      applyFog: null,
      flip: false,
      drawEnvLight: false,
      env: null
    };
    scene.frameUpdate();
    if (camera && !device.isContextLost()) {
      this._renderScene(ctx);
    }
    GlobalBindGroupAllocator.release(ctx.globalBindGroupAllocator);
  }
  /** @internal */
  protected static _renderSceneDepth(
    ctx: DrawContext,
    renderQueue: RenderQueue,
    depthFramebuffer: FrameBuffer
  ) {
    const device = ctx.device;
    device.pushDeviceStates();
    device.setFramebuffer(depthFramebuffer);
    this._depthPass.clearColor = device.type === 'webgl' ? new Vector4(0, 0, 0, 1) : new Vector4(1, 1, 1, 1);
    this._depthPass.render(ctx, null, renderQueue);
    device.popDeviceStates();
  }
  /** @internal */
  protected static _renderScene(ctx: DrawContext): void {
    const device = ctx.device;
    const vp = ctx.camera.viewport;
    const scissor = ctx.camera.scissor;
    const finalFramebuffer = device.getFramebuffer();
    const drawingBufferWidth = device.getDrawingBufferWidth();
    const drawingBufferHeight = device.getDrawingBufferHeight();
    ctx.depthFormat =
      false && device.getDeviceCaps().framebufferCaps.supportDepth32floatStencil8 ? 'd32fs8' : 'd24s8';
    ctx.viewportX = finalFramebuffer ? vp?.[0] ?? 0 : device.screenToDevice(vp?.[0] ?? 0);
    ctx.viewportY = finalFramebuffer ? vp?.[1] ?? 0 : device.screenToDevice(vp?.[1] ?? 0);
    ctx.viewportWidth = finalFramebuffer
      ? vp?.[2] ?? finalFramebuffer.getWidth()
      : vp
      ? device.screenToDevice(vp[2])
      : device.getDrawingBufferWidth();
    ctx.viewportHeight = finalFramebuffer
      ? vp?.[3] ?? finalFramebuffer.getHeight()
      : vp
      ? device.screenToDevice(vp[3])
      : device.getDrawingBufferHeight();
    ctx.defaultViewport = !finalFramebuffer && !vp;
    const oversizedViewport =
      vp &&
      !device.getDeviceCaps().miscCaps.supportOversizedViewport &&
      (ctx.viewportX < 0 ||
        ctx.viewportY < 0 ||
        ctx.viewportX + ctx.viewportWidth > drawingBufferWidth ||
        ctx.viewportY + ctx.viewportHeight > drawingBufferHeight);
    // TODO: determin the color buffer format
    const colorFmt: TextureFormat = device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer
      ? 'rgba16f'
      : 'rgba8unorm';
    let tempFramebuffer: FrameBuffer = null;
    let depthFramebuffer: FrameBuffer = null;

    if (ctx.camera.enablePicking) {
      this.renderObjectColors(ctx);
    }

    const renderQueue = this._scenePass.cullScene(ctx, ctx.camera);
    ctx.sunLight = renderQueue.sunLight;
    ctx.clusteredLight = this.getClusteredLight();
    ctx.clusteredLight.calculateLightIndex(ctx.camera, renderQueue);
    this.renderShadowMaps(ctx, renderQueue.shadowedLights);
    const sampleCount = ctx.compositor ? 1 : ctx.primaryCamera.sampleCount;
    if (
      ctx.primaryCamera.depthPrePass ||
      oversizedViewport ||
      renderQueue.needSceneColor ||
      ctx.scene.env.needSceneDepthTexture() ||
      ctx.primaryCamera.oit ||
      ctx.compositor?.requireLinearDepth()
    ) {
      const format: TextureFormat = device.type === 'webgl' ? 'rgba8unorm' : 'r32f';
      if (!finalFramebuffer && !vp) {
        depthFramebuffer = device.pool.fetchTemporalFramebuffer(
          true,
          drawingBufferWidth,
          drawingBufferHeight,
          format,
          ctx.depthFormat
        );
      } else {
        const originDepth = finalFramebuffer?.getDepthAttachment();
        depthFramebuffer = originDepth?.isTexture2D()
          ? device.pool.fetchTemporalFramebuffer(
              true,
              originDepth.width,
              originDepth.height,
              format,
              originDepth,
              false
            )
          : device.pool.fetchTemporalFramebuffer(
              true,
              ctx.viewportWidth,
              ctx.viewportHeight,
              format,
              ctx.depthFormat,
              false
            );
      }
      this._renderSceneDepth(ctx, renderQueue, depthFramebuffer);
      ctx.linearDepthTexture = depthFramebuffer.getColorAttachments()[0] as Texture2D;
      ctx.depthTexture = depthFramebuffer.getDepthAttachment() as Texture2D;
      if (ctx.depthTexture === finalFramebuffer?.getDepthAttachment()) {
        tempFramebuffer = finalFramebuffer;
      } else {
        // TODO: fetch resizable framebuffer if ctx.defaultViewport is true
        tempFramebuffer = device.pool.fetchTemporalFramebuffer(
          true,
          ctx.depthTexture.width,
          ctx.depthTexture.height,
          colorFmt,
          ctx.depthTexture,
          false,
          sampleCount
        );
      }
    } else {
      ctx.linearDepthTexture = null;
      ctx.depthTexture = null;
      if (!vp) {
        tempFramebuffer = finalFramebuffer;
      } else {
        tempFramebuffer = device.pool.fetchTemporalFramebuffer(
          true,
          ctx.viewportWidth,
          ctx.viewportHeight,
          colorFmt,
          ctx.depthFormat,
          false,
          sampleCount
        );
      }
    }
    if (tempFramebuffer && tempFramebuffer !== finalFramebuffer) {
      device.pushDeviceStates();
      device.setFramebuffer(tempFramebuffer);
    } else {
      device.setViewport(vp);
      device.setScissor(scissor);
    }
    this._scenePass.clearDepth = 1; //ctx.depthTexture ? null : 1;
    this._scenePass.clearStencil = 0; //ctx.depthTexture ? null : 0;
    this._scenePass.transmission = false; // transmission
    if (renderQueue.needSceneColor) {
      const sceneColorFramebuffer = device.pool.fetchTemporalFramebuffer(
        true,
        ctx.depthTexture.width,
        ctx.depthTexture.height,
        colorFmt,
        ctx.depthTexture,
        true
      );
      device.pushDeviceStates();
      device.setFramebuffer(sceneColorFramebuffer);
    }
    ctx.compositor?.begin(ctx);
    this._scenePass.render(ctx, null, renderQueue);
    ctx.compositor?.end(ctx);
    if (renderQueue.needSceneColor) {
      ctx.sceneColorTexture = device.getFramebuffer().getColorAttachments()[0] as Texture2D;
      device.popDeviceStates();
      new CopyBlitter().blit(
        ctx.sceneColorTexture,
        device.getFramebuffer() ?? null,
        device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipFilter: 'none'
        })
      );
      this._scenePass.transmission = true;
      this._scenePass.clearColor = null;
      this._scenePass.clearDepth = null;
      this._scenePass.clearStencil = null;
      ctx.compositor?.begin(ctx);
      this._scenePass.render(ctx, null, renderQueue);
      ctx.compositor?.end(ctx);
    }
    renderQueue.dispose();

    if (tempFramebuffer && tempFramebuffer !== finalFramebuffer) {
      const blitter = new CopyBlitter();
      if (oversizedViewport) {
        blitter.destRect = [ctx.viewportX, ctx.viewportY, ctx.viewportWidth, ctx.viewportHeight];
      } else {
        blitter.viewport = vp;
      }
      blitter.scissor = scissor;
      blitter.srgbOut = !finalFramebuffer;
      const srcTex = tempFramebuffer.getColorAttachments()[0] as Texture2D;
      blitter.blit(
        srcTex,
        finalFramebuffer ?? null,
        device.createSampler({
          magFilter: 'nearest',
          minFilter: 'nearest',
          mipFilter: 'none'
        })
      );
      device.popDeviceStates();
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
    const vp = ctx.device.getViewport();
    const savedViewport = ctx.camera.viewport;
    const savedScissor = ctx.camera.scissor;
    const savedWindow = ctx.camera.window;
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
            drawable && drawable.getPickTarget()?.pickable
              ? { drawable, node: drawable.getPickTarget() }
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
