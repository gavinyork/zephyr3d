import { Plane } from './plane';
import { Matrix4x4, Vector3 } from './vector';
import { BoxSide } from './types';

const npn = [-1, 1, -1];
const npp = [-1, 1, 1];
const ppp = [1, 1, 1];
const ppn = [1, 1, -1];
const nnn = [-1, -1, -1];
const nnp = [-1, -1, 1];
const pnp = [1, -1, 1];
const pnn = [1, -1, -1];

class BoundingBoxData {
  static readonly ndcVertices = [npn, npp, ppp, ppn, nnn, nnp, pnp, pnn];
  static generateVertexData(v: number[][]): number[] {
    return [
      ...v[0],
      ...v[1],
      ...v[2],
      ...v[3],
      ...v[1],
      ...v[5],
      ...v[6],
      ...v[2],
      ...v[2],
      ...v[6],
      ...v[7],
      ...v[3],
      ...v[3],
      ...v[7],
      ...v[4],
      ...v[0],
      ...v[0],
      ...v[4],
      ...v[5],
      ...v[1],
      ...v[5],
      ...v[4],
      ...v[7],
      ...v[6]
    ];
  }
  static readonly ndcBoxVertices = new Float32Array([
    ...npn,
    ...npp,
    ...ppp,
    ...ppn,
    ...npp,
    ...nnp,
    ...pnp,
    ...ppp,
    ...ppp,
    ...pnp,
    ...pnn,
    ...ppn,
    ...ppn,
    ...pnn,
    ...nnn,
    ...npn,
    ...npn,
    ...nnn,
    ...nnp,
    ...npp,
    ...nnp,
    ...nnn,
    ...pnn,
    ...pnp
  ]);
  static readonly boxBarycentric = new Float32Array([
    1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1,
    0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0,
    1, 0
  ]);
  static readonly boxIndices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23
  ]);
}

/**
 * The frustum class
 *
 * @public
 */
export class Frustum {
  static readonly CORNER_LEFT_TOP_NEAR = 0;
  static readonly CORNER_LEFT_TOP_FAR = 1;
  static readonly CORNER_RIGHT_TOP_FAR = 2;
  static readonly CORNER_RIGHT_TOP_NEAR = 3;
  static readonly CORNER_LEFT_BOTTOM_NEAR = 4;
  static readonly CORNER_LEFT_BOTTOM_FAR = 5;
  static readonly CORNER_RIGHT_BOTTOM_FAR = 6;
  static readonly CORNER_RIGHT_BOTTOM_NEAR = 7;
  /** @internal */
  private _planes: Plane[];
  /** @internal */
  private _corners: Vector3[];
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
    this._planes = null;
    this._corners = null;
    if (arg0 instanceof Frustum) {
      this._planes = arg0._planes.map(plane => new Plane(plane));
      this._corners = arg0._corners.map(vec => new Vector3(vec));
    } else {
      this.initWithMatrix(arg0);
    }
  }
  /**
   * Get the frustum planes.
   */
  get planes() {
    return this._planes;
  }
  /**
   * Get the corner points.
   */
  get corners() {
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
  containsPoint(pt: Vector3): boolean {
    for (const p of this.planes) {
      if (p.distanceToPoint(pt) < 0) {
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
      .setEquation(transform.m30 + transform.m00, transform.m31 + transform.m01, transform.m32 + transform.m02, transform.m33 + transform.m03)
      .inplaceNormalize();
    this._planes[BoxSide.RIGHT]
      .setEquation(transform.m30 - transform.m00, transform.m31 - transform.m01, transform.m32 - transform.m02, transform.m33 - transform.m03)
      .inplaceNormalize();
    this._planes[BoxSide.BOTTOM]
      .setEquation(transform.m30 + transform.m10, transform.m31 + transform.m11, transform.m32 + transform.m12, transform.m33 + transform.m13)
      .inplaceNormalize();
    this._planes[BoxSide.TOP]
      .setEquation(transform.m30 - transform.m10, transform.m31 - transform.m11, transform.m32 - transform.m12, transform.m33 - transform.m13)
      .inplaceNormalize();
    this._planes[BoxSide.FRONT]
      .setEquation(transform.m30 + transform.m20, transform.m31 + transform.m21, transform.m32 + transform.m22, transform.m33 + transform.m23)
      .inplaceNormalize();
    this._planes[BoxSide.BACK]
      .setEquation(transform.m30 - transform.m20, transform.m31 - transform.m21, transform.m32 - transform.m22, transform.m33 - transform.m23)
      .inplaceNormalize();
    const invMatrix = Matrix4x4.invert(transform);
    const ndcVertices: Vector3[] = BoundingBoxData.ndcVertices.map((v) => new Vector3(v[0], v[1], v[2]));
    this._corners = this._corners || [];
    for (let i = 0; i < 8; i++) {
      const v = invMatrix.transformPoint(ndcVertices[i]);
      this._corners[i] = v.scaleBy(1 / v.w).xyz();
    }
    return this;
  }
}
