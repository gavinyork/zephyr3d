import { Plane } from './plane';
import { Matrix4x4, Vector3 } from './vector';
import { BoxSide } from './types';
import { REVERSE_Z } from '../zconvention';
import type { Immutable } from '../utils';

// Near/far NDC z values for the active depth convention.
const NDC_NEAR_Z = REVERSE_Z ? 1 : -1;
const NDC_FAR_Z = REVERSE_Z ? 0 : 1;

const nnn = [-1, -1, NDC_NEAR_Z];
const nnp = [-1, -1, NDC_FAR_Z];
const npn = [-1, 1, NDC_NEAR_Z];
const npp = [-1, 1, NDC_FAR_Z];
const pnn = [1, -1, NDC_NEAR_Z];
const pnp = [1, -1, NDC_FAR_Z];
const ppn = [1, 1, NDC_NEAR_Z];
const ppp = [1, 1, NDC_FAR_Z];

const ndcVertices = [nnn, nnp, npn, npp, pnn, pnp, ppn, ppp];

/**
 * The frustum class
 *
 * @public
 */
export class Frustum {
  static readonly CORNER_LEFT_TOP_NEAR = 0b000;
  static readonly CORNER_LEFT_TOP_FAR = 0b001;
  static readonly CORNER_LEFT_BOTTOM_NEAR = 0b010;
  static readonly CORNER_LEFT_BOTTOM_FAR = 0b011;
  static readonly CORNER_RIGHT_TOP_NEAR = 0b100;
  static readonly CORNER_RIGHT_TOP_FAR = 0b101;
  static readonly CORNER_RIGHT_BOTTOM_NEAR = 0b110;
  static readonly CORNER_RIGHT_BOTTOM_FAR = 0b111;
  /** @internal */
  private _planes!: Plane[];
  /** @internal */
  private _corners!: Vector3[];
  /**
   * Creates a frustum from the tranform matrix.
   * @param transform - The transform matrix
   */
  constructor(transform: Matrix4x4);
  /**
   * Creates a frustum initialized with an existing frustum.
   * @param other - The frustum to copy from.
   */
  constructor(other: Frustum);
  constructor(arg0: Matrix4x4 | Frustum) {
    if (arg0 instanceof Frustum) {
      this._planes = arg0._planes.map((plane) => new Plane(plane));
      this._corners = arg0._corners.map((vec) => new Vector3(vec));
    } else {
      this.initWithMatrix(arg0);
    }
  }
  /**
   * Get the frustum planes.
   */
  get planes(): Immutable<Plane[]> {
    return this._planes;
  }
  /**
   * Get the corner points.
   */
  get corners(): Immutable<Vector3[]> {
    return this._corners;
  }
  /**
   * Get the point of a given corner.
   *
   * @remarks
   * The possible values of argument 'pos' are:
   * <ul>
   * <li>{@link Frustum.CORNER_LEFT_TOP_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_TOP_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_BOTTOM_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_NEAR}</li>
   * </ul>
   *
   * @param pos - The corner index.
   *
   * @returns The point of given corner
   */
  getCorner(pos: number) {
    return this.corners[pos];
  }
  /**
   * Tests if a point is inside the frustum.
   *
   * @param pt - The point to test.
   * @returns true if the point is inside the frustum, otherwise false
   */
  containsPoint(pt: Vector3, epsl = 1e-6) {
    for (const p of this.planes) {
      if (p.distanceToPoint(pt) < -epsl) {
        return false;
      }
    }
    return true;
  }
  /**
   * Initialize the frustum by given model-view matrix
   * @param transform - Model-view matrix used to initialize the frustum
   * @returns self
   */
  initWithMatrix(transform: Matrix4x4) {
    this._planes = this._planes || Array.from({ length: 6 }).map(() => new Plane());
    this._planes[BoxSide.LEFT]
      .setEquation(
        transform.m30 + transform.m00,
        transform.m31 + transform.m01,
        transform.m32 + transform.m02,
        transform.m33 + transform.m03
      )
      .inplaceNormalize();
    this._planes[BoxSide.RIGHT]
      .setEquation(
        transform.m30 - transform.m00,
        transform.m31 - transform.m01,
        transform.m32 - transform.m02,
        transform.m33 - transform.m03
      )
      .inplaceNormalize();
    this._planes[BoxSide.BOTTOM]
      .setEquation(
        transform.m30 + transform.m10,
        transform.m31 + transform.m11,
        transform.m32 + transform.m12,
        transform.m33 + transform.m13
      )
      .inplaceNormalize();
    this._planes[BoxSide.TOP]
      .setEquation(
        transform.m30 - transform.m10,
        transform.m31 - transform.m11,
        transform.m32 - transform.m12,
        transform.m33 - transform.m13
      )
      .inplaceNormalize();
    if (REVERSE_Z) {
      // Reverse ZO clip space: inside when 0 <= z_clip <= w_clip.
      // Near plane: z <= w  <=>  row3 - row2 >= 0
      this._planes[BoxSide.FRONT]
        .setEquation(
          transform.m30 - transform.m20,
          transform.m31 - transform.m21,
          transform.m32 - transform.m22,
          transform.m33 - transform.m23
        )
        .inplaceNormalize();
      // Far plane: z >= 0  <=>  row2 >= 0
      this._planes[BoxSide.BACK]
        .setEquation(transform.m20, transform.m21, transform.m22, transform.m23)
        .inplaceNormalize();
    } else {
      // GL clip space: inside when -w_clip <= z_clip <= w_clip.
      this._planes[BoxSide.FRONT]
        .setEquation(
          transform.m30 + transform.m20,
          transform.m31 + transform.m21,
          transform.m32 + transform.m22,
          transform.m33 + transform.m23
        )
        .inplaceNormalize();
      this._planes[BoxSide.BACK]
        .setEquation(
          transform.m30 - transform.m20,
          transform.m31 - transform.m21,
          transform.m32 - transform.m22,
          transform.m33 - transform.m23
        )
        .inplaceNormalize();
    }
    const invMatrix = Matrix4x4.invert(transform);
    const vertices: Vector3[] = ndcVertices.map((v) => new Vector3(v[0], v[1], v[2]));
    this._corners = this._corners || [];
    for (let i = 0; i < 8; i++) {
      const v = invMatrix.transformPoint(vertices[i]);
      this._corners[i] = v.scaleBy(1 / v.w).xyz();
    }
    return this;
  }
}
