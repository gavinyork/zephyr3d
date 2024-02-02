import { glMatrix, mat4, vec3, vec4 } from 'gl-matrix';
import { Camera } from '../graphics';
import { AABB } from './aabb';

export class Frustum {
  get planes(): Readonly<[vec4, vec4, vec4, vec4, vec4, vec4]> {
    return this._planes;
  }

  get corners(): Readonly<[vec3, vec3, vec3, vec3, vec3, vec3, vec3, vec3]> {
    return this._corners;
  }

  get origin(): Readonly<vec3> {
    return this._origin;
  }

  private cornersLocal: [vec3, vec3, vec3, vec3, vec3, vec3, vec3, vec3] = [
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
    vec3.create(),
  ];

  private readonly _corners: [vec3, vec3, vec3, vec3, vec3, vec3, vec3, vec3] =
    [
      vec3.create(),
      vec3.create(),
      vec3.create(),
      vec3.create(),
      vec3.create(),
      vec3.create(),
      vec3.create(),
      vec3.create(),
    ];

  private readonly _planes: [vec4, vec4, vec4, vec4, vec4, vec4] = [
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
    vec4.create(),
  ];

  private readonly _origin = vec3.create();

  constructor(camera: Camera) {
    this.initFromCamera(camera);
    this.transform(camera.transform);
  }

  transform(transform: mat4) {
    // Update origin
    vec3.set(this._origin, transform[12], transform[13], transform[14]);

    // Update corners
    for (let i = 0; i < 8; i++) {
      vec3.transformMat4(this._corners[i], this.cornersLocal[i], transform);
    }

    // Update planes
    const triples = [
      [this._corners[7], this._corners[4], this._corners[0]],
      [this._corners[4], this._corners[5], this._corners[1]],
      [this._corners[5], this._corners[6], this._corners[2]],
      [this._corners[6], this._corners[7], this._corners[3]],
      [this._corners[0], this._corners[1], this._corners[2]],
      [this._corners[6], this._corners[5], this._corners[4]],
    ];

    const a = vec3.create();
    const b = vec3.create();
    const n = vec3.create();
    let i = 0;
    for (const triple of triples) {
      vec3.sub(a, triple[1], triple[0]);
      vec3.sub(b, triple[2], triple[0]);
      vec3.cross(n, a, b);
      vec3.normalize(n, n);
      vec4.set(this._planes[i++], n[0], n[1], n[2], -vec3.dot(n, triple[0]));
    }
  }

  testAABB(aabb: AABB) {
    const corners = [
      // 0
      vec4.fromValues(aabb.min[0], aabb.min[1], aabb.min[2], 1.0),
      // 1
      vec4.fromValues(aabb.min[0], aabb.min[1], aabb.max[2], 1.0),
      // 2
      vec4.fromValues(aabb.max[0], aabb.min[1], aabb.max[2], 1.0),
      // 3
      vec4.fromValues(aabb.max[0], aabb.min[1], aabb.min[2], 1.0),
      // 4
      vec4.fromValues(aabb.min[0], aabb.max[1], aabb.min[2], 1.0),
      // 5
      vec4.fromValues(aabb.min[0], aabb.max[1], aabb.max[2], 1.0),
      // 6
      vec4.fromValues(aabb.max[0], aabb.max[1], aabb.max[2], 1.0),
      // 7
      vec4.fromValues(aabb.max[0], aabb.max[1], aabb.min[2], 1.0),
    ];

    for (const plane of this.planes) {
      if (corners.every((corner) => vec4.dot(corner, plane) > 0)) {
        return false;
      }
    }

    if (this._corners.every((c) => c[0] < aabb.min[0])) {
      return false;
    }
    if (this._corners.every((c) => c[0] > aabb.max[0])) {
      return false;
    }

    if (this._corners.every((c) => c[1] < aabb.min[1])) {
      return false;
    }
    if (this._corners.every((c) => c[1] > aabb.max[1])) {
      return false;
    }

    if (this._corners.every((c) => c[2] < aabb.min[2])) {
      return false;
    }
    if (this._corners.every((c) => c[2] > aabb.max[2])) {
      return false;
    }

    return true;
  }

  private initFromCamera(camera: Camera) {
    const near = camera.near;
    const far = camera.far;
    const top = near * Math.tan(glMatrix.toRadian(camera.fov / 2.0));
    const right = top * camera.aspect;
    const left = -right;
    const bottom = -top;

    const left_f = (left * far) / near;
    const right_f = (right * far) / near;
    const bottom_f = (bottom * far) / near;
    const top_f = (top * far) / near;

    // Get points on near plane
    this.cornersLocal[0][0] = left;
    this.cornersLocal[0][1] = bottom;
    this.cornersLocal[0][2] = -near;

    this.cornersLocal[1][0] = right;
    this.cornersLocal[1][1] = bottom;
    this.cornersLocal[1][2] = -near;

    this.cornersLocal[2][0] = right;
    this.cornersLocal[2][1] = top;
    this.cornersLocal[2][2] = -near;

    this.cornersLocal[3][0] = left;
    this.cornersLocal[3][1] = top;
    this.cornersLocal[3][2] = -near;

    // Get points on far plane
    this.cornersLocal[4][0] = left_f;
    this.cornersLocal[4][1] = bottom_f;
    this.cornersLocal[4][2] = -far;

    this.cornersLocal[5][0] = right_f;
    this.cornersLocal[5][1] = bottom_f;
    this.cornersLocal[5][2] = -far;

    this.cornersLocal[6][0] = right_f;
    this.cornersLocal[6][1] = top_f;
    this.cornersLocal[6][2] = -far;

    this.cornersLocal[7][0] = left_f;
    this.cornersLocal[7][1] = top_f;
    this.cornersLocal[7][2] = -far;

    // Reset origin
    vec3.set(this._origin, 0.0, 0.0, 0.0);
  }
}
