import type { Matrix4x4 } from './vector';
import { Vector3, Vector4 } from './vector';
import { BoxSide, ClipState } from './types';
import type { Plane } from './plane';
import type { Frustum } from './frustum';

/**
 * Axis aligned bounding box
 * @public
 */
export class AABB {
  /** Clip to the left side */
  static readonly ClipLeft = 1 << BoxSide.LEFT;
  /** Clip to the right side */
  static readonly ClipRight = 1 << BoxSide.RIGHT;
  /** Clip to the bottom side */
  static readonly ClipBottom = 1 << BoxSide.BOTTOM;
  /** Clip to the top side */
  static readonly ClipTop = 1 << BoxSide.TOP;
  /** Clip to the front side */
  static readonly ClipFront = 1 << BoxSide.FRONT;
  /** Clip to the back side */
  static readonly ClipBack = 1 << BoxSide.BACK;
  /** @internal */
  private _minPoint: Vector3;
  /** @internal */
  private _maxPoint: Vector3;
  /** Construct an AABB with zero size at zero point. */
  constructor();
  /**
   * Construct an AABB by copying from another AABB.
   * @param box - The AABB to be copied from.
   */
  constructor(box: AABB);
  /**
   * Construct AABB from the min/max point.
   * @param minPoint - The min point of the AABB.
   * @param maxPoint - The max point of the AABB.
   */
  constructor(minPoint: Vector3, maxPoint: Vector3);
  constructor(arg0?: Vector3 | AABB, arg1?: Vector3) {
    if (arg0 instanceof AABB) {
      this._minPoint = new Vector3(arg0.minPoint);
      this._maxPoint = new Vector3(arg0.maxPoint);
    } else if (arg0 instanceof Vector3) {
      this._minPoint = new Vector3(arg0);
      this._maxPoint = new Vector3(arg1);
    } else {
      this._minPoint = new Vector3(0, 0, 0);
      this._maxPoint = new Vector3(0, 0, 0);
    }
  }
  /** Get the min point of the AABB. */
  get minPoint() {
    return this._minPoint;
  }
  set minPoint(p: Vector3) {
    this._minPoint.set(p);
  }
  /** Get the max point of the AABB. */
  get maxPoint() {
    return this._maxPoint;
  }
  set maxPoint(p: Vector3) {
    this._maxPoint.set(p);
  }
  /** Get half size of the AABB. */
  get extents() {
    return Vector3.sub(this._maxPoint, this._minPoint).scaleBy(0.5);
  }
  /** Get center point of the AABB. */
  get center() {
    return Vector3.add(this._maxPoint, this._minPoint).scaleBy(0.5);
  }
  /** Get size of the AABB. */
  get size() {
    return Vector3.sub(this._maxPoint, this._minPoint);
  }
  /** Get the diagonal length of the AABB. */
  get diagonalLength() {
    return Vector3.sub(this._maxPoint, this._minPoint).magnitude;
  }
  /**
   * Calculate the coordinates of the eight corners of the AABB.
   * @returns the coordinates of the eight corners of the AABB.
   */
  computePoints(): Vector3[] {
    const { x: minx, y: miny, z: minz } = this._minPoint;
    const { x: maxx, y: maxy, z: maxz } = this._maxPoint;
    return [
      new Vector3(minx, miny, minz),
      new Vector3(minx, maxy, minz),
      new Vector3(maxx, miny, minz),
      new Vector3(maxx, maxy, minz),
      new Vector3(minx, miny, maxz),
      new Vector3(minx, maxy, maxz),
      new Vector3(maxx, miny, maxz),
      new Vector3(maxx, maxy, maxz)
    ];
  }
  /**
   * Inplace transform the AABB.
   * @param matrix - The transform matrix.
   * @returns self
   */
  inplaceTransform(matrix: Matrix4x4) {
    return AABB.transform(this, matrix, this);
  }
  /** Invalidate the min/max point so that we can start extending the AABB. */
  beginExtend() {
    this._minPoint.setXYZ(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    this._maxPoint.setXYZ(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  }
  /**
   * Extend the AABB so that it can contain specified point.
   * @param v - The point used to extend the AABB.
   */
  extend(v: Vector3) {
    this._minPoint.inplaceMin(v);
    this._maxPoint.inplaceMax(v);
  }
  /**
   * Extend the AABB so that it can contain specified point.
   * @param x - The x coordinate of the point.
   * @param y - The y coordinate of the point.
   * @param z - The z coordinate of the point.
   */
  extend3(x: number, y: number, z: number) {
    if (x < this._minPoint.x) this._minPoint.x = x;
    if (x > this._maxPoint.x) this._maxPoint.x = x;
    if (y < this._minPoint.y) this._minPoint.y = y;
    if (y > this._maxPoint.y) this._maxPoint.y = y;
    if (z < this._minPoint.z) this._minPoint.z = z;
    if (z > this._maxPoint.z) this._maxPoint.z = z;
  }
  /**
   * Merge the AABB with another AABB.
   * @param other - The AABB to be merged with.
   * @returns self
   */
  union(other: AABB) {
    if (other && other.isValid()) {
      this.extend(other._minPoint);
      this.extend(other._maxPoint);
    }
    return this;
  }
  /**
   * Check if the AABB is valid.
   * @returns true if the AABB is valid, otherwise false.
   */
  isValid(): boolean {
    return (
      this._minPoint.x <= this._maxPoint.x &&
      this._minPoint.y <= this._maxPoint.y &&
      this._minPoint.z <= this._maxPoint.z
    );
  }
  /**
   * Check if the AABB is close enough to another AABB.
   * @param other - The AABB to be compared with.
   * @param epsl - The epsilon for comparison.
   * @returns true if the comparison error is less than epsl, otherwise false.
   */
  equalsTo(other: AABB, epsl?: number) {
    return this._minPoint.equalsTo(other._minPoint, epsl) && this._maxPoint.equalsTo(other._maxPoint, epsl);
  }
  /**
   * Check if the AABB intersects with another AABB.
   * @param other - The destination AABB.
   * @returns true if the AABB intersects with other, otherwise false.
   */
  intersectedWithBox(other: AABB): boolean {
    return !(
      this._maxPoint.x <= other._minPoint.x ||
      this._minPoint.x >= other._maxPoint.x ||
      this._maxPoint.y <= other._minPoint.y ||
      this._minPoint.y >= other._maxPoint.y ||
      this._maxPoint.z <= other._minPoint.z ||
      this._minPoint.z >= other._maxPoint.z
    );
  }
  /**
   * Check if the box contains specified point.
   * @param pt - The point to be checked.
   * @returns true if the box contains the point, otherwise false.s
   */
  containsPoint(pt: Vector3): boolean {
    return (
      this._minPoint.x <= pt.x &&
      this._maxPoint.x >= pt.x &&
      this._minPoint.y <= pt.y &&
      this._maxPoint.y >= pt.y &&
      this._minPoint.z <= pt.z &&
      this._maxPoint.z >= pt.z
    );
  }
  /**
   * Check if the AABB contains all of the eight corner point of another AABB
   * @param other - The AABB to be checked.
   * @returns true if all contains, otherwise false.
   */
  containsBox(other: AABB): boolean {
    return (
      this._minPoint.x <= other._minPoint.x &&
      this._maxPoint.x >= other._maxPoint.x &&
      this._minPoint.y <= other._minPoint.y &&
      this._maxPoint.y >= other._maxPoint.y &&
      this._minPoint.z <= other._minPoint.z &&
      this._maxPoint.z >= other._maxPoint.z
    );
  }
  /**
   * Do a clip test at the AABB and a frustum.
   * @param viewProjMatrix - The view projection matrix of the frustum.
   * @param mask - The frustum planes that needs to be tested.
   * @returns The clip test result.
   */
  getClipStateMask(viewProjMatrix: Matrix4x4, mask: number): ClipState {
    let andFlags = 0xffff;
    let orFlags = 0;
    const v0 = new Vector3();
    const v1 = new Vector4();
    const clipLeft = mask & AABB.ClipLeft;
    const clipRight = mask & AABB.ClipRight;
    const clipTop = mask & AABB.ClipTop;
    const clipBottom = mask & AABB.ClipBottom;
    const clipNear = mask & AABB.ClipFront;
    const clipFar = mask & AABB.ClipBack;
    const minPoint = this._minPoint;
    const maxPoint = this._maxPoint;
    for (let i = 0; i < 8; i++) {
      let clip = 0;
      v0.setXYZ(
        i & 1 ? minPoint.x : maxPoint.x,
        i & 2 ? minPoint.y : maxPoint.y,
        i & 3 ? minPoint.z : maxPoint.z
      );
      viewProjMatrix.transformPoint(v0, v1);
      if (clipLeft && v1.x < -v1.w) {
        clip |= AABB.ClipLeft;
      } else if (clipRight && v1.x > v1.w) {
        clip |= AABB.ClipRight;
      }
      if (clipBottom && v1.y < -v1.w) {
        clip |= AABB.ClipBottom;
      } else if (clipTop && v1.y > v1.w) {
        clip |= AABB.ClipTop;
      }
      if (clipFar && v1.z < -v1.w) {
        clip |= AABB.ClipBack;
      } else if (clipNear && v1.z > v1.w) {
        clip |= AABB.ClipFront;
      }
      andFlags &= clip;
      orFlags |= clip;
    }
    if (orFlags === 0) {
      return ClipState.A_INSIDE_B;
    } else if (andFlags !== 0) {
      return ClipState.NOT_CLIPPED;
    } else {
      return ClipState.CLIPPED;
    }
  }
  /**
   * Do a clip test at the AABB and a frustum.
   * @param viewProjMatrix - The view projection matrix of the frustum.
   * @returns The clip test result.
   */
  getClipState(viewProjMatrix: Matrix4x4): ClipState {
    let andFlags = 0xffff;
    let orFlags = 0;
    const v0 = new Vector3();
    const v1 = new Vector4();
    const minPoint = this._minPoint;
    const maxPoint = this._maxPoint;
    for (let i = 0; i < 8; i++) {
      let clip = 0;
      v0.setXYZ(
        i & 1 ? minPoint.x : maxPoint.x,
        i & 2 ? minPoint.y : maxPoint.y,
        i & 3 ? minPoint.z : maxPoint.z
      );
      viewProjMatrix.transformPoint(v0, v1);
      if (v1.x < -v1.w) {
        clip |= AABB.ClipLeft;
      } else if (v1.x > v1.w) {
        clip |= AABB.ClipRight;
      }
      if (v1.y < -v1.w) {
        clip |= AABB.ClipBottom;
      } else if (v1.y > v1.w) {
        clip |= AABB.ClipTop;
      }
      if (v1.z < -v1.w) {
        clip |= AABB.ClipBack;
      } else if (v1.z > v1.w) {
        clip |= AABB.ClipFront;
      }
      andFlags &= clip;
      orFlags |= clip;
    }
    if (orFlags === 0) {
      return ClipState.A_INSIDE_B;
    } else if (andFlags !== 0) {
      return ClipState.NOT_CLIPPED;
    } else {
      return ClipState.CLIPPED;
    }
  }
  /**
   * Check if the box is behind a plane.
   * @param p - The plane to be tested.
   * @returns true if the box is behind the plane, otherwise false.
   */
  behindPlane(p: Plane): boolean {
    const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
    const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
    const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
    const ex = this._maxPoint.x - cx;
    const ey = this._maxPoint.y - cy;
    const ez = this._maxPoint.z - cz;
    return p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0;
  }
  /**
   * Do a clip test at the AABB and a frustum.
   * @param frustum - The frustum object.
   * @returns The clip test result.
   */
  getClipStateWithFrustum(frustum: Frustum): ClipState {
    let badIntersect = false;
    const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
    const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
    const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
    const ex = this._maxPoint.x - cx;
    const ey = this._maxPoint.y - cy;
    const ez = this._maxPoint.z - cz;
    for (let i = 0; i < 6; i++) {
      const p = frustum.planes[i];
      if (p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0) {
        return ClipState.NOT_CLIPPED;
      }
      if (p.a * (cx + p.nx * ex) + p.b * (cy + p.ny * ey) + p.c * (cz + p.nz * ez) + p.d < 0) {
        badIntersect = true;
      }
    }
    return badIntersect ? ClipState.CLIPPED : ClipState.A_INSIDE_B;
  }
  /**
   * Do a clip test at the AABB and a frustum.
   * @param frustum - The frustum object.
   * @param mask - The frustum planes that needs to be tested.
   * @returns The clip test result.
   */
  getClipStateWithFrustumMask(frustum: Frustum, mask: number): ClipState {
    let badIntersect = false;
    const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
    const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
    const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
    const ex = this._maxPoint.x - cx;
    const ey = this._maxPoint.y - cy;
    const ez = this._maxPoint.z - cz;
    for (let i = 0; i < 6; i++) {
      if (mask & (1 << i)) {
        const p = frustum.planes[i];
        if (p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0) {
          return ClipState.NOT_CLIPPED;
        }
        if (p.a * (cx + p.nx * ex) + p.b * (cy + p.ny * ey) + p.c * (cz + p.nz * ez) + p.d < 0) {
          badIntersect = true;
        }
      }
    }
    return badIntersect ? ClipState.CLIPPED : ClipState.A_INSIDE_B;
  }
  /**
   * Get an AABB by transforming another AABB
   * @param bbox - The AABB to be transformed.
   * @param matrix - The transform matrix.
   * @param result - The out AABB to be write to.
   * @returns The out AABB.
   */
  static transform(bbox: AABB, matrix: Matrix4x4, result?: AABB): AABB {
    const ret = result || new AABB();
    const minp = [0, 0, 0];
    const maxp = [0, 0, 0];
    const v1 = bbox.minPoint;
    const v2 = bbox.maxPoint;
    let r: number;
    for (let col = 0; col < 3; ++col) {
      r = col;
      minp[col] = maxp[col] = matrix[12 + col];
      for (let row = 0; row < 3; ++row) {
        const e = matrix[r] * v1[row];
        const f = matrix[r] * v2[row];
        if (e < f) {
          minp[col] += e;
          maxp[col] += f;
        } else {
          minp[col] += f;
          maxp[col] += e;
        }
        r += 4;
      }
    }
    ret.minPoint.set(minp);
    ret.maxPoint.set(maxp);
    return ret;
  }
}
