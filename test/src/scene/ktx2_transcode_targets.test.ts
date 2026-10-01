import type { TextureFormat } from '@zephyr3d/device';
import {
  BasisTranscoderFormat,
  resolveKTX2TranscodeTargets
} from '../../../libs/scene/src/asset/loaders/ktx2/ktx2_targets';

// Device profiles as reported by the capability probe
// (visual-test/tools/probes/texture-compression.html).
const DESKTOP: TextureFormat[] = ['dxt1', 'dxt1-srgb', 'dxt5', 'dxt5-srgb', 'bc7', 'bc7-srgb'];
const DESKTOP_S3TC_ONLY: TextureFormat[] = ['dxt1', 'dxt5'];
const MOBILE: TextureFormat[] = [
  'etc2-rgb8',
  'etc2-rgb8-srgb',
  'etc2-rgba8',
  'etc2-rgba8-srgb',
  'astc-4x4',
  'astc-4x4-srgb'
];
const ETC2_ONLY: TextureFormat[] = ['etc2-rgb8', 'etc2-rgba8'];

function resolve(supported: TextureFormat[], srgb = false) {
  return resolveKTX2TranscodeTargets(srgb, (f) => supported.includes(f));
}

describe('KTX2 transcode target selection', () => {
  test('desktop GPUs take BC7 for both encodings', () => {
    const t = resolve(DESKTOP);
    expect(t.etc1s.opaque.textureFormat).toBe('bc7');
    expect(t.etc1s.alpha.textureFormat).toBe('bc7');
    expect(t.uastc.opaque.textureFormat).toBe('bc7');
    expect(t.uastc.alpha.transcoderFormat).toBe(BasisTranscoderFormat.BC7_RGBA);
  });

  test('without BPTC, BC1 carries opaque data and BC3 carries alpha', () => {
    const t = resolve(DESKTOP_S3TC_ONLY);
    expect(t.etc1s.opaque.textureFormat).toBe('dxt1');
    expect(t.etc1s.alpha.textureFormat).toBe('dxt5');
    expect(t.uastc.opaque.transcoderFormat).toBe(BasisTranscoderFormat.BC1_RGB);
    expect(t.uastc.alpha.transcoderFormat).toBe(BasisTranscoderFormat.BC3_RGBA);
  });

  test('mobile GPUs take ETC2 for ETC1S and ASTC for UASTC', () => {
    const t = resolve(MOBILE);
    expect(t.etc1s.opaque).toEqual({
      transcoderFormat: BasisTranscoderFormat.ETC1_RGB,
      textureFormat: 'etc2-rgb8',
      compressed: true
    });
    expect(t.etc1s.alpha.textureFormat).toBe('etc2-rgba8');
    expect(t.uastc.opaque.textureFormat).toBe('astc-4x4');
    expect(t.uastc.alpha.textureFormat).toBe('astc-4x4');
  });

  test('ETC1S never goes to ASTC, it would only inflate the data', () => {
    const t = resolve(['astc-4x4']);
    expect(t.etc1s.opaque.textureFormat).toBe('rgba8unorm');
    expect(t.uastc.opaque.textureFormat).toBe('astc-4x4');
  });

  test('UASTC falls back to ETC2 when ASTC and BC are missing', () => {
    const t = resolve(ETC2_ONLY);
    expect(t.uastc.opaque.textureFormat).toBe('etc2-rgb8');
    expect(t.uastc.alpha.transcoderFormat).toBe(BasisTranscoderFormat.ETC2_RGBA);
  });

  test('uncompressed RGBA8 is the last resort', () => {
    const t = resolve([]);
    for (const target of [t.etc1s.opaque, t.etc1s.alpha, t.uastc.opaque, t.uastc.alpha, t.fallback]) {
      expect(target).toEqual({
        transcoderFormat: BasisTranscoderFormat.RGBA32,
        textureFormat: 'rgba8unorm',
        compressed: false
      });
    }
  });

  test('sRGB textures pick sRGB formats and skip formats lacking an sRGB variant', () => {
    const t = resolve(DESKTOP, true);
    expect(t.etc1s.opaque.textureFormat).toBe('bc7-srgb');
    expect(t.fallback.textureFormat).toBe('rgba8unorm-srgb');
    // WebGL can expose S3TC without WEBGL_compressed_texture_s3tc_srgb
    const s3tcNoSrgb = resolve(DESKTOP_S3TC_ONLY, true);
    expect(s3tcNoSrgb.etc1s.opaque.textureFormat).toBe('rgba8unorm-srgb');
  });
});
