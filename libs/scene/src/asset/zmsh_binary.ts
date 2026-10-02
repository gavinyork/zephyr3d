import type { VertexAttribFormat } from '@zephyr3d/device';
import type { PrimitiveType } from '@zephyr3d/device';

/**
 * Binary `.zmsh` container, version 2.
 *
 * Laid out like GLB: a fixed preamble, a JSON header describing the mesh, then
 * one binary blob holding every stream back to back.
 *
 * ```
 * u32 magic        'ZMSH' (0x48534d5a little endian)
 * u32 version      2
 * u32 headerLength byte length of the JSON header, a multiple of 4
 * u8[headerLength] JSON header (UTF-8, padded with spaces)
 * u8[...]          blob; every stream offset is relative to its start and 4-byte aligned
 * ```
 *
 * Streams are meshoptimizer-encoded when `encoding` is `meshopt` (the
 * KHR_meshopt_compression bitstream, decoded with `decodeGltfBuffer`), raw
 * otherwise. Version 1 is the JSON + base64 form, which readers keep accepting.
 *
 * @public
 */
export interface ZmshBinaryHeader {
  primitiveType: PrimitiveType;
  vertexCount: number;
  indexCount: number;
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  encoding: 'meshopt' | 'none';
  attributes: ZmshBinaryStream[];
  indices: ZmshBinaryIndexStream | null;
  /**
   * Levels of detail, finest first, each a range of the index stream drawing the shared vertices.
   * Absent for a single level, which draws all indexCount indices. The screen size of the first
   * level is not used.
   */
  lods?: ZmshBinaryLod[];
}

/**
 * One level of detail of a binary `.zmsh`, see {@link PrimitiveLod}.
 * @public
 */
export interface ZmshBinaryLod {
  indexStart: number;
  indexCount: number;
  screenSize: number;
  hysteresis: number;
}

/**
 * One vertex stream of a binary `.zmsh`.
 * @public
 */
export interface ZmshBinaryStream {
  format: VertexAttribFormat;
  /** Bytes per vertex; meshopt requires a multiple of 4 no larger than 256 */
  byteStride: number;
  /** meshopt filter the stream was encoded with: OCTAHEDRAL, QUATERNION, EXPONENTIAL or COLOR */
  filter?: string;
  offset: number;
  length: number;
}

/**
 * The index stream of a binary `.zmsh`.
 * @public
 */
export interface ZmshBinaryIndexStream {
  type: 'u16' | 'u32';
  /** meshopt mode: TRIANGLES for triangle lists, INDICES for any other topology */
  mode: 'TRIANGLES' | 'INDICES';
  offset: number;
  length: number;
}

/** @public */
export const ZMSH_MAGIC = 0x48534d5a;
/** @public */
export const ZMSH_BINARY_VERSION = 2;

const PREAMBLE_SIZE = 12;

function align4(n: number) {
  return (n + 3) & ~3;
}

/**
 * True if the data is a binary `.zmsh` rather than the JSON form.
 * @public
 */
export function isZmshBinary(data: ArrayBuffer) {
  return data.byteLength >= PREAMBLE_SIZE && new DataView(data).getUint32(0, true) === ZMSH_MAGIC;
}

/**
 * Assembles a binary `.zmsh`. Stream offsets and lengths in the header are
 * filled in from `attributeData` and `indexData`, which must be in the order of
 * `header.attributes`.
 * @public
 */
export function writeZmshBinary(
  header: Omit<ZmshBinaryHeader, 'attributes' | 'indices'> & {
    attributes: Omit<ZmshBinaryStream, 'offset' | 'length'>[];
    indices: Omit<ZmshBinaryIndexStream, 'offset' | 'length'> | null;
  },
  attributeData: Uint8Array[],
  indexData: Uint8Array | null
): ArrayBuffer {
  if (attributeData.length !== header.attributes.length) {
    throw new Error('writeZmshBinary(): one data array is needed per attribute');
  }
  if (!!indexData !== !!header.indices) {
    throw new Error('writeZmshBinary(): index data and index header must be given together');
  }
  let blobSize = 0;
  const place = (length: number) => {
    const offset = blobSize;
    blobSize = align4(blobSize + length);
    return { offset, length };
  };
  const full: ZmshBinaryHeader = {
    ...header,
    attributes: header.attributes.map((a, i) => ({ ...a, ...place(attributeData[i].byteLength) })),
    indices: header.indices ? { ...header.indices, ...place(indexData!.byteLength) } : null
  };
  const json = new TextEncoder().encode(JSON.stringify(full));
  const headerLength = align4(json.byteLength);
  const out = new Uint8Array(PREAMBLE_SIZE + headerLength + blobSize);
  const view = new DataView(out.buffer);
  view.setUint32(0, ZMSH_MAGIC, true);
  view.setUint32(4, ZMSH_BINARY_VERSION, true);
  view.setUint32(8, headerLength, true);
  out.fill(0x20, PREAMBLE_SIZE, PREAMBLE_SIZE + headerLength);
  out.set(json, PREAMBLE_SIZE);
  const blobStart = PREAMBLE_SIZE + headerLength;
  full.attributes.forEach((a, i) => out.set(attributeData[i], blobStart + a.offset));
  if (full.indices) {
    out.set(indexData!, blobStart + full.indices.offset);
  }
  return out.buffer;
}

/**
 * Splits a binary `.zmsh` into its header and stream views. Streams are returned
 * as stored, still encoded when the header says `meshopt`.
 * @public
 */
export function readZmshBinary(data: ArrayBuffer) {
  if (!isZmshBinary(data)) {
    throw new Error('Not a binary .zmsh file');
  }
  const view = new DataView(data);
  const version = view.getUint32(4, true);
  if (version !== ZMSH_BINARY_VERSION) {
    throw new Error(`Unsupported binary .zmsh version ${version}`);
  }
  const headerLength = view.getUint32(8, true);
  const blobStart = PREAMBLE_SIZE + headerLength;
  if (blobStart > data.byteLength) {
    throw new Error('Truncated binary .zmsh header');
  }
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, PREAMBLE_SIZE, headerLength))
  ) as ZmshBinaryHeader;
  const slice = (offset: number, length: number) => {
    if (blobStart + offset + length > data.byteLength) {
      throw new Error('Truncated binary .zmsh stream');
    }
    return new Uint8Array(data, blobStart + offset, length);
  };
  return {
    header,
    attributes: header.attributes.map((a) => slice(a.offset, a.length)),
    indices: header.indices ? slice(header.indices.offset, header.indices.length) : null
  };
}

/**
 * The subset of meshoptimizer's MeshoptDecoder the engine uses.
 * @public
 */
export interface MeshoptDecoderModule {
  ready: Promise<void>;
  decodeGltfBuffer(
    target: Uint8Array,
    count: number,
    size: number,
    source: Uint8Array,
    mode: string,
    filter?: string
  ): void;
}

/**
 * Decodes the streams of a binary `.zmsh` into raw vertex and index data, ready
 * for GPU upload.
 * @public
 */
export function decodeZmshBinary(data: ArrayBuffer, decoder: MeshoptDecoderModule | null) {
  const { header, attributes, indices } = readZmshBinary(data);
  const meshopt = header.encoding === 'meshopt';
  if (meshopt && !decoder) {
    throw new Error('A meshopt decoder is required for this .zmsh');
  }
  const vertexData = header.attributes.map((a, i) => {
    if (!meshopt) {
      return attributes[i];
    }
    const target = new Uint8Array(header.vertexCount * a.byteStride);
    decoder!.decodeGltfBuffer(
      target,
      header.vertexCount,
      a.byteStride,
      attributes[i],
      'ATTRIBUTES',
      a.filter
    );
    return target;
  });
  let indexData: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | null = null;
  if (header.indices && indices) {
    const size = header.indices.type === 'u16' ? 2 : 4;
    let bytes: Uint8Array;
    if (meshopt) {
      bytes = new Uint8Array(header.indexCount * size);
      decoder!.decodeGltfBuffer(bytes, header.indexCount, size, indices, header.indices.mode);
    } else {
      // Copy so the typed array is aligned regardless of where the stream sat in the file
      bytes = indices.slice();
    }
    indexData =
      size === 2
        ? new Uint16Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, header.indexCount)
        : new Uint32Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, header.indexCount);
  }
  return { header, vertexData, indexData };
}
