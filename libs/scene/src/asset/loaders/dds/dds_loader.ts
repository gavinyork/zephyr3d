import { getDDSMipLevelsInfo } from './dds';
import { AbstractTextureLoader } from '../loader';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import { getDevice } from '../../../app/api';

/**
 * The DDS texture loader
 * @internal
 */
export class DDSLoader extends AbstractTextureLoader {
  supportMIMEType(mimeType: string) {
    return mimeType === 'image/dds' || mimeType === 'image/x-dds';
  }
  async load(
    mimeType: string,
    data: ArrayBuffer | TypedArray,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: Nullable<BaseTexture>
  ) {
    const arrayBuffer = data instanceof ArrayBuffer ? data : data.buffer;
    const offset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
    const mipmapLevelData = getDDSMipLevelsInfo(arrayBuffer, offset);
    if (!mipmapLevelData) {
      throw new Error('read DDS file failed');
    }
    const options: TextureCreationOptions = {
      texture: texture ?? undefined,
      samplerOptions
    };
    return getDevice().createTextureFromMipmapData(mipmapLevelData, srgb, options);
  }
}
