import type { Ray } from './ray';
import { Vector3, Vector4 } from './vector';

export class HeightField {
  private _region: Vector4;
  private _scale: Vector3;
  private _width: number;
  private _height: number;
  private _heightData: Float32Array;
  constructor(width: number, height: number, scaleY?: number, region?: Vector4) {
    this._width = width;
    this._height = height;
    this._region = region?.clone() ?? new Vector4(0, 0, 1, 1);
    this._scale = new Vector3();
    this._scale.x = (this._region.z - this._region.x) / this._width;
    this._scale.y = scaleY ?? 1;
    this._scale.z = (this._region.w - this._region.y) / this._height;
    this._heightData = new Float32Array(width * height);
  }
  get region(): Vector4 {
    return this._region;
  }
  set region(v: Vector4) {
    this._region.set(v);
    this._scale.x = (this._region.z - this._region.x) / this._width;
    this._scale.z = (this._region.w - this._region.y) / this._height;
  }
  get scaleY(): number {
    return this._scale.y;
  }
  set scaleY(v: number) {
    this._scale.y = v;
  }
  get width(): number {
    return this._width;
  }
  set width(v: number) {
    if (v !== this._width) {
      this._width = v;
      this._heightData = new Float32Array(this._width * this._height);
      this._scale.x = (this._region.z - this._region.x) / this._width;
    }
  }
  get height(): number {
    return this._height;
  }
  set height(v: number) {
    if (v !== this._height) {
      this._height = v;
      this._heightData = new Float32Array(this._width * this._height);
      this._scale.z = (this._region.w - this._region.y) / this._height;
    }
  }
  get heightData(): Float32Array {
    return this._heightData;
  }
  sampleHeight(x: number, y: number): number {
    return this._heightData[y * this._width + x] * this._scale.y;
  }
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

  rayIntersect(ray: Ray, x: number, y: number, w: number, h: number): number | null {
    let x0 = ray.origin.x;
    let y0 = ray.origin.z;
    let dx = ray.direction.x;
    let dy = ray.direction.z;
    const scaleX = this._scale.x;
    const scaleY = this._scale.z;
    const epsl = 0.001;
    let tx = 0;
    let ty = 0;
    const xmin = x * scaleX;
    const xmax = xmin + w * scaleX;
    const ymin = y * scaleY;
    const ymax = ymin + h * scaleY;
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
      return;
    }
    if (y0 < ymin) {
      ty = (ymin - y0) / dy;
    } else if (y0 > ymax) {
      return;
    }
    const t = tx > ty ? tx : ty;
    x0 += t * dx;
    y0 += t * dy;
    let u = Math.floor((x0 - xmin + epsl) / scaleX);
    let v = Math.floor((y0 - ymin + epsl) / scaleY);
    while (u >= 0 && u < w && v >= 0 && v < h) {
      if (u < w - 1 && v < h - 1) {
        const m = x + (mirrorx ? w - u - 1 : u);
        const n = y + (mirrory ? h - v - 1 : v);
        const v00 = new Vector3(m * scaleX, this.sampleHeight(m, n), n * scaleY);
        const v01 = new Vector3((m + 1) * scaleX, this.sampleHeight(m + 1, n), n * scaleY);
        const v11 = new Vector3((m + 1) * scaleX, this.sampleHeight(m + 1, n + 1), (n + 1) * scaleY);
        const v10 = new Vector3(m * scaleX, this.sampleHeight(m, n + 1), (n + 1) * scaleY);
        let intersected = false;
        let dist1 = ray.intersectionTestTriangle(v00, v01, v10, false);
        if (dist1 !== null && dist1 > 0) {
          intersected = true;
        } else {
          dist1 = Number.MAX_VALUE;
        }
        let dist2 = ray.intersectionTestTriangle(v10, v01, v11, false);
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
        const x1 = (u + x + 1) * scaleX;
        d = Math.min(d, (x1 - x0) / dx);
      }
      if (dy !== 0) {
        const y1 = (v + y + 1) * scaleY;
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
