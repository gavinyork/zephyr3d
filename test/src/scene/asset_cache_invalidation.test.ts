import { MemoryFS, type HttpRequest } from '@zephyr3d/base';
import { ResourceManager, SharedModel } from '@zephyr3d/scene';

describe('asset cache invalidation', () => {
  test('reloads a file after it is overwritten at the same path', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const path = '/assets/data.txt';

    await vfs.writeFile(path, 'before', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(path)).toBe('before');

    await vfs.writeFile(path, 'after', { encoding: 'utf8' });
    expect(await manager.assetManager.fetchTextData(path)).toBe('after');
  });

  test('reloads a file deleted and recreated at the same path', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const path = '/assets/data.json';

    await vfs.writeFile(path, JSON.stringify({ version: 1 }), { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchJsonData(path)).toEqual({ version: 1 });

    await vfs.deleteFile(path);
    await vfs.writeFile(path, JSON.stringify({ version: 2 }), { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchJsonData(path)).toEqual({ version: 2 });
  });

  test('invalidates resolver-based cache keys through their source path index', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const path = '/assets/resolved.txt';
    const request = { urlResolver: () => 'resolved-cache-key' } as unknown as HttpRequest;

    await vfs.writeFile(path, 'before', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(path, undefined, request)).toBe('before');

    await vfs.writeFile(path, 'after', { encoding: 'utf8' });
    expect(await manager.assetManager.fetchTextData(path, undefined, request)).toBe('after');
  });

  test('recursively invalidates a directory without evicting sibling assets', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const nestedPath = '/assets/group/nested.txt';
    const siblingPath = '/assets/sibling.txt';
    let siblingLoads = 0;

    await vfs.writeFile(nestedPath, 'before', { encoding: 'utf8', create: true });
    await vfs.writeFile(siblingPath, 'sibling', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(nestedPath)).toBe('before');
    expect(
      await manager.assetManager.fetchTextData(siblingPath, (text) => {
        siblingLoads++;
        return text;
      })
    ).toBe('sibling');

    await vfs.deleteDirectory('/assets/group', true);
    await vfs.writeFile(nestedPath, 'after', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(nestedPath)).toBe('after');
    expect(await manager.assetManager.fetchTextData(siblingPath)).toBe('sibling');
    expect(siblingLoads).toBe(1);
  });

  test('clears path-based caches when switching VFS instances', async () => {
    const firstVFS = new MemoryFS();
    const secondVFS = new MemoryFS();
    const manager = new ResourceManager(firstVFS);
    const path = '/assets/shared.txt';

    await firstVFS.writeFile(path, 'first project', { encoding: 'utf8', create: true });
    await secondVFS.writeFile(path, 'second project', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(path)).toBe('first project');

    manager.VFS = secondVFS;
    expect(await manager.assetManager.fetchTextData(path)).toBe('second project');
  });

  test('invalidates both move paths without dropping unrelated caches or live asset ids', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const sourcePath = '/assets/source.txt';
    const targetPath = '/assets/target.txt';
    const liveAsset = {};
    const unrelatedPath = '/assets/unrelated.txt';
    let unrelatedLoads = 0;

    await vfs.writeFile(sourcePath, 'moved content', { encoding: 'utf8', create: true });
    await vfs.writeFile(targetPath, 'stale target', { encoding: 'utf8', create: true });
    await vfs.writeFile(unrelatedPath, 'unrelated', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(sourcePath)).toBe('moved content');
    expect(await manager.assetManager.fetchTextData(targetPath)).toBe('stale target');
    expect(
      await manager.assetManager.fetchTextData(unrelatedPath, (text) => {
        unrelatedLoads++;
        return text;
      })
    ).toBe('unrelated');
    manager.setAssetId(liveAsset, sourcePath);

    await vfs.move(sourcePath, targetPath, { overwrite: true });
    expect(manager.getAssetId(liveAsset)).toBe(sourcePath);
    expect(await manager.assetManager.fetchTextData(targetPath)).toBe('moved content');
    expect(await manager.assetManager.fetchTextData(unrelatedPath)).toBe('unrelated');
    expect(unrelatedLoads).toBe(1);
  });

  test('rewrites both move paths from a mounted VFS before invalidating caches', async () => {
    const projectVFS = new MemoryFS();
    const mountedVFS = new MemoryFS();
    const manager = new ResourceManager(projectVFS);
    const sourcePath = '/mounted/source.txt';
    const targetPath = '/mounted/target.txt';

    await mountedVFS.writeFile('/source.txt', 'moved content', { encoding: 'utf8', create: true });
    await mountedVFS.writeFile('/target.txt', 'stale target', { encoding: 'utf8', create: true });
    await projectVFS.mount('/mounted', mountedVFS);
    expect(await manager.assetManager.fetchTextData(sourcePath)).toBe('moved content');
    expect(await manager.assetManager.fetchTextData(targetPath)).toBe('stale target');

    await mountedVFS.move('/source.txt', '/target.txt', { overwrite: true });
    expect(await manager.assetManager.fetchTextData(targetPath)).toBe('moved content');
  });

  test('does not let an invalidated model request overwrite a newer request', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const path = '/assets/model.test';
    const pendingLoads: Array<(model: SharedModel) => void> = [];
    const oldModel = new SharedModel();
    const newModel = new SharedModel();
    const modelCache = manager.assetManager as unknown as {
      fetchModelData(path: string, options: { mimeType: string }): Promise<SharedModel>;
    };

    manager.setModelLoader('model/test', {
      loadModel: () => new Promise<SharedModel>((resolve) => pendingLoads.push(resolve))
    });
    await vfs.writeFile(path, 'old', { encoding: 'utf8', create: true });

    const oldRequest = modelCache.fetchModelData(path, { mimeType: 'model/test' });
    await vfs.writeFile(path, 'new', { encoding: 'utf8' });
    const newRequest = modelCache.fetchModelData(path, { mimeType: 'model/test' });

    pendingLoads[0](oldModel);
    expect(await oldRequest).toBe(oldModel);
    pendingLoads[1](newModel);
    expect(await newRequest).toBe(newModel);
    expect(await modelCache.fetchModelData(path, { mimeType: 'model/test' })).toBe(newModel);

    manager.clearCache();
    oldModel.dispose();
    newModel.dispose();
  });
});
