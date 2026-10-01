import type { VFS } from '@zephyr3d/base';
import type { AssetSourceKind, AssetSourceResolver } from './assetmanager';

/**
 * Maps source paths to the files a build actually ships for them, so scenes keep
 * referencing `/assets/rock.png` or `/assets/rock.zmsh` while the player loads the
 * compressed copy derived from it. Written by the editor's build next to index.html.
 * @public
 */
export interface AssetManifest {
  version: 1;
  /** Texture source path to shipped path, both absolute VFS paths */
  textures: Record<string, string>;
  /** Primitive (.zmsh) source path to shipped path */
  primitives?: Record<string, string>;
}

/** File name of the manifest at the root of a build. @public */
export const ASSET_MANIFEST_FILE = 'asset-manifest.json';

const MIME_BY_EXTENSION: Record<string, string> = { '.ktx2': 'image/ktx2' };

/**
 * Creates an asset source resolver that serves the files listed in a manifest.
 * Paths missing from it load as usual.
 *
 * @param vfs - File system the shipped files are read from
 * @param manifest - The build's manifest
 *
 * @public
 */
export function createManifestSourceResolver(vfs: VFS, manifest: AssetManifest): AssetSourceResolver {
  const tables: Record<AssetSourceKind, Record<string, string>> = {
    texture: manifest?.textures ?? {},
    primitive: manifest?.primitives ?? {}
  };
  return async (url: string, kind: AssetSourceKind) => {
    const target = tables[kind]?.[vfs.normalizePath(url)];
    if (!target) {
      return null;
    }
    const dot = target.lastIndexOf('.');
    const mimeType = MIME_BY_EXTENSION[target.slice(dot).toLowerCase()] ?? vfs.guessMIMEType(target);
    return { data: (await vfs.readFile(target, { encoding: 'binary' })) as ArrayBuffer, mimeType };
  };
}

/**
 * Reads a build's manifest; null when there is none, which is the normal case
 * for projects run from source.
 * @public
 */
export async function readAssetManifest(vfs: VFS, path = `/${ASSET_MANIFEST_FILE}`) {
  try {
    if (!(await vfs.exists(path))) {
      return null;
    }
    const text = (await vfs.readFile(path, { encoding: 'utf8' })) as string;
    // Hosts that answer missing files with an HTML page (SPA fallback) are the
    // normal case for projects without a build manifest, not an error
    if (!text.trimStart().startsWith('{')) {
      return null;
    }
    const manifest = JSON.parse(text) as AssetManifest;
    return manifest?.version === 1 && manifest.textures ? manifest : null;
  } catch (err) {
    console.warn(`Ignoring unreadable asset manifest ${path}: ${err}`);
    return null;
  }
}
