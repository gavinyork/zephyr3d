import type { VFS } from '@zephyr3d/base';
import { IndexedDBFS } from '@zephyr3d/base';
import { getDesktopAPI, type DesktopFSScope } from './desktop';
import { ElectronFS, createElectronProjectFS } from './electronfs';

const META_DATABASE_NAME = 'zephyr3d-editor';
const STORE_NAME = '$';

export function createEditorMetaVFS(): VFS {
  return createScopedVFS('meta', () => new IndexedDBFS(META_DATABASE_NAME, STORE_NAME));
}

export function createSystemPluginVFS(): VFS {
  return createScopedVFS('system', () => new IndexedDBFS(META_DATABASE_NAME, STORE_NAME));
}

export function createProjectVFS(uuid: string): VFS {
  return getDesktopAPI() ? createElectronProjectFS(uuid) : new IndexedDBFS(uuid, STORE_NAME);
}

export async function deleteProjectVFS(uuid: string) {
  if (getDesktopAPI()) {
    await createElectronProjectFS(uuid).deleteFileSystem();
  } else {
    await IndexedDBFS.deleteDatabase(uuid);
  }
}

function createScopedVFS(scope: DesktopFSScope, fallback: () => VFS): VFS {
  return getDesktopAPI() ? new ElectronFS(scope) : fallback();
}
