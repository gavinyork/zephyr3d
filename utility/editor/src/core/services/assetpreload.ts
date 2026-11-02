import type { VFS } from '@zephyr3d/base';
import type { AssetPreloadData, AssetRequest } from '@zephyr3d/scene';
import { getEngine } from '@zephyr3d/scene';

// The assets a scene fetches while it loads, kept beside it as `<scene>.zpreload`,
// so a loading screen can load them first with a known total. The `static` group
// is what loading the saved scene fetches, recorded again each time the editor
// opens it and when a build loads every scene; the `runtime` group adds what
// scripts fetch while the scene loads, recorded by "record pipelines" previews.

export const PRELOAD_EXTENSION = '.zpreload';
export type PreloadGroup = 'static' | 'runtime';

export function getScenePreloadPath(scenePath: string) {
  return `${scenePath}${PRELOAD_EXTENSION}`;
}

/** Whether a path is the preload list beside a scene */
export function isScenePreloadPath(path: string) {
  return path.toLowerCase().endsWith(`.zscn${PRELOAD_EXTENSION}`);
}

let suppressed = 0;

/**
 * Runs code whose fetches are not the scene's, such as asset thumbnails, without
 * them being recorded. Fetches report themselves when they are called, so only the
 * synchronous part of `fn` needs to be covered
 */
export function withoutPreloadRecording<T>(fn: () => T): T {
  suppressed++;
  try {
    return fn();
  } finally {
    suppressed--;
  }
}

function getRequestKey(request: AssetRequest) {
  return `${request.type}:${request.url}:${JSON.stringify(request.options ?? null)}`;
}

/** Records the fetches made while `load` runs */
export async function recordAssetRequests<T>(load: () => Promise<T>) {
  const assetManager = getEngine().resourceManager.assetManager;
  const requests = new Map<string, AssetRequest>();
  const listener = (request: AssetRequest) => {
    if (suppressed === 0) {
      requests.set(getRequestKey(request), request);
    }
  };
  assetManager.addRequestListener(listener);
  try {
    const result = await load();
    return { result, requests: [...requests.values()] };
  } finally {
    assetManager.removeRequestListener(listener);
  }
}

export async function readScenePreload(vfs: VFS, scenePath: string): Promise<AssetPreloadData | null> {
  const path = getScenePreloadPath(scenePath);
  try {
    if (await vfs.exists(path)) {
      const data = JSON.parse((await vfs.readFile(path, { encoding: 'utf8' })) as string) as AssetPreloadData;
      if (data?.format === 'zephyr3d-preload') {
        return data;
      }
    }
  } catch (err) {
    console.warn(`Preload list ${path} unreadable: ${err}`);
  }
  return null;
}

/**
 * Stores the requests of a group of a scene's preload list: the `static` group is
 * replaced, the `runtime` group grows
 */
export async function writeScenePreload(
  vfs: VFS,
  scenePath: string,
  group: PreloadGroup,
  requests: AssetRequest[]
) {
  if (vfs.readOnly) {
    return;
  }
  const data: AssetPreloadData = (await readScenePreload(vfs, scenePath)) ?? {
    format: 'zephyr3d-preload',
    version: 1,
    groups: {}
  };
  let list = requests;
  if (group === 'runtime') {
    const merged = new Map((data.groups.runtime ?? []).map((request) => [getRequestKey(request), request]));
    for (const request of requests) {
      merged.set(getRequestKey(request), request);
    }
    list = [...merged.values()];
  }
  const text = JSON.stringify({ ...data, groups: { ...data.groups, [group]: list } });
  const path = getScenePreloadPath(scenePath);
  try {
    if ((await vfs.exists(path)) && ((await vfs.readFile(path, { encoding: 'utf8' })) as string) === text) {
      return;
    }
    await vfs.writeFile(path, text, { encoding: 'utf8', create: true });
  } catch (err) {
    console.warn(`Writing preload list ${path} failed: ${err}`);
  }
}

/**
 * Records the `static` group of every scene of the project again by loading each
 * scene, one at a time, the way a build ships them
 * @returns The preload list of each scene, with the new `static` group
 */
export async function recordAllScenePreloads(
  vfs: VFS,
  onProgress?: (message: string, index: number, count: number) => void
) {
  const lists = new Map<string, AssetPreloadData>();
  const scenes = await vfs.glob('/assets/**/*.zscn', { includeDirs: false, recursive: true });
  for (const [index, entry] of scenes.entries()) {
    onProgress?.(`Recording the assets of ${entry.path}`, index, scenes.length);
    try {
      const { result: scene, requests } = await recordAssetRequests(() =>
        getEngine().resourceManager.loadScene(entry.path)
      );
      scene?.dispose();
      await writeScenePreload(vfs, entry.path, 'static', requests);
      const data = (await readScenePreload(vfs, entry.path)) ?? {
        format: 'zephyr3d-preload',
        version: 1,
        groups: {}
      };
      lists.set(entry.path, { ...data, groups: { ...data.groups, static: requests } });
    } catch (err) {
      console.warn(`Recording the assets of ${entry.path} failed: ${err}`);
    }
  }
  return lists;
}

/**
 * Writes the preload lists of a build, with the size of each shipped file so a
 * loading screen can weight its progress by it
 * @param shippedPaths - Paths assets are shipped under when not their own, such as compressed textures
 */
export async function shipScenePreloads(
  vfs: VFS,
  distDir: string,
  lists: Map<string, AssetPreloadData>,
  shippedPaths: Record<string, string>
) {
  const sizes = new Map<string, number>();
  const sizeOf = async (url: string) => {
    const path = vfs.join(distDir, shippedPaths[url] ?? url);
    let size = sizes.get(path);
    if (size === undefined) {
      size = (await vfs.exists(path)) ? (await vfs.stat(path)).size : 0;
      sizes.set(path, size);
    }
    return size;
  };
  for (const [scenePath, data] of lists) {
    const groups: AssetPreloadData['groups'] = {};
    for (const [name, requests] of Object.entries(data.groups)) {
      groups[name] = [];
      for (const request of requests) {
        const bytes = await sizeOf(request.url);
        groups[name].push(bytes > 0 ? { ...request, bytes } : request);
      }
    }
    await vfs.writeFile(
      vfs.join(distDir, getScenePreloadPath(scenePath)),
      JSON.stringify({ ...data, groups }),
      {
        encoding: 'utf8',
        create: true
      }
    );
  }
}
