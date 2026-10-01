import type { VFS } from '@zephyr3d/base';

/**
 * What a texture holds, which decides its colour space and how it compresses.
 *
 * - `color`: albedo, emissive and other colour data, sampled as sRGB
 * - `normal`: tangent-space normal maps
 * - `mask`: linear data such as occlusion/roughness/metallic packs, masks, height
 * - `hdr`: high dynamic range images (.hdr, .exr)
 * - `ui`: interface images, which keep sharp edges and are never block compressed
 *
 * @public
 */
export type TextureUsage = 'color' | 'normal' | 'mask' | 'hdr' | 'ui';

/**
 * Basis Universal encoding for a texture.
 *
 * `auto` picks from the usage: ETC1S for colour (small, block artefacts are hard
 * to see), UASTC for normals and masks (artefacts there get amplified by lighting
 * or leak between packed channels), none for HDR and UI.
 *
 * @public
 */
export type TextureCompression = 'auto' | 'etc1s' | 'uastc' | 'none';

/**
 * Encoder effort and fidelity: the ETC1S quality level or the UASTC rate-distortion setting.
 * @public
 */
export type TextureQuality = 'low' | 'normal' | 'high';

/**
 * Per-texture import settings, stored next to the source image in a `.zmeta` file.
 *
 * The source image is never modified; these settings only describe how the asset
 * pipeline derives the shipped texture from it.
 *
 * @public
 */
export interface TextureImportSettings {
  usage: TextureUsage;
  compression: TextureCompression;
  quality: TextureQuality;
  /** Largest allowed width or height in texels, 0 keeps the source size */
  maxSize: number;
  mipmaps: boolean;
}

/** Extension of asset sidecar files, appended to the asset's full file name. @public */
export const ASSET_META_EXTENSION = '.zmeta';

/** Current `.zmeta` format version. @public */
export const ASSET_META_VERSION = 1;

/** Usages that hold colour and are sampled as sRGB. */
const SRGB_USAGES: ReadonlySet<TextureUsage> = new Set(['color', 'ui']);

const USAGES: readonly TextureUsage[] = ['color', 'normal', 'mask', 'hdr', 'ui'];
const COMPRESSIONS: readonly TextureCompression[] = ['auto', 'etc1s', 'uastc', 'none'];
const QUALITIES: readonly TextureQuality[] = ['low', 'normal', 'high'];

/**
 * Path of the sidecar `.zmeta` file of an asset.
 * @public
 */
export function getAssetMetaPath(assetPath: string) {
  return `${assetPath}${ASSET_META_EXTENSION}`;
}

/**
 * True if a path is an asset sidecar file rather than an asset.
 * @public
 */
export function isAssetMetaPath(path: string) {
  return path.toLowerCase().endsWith(ASSET_META_EXTENSION);
}

/**
 * Whether textures of a usage are sampled as sRGB.
 * @public
 */
export function isSRGBTextureUsage(usage: TextureUsage) {
  return SRGB_USAGES.has(usage);
}

/**
 * Default settings for a usage.
 *
 * Compression is opt-in: a texture is only compressed when its settings say so,
 * so updating the engine or editor never changes how an existing project ships.
 * @public
 */
export function defaultTextureImportSettings(
  usage: TextureUsage,
  compression: TextureCompression = 'none'
): TextureImportSettings {
  return { usage, compression, quality: 'normal', maxSize: 0, mipmaps: usage !== 'ui' };
}

/**
 * The encoding a texture actually gets, with `auto` resolved from its usage.
 * @public
 */
export function resolveTextureCompression(settings: TextureImportSettings): 'etc1s' | 'uastc' | 'none' {
  if (settings.compression !== 'auto') {
    return settings.compression;
  }
  switch (settings.usage) {
    case 'color':
      return 'etc1s';
    case 'normal':
      return 'uastc';
    case 'mask':
      return settings.quality === 'low' ? 'etc1s' : 'uastc';
    default:
      return 'none';
  }
}

// File name tokens, matched whole after splitting on separators and case changes.
// Common suffix conventions of DCC tools and texture libraries (Substance,
// Quixel, Poly Haven, glTF samples). Only consulted when no material slot told
// the importer what the image is.
const NORMAL_TOKENS = new Set(['n', 'nrm', 'nor', 'norm', 'normal', 'normals', 'normalmap', 'nml']);
const MASK_TOKENS = new Set([
  'orm',
  'arm',
  'mra',
  'rma',
  'rough',
  'roughness',
  'metal',
  'metallic',
  'metalness',
  'ao',
  'occlusion',
  'ambientocclusion',
  'mask',
  'masks',
  'spec',
  'specular',
  'gloss',
  'glossiness',
  'height',
  'disp',
  'displacement',
  'bump',
  'opacity',
  'cavity',
  'thickness'
]);

function fileNameTokens(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Guesses the usage of a texture from its path, for images that arrive without
 * material context (dropped into the project, or referenced by no material).
 * @public
 */
export function inferTextureUsageFromPath(path: string): TextureUsage {
  const lower = path.toLowerCase();
  if (lower.endsWith('.hdr') || lower.endsWith('.exr')) {
    return 'hdr';
  }
  if (/(^|\/)ui\//.test(lower)) {
    return 'ui';
  }
  const tokens = fileNameTokens(path);
  // The last tokens carry the map type in suffix conventions ("rock_01_nrm")
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (NORMAL_TOKENS.has(tokens[i])) {
      return 'normal';
    }
    if (MASK_TOKENS.has(tokens[i])) {
      return 'mask';
    }
  }
  return 'color';
}

/**
 * Usage of an image referenced from a model material slot.
 *
 * @param slot - Material property holding the texture, e.g. `normalMap`
 * @param sRGB - Whether the importer samples the slot as sRGB
 *
 * @public
 */
export function inferTextureUsageFromSlot(slot: string, sRGB: boolean): TextureUsage {
  if (/normal/i.test(slot)) {
    return 'normal';
  }
  return sRGB ? 'color' : 'mask';
}

// When one image feeds several slots, the most demanding usage wins: a normal
// map compressed as colour loses far more than a colour map compressed as data.
const USAGE_PRIORITY: Record<TextureUsage, number> = { normal: 3, mask: 2, hdr: 2, color: 1, ui: 0 };

/**
 * Picks the usage that serves every slot an image is used in.
 * @public
 */
export function mergeTextureUsage(a: TextureUsage, b: TextureUsage): TextureUsage {
  return USAGE_PRIORITY[b] > USAGE_PRIORITY[a] ? b : a;
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Validates parsed settings, filling anything missing or invalid from the defaults
 * of the stored usage (or of `fallbackUsage` when the usage itself is unusable).
 * @public
 */
export function normalizeTextureImportSettings(
  value: unknown,
  fallbackUsage: TextureUsage
): TextureImportSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const usage = pick(v.usage, USAGES, fallbackUsage);
  const defaults = defaultTextureImportSettings(usage);
  const maxSize = Number(v.maxSize);
  return {
    usage,
    compression: pick(v.compression, COMPRESSIONS, defaults.compression),
    quality: pick(v.quality, QUALITIES, defaults.quality),
    maxSize: Number.isFinite(maxSize) && maxSize > 0 ? Math.floor(maxSize) : 0,
    mipmaps: typeof v.mipmaps === 'boolean' ? v.mipmaps : defaults.mipmaps
  };
}

/**
 * Reads the import settings of a texture. Without a `.zmeta` file (or with an
 * unreadable one) the texture is not compressed and its usage is inferred from
 * the path, so a texture that was never touched in the editor still has
 * well-defined settings that leave it exactly as it was.
 * @public
 */
export async function readTextureImportSettings(vfs: VFS, path: string): Promise<TextureImportSettings> {
  const fallbackUsage = inferTextureUsageFromPath(path);
  const metaPath = getAssetMetaPath(path);
  try {
    if (await vfs.exists(metaPath)) {
      const meta = JSON.parse((await vfs.readFile(metaPath, { encoding: 'utf8' })) as string);
      return normalizeTextureImportSettings(meta?.texture, fallbackUsage);
    }
  } catch (err) {
    console.warn(`Ignoring unreadable asset meta ${metaPath}: ${err}`);
  }
  return defaultTextureImportSettings(fallbackUsage);
}

/**
 * Writes the import settings of a texture to its `.zmeta` file.
 * @public
 */
export async function writeTextureImportSettings(vfs: VFS, path: string, settings: TextureImportSettings) {
  const content = JSON.stringify({ version: ASSET_META_VERSION, texture: settings }, null, 2);
  await vfs.writeFile(getAssetMetaPath(path), content, { encoding: 'utf8', create: true });
}
