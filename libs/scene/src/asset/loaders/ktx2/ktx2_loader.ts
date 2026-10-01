import type { BaseTexture, SamplerOptions, TextureCreationOptions, TextureFormat } from '@zephyr3d/device';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import { AbstractTextureLoader } from '../loader';
import { getDevice } from '../../../app/api';
import { resolveKTX2TranscodeTargets } from './ktx2_targets';
import { BasisTranscoder } from './transcoder_pool';

/**
 * KTX2 texture loader for Basis Universal (ETC1S and UASTC LDR) encoded files.
 *
 * Files are transcoded in web workers to the best block-compressed format the
 * device samples: ASTC or BC7 for UASTC, ETC2 or BC7 for ETC1S, then BC1/BC3,
 * with uncompressed RGBA8 as the last resort.
 *
 * The transcoder (basis_transcoder.js + .wasm) is fetched on first use from the
 * directory shipped next to this module. Set {@link KTX2Loader.transcoderPath}
 * when the files are served from somewhere else.
 *
 * @public
 */
export class KTX2Loader extends AbstractTextureLoader {
  /**
   * Directory URL holding basis_transcoder.js and basis_transcoder.wasm.
   * null (the default) uses the copy bundled with the engine.
   */
  static get transcoderPath(): string | null {
    return BasisTranscoder.path;
  }
  static set transcoderPath(url: string | null) {
    BasisTranscoder.path = url;
  }
  /**
   * Number of transcoder workers. 0 (the default) uses up to four, leaving one
   * hardware thread for the main thread.
   */
  static get workerCount() {
    return BasisTranscoder.workerCount;
  }
  static set workerCount(n: number) {
    BasisTranscoder.workerCount = n;
  }
  supportMIMEType(mimeType: string) {
    return mimeType === 'image/ktx2';
  }
  async load(
    _mimeType: string,
    data: ArrayBuffer | TypedArray,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: Nullable<BaseTexture>
  ) {
    const device = getDevice();
    const caps = device.getDeviceCaps().textureCaps;
    const targets = resolveKTX2TranscodeTargets(srgb, (format: TextureFormat) => {
      const info = caps.getTextureFormatInfo(format);
      return !!info && info.filterable;
    });
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    const result = await BasisTranscoder.instance.transcode(bytes, targets);
    const isCubemap = result.faces === 6;
    const isArray = result.layers > 0;
    if (isCubemap && isArray) {
      throw new Error('KTX2Loader: cube map arrays are not supported');
    }
    const slices = result.faces * Math.max(1, result.layers);
    const mipDatas = [];
    for (let slice = 0; slice < slices; slice++) {
      const levels = [];
      for (let level = 0; level < result.levels; level++) {
        levels.push({
          data: result.images[slice * result.levels + level],
          width: result.levelWidths[level],
          height: result.levelHeights[level]
        });
      }
      mipDatas.push(levels);
    }
    const options: TextureCreationOptions = {
      texture: texture ?? undefined,
      samplerOptions
    };
    return device.createTextureFromMipmapData(
      {
        width: result.width,
        height: result.height,
        depth: isArray ? slices : 1,
        isCubemap,
        isVolume: false,
        isArray,
        isCompressed: result.compressed,
        arraySize: slices,
        mipLevels: result.levels,
        format: result.textureFormat,
        mipDatas
      },
      srgb,
      options
    );
  }
}
