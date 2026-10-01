import type { VFS } from '@zephyr3d/base';
import { ASSET_META_VERSION, getAssetMetaPath } from './texture_settings';

/**
 * Vertex data encoding of a mesh: `none` ships the vertex buffers as they are,
 * `meshopt` stores them meshoptimizer-compressed with quantized attributes.
 * @public
 */
export type MeshCompression = 'none' | 'meshopt';

/**
 * Per-mesh import settings, stored in the `.zmeta` file beside a `.zmsh`.
 * @public
 */
export interface MeshImportSettings {
  compression: MeshCompression;
  /** Bits per normal and tangent component when compressed: 8, 16, or 0 to keep them as floats */
  normalBits: 0 | 8 | 16;
}

const COMPRESSIONS: readonly MeshCompression[] = ['none', 'meshopt'];
const NORMAL_BITS: readonly MeshImportSettings['normalBits'][] = [0, 8, 16];

/**
 * Default mesh settings. Like textures, compression is opt-in.
 * @public
 */
export function defaultMeshImportSettings(compression: MeshCompression = 'none'): MeshImportSettings {
  return { compression, normalBits: 8 };
}

/**
 * Validates parsed settings; anything missing or invalid falls back to the defaults.
 * @public
 */
export function normalizeMeshImportSettings(value: unknown): MeshImportSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const defaults = defaultMeshImportSettings();
  return {
    compression: COMPRESSIONS.includes(v.compression as MeshCompression)
      ? (v.compression as MeshCompression)
      : defaults.compression,
    normalBits: NORMAL_BITS.includes(v.normalBits as MeshImportSettings['normalBits'])
      ? (v.normalBits as MeshImportSettings['normalBits'])
      : defaults.normalBits
  };
}

/**
 * Reads the import settings of a mesh; without a `.zmeta` the mesh is not compressed.
 * @public
 */
export async function readMeshImportSettings(vfs: VFS, path: string): Promise<MeshImportSettings> {
  const metaPath = getAssetMetaPath(path);
  try {
    if (await vfs.exists(metaPath)) {
      const meta = JSON.parse((await vfs.readFile(metaPath, { encoding: 'utf8' })) as string);
      return normalizeMeshImportSettings(meta?.mesh);
    }
  } catch (err) {
    console.warn(`Ignoring unreadable asset meta ${metaPath}: ${err}`);
  }
  return defaultMeshImportSettings();
}

/**
 * Writes the import settings of a mesh to its `.zmeta` file.
 * @public
 */
export async function writeMeshImportSettings(vfs: VFS, path: string, settings: MeshImportSettings) {
  const content = JSON.stringify({ version: ASSET_META_VERSION, mesh: settings }, null, 2);
  await vfs.writeFile(getAssetMetaPath(path), content, { encoding: 'utf8', create: true });
}
