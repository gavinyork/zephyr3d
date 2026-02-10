import type { Immutable } from '../utils';
import type { Ray } from './ray';
import { Vector3, Vector4 } from './vector';

/**
 * Height field class for height sampling and ray intersection
 * @public
 */
export class HeightField {
  private _region: Vector4;
  private _scale: Vector3;
  private _baseHeight: number;
  private _width: number;
  private _height: number;
  private _heightData: Float32Array;
  private _v00: Vector3;
  private _v01: Vector3;
  private _v11: Vector3;
  private _v10: Vector3;

  /**
   * Create a height field
   *
   * @param width - number of height samples in x direction
   * @param height - number of height samples in z direction
   * @param scaleY - height scale factor
   * @param baseHeight - base height offset
   * @param region - region in xz plane covered by the height field
   */
  constructor(width: number, height: number, scaleY?: number, baseHeight?: number, region?: Vector4) {
    this._width = width;
    this._height = height;
    this._region = region?.clone() ?? new Vector4(0, 0, 1, 1);
    this._scale = new Vector3();
    this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
    this._scale.y = scaleY ?? 1;
    this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
    this._baseHeight = baseHeight ?? 0;
    this._heightData = new Float32Array(width * height);
    this._v00 = new Vector3();
    this._v01 = new Vector3();
    this._v11 = new Vector3();
    this._v10 = new Vector3();
  }
  /**
   * Region in xz plane covered by the height field
   */
  get region(): Immutable<Vector4> {
    return this._region;
  }
  set region(v: Immutable<Vector4>) {
    this._region.set(v);
    this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
    this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
  }
  /**
   * Base height offset
   */
  get baseHeight() {
    return this._baseHeight;
  }
  set baseHeight(v) {
    this._baseHeight = v;
  }
  /**
   * Height scale factor
   */
  get scaleY() {
    return this._scale.y;
  }
  set scaleY(v) {
    this._scale.y = v;
  }
  /**
   * Number of height samples in x direction
   */
  get width() {
    return this._width;
  }
  set width(v) {
    if (v !== this._width) {
      this._width = v;
      this._heightData = new Float32Array(this._width * this._height);
      this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
    }
  }
  /**
   * Number of height samples in z direction
   */
  get height() {
    return this._height;
  }
  set height(v) {
    if (v !== this._height) {
      this._height = v;
      this._heightData = new Float32Array(this._width * this._height);
      this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
    }
  }
  /**
   * Height data array (row major)
   */
  get heightData() {
    return this._heightData;
  }
  /**
   * Sample height at grid point (x, y)
   * @param x - x index
   * @param y - y index
   * @returns height value
   */
  sampleHeight(x: number, y: number) {
    return this._heightData[y * this._width + x] * this._scale.y + this._baseHeight;
  }
  /**
   * Calculate height at given world position (worldX, worldZ) by bilinear interpolation
   * @param worldX - world x position
   * @param worldZ - world z position
   * @returns height value
   */
  calculateHeight(worldX: number, worldZ: number) {
    const u = Math.max(
      0.5 / this._width,
      Math.min(1 - 0.5 / this._width, (worldX - this._region.x) / (this._region.z - this._region.x))
    );
    const v = Math.max(
      0.5 / this._height,
      Math.min(1 - 0.5 / this._height, (worldZ - this._region.y) / (this._region.w - this._region.y))
    );
    const pu = u * this._width;
    const pv = v * this._height;
    const l = Math.floor(pu);
    const t = Math.floor(pv);
    const r = l + 1;
    const b = t + 1;
    if (l === r) {
      if (t === b) {
        return this.sampleHeight(l, t);
      } else {
        const ht = this.sampleHeight(l, t);
        const hb = this.sampleHeight(l, b);
        return ht + (hb - ht) * (pv - t);
      }
    } else {
      const hlt = this.sampleHeight(l, t);
      const hrt = this.sampleHeight(r, t);
      const ht = hlt + (hrt - hlt) * (pu - l);
      if (t === b) {
        return ht;
      } else {
        const hlb = this.sampleHeight(l, b);
        const hrb = this.sampleHeight(r, b);
        const hb = hlb + (hrb - hlb) * (pu - l);
        return ht + (hb - ht) * (pv - t);
      }
    }
  }

  /**
   * Ray intersection test with the height field
   * @param rayWorld - ray in world space
   * @returns distance to intersection point, or null if no intersection
   */
  rayIntersect(rayWorld: Ray) {
    let x0 = rayWorld.origin.x;
    let y0 = rayWorld.origin.z;
    let dx = rayWorld.direction.x;
    let dy = rayWorld.direction.z;
    const scaleX = this._scale.x;
    const scaleY = this._scale.z;
    const epsl = 0.001;
    let tx = 0;
    let ty = 0;
    const xmin = this._region.x;
    const xmax = this._region.z;
    const ymin = this._region.y;
    const ymax = this._region.w;
    const xcenter = (xmin + xmax) / 2;
    const ycenter = (ymin + ymax) / 2;
    let mirrorx = false;
    let mirrory = false;
    if (dx < 0) {
      dx = -dx;
      x0 += 2 * (xcenter - x0);
      mirrorx = true;
    }
    if (dy < 0) {
      dy = -dy;
      y0 += 2 * (ycenter - y0);
      mirrory = true;
    }
    if (x0 < xmin) {
      tx = (xmin - x0) / dx;
    } else if (x0 > xmax) {
      return null;
    }
    if (y0 < ymin) {
      ty = (ymin - y0) / dy;
    } else if (y0 > ymax) {
      return null;
    }
    const t = tx > ty ? tx : ty;
    x0 += t * dx;
    y0 += t * dy;
    let u = Math.floor((x0 - xmin + epsl) / scaleX);
    let v = Math.floor((y0 - ymin + epsl) / scaleY);
    while (u >= 0 && u < this._width && v >= 0 && v < this._height) {
      if (u < this._width - 1 && v < this._height - 1) {
        const m = mirrorx ? this._width - 1 - u - 1 : u;
        const n = mirrory ? this._height - 1 - v - 1 : v;
        this._v00.setXYZ(xmin + m * scaleX, this.sampleHeight(m, n), ymin + n * scaleY);
        this._v01.setXYZ(xmin + (m + 1) * scaleX, this.sampleHeight(m + 1, n), ymin + n * scaleY);
        this._v11.setXYZ(xmin + (m + 1) * scaleX, this.sampleHeight(m + 1, n + 1), ymin + (n + 1) * scaleY);
        this._v10.setXYZ(xmin + m * scaleX, this.sampleHeight(m, n + 1), ymin + (n + 1) * scaleY);
        let intersected = false;
        let dist1 = rayWorld.intersectionTestTriangle(this._v00, this._v01, this._v10, false);
        if (dist1 !== null && dist1 > 0) {
          intersected = true;
        } else {
          dist1 = Number.MAX_VALUE;
        }
        let dist2 = rayWorld.intersectionTestTriangle(this._v10, this._v01, this._v11, false);
        if (dist2 !== null && dist2 > 0) {
          intersected = true;
        } else {
          dist2 = Number.MAX_VALUE;
        }
        if (intersected) {
          return dist1 < dist2 ? dist1 : dist2;
        }
      }
      let d = Infinity;
      if (dx > 0) {
        const x1 = xmin + (u + 1) * scaleX;
        d = Math.min(d, (x1 - x0) / dx);
      }
      if (dy !== 0) {
        const y1 = ymin + (v + 1) * scaleY;
        d = Math.min(d, (y1 - y0) / dy);
      }
      x0 += d * dx;
      y0 += d * dy;
      u = Math.floor((x0 - xmin + epsl) / scaleX);
      v = Math.floor((y0 - ymin + epsl) / scaleY);
    }
    return null;
  }
}
