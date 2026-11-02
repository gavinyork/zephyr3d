import type { VFS } from '@zephyr3d/base';
import { getAssetMetaPath } from '@zephyr3d/scene';
import { getScenePipelineCachePath } from './pipelinecache';

// Sidecar `.zmeta` files, and the `.zpso` pipeline caches of scenes, travel with
// their asset. They are hidden in the asset
// panel, so every file operation the panel offers has to carry them along;
// directory operations do so for free since the sidecar sits in the same folder.
// Failures are logged, never thrown: losing a sidecar only resets settings to
// their inferred defaults, which must not fail the operation the user asked for.

/** Sidecar files an asset may have */
function getSidecarPaths(path: string) {
  return path.toLowerCase().endsWith('.zscn')
    ? [getAssetMetaPath(path), getScenePipelineCachePath(path)]
    : [getAssetMetaPath(path)];
}

export async function moveAssetMeta(vfs: VFS, from: string, to: string) {
  const targets = getSidecarPaths(to);
  for (const [index, src] of getSidecarPaths(from).entries()) {
    try {
      if (await vfs.exists(src)) {
        await vfs.move(src, targets[index], { overwrite: true });
      }
    } catch (err) {
      console.warn(`Failed to move asset meta ${src}: ${err}`);
    }
  }
}

export async function copyAssetMeta(vfs: VFS, from: string, to: string) {
  const targets = getSidecarPaths(to);
  for (const [index, src] of getSidecarPaths(from).entries()) {
    try {
      if (await vfs.exists(src)) {
        await vfs.copyFile(src, targets[index], { overwrite: true });
      }
    } catch (err) {
      console.warn(`Failed to copy asset meta ${src}: ${err}`);
    }
  }
}

export async function deleteAssetMeta(vfs: VFS, path: string) {
  for (const meta of getSidecarPaths(path)) {
    try {
      if (await vfs.exists(meta)) {
        await vfs.deleteFile(meta);
      }
    } catch (err) {
      console.warn(`Failed to delete asset meta ${meta}: ${err}`);
    }
  }
}

/** Image formats the texture pipeline derives shipped textures from. Prebuilt GPU containers (DDS, KTX2) are shipped as they are. */
const TEXTURE_SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.hdr', '.exr'];

export function isTextureSourcePath(path: string) {
  const lower = path.toLowerCase();
  return TEXTURE_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
