import { Matrix4x4 } from '@zephyr3d/base';
import type { ScreenAdapter } from '../app/screen';
import { getEngine } from '../app/api';
import { RenderTarget } from './rendertarget';

export class ScreenRenderTarget extends RenderTarget {
  private readonly screenAdapter: ScreenAdapter;
  constructor(screenAdapter?: ScreenAdapter) {
    super();
    this.screenAdapter = screenAdapter ?? getEngine().screen;
  }
  calcViewport(outViewport: number[] = []): number[] {
    outViewport = outViewport ?? [];
    const transform = this.screenAdapter.transform;
    outViewport[0] = transform.croppedViewport.x;
    outViewport[1] = transform.croppedViewport.y;
    outViewport[2] = transform.croppedViewport.width;
    outViewport[3] = transform.croppedViewport.height;
    return outViewport;
  }
  calcOrthographicProjection(nearClip: number, farClip: number, outMatrix?: Matrix4x4): Matrix4x4 {
    const matrix = outMatrix ?? new Matrix4x4();
    const transform = this.screenAdapter.transform;
    const left = transform.croppedViewport.x;
    const right = transform.croppedViewport.x + transform.croppedViewport.width;
    const bottom = transform.croppedViewport.y + transform.croppedViewport.height;
    const top = transform.croppedViewport.y;
    return matrix.ortho(left, right, bottom, top, nearClip, farClip);
  }
  calcPerspectiveProjection(
    fov: number,
    nearClip: number,
    farClip: number,
    outMatrix?: Matrix4x4
  ): Matrix4x4 {
    const matrix = outMatrix ?? new Matrix4x4();
    const transform = this.screenAdapter.transform;
    const aspect =
      transform.croppedViewport.height !== 0
        ? transform.croppedViewport.width / transform.croppedViewport.height
        : 1;
    const h = nearClip * Math.tan(fov * 0.5);
    const w = h * aspect;
    const width = 2 * w;
    const height = 2 * h;
    let left = -w + (transform.croppedViewport.x - transform.viewportX) / width;
    let right =
      w -
      (transform.viewportX +
        transform.viewportWidth -
        transform.croppedViewport.x -
        transform.croppedViewport.width) /
        width;
    let bottom = -h + (transform.croppedViewport.y - transform.viewportY) / height;
    let top =
      h -
      (transform.viewportY +
        transform.viewportHeight -
        transform.croppedViewport.y -
        transform.croppedViewport.height) /
        height;
    return matrix.frustum(left, right, bottom, top, nearClip, farClip);
  }
}
