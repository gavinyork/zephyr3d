import type { VFS } from '@zephyr3d/base';
import { getAssetMetaPath } from '@zephyr3d/scene';

// Sidecar `.zmeta` files travel with their asset. They are hidden in the asset
// panel, so every file operation the panel offers has to carry them along;
// directory operations do so for free since the sidecar sits in the same folder.
// Failures are logged, never thrown: losing a sidecar only resets settings to
// their inferred defaults, which must not fail the operation the user asked for.

export async function moveAssetMeta(vfs: VFS, from: string, to: string) {
  const src = getAssetMetaPath(from);
  try {
    if (await vfs.exists(src)) {
      await vfs.move(src, getAssetMetaPath(to), { overwrite: true });
    }
  } catch (err) {
    console.warn(`Failed to move asset meta ${src}: ${err}`);
  }
}

export async function copyAssetMeta(vfs: VFS, from: string, to: string) {
  const src = getAssetMetaPath(from);
  try {
    if (await vfs.exists(src)) {
      await vfs.copyFile(src, getAssetMetaPath(to), { overwrite: true });
    }
  } catch (err) {
    console.warn(`Failed to copy asset meta ${src}: ${err}`);
  }
}

export async function deleteAssetMeta(vfs: VFS, path: string) {
  const meta = getAssetMetaPath(path);
  try {
    if (await vfs.exists(meta)) {
      await vfs.deleteFile(meta);
    }
  } catch (err) {
    console.warn(`Failed to delete asset meta ${meta}: ${err}`);
  }
}

/** Image formats the texture pipeline derives shipped textures from. Prebuilt GPU containers (DDS, KTX2) are shipped as they are. */
const TEXTURE_SOURCE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.hdr', '.exr'];

export function isTextureSourcePath(path: string) {
  const lower = path.toLowerCase();
  return TEXTURE_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
