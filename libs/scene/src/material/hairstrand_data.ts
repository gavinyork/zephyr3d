import type { GPUDataBuffer } from '@zephyr3d/device';
import { getDevice } from '../app/api';
import { Disposable, type Nullable } from '@zephyr3d/base';

/** Floats per control point in the GPU layout: position xyz plus width. */
const FLOATS_PER_POINT = 4;
/** Words per strand header in the GPU layout. */
const WORDS_PER_HEADER = 4;

/**
 * Source strands, as produced by a curve importer.
 *
 * @remarks
 * Control points are stored contiguously: strand `i` owns the `pointCounts[i]`
 * points starting at the running sum of the preceding counts, which is the same
 * layout Alembic uses.
 */
export type HairStrandSource = {
  /** Control point positions, 3 floats per point. */
  positions: Float32Array;
  /** Control point count per strand. */
  pointCounts: Int32Array | Uint32Array;
  /** Per-point width, or null to fall back to `defaultWidth`. */
  widths?: Nullable<Float32Array>;
  /** True when `widths` holds one value per strand rather than per point. */
  widthPerStrand?: boolean;
  /** Per-strand or per-point root UV, 2 floats each, or null. */
  uv?: Nullable<Float32Array>;
  /** Width used where the source provides none. Defaults to 0.0001. */
  defaultWidth?: number;
  /** Uniform scale applied to positions and widths. Defaults to 1. */
  scale?: number;
};

/**
 * GPU-resident strand geometry for {@link HairStrandMaterial}.
 *
 * @remarks
 * Strands live in storage buffers rather than vertex buffers, because the ribbon
 * geometry is generated in the vertex shader from the control points rather than
 * stored. That is what makes a full-density hair set affordable: the CPU-side
 * ribbon for a 69k-strand cap costs 266 MB of vertex data, while the control
 * points it was built from are around 20 MB.
 *
 * Two buffers:
 * - **Headers**, one per strand: first point index, point count, packed root UV,
 *   and a seed for per-strand variation.
 * - **Points**, one per control point: position and width.
 *
 * Both are read-only to the render pass. A simulation pass may write the point
 * buffer in place, which is why positions and widths are interleaved: a solver
 * touches position and leaves width alone, and keeping them in one buffer avoids
 * a second binding.
 * @public
 */
export class HairStrandData extends Disposable {
  /** @internal */
  private _headerBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private _pointBuffer: Nullable<GPUDataBuffer>;
  /** @internal */
  private readonly _strandCount: number;
  /** @internal */
  private readonly _pointCount: number;
  /** @internal */
  private readonly _maxPointsPerStrand: number;
  /**
   * Uploads strand geometry to the GPU.
   *
   * @param source - Strand control points and topology.
   */
  constructor(source: HairStrandSource) {
    super();
    const device = getDevice();
    const scale = source.scale ?? 1;
    const defaultWidth = source.defaultWidth ?? 0.0001;
    const counts = source.pointCounts;
    const strandCount = counts.length;
    let pointCount = 0;
    let maxPoints = 0;
    for (let i = 0; i < strandCount; i++) {
      const c = counts[i];
      pointCount += c;
      if (c > maxPoints) {
        maxPoints = c;
      }
    }
    if (strandCount === 0 || pointCount === 0) {
      throw new Error('HairStrandData: source contains no strands');
    }
    if (source.positions.length < pointCount * 3) {
      throw new Error(
        `HairStrandData: positions hold ${source.positions.length / 3} points, topology needs ${pointCount}`
      );
    }
    this._strandCount = strandCount;
    this._pointCount = pointCount;
    this._maxPointsPerStrand = maxPoints;

    const widths = source.widths ?? null;
    const widthPerStrand = !!source.widthPerStrand;
    const uv = source.uv ?? null;
    const uvPerPoint = !!uv && uv.length >= pointCount * 2;

    const points = new Float32Array(pointCount * FLOATS_PER_POINT);
    // Headers are read as uint in the shader, but the packed UV is a float bit
    // pattern, so the staging array is built as float and reinterpreted.
    const headers = new Uint32Array(strandCount * WORDS_PER_HEADER);
    const headerFloats = new Float32Array(headers.buffer);

    let first = 0;
    for (let s = 0; s < strandCount; s++) {
      const count = counts[s];
      for (let i = 0; i < count; i++) {
        const src = (first + i) * 3;
        const dst = (first + i) * FLOATS_PER_POINT;
        points[dst] = source.positions[src] * scale;
        points[dst + 1] = source.positions[src + 1] * scale;
        points[dst + 2] = source.positions[src + 2] * scale;
        let w = defaultWidth;
        if (widths) {
          w = widthPerStrand ? widths[s] : widths[first + i];
        }
        points[dst + 3] = w * scale;
      }
      const h = s * WORDS_PER_HEADER;
      headers[h] = first;
      headers[h + 1] = count;
      // Root UV, packed as two 16-bit unorm values.
      let u = 0;
      let v = 0;
      if (uv) {
        const o = uvPerPoint ? first * 2 : s * 2;
        u = uv[o];
        v = uv[o + 1];
      }
      headers[h + 2] = packUnorm2x16(u, v);
      // A cheap decorrelated seed, so per-strand jitter does not band across the
      // scalp. Written through the float view so the shader can read it directly.
      headerFloats[h + 3] = hashToUnitFloat(s);
      first += count;
    }

    // Unmanaged: the contents are uploaded once here, and a simulation pass may
    // later overwrite the point buffer on the GPU, so there is no CPU-side copy
    // worth keeping in sync.
    this._headerBuffer = device.createBuffer(headers.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    this._headerBuffer.bufferSubData(0, headers);
    this._pointBuffer = device.createBuffer(points.byteLength, {
      usage: 'uniform',
      storage: true,
      dynamic: false,
      managed: false
    });
    this._pointBuffer.bufferSubData(0, points);
  }
  /** Number of strands. */
  get strandCount() {
    return this._strandCount;
  }
  /** Total control point count across all strands. */
  get pointCount() {
    return this._pointCount;
  }
  /** Largest control point count of any single strand. */
  get maxPointsPerStrand() {
    return this._maxPointsPerStrand;
  }
  /** Per-strand header buffer. */
  get headerBuffer() {
    return this._headerBuffer;
  }
  /** Per-control-point buffer holding position and width. */
  get pointBuffer() {
    return this._pointBuffer;
  }
  /** Bytes of GPU memory held by the two buffers. */
  get byteLength() {
    return (this._headerBuffer?.byteLength ?? 0) + (this._pointBuffer?.byteLength ?? 0);
  }
  protected onDispose() {
    this._headerBuffer?.dispose();
    this._headerBuffer = null;
    this._pointBuffer?.dispose();
    this._pointBuffer = null;
  }
}

/** Packs two unit floats into one word as 16-bit unorms. @internal */
function packUnorm2x16(u: number, v: number) {
  const a = Math.max(0, Math.min(1, u)) * 65535 + 0.5;
  const b = Math.max(0, Math.min(1, v)) * 65535 + 0.5;
  return ((b & 0xffff) << 16) | (a & 0xffff);
}

/** Deterministic hash of a strand index into [0, 1). @internal */
function hashToUnitFloat(index: number) {
  let x = (index + 1) >>> 0;
  x = x ^ 61 ^ (x >>> 16);
  x = (x + (x << 3)) >>> 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d) >>> 0;
  x = x ^ (x >>> 15);
  return (x >>> 8) / 16777216;
}
