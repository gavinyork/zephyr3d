import type { Matrix4x4 } from './vector';
import { Vector3 } from './vector';
import type { AABB } from './aabb';

// reduce GC
const tmpV0 = new Vector3();
const tmpV1 = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const tmpV4 = new Vector3();

/**
 * The ray class
 * @public
 */
export class Ray {
  /** @internal */
  _origin: Vector3;
  /** @internal */
  _direction: Vector3;
  /** @internal */
  _ii: number;
  /** @internal */
  _ij: number;
  /** @internal */
  _ik: number;
  /** @internal */
  _ibyj: number;
  /** @internal */
  _jbyi: number;
  /** @internal */
  _kbyj: number;
  /** @internal */
  _jbyk: number;
  /** @internal */
  _ibyk: number;
  /** @internal */
  _kbyi: number;
  /** @internal */
  _c_xy: number;
  /** @internal */
  _c_xz: number;
  /** @internal */
  _c_yx: number;
  /** @internal */
  _c_yz: number;
  /** @internal */
  _c_zx: number;
  /** @internal */
  _c_zy: number;

  /**
   * Do a intersection test with an AABB.
   * @param bbox - The box to be test.
   * @returns true if the ray intersect with the box, otherwise false.
   */
  bboxIntersectionTest: (bbox: AABB) => boolean;
  /**
   * Do a intersection test with an AABB.
   * @param bbox - The box to be test.
   * @returns The distance from the origin to intersected point if the ray intersect with the box, otherwise null.
   */
  bboxIntersectionTestEx: (bbox: AABB) => number | null;

  /**
   * Construct a ray from origin and normalized direction vector.
   * @param origin - The ray origin if not specified, zero vector will be used.
   * @param directionNormalized - The normalized direction vector. if not specified, (0, 0, 1) will be used.
   */
  constructor(origin?: Vector3, directionNormalized?: Vector3) {
    this._origin = origin ? new Vector3(origin) : Vector3.zero();
    this._direction = directionNormalized ? new Vector3(directionNormalized) : Vector3.axisPZ();
    this.prepare();
  }
  /** Get the ray origin point */
  get origin(): Vector3 {
    return this._origin;
  }
  /** Get the ray direction vector */
  get direction(): Vector3 {
    return this._direction;
  }
  /**
   * Set the ray origin and normalized direction vector.
   * @param origin - The ray origin point.
   * @param directionNormalized - The normalized direction vector.
   */
  set(origin: Vector3, directionNormalized: Vector3): void {
    this._origin.set(origin);
    this._direction.set(directionNormalized);
    this.prepare();
  }
  /**
   * Transform the ray.
   * @param matrix - The transform matrix.
   * @param other - A ray object to which the result will be written, if not specified, a new ray object will be returned.
   * @returns The transform result.
   */
  transform(matrix: Matrix4x4, other?: Ray): Ray {
    if (other) {
      matrix.transformPointAffine(Vector3.add(this._origin, this._direction), other._direction);
      matrix.transformPointAffine(this._origin, other._origin);
      other._direction.subBy(other._origin).inplaceNormalize();
      /*
      matrix.transformPointAffine(this._origin, other._origin);
      matrix
        .transformPointAffine(Vector3.add(this._origin, this._direction), other._direction)
        .subBy(other._origin)
        .inplaceNormalize();
      */
      other.prepare();
    } else {
      const origin = matrix.transformPointAffine(this._origin);
      const direction = matrix
        .transformPointAffine(Vector3.add(this._origin, this._direction))
        .subBy(origin)
        .inplaceNormalize();
      other = new Ray(origin, direction);
    }
    return other;
  }
  intersectionTestCircle(
    center: Vector3,
    normal: Vector3,
    radius: number,
    epsl: number
  ): { dist: number; epsl: number } | null {
    // 数值容差
    const deltaParallel = 1e-1; // 接近平行阈值
    const deltaZero = 1e-12; // 避免除零用的小阈值

    const O = this.origin;
    const D = this.direction; // 假定已归一化
    const C = center;
    const N = normal; // 假定已归一化
    const R = radius;

    // 基础量
    const w = Vector3.sub(O, C);
    const a = Vector3.dot(D, N); // 射线方向与法线的夹角余弦
    const b = Vector3.dot(w, N); // 起点到平面的有符号距离
    /*
    // 将点 P 投影到平面 (N, 过 C)
    const projectPointToPlane = (P: Vector3) => {
      const h = Vector3.dot(Vector3.sub(P, C), N);
      return Vector3.sub(P, Vector3.scale(N, h));
    };
*/
    // 已在平面内的点 Q 到圆周的平面内距离
    const closestOnCircleInPlane = (Q: Vector3) => {
      const u = Vector3.sub(Q, C);
      const d = u.magnitude; // 长度
      if (d < deltaZero) {
        // Q 在圆心：最近距离等于半径
        return R;
      } else {
        return Math.abs(d - R);
      }
    };

    // 近似平行/共面处理：更稳健
    if (Math.abs(a) < deltaParallel) {
      const distance = this.intersectionTestSphere(center, radius + Math.abs(epsl));
      if (!distance) {
        return null;
      }
      let t = epsl;
      let d = -1;
      for (const dist of distance) {
        const distPlane = Vector3.dot(Vector3.sub(Vector3.add(O, Vector3.scale(D, dist)), center), N);
        if (Math.abs(distPlane) < t) {
          d = dist;
          t = Math.abs(distPlane);
        }
      }
      if (d >= 0) {
        return { dist: d, epsl: t };
      }
    }

    // 一般情况：用平面交点
    const tp = -b / a;
    if (tp >= 0) {
      // 前方交平面：直接在交点上测平面内到圆周距离
      const P = Vector3.add(O, Vector3.scale(D, tp));
      const dCircle = closestOnCircleInPlane(P);
      return dCircle <= epsl ? { dist: tp, epsl: dCircle } : null;
    }

    return null;
    /*
    // 平面在射线后方：最近点是 O（t=0），组合空间距离
    const distPlane = Math.abs(b);
    if (distPlane > epsl) {
      return null;
    }

    const Q = projectPointToPlane(O);
    const dCircle = closestOnCircleInPlane(Q);
    const distance = Math.hypot(distPlane, dCircle);
    return distance <= epsl ? distance : null;
    */
  }
  /**
   * Do a ray sphere intersection test
   * @param radius - Sphere radius
   * @returns Distance from origin to the intersected point if the ray intersects with the sphere, otherwise null
   */
  intersectionTestSphere(center: Vector3, radius: number): number[] | null {
    const O = Vector3.sub(this._origin, center);
    const a = Vector3.dot(this._direction, this._direction);
    const b = 2 * Vector3.dot(O, this._direction);
    const c = Vector3.dot(O, O) - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return null;
    }
    const s = Math.sqrt(discriminant);
    let t1 = (-b - s) / (2 * a);
    let t2 = (-b + s) / (2 * a);
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
    }
    if (t1 >= 0 || t2 >= 0) {
      const result: number[] = [];
      if (t1 >= 0) {
        result.push(t1);
      }
      if (t2 >= 0) {
        result.push(t2);
      }
      return result;
    }
    return null;
  }
  /**
   * Do a ray triangle intersection test.
   * @param v1 - The first triangle vertex.
   * @param v2 - The second triangle vertex.
   * @param v3 - The third triangle vertex.
   * @param cull - Allow back side intersection if true.
   * @returns Distance from origin to the intersected point if the ray intersects with the triangle, otherwise null.
   */
  intersectionTestTriangle(v1: Vector3, v2: Vector3, v3: Vector3, cull: boolean): number | null {
    const start = this._origin;
    const normal = this._direction;
    const edge1 = Vector3.sub(v2, v1, tmpV0);
    const edge2 = Vector3.sub(v3, v1, tmpV1);
    const pvec = Vector3.cross(normal, edge2, tmpV2);
    const det = Vector3.dot(edge1, pvec);
    if (!cull) {
      if (det > -0.0001 && det < 0.0001) {
        return null;
      }
      const inv_det = 1.0 / det;
      const tvec = Vector3.sub(start, v1, tmpV3);
      const u = inv_det * Vector3.dot(tvec, pvec);
      if (u < 0 || u > 1) {
        return null;
      }
      const qvec = Vector3.cross(tvec, edge1, tmpV4);
      const v = inv_det * Vector3.dot(normal, qvec);
      if (v < 0 || u + v > 1) {
        return null;
      }
      return Vector3.dot(edge2, qvec) * inv_det;
    } else {
      if (det < 0) {
        return null;
      }
      const tvec = Vector3.sub(start, v1, tmpV3);
      const u = Vector3.dot(tvec, pvec);
      if (u < 0 || u > det) {
        return null;
      }
      const qvec = Vector3.cross(tvec, edge1, tmpV4);
      const v = Vector3.dot(normal, qvec);
      if (v < 0 || u + v > det) {
        return null;
      }
      return Vector3.dot(edge2, qvec) / det;
    }
  }
  /** @internal */
  qtestMMM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.y < y0 ||
      this._origin.z < z0 ||
      this._jbyi * x0 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x1 + this._c_yx > 0 ||
      this._jbyk * z0 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z1 + this._c_yz > 0 ||
      this._kbyi * x0 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x1 + this._c_zx > 0
    ) {
      return false;
    }
    return true;
  }
  /** @internal */
  qtestMMMEx(bbox: AABB): number | null {
    if (!this.qtestMMM(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestMMP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.y < y0 ||
      this._origin.z > z1 ||
      this._jbyi * x0 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x1 + this._c_yx > 0 ||
      this._jbyk * z1 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z0 + this._c_yz < 0 ||
      this._kbyi * x0 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x1 + this._c_zx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMMPEx(bbox: AABB): number | null {
    if (!this.qtestMMP(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestMPM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.y > y1 ||
      this._origin.z < z0 ||
      this._jbyi * x0 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x1 + this._c_yx > 0 ||
      this._jbyk * z0 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z1 + this._c_yz > 0 ||
      this._kbyi * x0 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x1 + this._c_zx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMPMEx(bbox: AABB): number | null {
    if (!this.qtestMPM(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestMPP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.y > y1 ||
      this._origin.z > z1 ||
      this._jbyi * x0 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x1 + this._c_yx > 0 ||
      this._jbyk * z1 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z0 + this._c_yz < 0 ||
      this._kbyi * x0 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x1 + this._c_zx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMPPEx(bbox: AABB): number | null {
    if (!this.qtestMPP(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestPMM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.z < z0 ||
      this._jbyi * x1 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x0 + this._c_yx < 0 ||
      this._jbyk * z0 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z1 + this._c_yz > 0 ||
      this._kbyi * x1 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPMMEx(bbox: AABB): number | null {
    if (!this.qtestPMM(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestPMP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.z > z1 ||
      this._jbyi * x1 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x0 + this._c_yx < 0 ||
      this._jbyk * z1 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z0 + this._c_yz < 0 ||
      this._kbyi * x1 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPMPEx(bbox: AABB): number | null {
    if (!this.qtestPMP(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }
    return t;
  }
  /** @internal */
  qtestPPM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x > x1 ||
      this._origin.y > y1 ||
      this._origin.z < z0 ||
      this._jbyi * x1 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x0 + this._c_yx < 0 ||
      this._jbyk * z0 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z1 + this._c_yz > 0 ||
      this._kbyi * x1 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPPMEx(bbox: AABB): number | null {
    if (!this.qtestPPM(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestPPP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x > x1 ||
      this._origin.y > y1 ||
      this._origin.z > z1 ||
      this._jbyi * x1 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x0 + this._c_yx < 0 ||
      this._jbyk * z1 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z0 + this._c_yz < 0 ||
      this._kbyi * x1 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPPPEx(bbox: AABB): number | null {
    if (!this.qtestPPP(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t1 > t) {
      t = t1;
    }
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestOMM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.z < z0 ||
      this._jbyk * z0 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z1 + this._c_yz > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOMMEx(bbox: AABB): number | null {
    if (!this.qtestOMM(bbox)) {
      return null;
    }

    let t = (bbox.maxPoint.y - this._origin.y) * this._ij;
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestOMP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.z > z1 ||
      this._jbyk * z1 - y1 + this._c_zy > 0 ||
      this._kbyj * y0 - z0 + this._c_yz < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOMPEx(bbox: AABB): number | null {
    if (!this.qtestOMP(bbox)) {
      return null;
    }

    let t = (bbox.maxPoint.y - this._origin.y) * this._ij;
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestOPM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y > y1 ||
      this._origin.z < z0 ||
      this._jbyk * z0 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z1 + this._c_yz > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOPMEx(bbox: AABB): number | null {
    if (!this.qtestOPM(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.y - this._origin.y) * this._ij;
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestOPP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y > y1 ||
      this._origin.z > z1 ||
      this._jbyk * z1 - y0 + this._c_zy < 0 ||
      this._kbyj * y1 - z0 + this._c_yz < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOPPEx(bbox: AABB): number | null {
    if (!this.qtestOPP(bbox)) {
      return null;
    }

    let t = (bbox.minPoint.y - this._origin.y) * this._ij;
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestMOM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.x < x0 ||
      this._origin.z < z0 ||
      this._kbyi * x0 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x1 + this._c_zx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMOMEx(bbox: AABB): number | null {
    if (!this.qtestMOM(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestMOP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.x < x0 ||
      this._origin.z > z1 ||
      this._kbyi * x0 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x1 + this._c_zx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMOPEx(bbox: AABB): number | null {
    if (!this.qtestMOP(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestPOM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.x > x1 ||
      this._origin.z < z0 ||
      this._kbyi * x1 - z1 + this._c_xz > 0 ||
      this._ibyk * z0 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPOMEx(bbox: AABB): number | null {
    if (!this.qtestPOM(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestPOP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.x > x1 ||
      this._origin.z > z1 ||
      this._kbyi * x1 - z0 + this._c_xz < 0 ||
      this._ibyk * z1 - x0 + this._c_zx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPOPEx(bbox: AABB): number | null {
    if (!this.qtestPOP(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestMMO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.z < z0 ||
      this._origin.z > z1 ||
      this._origin.x < x0 ||
      this._origin.y < y0 ||
      this._jbyi * x0 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x1 + this._c_yx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMMOEx(bbox: AABB): number | null {
    if (!this.qtestMMO(bbox)) {
      return null;
    }
    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestMPO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.z < z0 ||
      this._origin.z > z1 ||
      this._origin.x < x0 ||
      this._origin.y > y1 ||
      this._jbyi * x0 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x1 + this._c_yx > 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMPOEx(bbox: AABB): number | null {
    if (!this.qtestMPO(bbox)) {
      return null;
    }

    let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestPMO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.z < z0 ||
      this._origin.z > z1 ||
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._jbyi * x1 - y1 + this._c_xy > 0 ||
      this._ibyj * y0 - x0 + this._c_yx < 0
    ) {
      return false;
    }
    return true;
  }
  /** @internal */
  qtestPMOEx(bbox: AABB): number | null {
    if (!this.qtestPMO(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.maxPoint.y - this._origin.y) * this._ij;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestPPO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;
    if (
      this._origin.z < z0 ||
      this._origin.z > z1 ||
      this._origin.x > x1 ||
      this._origin.y > y1 ||
      this._jbyi * x1 - y0 + this._c_xy < 0 ||
      this._ibyj * y1 - x0 + this._c_yx < 0
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPPOEx(bbox: AABB): number | null {
    if (!this.qtestPPO(bbox)) {
      return null;
    }
    let t = (bbox.minPoint.x - this._origin.x) * this._ii;
    const t2 = (bbox.minPoint.y - this._origin.y) * this._ij;
    if (t2 > t) {
      t = t2;
    }

    return t;
  }
  /** @internal */
  qtestMOO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;

    if (
      this._origin.x < x0 ||
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.z < z0 ||
      this._origin.z > z1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestMOOEx(bbox: AABB): number | null {
    if (!this.qtestMOO(bbox)) {
      return null;
    }
    const t = (bbox.maxPoint.x - this._origin.x) * this._ii;

    return t;
  }
  /** @internal */
  qtestPOO(bbox: AABB): boolean {
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;

    if (
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.y > y1 ||
      this._origin.z < z0 ||
      this._origin.z > z1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestPOOEx(bbox: AABB): number | null {
    if (!this.qtestPOO(bbox)) {
      return null;
    }

    const t = (bbox.minPoint.x - this._origin.x) * this._ii;

    return t;
  }
  /** @internal */
  qtestOMO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const z1 = bbox.maxPoint.z;

    if (
      this._origin.y < y0 ||
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.z < z0 ||
      this._origin.z > z1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOMOEx(bbox: AABB): number | null {
    if (!this.qtestOMO(bbox)) {
      return null;
    }

    const t = (bbox.maxPoint.y - this._origin.y) * this._ij;

    return t;
  }
  /** @internal */
  qtestOPO(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;

    if (
      this._origin.y > y1 ||
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.z < z0 ||
      this._origin.z > z1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOPOEx(bbox: AABB): number | null {
    if (!this.qtestOPO(bbox)) {
      return null;
    }

    const t = (bbox.minPoint.y - this._origin.y) * this._ij;

    return t;
  }
  /** @internal */
  qtestOOM(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const z0 = bbox.minPoint.z;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;

    if (
      this._origin.z < z0 ||
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.y > y1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOOMEx(bbox: AABB): number | null {
    if (!this.qtestOOM(bbox)) {
      return null;
    }

    const t = (bbox.maxPoint.z - this._origin.z) * this._ik;

    return t;
  }
  /** @internal */
  qtestOOP(bbox: AABB): boolean {
    const x0 = bbox.minPoint.x;
    const y0 = bbox.minPoint.y;
    const x1 = bbox.maxPoint.x;
    const y1 = bbox.maxPoint.y;
    const z1 = bbox.maxPoint.z;

    if (
      this._origin.z > z1 ||
      this._origin.x < x0 ||
      this._origin.x > x1 ||
      this._origin.y < y0 ||
      this._origin.y > y1
    ) {
      return false;
    }

    return true;
  }
  /** @internal */
  qtestOOPEx(bbox: AABB): number | null {
    if (!this.qtestOOP(bbox)) {
      return null;
    }

    const t = (bbox.minPoint.z - this._origin.z) * this._ik;

    return t;
  }
  /** @internal */
  prepare(): void {
    const x = this._origin.x;
    const y = this._origin.y;
    const z = this._origin.z;
    const i = this._direction.x;
    const j = this._direction.y;
    const k = this._direction.z;
    this._ii = 1.0 / i;
    this._ij = 1.0 / j;
    this._ik = 1.0 / k;
    this._ibyj = i * this._ij;
    this._jbyi = j * this._ii;
    this._jbyk = j * this._ik;
    this._kbyj = k * this._ij;
    this._ibyk = i * this._ik;
    this._kbyi = k * this._ii;
    this._c_xy = y - this._jbyi * x;
    this._c_xz = z - this._kbyi * x;
    this._c_yx = x - this._ibyj * y;
    this._c_yz = z - this._kbyj * y;
    this._c_zx = x - this._ibyk * z;
    this._c_zy = y - this._jbyk * z;
    if (i < 0) {
      if (j < 0) {
        if (k < 0) {
          this.bboxIntersectionTest = this.qtestMMM;
          this.bboxIntersectionTestEx = this.qtestMMMEx;
        } else if (k > 0) {
          this.bboxIntersectionTest = this.qtestMMP;
          this.bboxIntersectionTestEx = this.qtestMMPEx;
        } else {
          this.bboxIntersectionTest = this.qtestMMO;
          this.bboxIntersectionTestEx = this.qtestMMOEx;
        }
      } else {
        if (k < 0) {
          this.bboxIntersectionTest = j > 0 ? this.qtestMPM : this.qtestMOM;
          this.bboxIntersectionTestEx = j > 0 ? this.qtestMPMEx : this.qtestMOMEx;
        } else {
          if (j === 0 && k === 0) {
            this.bboxIntersectionTest = this.qtestMOO;
            this.bboxIntersectionTestEx = this.qtestMOOEx;
          } else if (k === 0) {
            this.bboxIntersectionTest = this.qtestMPO;
            this.bboxIntersectionTestEx = this.qtestMPOEx;
          } else if (j === 0) {
            this.bboxIntersectionTest = this.qtestMOP;
            this.bboxIntersectionTestEx = this.qtestMOPEx;
          } else {
            this.bboxIntersectionTest = this.qtestMPP;
            this.bboxIntersectionTestEx = this.qtestMPPEx;
          }
        }
      }
    } else {
      if (j < 0) {
        if (k < 0) {
          this.bboxIntersectionTest = i > 0 ? this.qtestPMM : this.qtestOMM;
          this.bboxIntersectionTestEx = i > 0 ? this.qtestPMMEx : this.qtestOMMEx;
        } else {
          if (i === 0 && k === 0) {
            this.bboxIntersectionTest = this.qtestOMO;
            this.bboxIntersectionTestEx = this.qtestOMOEx;
          } else if (k === 0) {
            this.bboxIntersectionTest = this.qtestPMO;
            this.bboxIntersectionTestEx = this.qtestPMOEx;
          } else if (i === 0) {
            this.bboxIntersectionTest = this.qtestOMP;
            this.bboxIntersectionTestEx = this.qtestOMPEx;
          } else {
            this.bboxIntersectionTest = this.qtestPMP;
            this.bboxIntersectionTestEx = this.qtestPMPEx;
          }
        }
      } else {
        if (k < 0) {
          if (i === 0 && j === 0) {
            this.bboxIntersectionTest = this.qtestOOM;
            this.bboxIntersectionTestEx = this.qtestOOMEx;
          } else if (i === 0) {
            this.bboxIntersectionTest = this.qtestOPM;
            this.bboxIntersectionTestEx = this.qtestOPMEx;
          } else if (j === 0) {
            this.bboxIntersectionTest = this.qtestPOM;
            this.bboxIntersectionTestEx = this.qtestPOMEx;
          } else {
            this.bboxIntersectionTest = this.qtestPPM;
            this.bboxIntersectionTestEx = this.qtestPPMEx;
          }
        } else {
          if (i === 0) {
            if (j === 0) {
              this.bboxIntersectionTest = this.qtestOOP;
              this.bboxIntersectionTestEx = this.qtestOOPEx;
            } else if (k === 0) {
              this.bboxIntersectionTest = this.qtestOPO;
              this.bboxIntersectionTestEx = this.qtestOPOEx;
            } else {
              this.bboxIntersectionTest = this.qtestOPP;
              this.bboxIntersectionTestEx = this.qtestOPPEx;
            }
          } else {
            if (j === 0 && k === 0) {
              this.bboxIntersectionTest = this.qtestPOO;
              this.bboxIntersectionTestEx = this.qtestPOOEx;
            } else if (j === 0) {
              this.bboxIntersectionTest = this.qtestPOP;
              this.bboxIntersectionTestEx = this.qtestPOPEx;
            } else if (k === 0) {
              this.bboxIntersectionTest = this.qtestPPO;
              this.bboxIntersectionTestEx = this.qtestPPOEx;
            } else {
              this.bboxIntersectionTest = this.qtestPPP;
              this.bboxIntersectionTestEx = this.qtestPPPEx;
            }
          }
        }
      }
    }
  }
}
