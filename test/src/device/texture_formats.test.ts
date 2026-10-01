import type { TextureFormat } from '@zephyr3d/device';
import {
  getTextureFormatBlockHeight,
  getTextureFormatBlockSize,
  getTextureFormatBlockWidth,
  hasAlphaChannel,
  hasBlueChannel,
  hasGreenChannel,
  hasRedChannel,
  isCompressedTextureFormat,
  isSignedTextureFormat,
  isSRGBTextureFormat,
  linearTextureFormatToSRGB
} from '@zephyr3d/device';
import { createNullDevice } from '@zephyr3d/backend-null';

// ETC2/EAC are the transcode targets for KTX2 on devices without BC or ASTC.
// Block layout follows the Khronos Data Format Specification: ETC2 RGB8 and
// RGB8A1 use 8-byte blocks, ETC2 RGBA8 pairs an ETC2 colour block with an EAC
// alpha block (16 bytes), EAC R11 is 8 bytes and RG11 is two of those.
const ETC_FORMATS: {
  format: TextureFormat;
  bytes: number;
  channels: [boolean, boolean, boolean, boolean];
  srgb: boolean;
  signed: boolean;
}[] = [
  { format: 'etc2-rgb8', bytes: 8, channels: [true, true, true, false], srgb: false, signed: false },
  { format: 'etc2-rgb8-srgb', bytes: 8, channels: [true, true, true, false], srgb: true, signed: false },
  { format: 'etc2-rgb8a1', bytes: 8, channels: [true, true, true, true], srgb: false, signed: false },
  { format: 'etc2-rgb8a1-srgb', bytes: 8, channels: [true, true, true, true], srgb: true, signed: false },
  { format: 'etc2-rgba8', bytes: 16, channels: [true, true, true, true], srgb: false, signed: false },
  { format: 'etc2-rgba8-srgb', bytes: 16, channels: [true, true, true, true], srgb: true, signed: false },
  { format: 'eac-r11', bytes: 8, channels: [true, false, false, false], srgb: false, signed: false },
  { format: 'eac-r11-signed', bytes: 8, channels: [true, false, false, false], srgb: false, signed: true },
  { format: 'eac-rg11', bytes: 16, channels: [true, true, false, false], srgb: false, signed: false },
  { format: 'eac-rg11-signed', bytes: 16, channels: [true, true, false, false], srgb: false, signed: true }
];

describe('ETC2/EAC texture formats', () => {
  test.each(ETC_FORMATS)('$format describes a 4x4 compressed block', (f) => {
    expect(isCompressedTextureFormat(f.format)).toBe(true);
    expect(getTextureFormatBlockWidth(f.format)).toBe(4);
    expect(getTextureFormatBlockHeight(f.format)).toBe(4);
    expect(getTextureFormatBlockSize(f.format)).toBe(f.bytes);
    expect([
      hasRedChannel(f.format),
      hasGreenChannel(f.format),
      hasBlueChannel(f.format),
      hasAlphaChannel(f.format)
    ]).toEqual(f.channels);
    expect(isSRGBTextureFormat(f.format)).toBe(f.srgb);
    expect(isSignedTextureFormat(f.format)).toBe(f.signed);
  });

  test('linear ETC2 formats map to their sRGB variants and EAC stays linear', () => {
    expect(linearTextureFormatToSRGB('etc2-rgb8')).toBe('etc2-rgb8-srgb');
    expect(linearTextureFormatToSRGB('etc2-rgb8a1')).toBe('etc2-rgb8a1-srgb');
    expect(linearTextureFormatToSRGB('etc2-rgba8')).toBe('etc2-rgba8-srgb');
    expect(linearTextureFormatToSRGB('eac-r11')).toBe('eac-r11');
    expect(linearTextureFormatToSRGB('eac-rg11')).toBe('eac-rg11');
  });

  test('ETC2 support is reported and can be overridden on the null device', async () => {
    const device = await createNullDevice({ type: 'webgpu' });
    expect(device.getDeviceCaps().textureCaps.supportETC2).toBe(true);
    const desktop = await createNullDevice({
      type: 'webgpu',
      caps: { textureCaps: { supportETC2: false, supportASTC: false } }
    });
    expect(desktop.getDeviceCaps().textureCaps.supportETC2).toBe(false);
  });
});
