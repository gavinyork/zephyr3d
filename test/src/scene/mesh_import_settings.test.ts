import { MemoryFS } from '@zephyr3d/base';
import {
  defaultMeshImportSettings,
  normalizeMeshImportSettings,
  readMeshImportSettings,
  writeMeshImportSettings
} from '../../../libs/scene/src/asset/mesh_settings';

describe('mesh import settings', () => {
  test('a mesh without settings is not compressed, with 8-bit normals once it is', () => {
    expect(defaultMeshImportSettings()).toEqual({ compression: 'none', normalBits: 8 });
    expect(defaultMeshImportSettings('meshopt')).toEqual({ compression: 'meshopt', normalBits: 8 });
  });

  test('invalid stored fields fall back to the defaults', () => {
    expect(normalizeMeshImportSettings({ compression: 'zip', normalBits: 12 })).toEqual(
      defaultMeshImportSettings()
    );
    expect(normalizeMeshImportSettings({ compression: 'meshopt', normalBits: 16 })).toEqual({
      compression: 'meshopt',
      normalBits: 16
    });
    expect(normalizeMeshImportSettings(undefined)).toEqual(defaultMeshImportSettings());
  });

  test('settings round-trip through the sidecar', async () => {
    const vfs = new MemoryFS();
    await vfs.makeDirectory('/assets', true);
    expect(await readMeshImportSettings(vfs, '/assets/duck.zmsh')).toEqual(defaultMeshImportSettings());
    await writeMeshImportSettings(vfs, '/assets/duck.zmsh', { compression: 'meshopt', normalBits: 0 });
    expect(await readMeshImportSettings(vfs, '/assets/duck.zmsh')).toEqual({
      compression: 'meshopt',
      normalBits: 0
    });
  });
});
