import type { TextureFormat } from '@zephyr3d/device';
import { linearTextureFormatToSRGB } from '@zephyr3d/device';

/**
 * Basis Universal `transcoder_texture_format` values used by the KTX2 loader.
 *
 * Values from `transcoder/basisu_transcoder.h` of basis_universal v2_50, the
 * version vendored in `./basis`.
 *
 * @internal
 */
export const BasisTranscoderFormat = {
  ETC1_RGB: 0,
  ETC2_RGBA: 1,
  BC1_RGB: 2,
  BC3_RGBA: 3,
  BC7_RGBA: 6,
  ASTC_LDR_4x4_RGBA: 10,
  RGBA32: 13
} as const;

/**
 * One transcode destination: what the transcoder writes and how the device sees it.
 * @internal
 */
export interface KTX2TranscodeTarget {
  transcoderFormat: number;
  textureFormat: TextureFormat;
  /** Block-compressed targets need multiple-of-four base dimensions on every backend */
  compressed: boolean;
}

/**
 * Transcode destinations resolved for one device and colour space, indexed by
 * Basis source encoding and whether the file has alpha. The worker picks one
 * entry per file; `fallback` is used when a compressed target cannot hold the
 * image (dimensions not a multiple of four).
 * @internal
 */
export interface KTX2TranscodeTargets {
  etc1s: { opaque: KTX2TranscodeTarget; alpha: KTX2TranscodeTarget };
  uastc: { opaque: KTX2TranscodeTarget; alpha: KTX2TranscodeTarget };
  fallback: KTX2TranscodeTarget;
}

interface TargetOption {
  opaque: [number, TextureFormat];
  alpha: [number, TextureFormat];
  /** Lower is preferred, undefined means never used for that encoding */
  priorityETC1S?: number;
  priorityUASTC?: number;
}

// Priorities follow three.js KTX2Loader (examples/jsm/loaders/KTX2Loader.js, r180,
// FORMAT_OPTIONS): ETC1S is a subset of ETC1, so it goes to ETC2 losslessly and
// ETC2 ranks first; UASTC maps losslessly to ASTC 4x4 and nearly so to BC7.
// ETC1S -> ASTC is deliberately absent, it only inflates the data. three.js keeps
// separate ETC1 and PVRTC entries; ETC1 data is valid ETC2 RGB8 so ETC2 support
// covers it here, and PVRTC is not a device format in this engine.
const TARGET_OPTIONS: TargetOption[] = [
  {
    opaque: [BasisTranscoderFormat.ASTC_LDR_4x4_RGBA, 'astc-4x4'],
    alpha: [BasisTranscoderFormat.ASTC_LDR_4x4_RGBA, 'astc-4x4'],
    priorityUASTC: 1
  },
  {
    opaque: [BasisTranscoderFormat.BC7_RGBA, 'bc7'],
    alpha: [BasisTranscoderFormat.BC7_RGBA, 'bc7'],
    priorityETC1S: 3,
    priorityUASTC: 2
  },
  {
    opaque: [BasisTranscoderFormat.BC1_RGB, 'dxt1'],
    alpha: [BasisTranscoderFormat.BC3_RGBA, 'dxt5'],
    priorityETC1S: 4,
    priorityUASTC: 5
  },
  {
    opaque: [BasisTranscoderFormat.ETC1_RGB, 'etc2-rgb8'],
    alpha: [BasisTranscoderFormat.ETC2_RGBA, 'etc2-rgba8'],
    priorityETC1S: 1,
    priorityUASTC: 3
  }
];

function makeTarget(
  [transcoderFormat, format]: [number, TextureFormat],
  srgb: boolean,
  compressed: boolean
): KTX2TranscodeTarget {
  return {
    transcoderFormat,
    textureFormat: srgb ? linearTextureFormatToSRGB(format) : format,
    compressed
  };
}

/**
 * Resolves the transcode destinations for a device.
 *
 * @param srgb - Whether the texture holds colour data that must be decoded as sRGB
 * @param isSupported - Tells whether the device can sample a texture format
 * @returns The resolved destinations
 *
 * @internal
 */
export function resolveKTX2TranscodeTargets(
  srgb: boolean,
  isSupported: (format: TextureFormat) => boolean
): KTX2TranscodeTargets {
  const fallback = makeTarget([BasisTranscoderFormat.RGBA32, 'rgba8unorm'], srgb, false);
  function pick(priority: 'priorityETC1S' | 'priorityUASTC', alpha: boolean) {
    const options = TARGET_OPTIONS.filter((opt) => opt[priority] !== undefined).sort(
      (a, b) => a[priority]! - b[priority]!
    );
    for (const opt of options) {
      const target = makeTarget(alpha ? opt.alpha : opt.opaque, srgb, true);
      if (isSupported(target.textureFormat)) {
        return target;
      }
    }
    return fallback;
  }
  return {
    etc1s: { opaque: pick('priorityETC1S', false), alpha: pick('priorityETC1S', true) },
    uastc: { opaque: pick('priorityUASTC', false), alpha: pick('priorityUASTC', true) },
    fallback
  };
}
