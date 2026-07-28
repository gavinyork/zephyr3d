import { MemoryFS } from '@zephyr3d/base';
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

  test('clears asset caches on move without dropping live asset ids', async () => {
    const vfs = new MemoryFS();
    const manager = new ResourceManager(vfs);
    const sourcePath = '/assets/source.txt';
    const targetPath = '/assets/target.txt';
    const liveAsset = {};

    await vfs.writeFile(sourcePath, 'moved content', { encoding: 'utf8', create: true });
    expect(await manager.assetManager.fetchTextData(sourcePath)).toBe('moved content');
    manager.setAssetId(liveAsset, sourcePath);

    await vfs.move(sourcePath, targetPath);
    expect(manager.getAssetId(liveAsset)).toBe(sourcePath);
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
