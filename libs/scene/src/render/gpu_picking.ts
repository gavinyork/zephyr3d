import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector3, Vector4 } from '@zephyr3d/base';
import type { DrawContext } from './drawable';
import type { RenderQueue } from './render_queue';
import { type PickResult, Camera } from '../camera';
import { ObjectColorPass } from './objectcolorpass';

const _pickCamera = new Camera(null);
const _objectColorPass = new ObjectColorPass();

function decodeNormalizedFloat(rgba: Uint8Array<ArrayBuffer>): number {
  const a = rgba[0] / 255;
  const b = rgba[1] / 255;
  const c = rgba[2] / 255;
  const d = rgba[3] / 255;
  return a / (256 * 256 * 256) + b / (256 * 256) + c / 256 + d;
}

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
  const isWebGL1 = ctx.device.type === 'webgl';
  ctx.renderPass = _objectColorPass;
  ctx.device.pushDeviceStates();
  const fb = ctx.device.pool.fetchTemporalFramebuffer(
    false,
    1,
    1,
    isWebGL1 ? ['rgba8unorm', 'rgba8unorm'] : ['rgba8unorm', 'rgba32f'],
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
  const cameraPos = isWebGL1 ? new Vector3(pickCamera.position) : null;
  const ray = isWebGL1 ? camera.constructRay(camera.getPickPosX(), camera.getPickPosY()) : null;
  ctx.device.setFramebuffer(fb);
  _objectColorPass.clearColor = Vector4.zero();
  _objectColorPass.clearDepth = 1;
  const rq = _objectColorPass.cullScene(ctx, pickCamera);
  _objectColorPass.render(ctx, pickCamera, null, rq);
  rq.dispose();
  ctx.device.popDeviceStates();
  const colorTex = fb.getColorAttachments()[0];
  const distanceTex = fb.getColorAttachments()[1];
  const colorPixels = new Uint8Array(4);
  const distancePixels = isWebGL1 ? new Uint8Array(4) : new Float32Array(4);
  const device = ctx.device;
  let fence: Promise<void[]>;
  if (ctx.device.type === 'webgl') {
    fence = Promise.all([
      ctx.device.runNextFrameAsync(() => colorTex.readPixels(0, 0, 1, 1, 0, 0, colorPixels)),
      ctx.device.runNextFrameAsync(() => distanceTex.readPixels(0, 0, 1, 1, 0, 0, distancePixels))
    ]);
  } else {
    fence = Promise.all([
      colorTex.readPixels(0, 0, 1, 1, 0, 0, colorPixels),
      distanceTex.readPixels(0, 0, 1, 1, 0, 0, distancePixels)
    ]);
  }
  fence
    .then(() => {
      const drawable = renderQueue.getDrawableByColor(colorPixels);
      let d = isWebGL1
        ? decodeNormalizedFloat(distancePixels as Uint8Array<ArrayBuffer>) * far
        : distancePixels[0];
      const intersectedPoint = new Vector3(distancePixels[0], distancePixels[1], distancePixels[2]);
      if (isWebGL1) {
        intersectedPoint.x = cameraPos!.x + ray!.direction.x * d;
        intersectedPoint.y = cameraPos!.y + ray!.direction.y * d;
        intersectedPoint.z = cameraPos!.z + ray!.direction.z * d;
        d = Vector3.distance(intersectedPoint, cameraPos!);
      }
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
      device.pool.releaseFrameBuffer(fb);
    })
    .catch((_err) => {
      camera.getPickResultResolveFunc()?.(null);
      device.pool.releaseFrameBuffer(fb);
    });
}
