/**
 * Up-axis conversion for strand control points.
 *
 * @remarks
 * The engine is Y-up, but curve formats disagree: an XGen Alembic archive comes
 * out of Maya already Y-up, while every published `.hair` model is Z-up with
 * hair growing toward -Z. The conversion has to happen to the control points
 * themselves rather than to a node transform, because the GPU strand path reads
 * its point buffer as world space and never consults a matrix (see
 * `HairStrandMaterial`). A node rotation would therefore fix the CPU ribbon path
 * and silently do nothing for the strand path - the worse of the two failures,
 * since it looks like it worked.
 */

/**
 * Up axis of a source's coordinate system.
 *
 * @remarks
 * Names the convention the data is *in*, not the one it is converted to; the
 * target is always the engine's Y-up. `y` therefore means "already correct,
 * leave it alone".
 * @public
 */
export type StrandUpAxis = 'y' | 'z';

/**
 * Rotates control points from `upAxis` into the engine's Y-up frame, in place.
 *
 * @remarks
 * Z-up becomes Y-up by a -90 degree rotation about X, `(x, y, z)` to
 * `(x, z, -y)` - the same convention glTF uses for Z-up authoring tools. It is a
 * rotation rather than an axis swap, so the determinant stays positive and
 * triangle winding is unaffected.
 *
 * @param positions - Control point positions, 3 floats per point, modified in place.
 * @param upAxis - Up axis the positions are currently expressed in.
 * @returns The same array, for convenience.
 * @public
 */
export function convertStrandUpAxis(positions: Float32Array, upAxis: StrandUpAxis): Float32Array {
  if (upAxis === 'y') {
    return positions;
  }
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    positions[i + 1] = positions[i + 2];
    positions[i + 2] = -y;
  }
  return positions;
}
