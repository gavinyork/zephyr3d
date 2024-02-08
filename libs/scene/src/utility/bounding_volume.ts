import type { Vector3, Matrix4x4, Plane} from '@zephyr3d/base';
import { Frustum, AABB, ClipState } from '@zephyr3d/base';
import { AABBTree } from './aabbtree';

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

/**
 * Bounding box tree
 * @public
 */
export class BoundingBoxTree extends AABBTree implements BoundingVolume {
  /**
   * Creates an empty bounding box tree
   */
  constructor();
  /**
   * Creates a bounding box tree from an AABB tree
   * @param aabbtree - The AABB tree to be copied from
   */
  constructor(aabbtree: AABBTree);
  constructor(arg?: AABBTree) {
    super(arg);
  }
  /** {@inheritDoc BoundingVolume.clone} */
  clone(): BoundingVolume {
    return new BoundingBoxTree(this);
  }
  /** {@inheritDoc BoundingVolume.transform} */
  transform(matrix: Matrix4x4): BoundingVolume {
    const newBV = new BoundingBoxTree(this);
    newBV.transform(matrix);
    return newBV;
  }
  /** {@inheritDoc BoundingVolume.behindPlane} */
  behindPlane(plane: Plane): boolean {
    return this.toAABB().behindPlane(plane);
  }
  /** {@inheritDoc BoundingVolume.outsideFrustum} */
  outsideFrustum(frustum: Frustum | Matrix4x4): boolean {
    const aabb = this.getTopLevelAABB();
    if (aabb) {
      return (
        (frustum instanceof Frustum ? aabb.getClipStateWithFrustum(frustum) : aabb.getClipState(frustum)) ===
        ClipState.NOT_CLIPPED
      );
    } else {
      return false;
    }
  }
  /** {@inheritDoc BoundingVolume.toAABB} */
  toAABB(): AABB {
    return this.getTopLevelAABB();
  }
}

 /*
export class BoundingFrustum implements BoundingVolume {
    protected _frustum: Frustum;
    constructor ();
    constructor (other: BoundingFrustum|Frustum|Matrix4x4);
    constructor (arg0?: BoundingFrustum|Frustum|Matrix4x4) {
        if (arg0 instanceof BoundingFrustum) {
            this._frustum = arg0._frustum ? new Frustum (arg0._frustum) : null;
        } else if (arg0 instanceof Frustum) {
            this._frustum = new Frustum (arg0);
        } else if (arg0 instanceof Matrix4x4) {
            this._frustum = new Frustum (arg0);
        } else {
            this._frustum = null;
        }
    }
    clone (): BoundingVolume {
        return new BoundingFrustum (this);
    }
    transform (matrix: Matrix4x4)
}
*/
