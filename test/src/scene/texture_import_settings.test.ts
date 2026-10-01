import { MemoryFS } from '@zephyr3d/base';
import {
  defaultTextureImportSettings,
  getAssetMetaPath,
  inferTextureUsageFromPath,
  inferTextureUsageFromSlot,
  isAssetMetaPath,
  isSRGBTextureUsage,
  mergeTextureUsage,
  normalizeTextureImportSettings,
  readTextureImportSettings,
  resolveTextureCompression,
  writeTextureImportSettings
} from '../../../libs/scene/src/asset/texture_settings';

describe('texture import settings', () => {
  test('sidecar paths append to the full asset file name', () => {
    expect(getAssetMetaPath('/assets/rock_albedo.png')).toBe('/assets/rock_albedo.png.zmeta');
    expect(isAssetMetaPath('/assets/rock_albedo.png.zmeta')).toBe(true);
    expect(isAssetMetaPath('/assets/rock_albedo.png')).toBe(false);
  });

  test.each([
    ['/assets/rock_01_nrm.png', 'normal'],
    ['/assets/Rock01_Normal.jpg', 'normal'],
    ['/assets/rockNormalMap.png', 'normal'],
    ['/assets/helmet_ORM.png', 'mask'],
    ['/assets/metal_plate_roughness.jpg', 'mask'],
    ['/assets/brick_AO.png', 'mask'],
    ['/assets/brick_albedo.png', 'color'],
    ['/assets/Duck.png', 'color'],
    // "n" only counts as a whole token
    ['/assets/lantern.png', 'color'],
    ['/assets/sky/studio.hdr', 'hdr'],
    ['/assets/ui/button_normal.png', 'ui']
  ])('infers %s as %s from the path', (path, usage) => {
    expect(inferTextureUsageFromPath(path)).toBe(usage);
  });

  test('material slots decide usage from the slot name and colour space', () => {
    expect(inferTextureUsageFromSlot('normalMap', false)).toBe('normal');
    expect(inferTextureUsageFromSlot('clearCoatNormalMap', false)).toBe('normal');
    expect(inferTextureUsageFromSlot('diffuseMap', true)).toBe('color');
    expect(inferTextureUsageFromSlot('metallicMap', false)).toBe('mask');
  });

  test('an image shared between slots takes the most demanding usage', () => {
    expect(mergeTextureUsage('color', 'normal')).toBe('normal');
    expect(mergeTextureUsage('normal', 'mask')).toBe('normal');
    expect(mergeTextureUsage('color', 'mask')).toBe('mask');
  });

  test('compression is opt-in: defaults, missing and invalid settings all mean none', () => {
    expect(defaultTextureImportSettings('color').compression).toBe('none');
    expect(resolveTextureCompression(defaultTextureImportSettings('normal'))).toBe('none');
    expect(normalizeTextureImportSettings({ usage: 'color' }, 'color').compression).toBe('none');
  });

  test('auto compression follows the usage', () => {
    expect(resolveTextureCompression(defaultTextureImportSettings('color', 'auto'))).toBe('etc1s');
    expect(resolveTextureCompression(defaultTextureImportSettings('normal', 'auto'))).toBe('uastc');
    expect(resolveTextureCompression(defaultTextureImportSettings('mask', 'auto'))).toBe('uastc');
    expect(
      resolveTextureCompression({ ...defaultTextureImportSettings('mask', 'auto'), quality: 'low' })
    ).toBe('etc1s');
    expect(resolveTextureCompression(defaultTextureImportSettings('ui', 'auto'))).toBe('none');
    expect(resolveTextureCompression(defaultTextureImportSettings('hdr', 'auto'))).toBe('none');
    expect(
      resolveTextureCompression({ ...defaultTextureImportSettings('color'), compression: 'uastc' })
    ).toBe('uastc');
  });

  test('only colour and UI usages are sRGB, and UI skips mipmaps', () => {
    expect(isSRGBTextureUsage('color')).toBe(true);
    expect(isSRGBTextureUsage('ui')).toBe(true);
    expect(isSRGBTextureUsage('normal')).toBe(false);
    expect(defaultTextureImportSettings('ui').mipmaps).toBe(false);
    expect(defaultTextureImportSettings('color').mipmaps).toBe(true);
  });

  test('invalid stored fields fall back to defaults instead of failing', () => {
    expect(
      normalizeTextureImportSettings(
        { usage: 'normal', compression: 'zip', maxSize: -3, mipmaps: 'yes' },
        'color'
      )
    ).toEqual({ usage: 'normal', compression: 'none', quality: 'normal', maxSize: 0, mipmaps: true });
    expect(normalizeTextureImportSettings(null, 'mask')).toEqual(defaultTextureImportSettings('mask'));
  });

  test('settings round-trip through the sidecar, and a missing sidecar infers from the path', async () => {
    const vfs = new MemoryFS();
    await vfs.makeDirectory('/assets', true);
    expect(await readTextureImportSettings(vfs, '/assets/wall_normal.png')).toEqual(
      defaultTextureImportSettings('normal')
    );
    const settings = {
      usage: 'mask',
      compression: 'etc1s',
      quality: 'high',
      maxSize: 1024,
      mipmaps: false
    } as const;
    await writeTextureImportSettings(vfs, '/assets/wall_normal.png', settings);
    expect(await vfs.exists('/assets/wall_normal.png.zmeta')).toBe(true);
    expect(await readTextureImportSettings(vfs, '/assets/wall_normal.png')).toEqual(settings);
  });

  test('a corrupt sidecar is ignored rather than breaking the texture', async () => {
    const vfs = new MemoryFS();
    await vfs.makeDirectory('/assets', true);
    await vfs.writeFile('/assets/a.png.zmeta', '{not json', { encoding: 'utf8', create: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readTextureImportSettings(vfs, '/assets/a.png')).toEqual(
      defaultTextureImportSettings('color')
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
