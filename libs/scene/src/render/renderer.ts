import { CopyBlitter } from '../blitter';
import type { DrawContext } from './drawable';
import type { Scene } from '../scene';
import type { Camera } from '../camera';
import { GlobalBindGroupAllocator } from './globalbindgroup_allocator';
import { fetchSampler } from '../utility/misc';
import { getDevice } from '../app/api';
import { executeForwardPlusGraph } from './rendergraph/forward_plus_builder';

/**
 * Forward render scheme
 * @internal
 */
export class SceneRenderer {
  /**
   * Renders a scene by given camera
   * @param scene - The scene to render
   * @param camera - The camera that will be used to render the scene
   */
  static renderScene(scene: Scene, camera: Camera): void {
    const device = getDevice();
    const colorFormat =
      camera.HDR && device.getDeviceCaps().textureCaps.supportHalfFloatColorBuffer ? 'rgba16f' : 'rgba8unorm';
    const depthFormat = device.getDeviceCaps().framebufferCaps.supportDepth32floatStencil8
      ? 'd32fs8'
      : 'd24s8';
    const globalBindGroupAllocator = GlobalBindGroupAllocator.get();
    scene.frameUpdate();
    scene.frameUpdatePerCamera(camera);
    if (camera && !device.isContextLost()) {
      const defaultViewport = !camera.viewport && !camera.scissor;
      const renderX = camera.viewport ? device.screenXToDevice(camera.viewport[0]) : 0;
      const renderY = camera.viewport ? device.screenYToDevice(camera.viewport[1]) : 0;
      const renderWidth = camera.viewport
        ? device.screenXToDevice(camera.viewport[2])
        : device.getDrawingBufferWidth();
      const renderHeight = camera.viewport
        ? device.screenYToDevice(camera.viewport[3])
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
      device.clearFrameBuffer(camera.clearColor, camera.clearDepth, camera.clearStencil);
      const SSR = camera.SSR && scene.env.light.envLight && scene.env.light.envLight.hasRadiance();
      const ctx: DrawContext = {
        device,
        scene,
        renderWidth,
        renderHeight,
        oit: null,
        motionVectors: device.type !== 'webgl' && (camera.TAA || camera.motionBlur),
        HiZ: camera.HiZ && device.type !== 'webgl',
        HiZTexture: null,
        globalBindGroupAllocator,
        camera,
        compositor: camera.compositor,
        queue: 0,
        lightBlending: false,
        renderPass: null,
        renderPassHash: null,
        flip: false,
        depthFormat,
        colorFormat,
        drawEnvLight: false,
        env: null,
        materialFlags: 0,
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
          blitter.viewport = camera.viewport ? camera.viewport.slice() : null;
        }
        blitter.scissor = camera.scissor ? camera.scissor.slice() : null;
        blitter.srgbOut = !originFramebuffer;
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
  /** @internal */
  protected static _renderScene(ctx: DrawContext) {
    executeForwardPlusGraph(ctx);
  }
}
