import { MemoryFS } from '@zephyr3d/base';
import {
  createManifestTextureResolver,
  readTextureManifest,
  TEXTURE_MANIFEST_FILE
} from '../../../libs/scene/src/asset/texture_manifest';

describe('texture manifest', () => {
  async function makeBuild() {
    const vfs = new MemoryFS();
    await vfs.makeDirectory('/assets', true);
    await vfs.writeFile('/assets/rock.1a2b3c4d.ktx2', new Uint8Array([0xab, 0x4b, 0x54, 0x58]).buffer, {
      encoding: 'binary',
      create: true
    });
    await vfs.writeFile(
      `/${TEXTURE_MANIFEST_FILE}`,
      JSON.stringify({ version: 1, textures: { '/assets/rock.png': '/assets/rock.1a2b3c4d.ktx2' } }),
      { encoding: 'utf8', create: true }
    );
    return vfs;
  }

  test('serves the shipped file for a listed source path as KTX2', async () => {
    const vfs = await makeBuild();
    const manifest = await readTextureManifest(vfs);
    expect(manifest).not.toBeNull();
    const resolve = createManifestTextureResolver(vfs, manifest!);
    const hit = await resolve('/assets/rock.png');
    expect(hit?.mimeType).toBe('image/ktx2');
    expect(Array.from(new Uint8Array(hit!.data))).toEqual([0xab, 0x4b, 0x54, 0x58]);
  });

  test('normalizes request paths and leaves unlisted textures alone', async () => {
    const vfs = await makeBuild();
    const resolve = createManifestTextureResolver(vfs, (await readTextureManifest(vfs))!);
    expect((await resolve('/assets/./rock.png'))?.mimeType).toBe('image/ktx2');
    expect(await resolve('/assets/grass.png')).toBeNull();
  });

  test('a project without a manifest, or with a malformed one, has none', async () => {
    const vfs = new MemoryFS();
    expect(await readTextureManifest(vfs)).toBeNull();
    await vfs.writeFile(`/${TEXTURE_MANIFEST_FILE}`, JSON.stringify({ version: 7, textures: {} }), {
      encoding: 'utf8',
      create: true
    });
    expect(await readTextureManifest(vfs)).toBeNull();
    await vfs.writeFile(`/${TEXTURE_MANIFEST_FILE}`, '{broken', { encoding: 'utf8' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readTextureManifest(vfs)).toBeNull();
    warn.mockRestore();
  });
});
