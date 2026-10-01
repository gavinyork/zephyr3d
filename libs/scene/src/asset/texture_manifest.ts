import type { VFS } from '@zephyr3d/base';
import type { TextureSourceResolver } from './assetmanager';

/**
 * Maps texture source paths to the files a build actually ships for them, so
 * scenes keep referencing `/assets/rock.png` while the player loads the KTX2
 * derived from it. Written by the editor's build next to index.html.
 * @public
 */
export interface TextureManifest {
  version: 1;
  /** Source path to shipped path, both absolute VFS paths */
  textures: Record<string, string>;
}

/** File name of the manifest at the root of a build. @public */
export const TEXTURE_MANIFEST_FILE = 'asset-manifest.json';

const MIME_BY_EXTENSION: Record<string, string> = { '.ktx2': 'image/ktx2' };

/**
 * Creates a texture source resolver that serves the files listed in a manifest.
 * Paths missing from it load as usual.
 *
 * @param vfs - File system the shipped files are read from
 * @param manifest - The build's manifest
 *
 * @public
 */
export function createManifestTextureResolver(vfs: VFS, manifest: TextureManifest): TextureSourceResolver {
  const textures = manifest?.textures ?? {};
  return async (url: string) => {
    const target = textures[vfs.normalizePath(url)];
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
export async function readTextureManifest(vfs: VFS, path = `/${TEXTURE_MANIFEST_FILE}`) {
  try {
    if (!(await vfs.exists(path))) {
      return null;
    }
    const manifest = JSON.parse(
      (await vfs.readFile(path, { encoding: 'utf8' })) as string
    ) as TextureManifest;
    return manifest?.version === 1 && manifest.textures ? manifest : null;
  } catch (err) {
    console.warn(`Ignoring unreadable texture manifest ${path}: ${err}`);
    return null;
  }
}
