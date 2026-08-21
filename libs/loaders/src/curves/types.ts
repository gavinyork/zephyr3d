/**
 * Format-neutral strand curve data.
 *
 * @remarks
 * Hair arrives in more than one container - an Alembic curve archive from XGen,
 * a `.hair` model from the cyHairFile format - but once the container is peeled
 * away every one of them describes the same thing: a run of control points, a
 * per-strand point count that slices it up, and optional width and root UV.
 * Everything downstream of parsing works on this shape, so a new container only
 * has to produce it rather than bring its own tessellator.
 */
import type { Nullable } from '@zephyr3d/base';

/**
 * One set of strands, decoded into flat typed arrays.
 *
 * @remarks
 * Control points are stored contiguously: strand `i` owns the `numVertices[i]`
 * points starting at the running sum of the preceding counts.
 * @public
 */
export type StrandCurveSet = {
  /** Name used for the generated node and primitive. */
  name: string;
  /** Control point positions, 3 floats per point. */
  positions: Float32Array;
  /** Control point count for each strand. */
  numVertices: Int32Array | Uint32Array;
  /**
   * Strand width, or null when the source provides none.
   *
   * @remarks
   * Interpreted as a diameter in the same linear unit as `positions`.
   */
  width: Nullable<Float32Array>;
  /** True when `width` holds one value per strand rather than per point. */
  widthPerCurve: boolean;
  /** Per-strand or per-point root UV, 2 floats each, or null when absent. */
  uv: Nullable<Float32Array>;
  /** Total control point count, that is the sum of `numVertices`. */
  totalPoints: number;
};
