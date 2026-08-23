/**
 * The `.zhair` container: strand geometry, ready to upload.
 *
 * @remarks
 * Hair reaches the engine as an Alembic curve archive or a `.hair` model, and
 * neither is cheap to open: the sample XGen archive is 84 MB of Ogawa container
 * holding two million control points, and parsing it means walking an object
 * tree and cross-checking property blocks before a single strand appears. Doing
 * that every time a scene loads is not viable, so the editor converts once and
 * writes this instead.
 *
 * The layout follows `.zabc`, the geometry cache container already in the tree:
 * a magic, a version, a JSON manifest, and then every large array concatenated
 * into one payload the manifest points into. The manifest stays readable for
 * debugging while the arrays are copied out by offset rather than decoded.
 *
 * What is stored is {@link StrandCurveSet} - the format-neutral shape both
 * importers already converge on - at **full authored density**. Thinning is a
 * property of the node that draws the hair, not of the file, so an artist can
 * pull strand count down for a distant character and back up for a close-up
 * without returning to the source archive.
 */
import type { Nullable } from '@zephyr3d/base';

/** The only version this module writes. @public */
export const ZHAIR_VERSION = 1;
/** Bytes before the manifest: magic, version, manifest length. @internal */
const ZHAIR_HEADER_SIZE = 12;

/**
 * Where one array sits inside the binary payload.
 *
 * @remarks
 * Both fields are byte counts, and `offset` is relative to the start of the
 * payload rather than the file, so the manifest does not have to be rewritten
 * if the header ever grows.
 * @public
 */
export type ZHairBufferRef = {
  /** Byte offset from the start of the payload. */
  offset: number;
  /** Length in bytes. */
  length: number;
};

/**
 * One strand set as described by the manifest.
 *
 * @remarks
 * Mirrors {@link StrandCurveSet}, with the per-point colour and transparency
 * channels a `.hair` file may carry. Control points are contiguous: strand `i`
 * owns the `pointCounts[i]` points following the running sum of the counts
 * before it.
 * @public
 */
export type ZHairStrandSetJSON = {
  /** Name carried over from the source object. */
  name: string;
  /** Number of strands. */
  strandCount: number;
  /** Total control points across all strands. */
  pointCount: number;
  /**
   * Axis-aligned bounds of the control points, as `[minX, minY, minZ, maxX,
   * maxY, maxZ]`.
   *
   * @remarks
   * In the file's own units, before `unitScale` is applied, so that a reader
   * can size a node without touching the payload.
   */
  bounds: [number, number, number, number, number, number];
  /** Control point positions, 3 float32 per point. */
  positions: ZHairBufferRef;
  /** Control point count per strand, 1 uint32 each. */
  pointCounts: ZHairBufferRef;
  /** Strand width as a diameter, in the same unit as `positions`. */
  widths?: ZHairBufferRef;
  /** True when `widths` holds one value per strand rather than per point. */
  widthPerStrand?: boolean;
  /** Root UV, 2 float32 each. */
  uv?: ZHairBufferRef;
  /** True when `uv` holds one pair per point rather than per strand. */
  uvPerPoint?: boolean;
  /** Per-point colour, 3 float32 each. Only `.hair` sources carry this. */
  colors?: ZHairBufferRef;
  /** Per-point transparency, 1 float32 each. Only `.hair` sources carry this. */
  transparency?: ZHairBufferRef;
};

/**
 * The manifest at the head of a `.zhair` file.
 * @public
 */
export type ZHairFileJSON = {
  /** Format version; {@link ZHAIR_VERSION} is the only one written. */
  version: number;
  /** Path of the archive this was converted from, for reimport. */
  sourcePath?: string;
  /** Container the strands came out of. */
  sourceFormat?: 'alembic' | 'hair';
  /**
   * Scale that converts the stored units to metres.
   *
   * @remarks
   * Decided at conversion time, because only the importer knows what the source
   * meant: Alembic from Maya is authored in centimetres, while `.hair` records
   * no unit at all and gets a scale fitted from its bounds. Positions are stored
   * unscaled so the number stays visible and adjustable.
   */
  unitScale: number;
  /** Strand sets, one per source curve object. */
  strandSets: ZHairStrandSetJSON[];
};

/**
 * A `.zhair` file, opened.
 * @public
 */
export type ParsedZHair = {
  /** The decoded manifest. */
  content: ZHairFileJSON;
  /** The whole file, which the buffer refs index into. */
  payload: ArrayBuffer;
  /** Byte offset of the payload within {@link ParsedZHair.payload}. */
  payloadOffset: number;
};

/**
 * One strand set on its way into a file.
 *
 * @remarks
 * Structurally a `StrandCurveSet` plus the two optional `.hair` channels, but
 * declared here rather than imported so this module stays free of a dependency
 * on the loaders package.
 * @public
 */
export type ZHairStrandSetSource = {
  /** Name for the strand set. */
  name?: string;
  /** Control point positions, 3 floats per point. */
  positions: Float32Array;
  /** Control point count per strand. */
  pointCounts: Int32Array | Uint32Array;
  /** Strand width as a diameter, or null when the source has none. */
  widths?: Nullable<Float32Array>;
  /** True when `widths` holds one value per strand. */
  widthPerStrand?: boolean;
  /** Root UV, 2 floats each, or null when absent. */
  uv?: Nullable<Float32Array>;
  /** True when `uv` holds one pair per point. */
  uvPerPoint?: boolean;
  /** Per-point colour, 3 floats each. */
  colors?: Nullable<Float32Array>;
  /** Per-point transparency. */
  transparency?: Nullable<Float32Array>;
};

/**
 * File-level facts that are not derivable from the strands themselves.
 * @public
 */
export type ZHairEncodeOptions = {
  /** Scale converting the stored units to metres. Defaults to 1. */
  unitScale?: number;
  /** Path of the source archive, recorded for reimport. */
  sourcePath?: string;
  /** Container the strands came from. */
  sourceFormat?: 'alembic' | 'hair';
};

/**
 * Packs strand sets into a `.zhair` file.
 *
 * @param sets - Strand sets to write, one per source curve object.
 * @param options - Unit scale and source provenance.
 * @returns The complete file.
 *
 * @public
 */
export function encodeZHair(sets: ZHairStrandSetSource[], options?: ZHairEncodeOptions): ArrayBuffer {
  if (sets.length === 0) {
    throw new Error('encodeZHair: no strand sets given');
  }
  // Two passes: the manifest has to carry the offset of every array, so the
  // payload is laid out first and the arrays are copied only once the total size
  // is known.
  const chunks: { data: ArrayBufferView; ref: ZHairBufferRef }[] = [];
  let payloadLength = 0;
  const place = (data: ArrayBufferView): ZHairBufferRef => {
    // Each array starts on a 4-byte boundary so a reader may view the payload
    // in place rather than copying, should it ever want to.
    payloadLength = (payloadLength + 3) & ~3;
    const ref: ZHairBufferRef = { offset: payloadLength, length: data.byteLength };
    chunks.push({ data, ref });
    payloadLength += data.byteLength;
    return ref;
  };

  const strandSets: ZHairStrandSetJSON[] = sets.map((set, index) => {
    const counts = set.pointCounts;
    const strandCount = counts.length;
    let pointCount = 0;
    for (let i = 0; i < strandCount; i++) {
      pointCount += counts[i];
    }
    if (strandCount === 0 || pointCount === 0) {
      throw new Error(`encodeZHair: strand set ${index} is empty`);
    }
    if (set.positions.length < pointCount * 3) {
      throw new Error(
        `encodeZHair: strand set ${index} holds ${
          set.positions.length / 3
        } points but its topology needs ${pointCount}`
      );
    }
    const json: ZHairStrandSetJSON = {
      name: set.name || `Strands${index}`,
      strandCount,
      pointCount,
      bounds: computeBounds(set.positions, pointCount),
      // Counts are stored as uint32 whatever the source used, so a reader has
      // one type to handle.
      positions: place(exactFloat32(set.positions, pointCount * 3)),
      pointCounts: place(toUint32(counts))
    };
    if (set.widths && set.widths.length > 0) {
      const expected = set.widthPerStrand ? strandCount : pointCount;
      json.widths = place(exactFloat32(set.widths, expected));
      if (set.widthPerStrand) {
        json.widthPerStrand = true;
      }
    }
    if (set.uv && set.uv.length > 0) {
      const perPoint = !!set.uvPerPoint;
      const expected = (perPoint ? pointCount : strandCount) * 2;
      json.uv = place(exactFloat32(set.uv, expected));
      if (perPoint) {
        json.uvPerPoint = true;
      }
    }
    if (set.colors && set.colors.length > 0) {
      json.colors = place(exactFloat32(set.colors, pointCount * 3));
    }
    if (set.transparency && set.transparency.length > 0) {
      json.transparency = place(exactFloat32(set.transparency, pointCount));
    }
    return json;
  });

  const manifest: ZHairFileJSON = {
    version: ZHAIR_VERSION,
    unitScale: options?.unitScale ?? 1,
    strandSets
  };
  if (options?.sourcePath) {
    manifest.sourcePath = options.sourcePath;
  }
  if (options?.sourceFormat) {
    manifest.sourceFormat = options.sourceFormat;
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  // The payload is aligned too, so every array inside it keeps the alignment the
  // layout pass gave it.
  const payloadOffset = (ZHAIR_HEADER_SIZE + manifestBytes.byteLength + 3) & ~3;
  const buffer = new ArrayBuffer(payloadOffset + payloadLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes[0] = 0x5a; // 'Z'
  bytes[1] = 0x48; // 'H'
  bytes[2] = 0x52; // 'R'
  bytes[3] = 0x00;
  view.setUint32(4, ZHAIR_VERSION, true);
  view.setUint32(8, manifestBytes.byteLength, true);
  bytes.set(manifestBytes, ZHAIR_HEADER_SIZE);
  for (const chunk of chunks) {
    bytes.set(
      new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength),
      payloadOffset + chunk.ref.offset
    );
  }
  return buffer;
}

/**
 * Opens a `.zhair` file.
 *
 * @remarks
 * Reads the manifest and keeps the buffer; the arrays themselves are not touched
 * until {@link readZHairPositions} and its siblings are called for them.
 *
 * @param buffer - The complete file.
 * @returns The manifest and the payload it indexes into.
 *
 * @public
 */
export function parseZHair(buffer: ArrayBuffer): ParsedZHair {
  if (!isZHair(buffer)) {
    throw new Error('parseZHair: not a zhair file');
  }
  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== ZHAIR_VERSION) {
    throw new Error(`parseZHair: unsupported zhair version ${version}`);
  }
  const manifestLength = view.getUint32(8, true);
  const manifestEnd = ZHAIR_HEADER_SIZE + manifestLength;
  if (manifestEnd > buffer.byteLength) {
    throw new Error('parseZHair: truncated manifest');
  }
  const manifestText = new TextDecoder().decode(new Uint8Array(buffer, ZHAIR_HEADER_SIZE, manifestLength));
  const content = JSON.parse(manifestText) as ZHairFileJSON;
  if (!Array.isArray(content.strandSets) || content.strandSets.length === 0) {
    throw new Error('parseZHair: manifest holds no strand sets');
  }
  return {
    content,
    payload: buffer,
    payloadOffset: (manifestEnd + 3) & ~3
  };
}

/**
 * Whether a buffer starts with the `.zhair` magic.
 *
 * @param buffer - Bytes to test.
 * @returns True when the buffer looks like a `.zhair` file.
 *
 * @public
 */
export function isZHair(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < ZHAIR_HEADER_SIZE) {
    return false;
  }
  const magic = new Uint8Array(buffer, 0, 4);
  return magic[0] === 0x5a && magic[1] === 0x48 && magic[2] === 0x52 && magic[3] === 0x00;
}

/**
 * Copies a float32 array out of the payload.
 *
 * @param parsed - The opened file.
 * @param ref - Where the array sits, from the manifest.
 * @returns A copy of the array, or null when `ref` is absent.
 *
 * @public
 */
export function readZHairFloats(
  parsed: ParsedZHair,
  ref: Nullable<ZHairBufferRef> | undefined
): Nullable<Float32Array> {
  if (!ref) {
    return null;
  }
  const start = parsed.payloadOffset + ref.offset;
  const end = start + ref.length;
  if (end > parsed.payload.byteLength) {
    throw new Error('readZHairFloats: buffer reference runs past the end of the file');
  }
  return new Float32Array(parsed.payload.slice(start, end));
}

/**
 * Copies a uint32 array out of the payload.
 *
 * @param parsed - The opened file.
 * @param ref - Where the array sits, from the manifest.
 * @returns A copy of the array.
 *
 * @public
 */
export function readZHairUints(parsed: ParsedZHair, ref: ZHairBufferRef): Uint32Array {
  const start = parsed.payloadOffset + ref.offset;
  const end = start + ref.length;
  if (end > parsed.payload.byteLength) {
    throw new Error('readZHairUints: buffer reference runs past the end of the file');
  }
  return new Uint32Array(parsed.payload.slice(start, end));
}

/** Bounds of the first `pointCount` points. @internal */
function computeBounds(
  positions: Float32Array,
  pointCount: number
): [number, number, number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
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
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

/**
 * Narrows a float array to exactly `length` values.
 *
 * @remarks
 * Sources routinely hand over arrays longer than the topology needs - a view
 * into a larger buffer, or trailing values a container padded. Writing the
 * excess would make the file disagree with its own point count.
 * @internal
 */
function exactFloat32(data: Float32Array, length: number): Float32Array {
  if (data.length === length && data.byteOffset === 0 && data.buffer.byteLength === data.byteLength) {
    return data;
  }
  if (data.length < length) {
    throw new Error(`encodeZHair: expected ${length} floats but the source holds ${data.length}`);
  }
  return data.slice(0, length);
}

/** Converts a count array to uint32, copying only when the type differs. @internal */
function toUint32(counts: Int32Array | Uint32Array): Uint32Array {
  if (counts instanceof Uint32Array && counts.byteOffset === 0) {
    return counts;
  }
  const out = new Uint32Array(counts.length);
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < 0) {
      throw new Error(`encodeZHair: strand ${i} has a negative point count`);
    }
    out[i] = counts[i];
  }
  return out;
}
