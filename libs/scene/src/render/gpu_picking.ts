import type { Nullable } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import type { DrawContext } from './drawable';
import type { RenderQueue } from './render_queue';
import { type PickResult, Camera } from '../camera';
import { ObjectColorPass } from './objectcolorpass';

const _pickCamera = new Camera(null);
const _objectColorPass = new ObjectColorPass();

/**
 * Perform GPU-based object picking by rendering object IDs to a 1x1 framebuffer.
 * @internal
 */
export function renderObjectColors(
  ctx: DrawContext,
  pickResolveFunc: (result: Nullable<PickResult>) => void,
  renderQueue: RenderQueue
): void {
  const camera = ctx.camera;
  ctx.renderPass = _objectColorPass;
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
  const pickCamera = _pickCamera;
  camera.worldMatrix.decompose(pickCamera.scale, pickCamera.rotation, pickCamera.position);
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
  pickCamera.setProjectionMatrix(
    camera.isPerspective()
      ? Matrix4x4.frustum(left, right, bottom, top, near, far)
      : Matrix4x4.ortho(left, right, bottom, top, near, far)
  );
  ctx.device.setFramebuffer(fb);
  _objectColorPass.clearColor = Vector4.zero();
  _objectColorPass.clearDepth = DEPTH_CLEAR_VALUE;
  const rq = _objectColorPass.cullScene(ctx, pickCamera);
  _objectColorPass.render(ctx, pickCamera, null, rq);
  rq.dispose();
  ctx.device.popDeviceStates();
  const colorTex = fb.getColorAttachments()[0];
  const distanceTex = fb.getColorAttachments()[1];
  const colorPixels = new Uint8Array(4);
  const distancePixels = new Float32Array(4);
  const device = ctx.device;
  // RenderGraph releases the frame RenderQueue before the asynchronous GPU readback completes.
  const getDrawableByColor = renderQueue.createObjectColorLookupSnapshot();
  Promise.all([
    colorTex.readPixels(0, 0, 1, 1, 0, 0, colorPixels),
    distanceTex.readPixels(0, 0, 1, 1, 0, 0, distancePixels)
  ])
    .then(() => {
      const drawable = getDrawableByColor(colorPixels);
      const d = distancePixels[0];
      const intersectedPoint = new Vector3(distancePixels[0], distancePixels[1], distancePixels[2]);
      pickResolveFunc(
        drawable
          ? {
              distance: d,
              intersectedPoint,
              drawable,
              target: drawable.getPickTarget()
            }
          : null
      );
    })
    .catch((_err) => {
      pickResolveFunc(null);
    })
    .finally(() => {
      device.pool.releaseFrameBuffer(fb);
    });
}
