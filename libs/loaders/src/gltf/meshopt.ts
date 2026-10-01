import { getMeshoptDecoder } from '@zephyr3d/scene';
import type { MeshoptDecoderModule } from '@zephyr3d/scene';
import type { GLTFContent } from './gltf_importer';

interface MeshoptCompression {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride: number;
  count: number;
  mode: string;
  filter?: string;
}

/** @internal */
export const MESHOPT_EXTENSIONS = ['KHR_meshopt_compression', 'EXT_meshopt_compression'] as const;

function getMeshoptCompression(ext: Record<string, unknown> | undefined): MeshoptCompression | null {
  for (const name of MESHOPT_EXTENSIONS) {
    const info = ext?.[name];
    if (info) {
      return info as MeshoptCompression;
    }
  }
  return null;
}

/**
 * True if a buffer only exists as the uncompressed fallback of meshopt-compressed
 * buffer views. Such a buffer carries no data (and usually no uri); loaders that
 * understand the extension never read it.
 * @internal
 */
export function isMeshoptFallbackBuffer(buffer: { extensions?: Record<string, unknown> }) {
  return !!(getMeshoptCompression(buffer.extensions) as { fallback?: boolean } | null)?.fallback;
}

/**
 * True if any buffer view of the model is meshopt compressed.
 * @internal
 */
export function hasMeshoptBufferViews(gltf: GLTFContent) {
  return !!gltf.bufferViews?.some((view) => getMeshoptCompression(view.extensions));
}

/**
 * Returns meshoptimizer's decoder, the copy shipped with the scene package.
 * @internal
 */
export function loadMeshoptDecoder(): Promise<MeshoptDecoderModule> {
  return getMeshoptDecoder();
}

/**
 * Decompresses every meshopt-compressed buffer view in place.
 *
 * Implements KHR_meshopt_compression and EXT_meshopt_compression: the compressed
 * bytes are read from the extension's own buffer range and decoded to
 * `count * byteStride` bytes, which become a new loaded buffer that the view is
 * repointed at. The view keeps its byteLength and byteStride, which describe the
 * decoded data, so accessors read it exactly as if it had been stored plain.
 *
 * @param gltf - The model, with buffers already loaded
 * @param decoder - The meshoptimizer decoder
 *
 * @internal
 */
export function decodeMeshoptBufferViews(gltf: GLTFContent, decoder: MeshoptDecoderModule) {
  const loaded = gltf._loadedBuffers!;
  for (const view of gltf.bufferViews ?? []) {
    const ext = getMeshoptCompression(view.extensions);
    if (!ext) {
      continue;
    }
    const source = loaded[ext.buffer];
    const byteOffset = ext.byteOffset ?? 0;
    if (!source || source.byteLength < byteOffset + ext.byteLength) {
      throw new Error(
        `Invalid meshopt compressed buffer view: source buffer ${ext.buffer} is missing or too short`
      );
    }
    const target = new Uint8Array(ext.count * ext.byteStride);
    decoder.decodeGltfBuffer(
      target,
      ext.count,
      ext.byteStride,
      new Uint8Array(source, byteOffset, ext.byteLength),
      ext.mode,
      ext.filter
    );
    loaded.push(target.buffer);
    view.buffer = loaded.length - 1;
    view.byteOffset = 0;
  }
}
