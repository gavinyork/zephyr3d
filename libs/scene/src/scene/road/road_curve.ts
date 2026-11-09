import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';

/**
 * How the handles of a road control point are decided
 *
 * - `'auto'`: computed from the neighboring points (centripetal Catmull-Rom), the stored handles
 *   are not used.
 * - `'aligned'`: the stored handles, kept on one line by the editor.
 * - `'free'`: the stored handles as they are, which can make a corner.
 *
 * @public
 */
export type RoadHandleMode = 'auto' | 'aligned' | 'free';

/**
 * A control point as {@link RoadCurve} takes it, in the space of the road
 * @public
 */
export interface RoadCurvePoint {
  /** Position */
  position: Vector3;
  /** Road width at this point in meters; 0 or less for the default width */
  width: number;
  /** Roll about the direction of the road in degrees, positive raises the right edge */
  bank: number;
  /** How the handles are decided */
  handleMode: RoadHandleMode;
  /** Incoming handle relative to the position, used unless the mode is auto */
  inHandle: Vector3;
  /** Outgoing handle relative to the position, used unless the mode is auto */
  outHandle: Vector3;
}

/**
 * A point on a road with the directions around it
 * @public
 */
export interface RoadFrame {
  /** Distance along the road from its start */
  s: number;
  /** Point on the center line */
  position: Vector3;
  /** Direction of travel */
  tangent: Vector3;
  /** Across the road to the right, rolled by the bank */
  right: Vector3;
  /** Normal of the road surface */
  up: Vector3;
  /** Road width */
  width: number;
  /** Bank in radians */
  bank: number;
}

/**
 * Where a point is relative to a road, see {@link RoadCurve.project}
 * @public
 */
export interface RoadProjection {
  /** Distance along the road of the closest center line point */
  s: number;
  /** Horizontal offset from the center line, positive to the right of the direction of travel */
  lateral: number;
  /** Horizontal distance to the center line */
  distance: number;
  /** The closest center line point */
  position: Vector3;
}

/** Bezier subdivisions per segment of the arc length table */
const LUT_STEPS = 32;
/** Centripetal parameterization of the auto handles */
const ALPHA = 0.5;
/** Cell size of the grid of the projection polyline, in meters */
const GRID_CELL = 8;
const EPS = 1e-6;

/** Creates an empty frame */
export function createRoadFrame(): RoadFrame {
  return {
    s: 0,
    position: new Vector3(),
    tangent: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, 1, 0),
    width: 0,
    bank: 0
  };
}

function smoothstep(t: number) {
  t = Math.min(Math.max(t, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The center line of a road: a chain of cubic Bezier segments through the control points,
 * parameterized by arc length, with a width and a bank along it.
 *
 * Everything is in the space of the road node. Up is +Y.
 * @public
 */
export class RoadCurve {
  private readonly _closed: boolean;
  private readonly _numPoints: number;
  private readonly _numSegments: number;
  /** Per segment the four Bezier control points, 12 numbers */
  private readonly _bezier: Float64Array;
  /** Per segment LUT_STEPS + 1 arc lengths from the start of the road */
  private readonly _lut: Float64Array;
  /** Arc length at each control point, plus the end of a closed road */
  private readonly _pointS: Float64Array;
  private readonly _widths: Float64Array;
  private readonly _banks: Float64Array;
  private readonly _length: number;
  /** Polyline for projection: x, y, z, s per vertex */
  private _polyline: Nullable<Float64Array>;
  private _grid: Nullable<Map<number, number[]>>;
  private _gridMinX: number;
  private _gridMinZ: number;
  private _gridW: number;
  private _gridH: number;
  /**
   * Builds the curve
   * @param points - Control points in order
   * @param closed - Whether the last point connects back to the first
   * @param defaultWidth - Width of points whose width is 0 or less
   */
  constructor(points: readonly RoadCurvePoint[], closed: boolean, defaultWidth: number) {
    const n = points.length;
    this._closed = closed && n >= 3;
    this._numPoints = n;
    this._numSegments = n < 2 ? 0 : this._closed ? n : n - 1;
    this._bezier = new Float64Array(this._numSegments * 12);
    this._lut = new Float64Array(this._numSegments * (LUT_STEPS + 1));
    this._pointS = new Float64Array(this._numSegments + 1);
    this._widths = new Float64Array(n + 1);
    this._banks = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const w = points[i].width;
      this._widths[i] = w > 0 ? w : Math.max(defaultWidth, 0.01);
      this._banks[i] = (points[i].bank * Math.PI) / 180;
    }
    if (n > 0) {
      // The end of a closed road is its start again
      this._widths[n] = this._widths[0];
      this._banks[n] = this._banks[0];
    }
    this._polyline = null;
    this._grid = null;
    this._gridMinX = 0;
    this._gridMinZ = 0;
    this._gridW = 0;
    this._gridH = 0;
    if (this._numSegments === 0) {
      this._length = 0;
      return;
    }
    const outH = new Float64Array(n * 3);
    const inH = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.computeHandles(points, i, inH, outH);
    }
    let s = 0;
    const p = [0, 0, 0];
    for (let seg = 0; seg < this._numSegments; seg++) {
      const a = points[seg].position;
      const j = (seg + 1) % n;
      const b = points[j].position;
      const o = seg * 12;
      this._bezier[o + 0] = a.x;
      this._bezier[o + 1] = a.y;
      this._bezier[o + 2] = a.z;
      this._bezier[o + 3] = a.x + outH[seg * 3];
      this._bezier[o + 4] = a.y + outH[seg * 3 + 1];
      this._bezier[o + 5] = a.z + outH[seg * 3 + 2];
      this._bezier[o + 6] = b.x + inH[j * 3];
      this._bezier[o + 7] = b.y + inH[j * 3 + 1];
      this._bezier[o + 8] = b.z + inH[j * 3 + 2];
      this._bezier[o + 9] = b.x;
      this._bezier[o + 10] = b.y;
      this._bezier[o + 11] = b.z;
      this._pointS[seg] = s;
      const lo = seg * (LUT_STEPS + 1);
      this._lut[lo] = s;
      let px = a.x;
      let py = a.y;
      let pz = a.z;
      for (let k = 1; k <= LUT_STEPS; k++) {
        this.evalPosition(seg, k / LUT_STEPS, p);
        s += Math.hypot(p[0] - px, p[1] - py, p[2] - pz);
        this._lut[lo + k] = s;
        px = p[0];
        py = p[1];
        pz = p[2];
      }
    }
    this._pointS[this._numSegments] = s;
    this._length = s;
  }
  /** Whether the road is a loop */
  get closed() {
    return this._closed;
  }
  /** Length of the center line */
  get length() {
    return this._length;
  }
  /** Number of control points */
  get numPoints() {
    return this._numPoints;
  }
  /** Number of Bezier segments */
  get numSegments() {
    return this._numSegments;
  }
  /**
   * Distance along the road of a control point
   * @param index - Point index
   */
  getPointS(index: number) {
    return this._pointS[Math.min(Math.max(index, 0), this._numSegments)] ?? 0;
  }
  /**
   * The Bezier control points of a segment
   * @param segment - Segment index, the segment starting at the point of the same index
   * @param out - Receives the four points
   */
  getSegmentBezier(segment: number, out: [Vector3, Vector3, Vector3, Vector3]) {
    const o = segment * 12;
    for (let i = 0; i < 4; i++) {
      out[i].setXYZ(this._bezier[o + i * 3], this._bezier[o + i * 3 + 1], this._bezier[o + i * 3 + 2]);
    }
    return out;
  }
  /**
   * Samples the road
   * @param s - Distance along the road, clamped to it (wrapped on a loop)
   * @param out - Receives the frame
   * @returns out
   */
  sample(s: number, out: RoadFrame): RoadFrame {
    if (this._numSegments === 0) {
      out.s = 0;
      out.width = this._numPoints > 0 ? this._widths[0] : 0;
      out.bank = this._numPoints > 0 ? this._banks[0] : 0;
      out.tangent.setXYZ(0, 0, -1);
      out.right.setXYZ(1, 0, 0);
      out.up.setXYZ(0, 1, 0);
      return out;
    }
    s = this.normalizeS(s);
    const seg = this.segmentAt(s);
    const t = this.segmentT(seg, s);
    const p = [0, 0, 0];
    const d = [0, 0, 0];
    this.evalPosition(seg, t, p);
    this.evalDerivative(seg, t, d);
    let dl = Math.hypot(d[0], d[1], d[2]);
    if (dl < EPS) {
      // Coincident handles: fall back to the chord
      const o = seg * 12;
      d[0] = this._bezier[o + 9] - this._bezier[o];
      d[1] = this._bezier[o + 10] - this._bezier[o + 1];
      d[2] = this._bezier[o + 11] - this._bezier[o + 2];
      dl = Math.hypot(d[0], d[1], d[2]);
      if (dl < EPS) {
        d[0] = 0;
        d[1] = 0;
        d[2] = -1;
        dl = 1;
      }
    }
    const tx = d[0] / dl;
    const ty = d[1] / dl;
    const tz = d[2] / dl;
    // right = tangent x up, horizontal
    let rx = -tz;
    let rz = tx;
    const rl = Math.hypot(rx, rz);
    if (rl < EPS) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    // unbanked up = right x tangent
    const ux = -rz * ty;
    const uy = rz * tx - rx * tz;
    const uz = rx * ty;
    const s0 = this._pointS[seg];
    const s1 = this._pointS[seg + 1];
    const u = smoothstep(s1 > s0 ? (s - s0) / (s1 - s0) : 0);
    const width = this._widths[seg] + (this._widths[seg + 1] - this._widths[seg]) * u;
    const bank = this._banks[seg] + (this._banks[seg + 1] - this._banks[seg]) * u;
    const c = Math.cos(bank);
    const sn = Math.sin(bank);
    // Rolled right; positive bank lifts it
    const brx = rx * c + ux * sn;
    const bry = uy * sn;
    const brz = rz * c + uz * sn;
    out.s = s;
    out.position.setXYZ(p[0], p[1], p[2]);
    out.tangent.setXYZ(tx, ty, tz);
    out.right.setXYZ(brx, bry, brz);
    // up = right x tangent
    out.up.setXYZ(bry * tz - brz * ty, brz * tx - brx * tz, brx * ty - bry * tx);
    out.width = width;
    out.bank = bank;
    return out;
  }
  /**
   * The closest center line point to a horizontal position, measured horizontally
   * @param x - X in the space of the road
   * @param z - Z in the space of the road
   * @param out - Receives the result
   * @returns out, or null for a road without segments
   */
  project(x: number, z: number, out: RoadProjection): Nullable<RoadProjection> {
    if (this._numSegments === 0) {
      return null;
    }
    this.ensurePolyline();
    const poly = this._polyline!;
    const grid = this._grid!;
    const cx = Math.floor((x - this._gridMinX) / GRID_CELL);
    const cz = Math.floor((z - this._gridMinZ) / GRID_CELL);
    // Rings of cells outside the grid hold nothing; start at the first that overlaps it
    const outside = Math.max(0, -cx, cx - this._gridW + 1, -cz, cz - this._gridH + 1);
    const maxRing = Math.max(cx, this._gridW - 1 - cx, cz, this._gridH - 1 - cz, 0);
    let best = Infinity;
    let bestSeg = -1;
    let bestT = 0;
    const visit = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= this._gridW || j >= this._gridH) {
        return;
      }
      const list = grid.get(j * this._gridW + i);
      if (!list) {
        return;
      }
      for (const seg of list) {
        const o = seg * 4;
        const ax = poly[o];
        const az = poly[o + 2];
        const dx = poly[o + 4] - ax;
        const dz = poly[o + 6] - az;
        const len2 = dx * dx + dz * dz;
        const t = len2 > EPS ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
        const ex = ax + dx * t - x;
        const ez = az + dz * t - z;
        const dist = ex * ex + ez * ez;
        if (dist < best) {
          best = dist;
          bestSeg = seg;
          bestT = t;
        }
      }
    };
    for (let r = outside; r <= maxRing; r++) {
      // Everything in ring r is at least (r - 1) cells away
      if (bestSeg >= 0 && Math.sqrt(best) < (r - 1) * GRID_CELL) {
        break;
      }
      if (r === 0) {
        visit(cx, cz);
        continue;
      }
      for (let i = -r; i <= r; i++) {
        visit(cx + i, cz - r);
        visit(cx + i, cz + r);
      }
      for (let j = -r + 1; j <= r - 1; j++) {
        visit(cx - r, cz + j);
        visit(cx + r, cz + j);
      }
    }
    if (bestSeg < 0) {
      return null;
    }
    const o = bestSeg * 4;
    const px = poly[o] + (poly[o + 4] - poly[o]) * bestT;
    const py = poly[o + 1] + (poly[o + 5] - poly[o + 1]) * bestT;
    const pz = poly[o + 2] + (poly[o + 6] - poly[o + 2]) * bestT;
    const dx = poly[o + 4] - poly[o];
    const dz = poly[o + 6] - poly[o + 2];
    const dl = Math.hypot(dx, dz);
    // Right of the direction of travel: (-dz, dx)
    const lateral = dl > EPS ? ((x - px) * -dz + (z - pz) * dx) / dl : 0;
    out.s = poly[o + 3] + (poly[o + 7] - poly[o + 3]) * bestT;
    out.position.setXYZ(px, py, pz);
    out.distance = Math.sqrt(best);
    out.lateral = lateral;
    return out;
  }
  /**
   * Visits the polyline segments of the center line near a horizontal position
   * @param x - X in the space of the road
   * @param z - Z in the space of the road
   * @param radius - Search radius
   * @param callback - Called with the polyline vertex data (x, y, z, s per vertex) and the index
   *   of the segment's first vertex; a segment may be visited more than once
   */
  forEachSegmentNear(
    x: number,
    z: number,
    radius: number,
    callback: (polyline: Float64Array, index: number) => void
  ) {
    if (this._numSegments === 0) {
      return;
    }
    this.ensurePolyline();
    const i0 = Math.max(0, Math.floor((x - radius - this._gridMinX) / GRID_CELL));
    const i1 = Math.min(this._gridW - 1, Math.floor((x + radius - this._gridMinX) / GRID_CELL));
    const j0 = Math.max(0, Math.floor((z - radius - this._gridMinZ) / GRID_CELL));
    const j1 = Math.min(this._gridH - 1, Math.floor((z + radius - this._gridMinZ) / GRID_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this._grid!.get(j * this._gridW + i);
        if (list) {
          for (const seg of list) {
            callback(this._polyline!, seg);
          }
        }
      }
    }
  }
  /**
   * The center line as a polyline
   * @param spacing - Distance between vertices
   * @returns x, y, z, s per vertex
   */
  getPolyline(spacing: number) {
    const count = this._length > 0 ? Math.max(1, Math.ceil(this._length / Math.max(spacing, 0.01))) : 0;
    const out = new Float64Array((count + 1) * 4);
    const frame = createRoadFrame();
    for (let k = 0; k <= count; k++) {
      const s = count > 0 ? (this._length * k) / count : 0;
      this.sample(s, frame);
      out[k * 4] = frame.position.x;
      out[k * 4 + 1] = frame.position.y;
      out[k * 4 + 2] = frame.position.z;
      out[k * 4 + 3] = s;
    }
    return out;
  }
  private normalizeS(s: number) {
    if (this._closed && this._length > 0) {
      s %= this._length;
      return s < 0 ? s + this._length : s;
    }
    return Math.min(Math.max(s, 0), this._length);
  }
  private segmentAt(s: number) {
    let lo = 0;
    let hi = this._numSegments - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this._pointS[mid] <= s) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
  private segmentT(seg: number, s: number) {
    const o = seg * (LUT_STEPS + 1);
    let lo = 0;
    let hi = LUT_STEPS - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this._lut[o + mid] <= s) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const a = this._lut[o + lo];
    const b = this._lut[o + lo + 1];
    const f = b > a ? Math.min(Math.max((s - a) / (b - a), 0), 1) : 0;
    return (lo + f) / LUT_STEPS;
  }
  private evalPosition(seg: number, t: number, out: number[]) {
    const o = seg * 12;
    const b = this._bezier;
    const mt = 1 - t;
    const c0 = mt * mt * mt;
    const c1 = 3 * mt * mt * t;
    const c2 = 3 * mt * t * t;
    const c3 = t * t * t;
    for (let i = 0; i < 3; i++) {
      out[i] = c0 * b[o + i] + c1 * b[o + 3 + i] + c2 * b[o + 6 + i] + c3 * b[o + 9 + i];
    }
  }
  private evalDerivative(seg: number, t: number, out: number[]) {
    const o = seg * 12;
    const b = this._bezier;
    const mt = 1 - t;
    const c0 = 3 * mt * mt;
    const c1 = 6 * mt * t;
    const c2 = 3 * t * t;
    for (let i = 0; i < 3; i++) {
      out[i] =
        c0 * (b[o + 3 + i] - b[o + i]) +
        c1 * (b[o + 6 + i] - b[o + 3 + i]) +
        c2 * (b[o + 9 + i] - b[o + 6 + i]);
    }
  }
  /** Handles of a point relative to it: stored, or from centripetal Catmull-Rom */
  private computeHandles(
    points: readonly RoadCurvePoint[],
    i: number,
    inH: Float64Array,
    outH: Float64Array
  ) {
    const n = points.length;
    const pt = points[i];
    if (pt.handleMode !== 'auto') {
      inH[i * 3] = pt.inHandle.x;
      inH[i * 3 + 1] = pt.inHandle.y;
      inH[i * 3 + 2] = pt.inHandle.z;
      outH[i * 3] = pt.outHandle.x;
      outH[i * 3 + 1] = pt.outHandle.y;
      outH[i * 3 + 2] = pt.outHandle.z;
      return;
    }
    const p = pt.position;
    let prev: [number, number, number];
    let next: [number, number, number];
    if (i > 0 || this._closed) {
      const q = points[(i - 1 + n) % n].position;
      prev = [q.x, q.y, q.z];
    } else {
      // Reflected neighbor: the road leaves the end towards the next point
      const q = points[1].position;
      prev = [2 * p.x - q.x, 2 * p.y - q.y, 2 * p.z - q.z];
    }
    if (i < n - 1 || this._closed) {
      const q = points[(i + 1) % n].position;
      next = [q.x, q.y, q.z];
    } else {
      const q = points[n - 2].position;
      next = [2 * p.x - q.x, 2 * p.y - q.y, 2 * p.z - q.z];
    }
    const d0 = Math.max(Math.pow(Math.hypot(p.x - prev[0], p.y - prev[1], p.z - prev[2]), ALPHA), EPS);
    const d1 = Math.max(Math.pow(Math.hypot(next[0] - p.x, next[1] - p.y, next[2] - p.z), ALPHA), EPS);
    const pc = [p.x, p.y, p.z];
    for (let k = 0; k < 3; k++) {
      // Derivative of the non-uniform Catmull-Rom spline (Barry-Goldman) at the point
      const m = (pc[k] - prev[k]) / d0 - (next[k] - prev[k]) / (d0 + d1) + (next[k] - pc[k]) / d1;
      outH[i * 3 + k] = (m * d1) / 3;
      inH[i * 3 + k] = (-m * d0) / 3;
    }
  }
  private ensurePolyline() {
    if (this._polyline) {
      return;
    }
    const poly = this.getPolyline(1);
    const count = poly.length / 4 - 1;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k <= count; k++) {
      minX = Math.min(minX, poly[k * 4]);
      maxX = Math.max(maxX, poly[k * 4]);
      minZ = Math.min(minZ, poly[k * 4 + 2]);
      maxZ = Math.max(maxZ, poly[k * 4 + 2]);
    }
    this._gridMinX = minX;
    this._gridMinZ = minZ;
    this._gridW = Math.max(1, Math.floor((maxX - minX) / GRID_CELL) + 1);
    this._gridH = Math.max(1, Math.floor((maxZ - minZ) / GRID_CELL) + 1);
    const grid = new Map<number, number[]>();
    for (let k = 0; k < count; k++) {
      const ax = poly[k * 4];
      const az = poly[k * 4 + 2];
      const bx = poly[k * 4 + 4];
      const bz = poly[k * 4 + 6];
      const i0 = Math.floor((Math.min(ax, bx) - minX) / GRID_CELL);
      const i1 = Math.floor((Math.max(ax, bx) - minX) / GRID_CELL);
      const j0 = Math.floor((Math.min(az, bz) - minZ) / GRID_CELL);
      const j1 = Math.floor((Math.max(az, bz) - minZ) / GRID_CELL);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = j * this._gridW + i;
          let list = grid.get(key);
          if (!list) {
            list = [];
            grid.set(key, list);
          }
          list.push(k);
        }
      }
    }
    this._polyline = poly;
    this._grid = grid;
  }
}
