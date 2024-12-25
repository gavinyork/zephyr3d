import { getDDSMipLevelsInfo } from './dds';
import { AbstractTextureLoader } from '../loader';
import { Application } from '../../../app';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';

/**
 * The DDS texture loader
 * @internal
 */
export class DDSLoader extends AbstractTextureLoader {
  supportExtension(ext: string): boolean {
    return ext === '.dds';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'image/dds' || mimeType === 'image/x-dds';
  }
  async load(
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const arrayBuffer = data;
    const mipmapLevelData = getDDSMipLevelsInfo(arrayBuffer);
    if (!mipmapLevelData) {
      throw new Error('read DDS file failed');
    }
    const options: TextureCreationOptions = {
      texture: texture,
      samplerOptions
    };
    return Application.instance.device.createTextureFromMipmapData(mipmapLevelData, srgb, options);
  }
}
