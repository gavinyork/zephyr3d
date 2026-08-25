/**
 * Origin correction for strand control points.
 *
 * @remarks
 * A groom is combed in place on a character, so its control points carry
 * whatever offset the head had in the scene that authored them - an XGen archive
 * can easily sit tens of units away from its own origin. Imported as it stands,
 * the resulting node's transform says one thing and the hair appears somewhere
 * else entirely, and framing the node looks at empty space.
 *
 * Like the up-axis conversion this moves the control points rather than the
 * node, and for the same reason: the GPU strand path reads its point buffer as
 * world space and never consults a matrix (see `HairStrandMaterial`), so a
 * compensating node translation would fix the CPU ribbon path and silently do
 * nothing for the other - the worse of the two failures, since it looks like it
 * worked.
 */
import type { Nullable } from '@zephyr3d/base';

/**
 * The point of a groom's bounding box that import moves onto the origin.
 *
 * @remarks
 * Normalized to the box rather than measured in source units: per axis, 0 is the
 * box minimum and 1 its maximum, so `[0.5, 0.5, 0.5]` is the centre and
 * `[0.5, 0, 0.5]` the middle of its base. Values outside 0 to 1 extrapolate and
 * are allowed.
 * @public
 */
export type StrandOriginAnchor = [number, number, number];

/**
 * The part of a strand set origin correction reads.
 *
 * @remarks
 * Structural rather than the encoder's full strand set type, so the correction
 * can run over sets that have not been packed into a file yet.
 * @public
 */
export type StrandPositionSet = {
  /** Control point positions, 3 floats per point. */
  positions: Float32Array;
  /** Control point count per strand. */
  pointCounts: Int32Array | Uint32Array;
};

/**
 * Points a strand set's topology actually accounts for.
 *
 * @remarks
 * A position array may be longer than the topology needs, and the encoder trims
 * it on the way out. Whatever is past the end is not part of the groom, so it
 * must neither widen the bounds nor be moved.
 */
function usedPointCount(set: StrandPositionSet): number {
  let total = 0;
  for (let i = 0; i < set.pointCounts.length; i++) {
    total += set.pointCounts[i];
  }
  return Math.min(total, Math.floor(set.positions.length / 3));
}

/**
 * Bounding box enclosing every strand set, in the units the points are in.
 *
 * @remarks
 * All sets at once rather than one box each: an archive's curve objects are
 * parts of a single groom, and boxing them separately would shift them relative
 * to one another.
 *
 * @param sets - Strand sets to measure.
 * @returns `[minX, minY, minZ, maxX, maxY, maxZ]`, or null when the sets hold no
 *   finite points to measure.
 *
 * @public
 */
export function computeStrandSetsBounds(
  sets: StrandPositionSet[]
): Nullable<[number, number, number, number, number, number]> {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const set of sets) {
    const count = usedPointCount(set);
    const p = set.positions;
    for (let i = 0; i < count; i++) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      if (x < minX) {
        minX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (z < minZ) {
        minZ = z;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
      if (z > maxZ) {
        maxZ = z;
      }
    }
  }
  // Infinite bounds mean there were no points, or none that were finite; a NaN
  // in the archive would otherwise propagate into every control point below.
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY) ||
    !Number.isFinite(maxZ)
  ) {
    return null;
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

/**
 * Moves an anchor point of the sets' shared bounding box onto the origin.
 *
 * @remarks
 * Modifies the control points in place. Runs before the unit scale is recorded
 * and is unaffected by it, since scaling about the origin leaves a groom that
 * has been anchored there anchored there.
 *
 * @param sets - Strand sets to move, modified in place.
 * @param anchor - Point of the bounding box to bring to the origin.
 * @returns The offset added to every point, or null when the sets held nothing
 *   measurable and were left alone.
 *
 * @public
 */
export function applyStrandOriginAnchor(
  sets: StrandPositionSet[],
  anchor: StrandOriginAnchor
): Nullable<[number, number, number]> {
  const bounds = computeStrandSetsBounds(sets);
  if (!bounds) {
    return null;
  }
  const ax = Number.isFinite(anchor[0]) ? anchor[0] : 0;
  const ay = Number.isFinite(anchor[1]) ? anchor[1] : 0;
  const az = Number.isFinite(anchor[2]) ? anchor[2] : 0;
  const offsetX = -(bounds[0] + (bounds[3] - bounds[0]) * ax);
  const offsetY = -(bounds[1] + (bounds[4] - bounds[1]) * ay);
  const offsetZ = -(bounds[2] + (bounds[5] - bounds[2]) * az);
  if (offsetX === 0 && offsetY === 0 && offsetZ === 0) {
    return [0, 0, 0];
  }
  // Keyed by array identity: should two sets ever share one position buffer, it
  // must be shifted once, not once per set.
  const moved = new Set<Float32Array>();
  for (const set of sets) {
    if (moved.has(set.positions)) {
      continue;
    }
    moved.add(set.positions);
    const count = usedPointCount(set);
    const p = set.positions;
    for (let i = 0; i < count; i++) {
      p[i * 3] += offsetX;
      p[i * 3 + 1] += offsetY;
      p[i * 3 + 2] += offsetZ;
    }
  }
  return [offsetX, offsetY, offsetZ];
}
