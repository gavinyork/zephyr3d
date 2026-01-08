import type { Matrix4x4, Nullable } from '@zephyr3d/base';

export abstract class RenderTarget {
  abstract calcViewport(outViewport?: Nullable<number[]>): number[];
  abstract calcPerspectiveProjection(
    fov: number,
    nearClip: number,
    farClip: number,
    outMatrix?: Matrix4x4
  ): Matrix4x4;
  abstract calcOrthographicProjection(nearClip: number, farClip: number, outMatrix?: Matrix4x4): Matrix4x4;
}
