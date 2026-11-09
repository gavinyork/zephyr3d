import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { RoadCurve } from './road_curve';
import { createRoadFrame } from './road_curve';

/**
 * Height above the ground of a shoulder lying over it, up to its skirt. While the shoulder still
 * shows some of the road it must not cross the ground: at a shallow angle the two surfaces would
 * fight for depth along a crossing line that wanders with every bump.
 */
const SHOULDER_CLEARANCE = 0.05;
/**
 * Fraction of the shoulder width where its skirt starts. The shoulder has faded out (alpha 0) by
 * then, wholly into the terrain with RoadShoulderMaterial; the skirt dips under the ground, so the
 * edge leaves no step in depth for screen space effects (contact shadows, ambient occlusion) to
 * draw a line along, and wherever it crosses the ground both sides look the same.
 */
const SKIRT_START = 0.9;
/**
 * Depth below the ground of the outer edge of the skirt; it has to stay under the terrain as drawn
 * in the distance too, where the clipmap takes its heights from coarser mips
 */
const SHOULDER_SINK = 0.15;
/**
 * Radius around a shoulder vertex the ground is sampled over, taking the highest: the ground
 * between vertices is drawn as triangles of the height map, which can bulge above a plane through
 * the heights at the vertices alone
 */
const GROUND_ENVELOPE_RADIUS = 0.5;
/** The inner side of a bend keeps within this fraction of the bend radius */
const FOLD_LIMIT = 0.9;

/**
 * Ground height in the space of the road at a horizontal position, or null where there is none
 * @public
 */
export type RoadGroundSampler = (x: number, z: number) => Nullable<number>;

/** @internal */
export interface RoadMeshOptions {
  spacing: number;
  chunkLength: number;
  shoulderWidth: number;
  uvTileLength: number;
  uvTileWidth: number;
  ground: Nullable<RoadGroundSampler>;
}

/** @internal */
export interface RoadMeshPart {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  tangents: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  colors: Nullable<Float32Array<ArrayBuffer>>;
  indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  min: Vector3;
  max: Vector3;
}

/** @internal */
export interface RoadChunkGeometry {
  s0: number;
  s1: number;
  surface: RoadMeshPart;
  shoulder: Nullable<RoadMeshPart>;
  colliderPositions: Float32Array<ArrayBuffer>;
  colliderIndices: Uint32Array<ArrayBuffer>;
}

/**
 * Measures of how drivable a road is
 * @public
 */
export interface RoadStats {
  /** Length of the center line */
  length: number;
  /** Smallest horizontal bend radius of the center line, Infinity for a straight road */
  minRadius: number;
  /** Where the smallest radius is */
  minRadiusS: number;
  /** Steepest grade of the center line, rise over horizontal run */
  maxGrade: number;
  /** Where the steepest grade is */
  maxGradeS: number;
  /** Largest bank in degrees */
  maxBank: number;
  /** Ranges of distance along the road where the inner side had to be narrowed in a tight bend */
  narrowed: [number, number][];
}

/** Center line samples with their frames and the extents of the cross section */
interface RoadSamples {
  count: number;
  /** Distance along the road for the texture, which on a loop goes on past the end */
  v: Float64Array;
  s: Float64Array;
  /** center, tangent, right, up per sample */
  frame: Float64Array;
  /** Signed horizontal curvature, positive when turning right */
  curvature: Float64Array;
  /** left and right half widths of the surface, then of the shoulders */
  extents: Float64Array;
  narrowed: Uint8Array;
}

function sampleRoad(curve: RoadCurve, spacing: number, shoulderWidth: number): RoadSamples {
  const length = curve.length;
  const steps = Math.max(1, Math.ceil(length / Math.max(spacing, 0.05)));
  const count = steps + 1;
  const s = new Float64Array(count);
  const v = new Float64Array(count);
  const frame = new Float64Array(count * 12);
  const widths = new Float64Array(count);
  const f = createRoadFrame();
  for (let k = 0; k < count; k++) {
    const sk = (length * k) / steps;
    curve.sample(sk, f);
    s[k] = sk;
    v[k] = sk;
    const o = k * 12;
    frame[o] = f.position.x;
    frame[o + 1] = f.position.y;
    frame[o + 2] = f.position.z;
    frame[o + 3] = f.tangent.x;
    frame[o + 4] = f.tangent.y;
    frame[o + 5] = f.tangent.z;
    frame[o + 6] = f.right.x;
    frame[o + 7] = f.right.y;
    frame[o + 8] = f.right.z;
    frame[o + 9] = f.up.x;
    frame[o + 10] = f.up.y;
    frame[o + 11] = f.up.z;
    widths[k] = f.width;
  }
  const curvature = new Float64Array(count);
  const closed = curve.closed;
  for (let k = 0; k < count; k++) {
    let a = k - 1;
    let b = k + 1;
    if (closed) {
      // The last sample is the first one again
      a = a < 0 ? count - 2 : a;
      b = b >= count ? 1 : b;
    } else {
      a = Math.max(a, 0);
      b = Math.min(b, count - 1);
    }
    if (a === b) {
      continue;
    }
    const ax = frame[a * 12 + 3];
    const az = frame[a * 12 + 5];
    const bx = frame[b * 12 + 3];
    const bz = frame[b * 12 + 5];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const ds = (b > a ? s[b] - s[a] : s[b] + length - s[a]) || 1;
    if (la > 1e-6 && lb > 1e-6) {
      // Rate of turn of the horizontal direction; heading -Z, turning towards +X is positive
      const sinA = (ax * bz - az * bx) / (la * lb);
      const cosA = (ax * bx + az * bz) / (la * lb);
      curvature[k] = Math.atan2(sinA, cosA) / ds;
    }
  }
  const extents = new Float64Array(count * 4);
  const narrowed = new Uint8Array(count);
  for (let k = 0; k < count; k++) {
    const h = widths[k] * 0.5;
    const total = h + shoulderWidth;
    let hl = h;
    let hr = h;
    let sl = shoulderWidth;
    let sr = shoulderWidth;
    const kappa = curvature[k];
    if (Math.abs(kappa) > 1e-6) {
      const limit = FOLD_LIMIT / Math.abs(kappa);
      if (total > limit) {
        const scale = limit / total;
        narrowed[k] = 1;
        // The bend center is on the right when turning right
        if (kappa > 0) {
          hr *= scale;
          sr *= scale;
        } else {
          hl *= scale;
          sl *= scale;
        }
      }
    }
    extents[k * 4] = hl;
    extents[k * 4 + 1] = hr;
    extents[k * 4 + 2] = sl;
    extents[k * 4 + 3] = sr;
  }
  return { count, v, s, frame, curvature, extents, narrowed };
}

/**
 * Measures a road
 * @internal
 */
export function measureRoad(curve: RoadCurve, spacing: number, shoulderWidth: number): RoadStats {
  const stats: RoadStats = {
    length: curve.length,
    minRadius: Infinity,
    minRadiusS: 0,
    maxGrade: 0,
    maxGradeS: 0,
    maxBank: 0,
    narrowed: []
  };
  if (curve.numSegments === 0) {
    return stats;
  }
  const samples = sampleRoad(curve, spacing, shoulderWidth);
  const f = createRoadFrame();
  let start = -1;
  for (let k = 0; k < samples.count; k++) {
    const kappa = Math.abs(samples.curvature[k]);
    if (kappa > 1e-9 && 1 / kappa < stats.minRadius) {
      stats.minRadius = 1 / kappa;
      stats.minRadiusS = samples.s[k];
    }
    const o = k * 12;
    const horiz = Math.hypot(samples.frame[o + 3], samples.frame[o + 5]);
    const grade = horiz > 1e-6 ? Math.abs(samples.frame[o + 4]) / horiz : Infinity;
    if (grade > stats.maxGrade) {
      stats.maxGrade = grade;
      stats.maxGradeS = samples.s[k];
    }
    curve.sample(samples.s[k], f);
    stats.maxBank = Math.max(stats.maxBank, (Math.abs(f.bank) * 180) / Math.PI);
    if (samples.narrowed[k] && start < 0) {
      start = samples.s[k];
    } else if (!samples.narrowed[k] && start >= 0) {
      stats.narrowed.push([start, samples.s[k - 1]]);
      start = -1;
    }
  }
  if (start >= 0) {
    stats.narrowed.push([start, samples.s[samples.count - 1]]);
  }
  return stats;
}

class PartBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly tangents: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  /**
   * Triangulates a grid of rows (along the road) by columns (left to right), facing up
   * @param skip - Column gap not to fill, between columns skip and skip + 1
   */
  grid(columns: number, rows: number, skip = -1) {
    for (let k = 0; k + 1 < rows; k++) {
      for (let j = 0; j + 1 < columns; j++) {
        if (j === skip) {
          continue;
        }
        const a = k * columns + j;
        const b = a + 1;
        const c = a + columns;
        const d = c + 1;
        this.indices.push(a, b, c, b, d, c);
      }
    }
  }
  build(withColors: boolean): RoadMeshPart {
    const positions = new Float32Array(this.positions);
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < positions.length; i += 3) {
      min.setXYZ(
        Math.min(min.x, positions[i]),
        Math.min(min.y, positions[i + 1]),
        Math.min(min.z, positions[i + 2])
      );
      max.setXYZ(
        Math.max(max.x, positions[i]),
        Math.max(max.y, positions[i + 1]),
        Math.max(max.z, positions[i + 2])
      );
    }
    const numVertices = positions.length / 3;
    return {
      positions,
      normals: new Float32Array(this.normals),
      tangents: new Float32Array(this.tangents),
      uvs: new Float32Array(this.uvs),
      colors: withColors ? new Float32Array(this.colors) : null,
      indices: numVertices > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
      min,
      max
    };
  }
}

/**
 * Builds the geometry of a road, in chunks along it
 * @internal
 */
export function buildRoadGeometry(curve: RoadCurve, options: RoadMeshOptions): RoadChunkGeometry[] {
  if (curve.numSegments === 0 || curve.length <= 0) {
    return [];
  }
  const shoulderWidth = Math.max(0, options.shoulderWidth);
  const samples = sampleRoad(curve, options.spacing, shoulderWidth);
  const tileW = Math.max(options.uvTileWidth, 0.01);
  let tileL = Math.max(options.uvTileLength, 0.01);
  if (curve.closed) {
    // A whole number of repeats, so the texture meets itself where the loop closes
    tileL = curve.length / Math.max(1, Math.round(curve.length / tileL));
  }
  const sampler = options.ground;
  const ground: Nullable<RoadGroundSampler> = sampler
    ? (x, z) => {
        let h = sampler(x, z);
        if (h === null) {
          return null;
        }
        const r = GROUND_ENVELOPE_RADIUS;
        const d = r * Math.SQRT1_2;
        for (const [ox, oz] of [
          [r, 0],
          [-r, 0],
          [0, r],
          [0, -r],
          [d, d],
          [d, -d],
          [-d, d],
          [-d, -d]
        ]) {
          const g = sampler(x + ox, z + oz);
          if (g !== null && g > h) {
            h = g;
          }
        }
        return h;
      }
    : null;
  const steps = samples.count - 1;
  const stepLength = curve.length / steps;
  const perChunk = Math.max(1, Math.round(Math.max(options.chunkLength, stepLength) / stepLength));
  const chunks: RoadChunkGeometry[] = [];
  // Cross section, left to right: outer edge (under the ground), skirt, middle and inner edge of
  // the left shoulder, two points inside the surface, then the right shoulder mirrored
  const COLUMNS = 10;
  const SHOULDER_COLUMNS = [0, 1, 2, 3, 6, 7, 8, 9];
  const lat = new Float64Array(COLUMNS);
  const px = new Float64Array(COLUMNS);
  const py = new Float64Array(COLUMNS);
  const pz = new Float64Array(COLUMNS);
  const nrm = [0, 0, 0];
  for (let k0 = 0; k0 < steps; k0 += perChunk) {
    const k1 = Math.min(k0 + perChunk, steps);
    const surface = new PartBuilder();
    const shoulder = shoulderWidth > 0 ? new PartBuilder() : null;
    const collider = new PartBuilder();
    for (let k = k0; k <= k1; k++) {
      const o = k * 12;
      const cx = samples.frame[o];
      const cy = samples.frame[o + 1];
      const cz = samples.frame[o + 2];
      const tx = samples.frame[o + 3];
      const ty = samples.frame[o + 4];
      const tz = samples.frame[o + 5];
      const rx = samples.frame[o + 6];
      const ry = samples.frame[o + 7];
      const rz = samples.frame[o + 8];
      const ux = samples.frame[o + 9];
      const uy = samples.frame[o + 10];
      const uz = samples.frame[o + 11];
      const hl = samples.extents[k * 4];
      const hr = samples.extents[k * 4 + 1];
      const sl = samples.extents[k * 4 + 2];
      const sr = samples.extents[k * 4 + 3];
      lat[0] = -(hl + sl);
      lat[1] = -(hl + sl * SKIRT_START);
      lat[2] = -(hl + sl * 0.5);
      lat[3] = -hl;
      lat[4] = -hl / 3;
      lat[5] = hr / 3;
      lat[6] = hr;
      lat[7] = hr + sr * 0.5;
      lat[8] = hr + sr * SKIRT_START;
      lat[9] = hr + sr;
      for (let j = 0; j < COLUMNS; j++) {
        px[j] = cx + rx * lat[j];
        py[j] = cy + ry * lat[j];
        pz[j] = cz + rz * lat[j];
      }
      // Each shoulder runs from the road edge down to just above the ground, then its skirt dips
      // under it
      for (const [mid, skirt, outer] of [
        [2, 1, 0],
        [7, 8, 9]
      ]) {
        const gm = ground ? ground(px[mid], pz[mid]) : null;
        if (gm !== null) {
          py[mid] = Math.max(py[mid], gm + SHOULDER_CLEARANCE);
        }
        const gs = ground ? ground(px[skirt], pz[skirt]) : null;
        if (gs !== null) {
          py[skirt] = gs + SHOULDER_CLEARANCE;
        }
        // The plain height, not the highest around, which would leave the edge above a dip
        const go = sampler ? sampler(px[outer], pz[outer]) : null;
        if (go !== null) {
          py[outer] = go - SHOULDER_SINK;
        }
      }
      const v = samples.v[k] / tileL;
      for (let j = 3; j <= 6; j++) {
        surface.positions.push(px[j], py[j], pz[j]);
        surface.normals.push(ux, uy, uz);
        // u grows to the right and v along the road, so cross(normal, tangent) points along +v
        surface.tangents.push(rx, ry, rz, 1);
        surface.uvs.push(0.5 + lat[j] / tileW, v);
      }
      if (shoulder) {
        for (const j of SHOULDER_COLUMNS) {
          shoulder.positions.push(px[j], py[j], pz[j]);
          shoulder.uvs.push(0.5 + lat[j] / tileW, v);
          const alpha = j === 3 || j === 6 ? 1 : j === 2 || j === 7 ? 0.5 : 0;
          shoulder.colors.push(1, 1, 1, alpha);
          if (j === 3 || j === 6) {
            shoulder.normals.push(ux, uy, uz);
            shoulder.tangents.push(rx, ry, rz, 1);
            continue;
          }
          // Across the shoulder to the right between the neighbours on the same side, then the
          // normal is across x tangent
          const a = j < 3 ? Math.max(j - 1, 0) : j - 1;
          const b = j < 3 ? j + 1 : Math.min(j + 1, COLUMNS - 1);
          let ax = px[b] - px[a];
          let ay = py[b] - py[a];
          let az = pz[b] - pz[a];
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al;
          ay /= al;
          az /= al;
          nrm[0] = ay * tz - az * ty;
          nrm[1] = az * tx - ax * tz;
          nrm[2] = ax * ty - ay * tx;
          const nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
          const sign = nrm[1] < 0 ? -1 : 1;
          shoulder.normals.push((sign * nrm[0]) / nl, (sign * nrm[1]) / nl, (sign * nrm[2]) / nl);
          shoulder.tangents.push(ax, ay, az, 1);
        }
      }
      if (shoulder) {
        for (let j = 0; j < COLUMNS; j++) {
          collider.positions.push(px[j], py[j], pz[j]);
        }
      } else {
        for (let j = 3; j <= 6; j++) {
          collider.positions.push(px[j], py[j], pz[j]);
        }
      }
    }
    const rows = k1 - k0 + 1;
    surface.grid(4, rows);
    // No triangles across the surface, between the inner edges of the two shoulders
    shoulder?.grid(SHOULDER_COLUMNS.length, rows, 3);
    collider.grid(shoulder ? COLUMNS : 4, rows);
    chunks.push({
      s0: samples.s[k0],
      s1: samples.s[k1],
      surface: surface.build(false),
      shoulder: shoulder?.build(true) ?? null,
      colliderPositions: new Float32Array(collider.positions),
      colliderIndices: new Uint32Array(collider.indices)
    });
  }
  return chunks;
}
