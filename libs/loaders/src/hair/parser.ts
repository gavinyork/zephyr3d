/**
 * Parser for the HAIR model format (Cem Yuksel's `cyHairFile`).
 *
 * @remarks
 * The layout is fixed and positional: a 128-byte header, then the optional
 * arrays back to back in a defined order, with no names, no offsets and no
 * padding between them. That makes parsing a matter of walking a cursor, and it
 * makes a wrong assumption anywhere silently reinterpret everything that
 * follows - so the arrays that can be cross-checked are cross-checked, and every
 * read is bounds-tested against the file rather than trusted from the header.
 *
 * `cyHairFile` writes in the host's byte order and every published model, like
 * every machine that would open one, is little-endian.
 */
import type { Nullable } from '@zephyr3d/base';
import type { StrandUpAxis } from '../curves';
import { convertStrandUpAxis } from '../curves';
import {
  HAIR_ARRAY_COLORS,
  HAIR_ARRAY_POINTS,
  HAIR_ARRAY_SEGMENTS,
  HAIR_ARRAY_THICKNESS,
  HAIR_ARRAY_TRANSPARENCY,
  HAIR_ARRAY_UVS,
  HAIR_HEADER_SIZE,
  HAIR_INFO_SIZE,
  type HairFileHeader,
  type HairFileModel
} from './types';

/** Signature every HAIR file starts with. @internal */
const HAIR_SIGNATURE = 'HAIR';

/** Options for {@link parseHairFile}. @public */
export type ParseHairFileOptions = {
  /** Name for the resulting strand set. Defaults to `Hair`. */
  name?: string;
  /**
   * Up axis the file's control points are expressed in.
   *
   * @remarks
   * Defaults to `z`, which is what every published HAIR model uses and what the
   * format's own tooling writes - the header records no axis, so a convention is
   * the only thing available. Points are rotated into the engine's Y-up frame on
   * the way out; pass `y` for a file that is already Y-up, which leaves them
   * untouched.
   */
  upAxis?: StrandUpAxis;
};

/**
 * Parses a HAIR file.
 *
 * @remarks
 * Control points come back in the engine's Y-up frame, converted from the
 * format's Z-up convention unless `upAxis` says otherwise. The conversion is
 * done here rather than left to the caller because the GPU strand path consumes
 * this output directly, without a node transform that could carry it.
 *
 * @param buffer - Whole `.hair` file contents.
 * @param options - Naming and coordinate-system options.
 * @returns The decoded model.
 * @public
 */
export function parseHairFile(buffer: ArrayBuffer, options?: ParseHairFileOptions): HairFileModel {
  const name = options?.name ?? 'Hair';
  const upAxis = options?.upAxis ?? 'z';
  if (buffer.byteLength < HAIR_HEADER_SIZE) {
    throw new Error(
      `Not a HAIR file: ${buffer.byteLength} bytes is shorter than the ${HAIR_HEADER_SIZE}-byte header`
    );
  }
  const view = new DataView(buffer);
  const signature = readAscii(view, 0, 4);
  if (signature !== HAIR_SIGNATURE) {
    throw new Error(`Not a HAIR file (signature '${signature}', expected '${HAIR_SIGNATURE}')`);
  }
  const header = readHeader(view);
  // Each strand has at least one point, so a strand count above the point count
  // means the header was misread - and it is also the number the segment array
  // allocation is sized from, so it is checked before anything is allocated.
  if (header.strandCount === 0 || header.pointCount === 0) {
    throw new Error(
      `HAIR file is empty: ${header.strandCount} strand(s), ${header.pointCount} control point(s)`
    );
  }
  if (header.strandCount > header.pointCount) {
    throw new Error(
      `HAIR header is inconsistent: ${header.strandCount} strands cannot fit in ${header.pointCount} control points`
    );
  }

  const cursor = new Cursor(buffer, HAIR_HEADER_SIZE);

  // Point count per strand, which is one more than the segment count.
  const numVertices = new Int32Array(header.strandCount);
  if (header.arrays & HAIR_ARRAY_SEGMENTS) {
    const segments = cursor.uint16Array(header.strandCount, 'segments');
    for (let i = 0; i < header.strandCount; i++) {
      numVertices[i] = segments[i] + 1;
    }
  } else {
    numVertices.fill(header.defaultSegments + 1);
  }
  let totalPoints = 0;
  for (let i = 0; i < numVertices.length; i++) {
    totalPoints += numVertices[i];
  }
  // The first thing that goes wrong if the header or the segment array was read
  // incorrectly, and the last point at which the error is still legible: every
  // array after this one is sized from point_count, so a mismatch here turns into
  // arbitrary garbage rather than a diagnosable failure.
  if (totalPoints !== header.pointCount) {
    throw new Error(
      `HAIR topology is inconsistent: segments imply ${totalPoints} control points, header says ${header.pointCount}`
    );
  }

  if (!(header.arrays & HAIR_ARRAY_POINTS)) {
    throw new Error('HAIR file carries no point array, so it has no geometry to import');
  }
  const positions = convertStrandUpAxis(cursor.float32Array(header.pointCount * 3, 'points'), upAxis);

  let width: Float32Array;
  let widthPerCurve: boolean;
  if (header.arrays & HAIR_ARRAY_THICKNESS) {
    width = cursor.float32Array(header.pointCount, 'thickness');
    widthPerCurve = false;
  } else {
    // One value per strand rather than per point: the shared tessellator already
    // has a per-strand width path, and taking it costs strandCount floats instead
    // of pointCount for what is a single constant.
    width = new Float32Array(header.strandCount);
    width.fill(header.defaultThickness);
    widthPerCurve = true;
  }

  const transparency =
    header.arrays & HAIR_ARRAY_TRANSPARENCY ? cursor.float32Array(header.pointCount, 'transparency') : null;
  const colors =
    header.arrays & HAIR_ARRAY_COLORS ? cursor.float32Array(header.pointCount * 3, 'colors') : null;
  // Written only by newer versions of the format. Older files stop after the
  // colour array, and the bit is clear, so nothing is read.
  const uv: Nullable<Float32Array> =
    header.arrays & HAIR_ARRAY_UVS ? cursor.float32Array(header.pointCount * 2, 'uvs') : null;

  return {
    name,
    positions,
    numVertices,
    width,
    widthPerCurve,
    uv,
    totalPoints,
    header,
    sourceUpAxis: upAxis,
    transparency,
    colors
  };
}

/**
 * Decodes the fixed 128-byte header.
 * @internal
 */
function readHeader(view: DataView): HairFileHeader {
  return {
    strandCount: view.getUint32(4, true),
    pointCount: view.getUint32(8, true),
    arrays: view.getUint32(12, true),
    defaultSegments: view.getUint32(16, true),
    defaultThickness: view.getFloat32(20, true),
    defaultTransparency: view.getFloat32(24, true),
    defaultColor: [view.getFloat32(28, true), view.getFloat32(32, true), view.getFloat32(36, true)],
    info: readAscii(view, 40, HAIR_INFO_SIZE).replace(/\0[\s\S]*$/, '')
  };
}

/**
 * Reads a fixed-length byte range as ASCII.
 * @internal
 */
function readAscii(view: DataView, offset: number, length: number) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

/**
 * A bounds-checked forward cursor over the file's array section.
 *
 * @remarks
 * Every array is copied out rather than viewed in place. The segment array is
 * 16-bit and the header is 128 bytes, so an odd strand count leaves the point
 * array on a 2-byte boundary, where a `Float32Array` view over the original
 * buffer would throw. Copying also detaches the decoded arrays from the file
 * bytes, which lets the caller drop the whole download.
 *
 * The typed arrays read in host byte order rather than through a DataView, the
 * same trade the Alembic reader makes: a groom is a few million floats, and a
 * per-element `getFloat32` costs far more than the big-endian host it would
 * cover for is ever likely to be worth.
 * @internal
 */
class Cursor {
  /** @internal */
  private readonly _buffer: ArrayBuffer;
  /** @internal */
  private _offset: number;
  constructor(buffer: ArrayBuffer, offset: number) {
    this._buffer = buffer;
    this._offset = offset;
  }
  /** Reads `count` 32-bit floats. */
  float32Array(count: number, what: string) {
    return new Float32Array(this._take(count * 4, what));
  }
  /** Reads `count` unsigned 16-bit integers. */
  uint16Array(count: number, what: string) {
    return new Uint16Array(this._take(count * 2, what));
  }
  /**
   * Copies out the next `byteLength` bytes, failing if the file is too short.
   * @internal
   */
  private _take(byteLength: number, what: string) {
    const start = this._offset;
    const end = start + byteLength;
    if (end > this._buffer.byteLength) {
      throw new Error(
        `HAIR file is truncated: the '${what}' array needs ${byteLength} bytes at offset ${start}, but the file ends at ${this._buffer.byteLength}`
      );
    }
    this._offset = end;
    // slice() returns a fresh buffer starting at zero, so the typed array below
    // is always aligned no matter where the source range began.
    return this._buffer.slice(start, end);
  }
}
