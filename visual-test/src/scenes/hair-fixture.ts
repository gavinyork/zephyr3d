/**
 * Synthesises HAIR files in memory, for the hair import scenes.
 *
 * @remarks
 * Deliberately fed from the same {@link SyntheticCurveSet} generators as the
 * Alembic fixtures, so the same control points can be pushed through both
 * container readers. That is the whole point of the HAIR scene: the two formats
 * describe the same strands, so the two baselines have to agree, and a
 * difference in either reader shows up as a difference between two pictures
 * rather than as an absolute judgement about one.
 *
 * See {@link https://www.cemyuksel.com/research/hairmodels/ | HAIR Model Files}
 * for the format.
 */
import type { SyntheticCurveSet } from './alembic-fixture';

/** Size of the fixed header, in bytes. */
const HEADER_SIZE = 128;
/** Bit flags for the `arrays` header field. */
const SEGMENTS_BIT = 1;
const POINTS_BIT = 2;
const THICKNESS_BIT = 4;
const UVS_BIT = 32;

/**
 * Writes the bytes of a HAIR file describing one curve set.
 *
 * @remarks
 * Every array the importer reads is written out rather than left to a header
 * default, because the defaults are the easy path: a file that carries real
 * per-point thickness and UVs exercises the cursor walking from one array to the
 * next, which is where a positional format goes wrong.
 *
 * Positions are written Z-up, which is the format's convention and so what the
 * importer undoes by default. Writing the generator's Y-up points verbatim and
 * telling the importer to leave them alone would be simpler and would test less:
 * the scene's whole value is that its picture must match the Alembic one, so
 * routing through the real conversion is what makes that match meaningful.
 *
 * @param set - Curve set to encode, in the engine's Y-up frame.
 * @returns File bytes, ready to hand to the importer as a Blob.
 */
export function buildHairFile(set: SyntheticCurveSet): ArrayBuffer {
  const strandCount = set.numVertices.length;
  let pointCount = 0;
  for (let i = 0; i < strandCount; i++) {
    pointCount += set.numVertices[i];
  }
  const size = HEADER_SIZE + strandCount * 2 + (pointCount * 3 + pointCount + pointCount * 2) * 4;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'HAIR');
  view.setUint32(4, strandCount, true);
  view.setUint32(8, pointCount, true);
  view.setUint32(12, SEGMENTS_BIT | POINTS_BIT | THICKNESS_BIT | UVS_BIT, true);
  // Defaults are unused here, but a real writer fills them in, and leaving them
  // at zero would hide a reader that took them when it should not have.
  view.setUint32(16, 1, true);
  view.setFloat32(20, 0.01, true);
  view.setFloat32(24, 0, true);
  view.setFloat32(28, 0.2, true);
  view.setFloat32(32, 0.12, true);
  view.setFloat32(36, 0.08, true);
  writeAscii(view, 40, 'zephyr3d visual-test fixture');

  let cursor = HEADER_SIZE;
  // Segment count, which is one less than the strand's control point count.
  for (let i = 0; i < strandCount; i++) {
    view.setUint16(cursor, set.numVertices[i] - 1, true);
    cursor += 2;
  }
  cursor = writePositionsAsZUp(view, cursor, set.positions, pointCount);
  cursor = writeFloats(view, cursor, set.width, pointCount);
  writeFloats(view, cursor, set.uv, pointCount * 2);
  return buffer;
}

/**
 * Writes Y-up positions in the format's Z-up frame.
 *
 * The inverse of the importer's conversion: Y-up to Z-up is `(x, y, z)` to
 * `(x, -z, y)`, so a round trip through the importer lands back where it started.
 */
function writePositionsAsZUp(view: DataView, offset: number, positions: Float32Array, pointCount: number) {
  for (let i = 0; i < pointCount; i++) {
    view.setFloat32(offset + i * 12, positions[i * 3], true);
    view.setFloat32(offset + i * 12 + 4, -positions[i * 3 + 2], true);
    view.setFloat32(offset + i * 12 + 8, positions[i * 3 + 1], true);
  }
  return offset + pointCount * 12;
}

function writeFloats(view: DataView, offset: number, values: Float32Array, count: number) {
  for (let i = 0; i < count; i++) {
    view.setFloat32(offset + i * 4, values[i], true);
  }
  return offset + count * 4;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i) & 0xff);
  }
}
