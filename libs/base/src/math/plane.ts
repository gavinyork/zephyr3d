import { VectorBase, Vector3, Vector4, Matrix4x4 } from './vector';

/**
 * The plane class
 * @public
 */
export class Plane extends VectorBase {
  /** @internal */
  private _px = 0;
  /** @internal */
  private _py = 0;
  /** @internal */
  private _pz = 0;
  /** @internal */
  private _nx = 0;
  /** @internal */
  private _ny = 0;
  /** @internal */
  private _nz = 0;
  /** @internal */
  private _npDirty = false;
  /** Construct a plane lying on the XZ axis with upwards normal */
  constructor();
  /**
   * Construct a plane that satisfies the equation Ax+By+Cz+D=0
   * @param a - The coefficient A of the equation
   * @param b - The coefficient B of the equation
   * @param c - The coefficient C of the equation
   * @param d - The coefficient D of the equation
   */
  constructor(a: number, b: number, c: number, d: number);
  /**
   * Construct a plane by copying another plane
   * @param other - The plane to be copied from.
   */
  constructor(other: Plane);
  /**
   * Construct a plane from normal and a point on the plane.
   * @param origin - The point on the plane.
   * @param normal - Normal of the plane.
   */
  constructor(origin: Vector3, normal: Vector3);
  /**
   * Construct a plane from three points on the plane.
   * @param p0 - The first point.
   * @param p1 - The second point.
   * @param p2 - The third point.
   */
  constructor(p0: Vector3, p1: Vector3, p2: Vector3);
  constructor(arg0?: unknown, arg1?: unknown, arg2?: unknown, arg3?: unknown) {
    super(4);
    switch (arguments.length) {
      case 0: {
        this[0] = 0;
        this[1] = 1;
        this[2] = 0;
        this[3] = 0;
        this._npDirty = true;
        break;
      }
      case 1: {
        this.set(arg0 as Plane);
        break;
      }
      case 2: {
        this.initWithOriginNormal(arg0 as Vector3, arg1 as Vector3);
        break;
      }
      case 3: {
        this.initWithPoints(arg0 as Vector3, arg1 as Vector3, arg2 as Vector3);
        break;
      }
      case 4: {
        this.setEquation(arg0 as number, arg1 as number, arg2 as number, arg3 as number);
        break;
      }
      default: {
        console.error('Plane constructor must have 0/2/3/4 arguments');
      }
    }
  }
  /** Get the coefficient A of the plane equation */
  get a() {
    return this[0];
  }
  set a(val) {
    this[0] = val;
    this._npDirty = true;
  }
  /** Get the coefficient B of the plane equation */
  get b() {
    return this[1];
  }
  set b(val) {
    this[1] = val;
    this._npDirty = true;
  }
  /** Get the coefficient C of the plane equation */
  get c() {
    return this[2];
  }
  set c(val) {
    this[2] = val;
    this._npDirty = true;
  }
  /** Get the coefficient D of the plane equation */
  get d() {
    return this[3];
  }
  set d(val) {
    this[3] = val;
    this._npDirty = true;
  }
  /** @internal */
  get px() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._px;
  }
  /** @internal */
  get py() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._py;
  }
  /** @internal */
  get pz() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._pz;
  }
  /** @internal */
  get nx() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._nx;
  }
  /** @internal */
  get ny() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._ny;
  }
  /** @internal */
  get nz() {
    if (this._npDirty) {
      this._npDirty = false;
      this._calcNP();
    }
    return this._nz;
  }
  /**
   * Set coefficients of the plane equation.
   * @param other - An array holding the coefficients.
   * @returns self
   */
  assign(other: ArrayLike<number>) {
    this._npDirty = true;
    super.set(other);
    return this;
  }
  /**
   * Set coefficients of the plane equation.
   * @param a - The coefficient A of the equation
   * @param b - The coefficient B of the equation
   * @param c - The coefficient C of the equation
   * @param d - The coefficient D of the equation
   * @returns self
   */
  setEquation(a: number, b: number, c: number, d: number) {
    this[0] = a;
    this[1] = b;
    this[2] = c;
    this[3] = d;
    this._npDirty = true;
    return this;
  }
  /**
   * Initialize the plane by normal vector and a point on the plane.
   * @param origin - A point on the plane.
   * @param normal - Normal of the plane.
   * @returns self
   */
  initWithOriginNormal(origin: Vector3, normal: Vector3) {
    // assume normal is normalized
    return this.setEquation(normal.x, normal.y, normal.z, -Vector3.dot(origin, normal));
  }
  /**
   * Initialize the plane by three points on the plane.
   * @param p0 - The first point.
   * @param p1 - The second point.
   * @param p2 - The third point.
   * @returns self
   */
  initWithPoints(p0: Vector3, p1: Vector3, p2: Vector3) {
    const normal = Vector3.cross(Vector3.sub(p1, p0), Vector3.sub(p2, p0)).inplaceNormalize();
    return this.initWithOriginNormal(p0, normal);
  }
  /**
   * Calculate the distance from a point to the plane.
   * @param p - The point
   * @returns The distance value.
   */
  distanceToPoint(p: Vector3) {
    return p.x * this[0] + p.y * this[1] + p.z * this[2] + this[3];
  }
  /**
   * Given a point, calucate the closest point on the plane to that point.
   * @param p - The given point.
   * @param result - A point object to which the result will be written, if not specified, a new point object will be returned.
   * @returns The result value.
   */
  nearestPointToPoint(p: Vector3, result?: Vector3) {
    const d = this.distanceToPoint(p);
    return (result || new Vector3()).setXYZ(p.x - this[0] * d, p.y - this[1] * d, p.z - this[2] * d);
  }
  /**
   * Get normal vector of the plane.
   * @param result - A vector object to which the result will be written, if not specified, a new vector will be returned.
   * @returns The result vector.
   */
  getNormal(result?: Vector3) {
    return (result || new Vector3()).setXYZ(this[0], this[1], this[2]);
  }
  /** Inplace flip the normal vector . */
  inplaceFlip() {
    return Plane.flip(this, this);
  }
  /** Inplace normalize the plane equation. */
  inplaceNormalize() {
    return Plane.normalize(this, this);
  }
  /**
   * Create a new plane object by flipping another plane's normal.
   * @param plane - The plane to which the normal will be flipped.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */
  static flip(plane: Plane, result?: Plane) {
    return (result || new Plane()).setEquation(-plane[0], -plane[1], -plane[2], -plane[3]);
  }
  /**
   * Create a new plane object by normalizing another plane.
   * @param plane - The plane that will be normalized.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */
  static normalize(plane: Plane, result?: Plane) {
    const len = Math.hypot(plane[0], plane[1], plane[2]);
    return (result || new Plane()).setEquation(
      plane[0] / len,
      plane[1] / len,
      plane[2] / len,
      plane[3] / len
    );
  }
  /**
   * Create a new plane object by transforming another plane.
   * @param plane - The plane that will be transformed.
   * @param matrix - The transform matrix.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */
  static transform(plane: Plane, matrix: Matrix4x4, result?: Plane) {
    const adjMatrix = Matrix4x4.transpose(Matrix4x4.invertAffine(matrix));
    const p = adjMatrix.transform(new Vector4(plane[0], plane[1], plane[2], plane[3]));
    const ret: Plane = result || plane;
    ret.setEquation(p.x, p.y, p.z, p.w);
    return ret.inplaceNormalize();
  }
  /** @internal */
  private _calcNP() {
    this._px = this[0] > 0 ? 1 : -1;
    this._py = this[1] > 0 ? 1 : -1;
    this._pz = this[2] > 0 ? 1 : -1;
    this._nx = -this._px;
    this._ny = -this._py;
    this._nz = -this._pz;
  }
}
