import type { VFS } from '@zephyr3d/base';
import { LockFile, readLock } from '../dep';

export function depsResolvePlugin(vfs: VFS, projectRoot: string) {
  let lock: LockFile | null = null;

  return {
    name: 'deps-resolve-vfs',
    async buildStart() {
      lock = await readLock(vfs, projectRoot);
      if (!lock) {
        console.warn('deps.lock.json not found. Bare imports will not resolve until you install deps.');
      }
    },
    async resolveId(source, importer) {
      // If already a VFS deps path, accept
      if (source.startsWith('/deps/')) return source;

      // Bare import → lockfile
      if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('http')) {
        return lock?.dependencies[source]?.entry || null;
      }

      // Defer relative/absolute paths to other plugins
      return null;
    },
    async load(id) {
      if (id.startsWith('/deps/')) {
        const code = (await vfs.readFile(id, { encoding: 'utf8' })) as string | null;
        if (code == null) throw new Error(`VFS miss for dependency: ${id}`);
        return { code, map: null };
      }
      return null;
    }
  };
}
