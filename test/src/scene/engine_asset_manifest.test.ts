import { MemoryFS } from '@zephyr3d/base';
import { createNullDevice } from '@zephyr3d/backend-null';
import { Engine } from '../../../libs/scene/src/app/engine';
import { ASSET_MANIFEST_FILE } from '../../../libs/scene/src/asset/asset_manifest';

// Building the engine's builtin assets needs a device; the null backend is a real one
let nullDevice: unknown = null;
jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => nullDevice),
  tryGetApp: jest.fn(() => null),
  getApp: jest.fn(() => null)
}));
beforeAll(async () => {
  nullDevice = await createNullDevice({ type: 'webgpu' });
});

async function buildVFS() {
  const vfs = new MemoryFS();
  await vfs.makeDirectory('/assets', true);
  await vfs.writeFile('/assets/rock.1a2b3c4d.ktx2', new Uint8Array([1, 2, 3, 4]).buffer, {
    encoding: 'binary',
    create: true
  });
  await vfs.writeFile(
    `/${ASSET_MANIFEST_FILE}`,
    JSON.stringify({ version: 1, textures: { '/assets/rock.png': '/assets/rock.1a2b3c4d.ktx2' } }),
    { encoding: 'utf8', create: true }
  );
  return vfs;
}

describe('engine asset manifest', () => {
  test('a build manifest on the engine VFS is picked up without any setup', async () => {
    const engine = new Engine(await buildVFS());
    expect(await engine.loadAssetManifest()).toBe(true);
    const resolver = engine.resourceManager.assetManager.assetSourceResolver!;
    expect((await resolver('/assets/rock.png', 'texture'))?.mimeType).toBe('image/ktx2');
  });

  test('without a manifest, or with an HTML fallback page, nothing is installed and nothing warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = new Engine(new MemoryFS());
    expect(await engine.loadAssetManifest()).toBe(false);
    const spa = new MemoryFS();
    await spa.writeFile(`/${ASSET_MANIFEST_FILE}`, '<!doctype html><html></html>', {
      encoding: 'utf8',
      create: true
    });
    const engine2 = new Engine(spa);
    expect(await engine2.loadAssetManifest()).toBe(false);
    expect(engine2.resourceManager.assetManager.assetSourceResolver).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a resolver installed by someone else, such as the editor, is left alone', async () => {
    const engine = new Engine(await buildVFS());
    const editorResolver = async () => null;
    engine.resourceManager.assetManager.assetSourceResolver = editorResolver;
    expect(await engine.loadAssetManifest()).toBe(false);
    expect(engine.resourceManager.assetManager.assetSourceResolver).toBe(editorResolver);
  });

  test('switching the VFS drops the old manifest', async () => {
    const engine = new Engine(await buildVFS());
    await engine.loadAssetManifest();
    engine.VFS = new MemoryFS();
    expect(engine.resourceManager.assetManager.assetSourceResolver).toBeNull();
  });
});
