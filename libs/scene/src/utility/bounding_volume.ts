import type { Vector3, Matrix4x4, Plane } from '@zephyr3d/base';
import { Frustum, AABB, ClipState } from '@zephyr3d/base';

/**
 * Base interface for any kind of bounding volumes
 * @public
 */
export interface BoundingVolume {
  /**
   * Creates a new bounding volume by copying from this bounding volume
   */
  clone(): BoundingVolume;
  /**
   * Creates a new bounding volume by tranforming this bounding volume by a matrix
   * @param matrix - The transform matrix
   * @returns The created bounding volume
   */
  transform(matrix: Matrix4x4): BoundingVolume;
  /**
   * Check if this bounding volume is behind a plane
   * @param plane - The plane to check
   * @returns true if the bounding volume behinds the plane, false otherwise
   */
  behindPlane(plane: Plane): boolean;
  /**
   * Check if this bounding volume is outside a frustum
   * @param frustum - The frustum to check
   * @returns true if the bounding volume outsides the frustum, false otherwise
   */
  outsideFrustum(frustum: Frustum | Matrix4x4): boolean;
  /**
   * Gets the minimum AABB that contains the bounding volume
   * @returns The mimimum AABB that contains the bounding volume
   */
  toAABB(): AABB;
}

/**
 * The bounding box class
 * @public
 */
export class BoundingBox extends AABB implements BoundingVolume {
  /**
   * Creates an empty bounding box
   */
  constructor();
  /**
   * Creates a bounding box from an AABB
   * @param box - The AABB
   */
  constructor(box: AABB);
  /**
   * Creates a bounding box from the min point and the max point
   * @param minPoint - Min point of the box
   * @param maxPoint - Max point of the box
   */
  constructor(minPoint: Vector3, maxPoint: Vector3);
  constructor(arg0?: Vector3 | AABB, arg1?: Vector3) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(arg0 as any, arg1);
  }
  /** {@inheritDoc BoundingVolume.behindPlane} */
  behindPlane(plane: Plane): boolean {
    return this.toAABB().behindPlane(plane);
  }
  /** {@inheritDoc BoundingVolume.clone} */
  clone(): BoundingVolume {
    return new BoundingBox(this);
  }
  /** {@inheritDoc BoundingVolume.transform} */
  transform(matrix: Matrix4x4): BoundingVolume {
    return new BoundingBox(AABB.transform(this, matrix));
  }
  /** {@inheritDoc BoundingVolume.outsideFrustum} */
  outsideFrustum(frustum: Frustum | Matrix4x4): boolean {
    return (
      (frustum instanceof Frustum ? this.getClipStateWithFrustum(frustum) : this.getClipState(frustum)) ===
      ClipState.NOT_CLIPPED
    );
  }
  /** {@inheritDoc BoundingVolume.toAABB} */
  toAABB(): AABB {
    return this;
  }
}

