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
  /**
   * Precision of normals and tangents when compressed, or 0 to keep them as floats.
   * 8 bits ships them as snorm8 (4 bytes, up to 0.8 degrees off, visible as a
   * ragged terminator on smooth surfaces); 12 and 16 ship as snorm16 (8 bytes,
   * 0.05 and 0.004 degrees), 12 encoding notably smaller than 16.
   */
  normalBits: 0 | 8 | 12 | 16;
  /**
   * Generate levels of detail: coarser levels simplified from the source, stored as extra index
   * ranges over the same vertices. How many follows from {@link MeshImportSettings.lodMinTriangles}.
   */
  lodEnabled: boolean;
  /**
   * Fewest triangles a generated level may have. Levels are added while the next one keeps at
   * least this many, up to {@link MAX_MESH_LODS} levels including the source.
   */
  lodMinTriangles: number;
  /** Fraction of the source triangles each level keeps over the previous one, UE PercentTriangles per step */
  lodReduction: number;
  /**
   * Pixel error the automatic switch distances allow, UE ReductionSettings.PixelError: a level is
   * used once its simplification error projects to fewer pixels on a 1920 wide, 90 degree view
   */
  lodPixelError: number;
}

/** Most levels of detail a mesh can have, UE MAX_STATIC_MESH_LODS */
export const MAX_MESH_LODS = 8;

const COMPRESSIONS: readonly MeshCompression[] = ['none', 'meshopt'];
const NORMAL_BITS: readonly MeshImportSettings['normalBits'][] = [0, 8, 12, 16];

/**
 * Default mesh settings. Like textures, compression is opt-in. Normals default
 * to 12 bits: 8-bit error shows on smooth surfaces near the light terminator.
 * @public
 */
export function defaultMeshImportSettings(compression: MeshCompression = 'none'): MeshImportSettings {
  return {
    compression,
    normalBits: 12,
    lodEnabled: false,
    lodMinTriangles: 100,
    lodReduction: 0.5,
    lodPixelError: 8
  };
}

/**
 * Triangle count each level of detail aims for, the source first: level i keeps
 * `lodReduction^i` of the source triangles, and levels stop before one would fall below
 * `lodMinTriangles` or at {@link MAX_MESH_LODS}. Simplification may end the chain earlier when it
 * cannot reach a target, so this is the most levels the settings can give.
 * @public
 */
export function getMeshLodTargets(
  triangles: number,
  settings: Pick<MeshImportSettings, 'lodEnabled' | 'lodMinTriangles' | 'lodReduction'>
) {
  const targets = [triangles];
  if (settings.lodEnabled) {
    for (let i = 1; i < MAX_MESH_LODS; i++) {
      const target = Math.floor(triangles * settings.lodReduction ** i);
      if (target < settings.lodMinTriangles || target < 1) {
        break;
      }
      targets.push(target);
    }
  }
  return targets;
}

/**
 * Whether a mesh with these settings ships a derived copy instead of its source: when compressed
 * or when its source has enough triangles for a level of detail.
 * @param settings - Mesh settings
 * @param sourceTriangles - Triangles of the source mesh
 * @public
 */
export function meshNeedsDerivedCopy(settings: MeshImportSettings, sourceTriangles: number) {
  return settings.compression !== 'none' || getMeshLodTargets(sourceTriangles, settings).length > 1;
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
      : defaults.normalBits,
    lodEnabled: typeof v.lodEnabled === 'boolean' ? v.lodEnabled : defaults.lodEnabled,
    lodMinTriangles:
      Number.isInteger(v.lodMinTriangles) && (v.lodMinTriangles as number) >= 1
        ? (v.lodMinTriangles as number)
        : defaults.lodMinTriangles,
    lodReduction:
      typeof v.lodReduction === 'number' && v.lodReduction > 0 && v.lodReduction < 1
        ? v.lodReduction
        : defaults.lodReduction,
    lodPixelError:
      typeof v.lodPixelError === 'number' && v.lodPixelError > 0 ? v.lodPixelError : defaults.lodPixelError
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
