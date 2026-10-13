import { float2half, halfToFloat } from '@zephyr3d/base';
import type { MeshSDFData } from '../utility/sdf/bake';

/**
 * Binary `.zsdf` container: the signed distance field baked for a mesh.
 *
 * ```
 * u32 magic        'ZSDF' (0x4644535a little endian)
 * u32 version      1
 * u32 headerLength byte length of the JSON header, a multiple of 4
 * u8[headerLength] JSON header (UTF-8, padded with spaces)
 * u8[...]          voxel data, `resolution` x * y * z samples, x fastest
 * ```
 *
 * `encoding` `f16` stores one half float per voxel, the distance in the
 * mesh's local units. The field leaves room for sparse or quantized encodings.
 *
 * @public
 */
export interface ZsdfHeader {
  encoding: 'f16';
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  resolution: [number, number, number];
  voxelSize: number;
  meshBoxMin: [number, number, number];
  meshBoxMax: [number, number, number];
  twoSided: boolean;
  minDistance: number;
  maxDistance: number;
  /**
   * What the field was baked from, for the editor to tell a stale bake: the
   * content hash of the source mesh and the bake settings key.
   */
  source?: { hash: string; settings: string };
}

/** @public */
export const ZSDF_MAGIC = 0x4644535a;
/** @public */
export const ZSDF_VERSION = 1;

const PREAMBLE_SIZE = 12;

/**
 * True if the data is a `.zsdf`.
 * @public
 */
export function isZsdf(data: ArrayBuffer) {
  return data.byteLength >= PREAMBLE_SIZE && new DataView(data).getUint32(0, true) === ZSDF_MAGIC;
}

/**
 * Encodes a baked field as a `.zsdf`.
 * @public
 */
export function writeZsdf(sdf: MeshSDFData, source?: ZsdfHeader['source']): ArrayBuffer {
  const header: ZsdfHeader = {
    encoding: 'f16',
    boxMin: sdf.boxMin,
    boxMax: sdf.boxMax,
    resolution: sdf.resolution,
    voxelSize: sdf.voxelSize,
    meshBoxMin: sdf.meshBoxMin,
    meshBoxMax: sdf.meshBoxMax,
    twoSided: sdf.twoSided,
    minDistance: sdf.minDistance,
    maxDistance: sdf.maxDistance,
    ...(source ? { source } : {})
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headerLength = (json.byteLength + 3) & ~3;
  const count = sdf.distances.length;
  const out = new Uint8Array(PREAMBLE_SIZE + headerLength + count * 2);
  const view = new DataView(out.buffer);
  view.setUint32(0, ZSDF_MAGIC, true);
  view.setUint32(4, ZSDF_VERSION, true);
  view.setUint32(8, headerLength, true);
  out.fill(0x20, PREAMBLE_SIZE, PREAMBLE_SIZE + headerLength);
  out.set(json, PREAMBLE_SIZE);
  const voxels = new Uint16Array(out.buffer, PREAMBLE_SIZE + headerLength, count);
  for (let i = 0; i < count; i++) {
    voxels[i] = float2half(sdf.distances[i]);
  }
  return out.buffer;
}

/**
 * Splits a `.zsdf` into its header and its raw half-float voxels, as stored,
 * ready for upload to an `r16f` texture.
 * @public
 */
export function readZsdf(data: ArrayBuffer) {
  if (!isZsdf(data)) {
    throw new Error('Not a .zsdf file');
  }
  const view = new DataView(data);
  const version = view.getUint32(4, true);
  if (version !== ZSDF_VERSION) {
    throw new Error(`Unsupported .zsdf version ${version}`);
  }
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, PREAMBLE_SIZE, headerLength))
  ) as ZsdfHeader;
  if (header.encoding !== 'f16') {
    throw new Error(`Unsupported .zsdf encoding ${header.encoding}`);
  }
  const count = header.resolution[0] * header.resolution[1] * header.resolution[2];
  const start = PREAMBLE_SIZE + headerLength;
  if (start + count * 2 > data.byteLength) {
    throw new Error('Truncated .zsdf');
  }
  // Copy so the view is aligned and independent of the file buffer
  const voxels = new Uint16Array(data.slice(start, start + count * 2));
  return { header, voxels };
}

/**
 * Decodes a `.zsdf` into a {@link MeshSDFData} with float distances, for CPU queries.
 * @public
 */
export function decodeZsdf(data: ArrayBuffer): MeshSDFData {
  const { header, voxels } = readZsdf(data);
  const distances = new Float32Array(voxels.length);
  for (let i = 0; i < voxels.length; i++) {
    distances[i] = halfToFloat(voxels[i]);
  }
  return {
    boxMin: header.boxMin,
    boxMax: header.boxMax,
    resolution: header.resolution,
    voxelSize: header.voxelSize,
    meshBoxMin: header.meshBoxMin,
    meshBoxMax: header.meshBoxMax,
    twoSided: header.twoSided,
    minDistance: header.minDistance,
    maxDistance: header.maxDistance,
    distances
  };
}

/** Directory the baked fields of a project live in. @public */
export const MESH_SDF_DIR = '/assets/.sdf';

/**
 * Path of the field baked for a mesh asset: the asset path flattened into one
 * file name under {@link MESH_SDF_DIR}, so the runtime finds it without an index.
 * @param primitivePath - Asset path of the `.zmsh`, e.g. `/assets/models/car/chassis.zmsh`.
 * @public
 */
export function getMeshSDFPath(primitivePath: string) {
  const rel = primitivePath.replace(/^\/assets\//, '').replace(/^\/+/, '');
  return `${MESH_SDF_DIR}/${rel.replace(/[\\/]/g, '__')}.zsdf`;
}
