import { getDDSMipLevelsInfo } from './dds';
import { AbstractTextureLoader } from '../loader';
import { Application } from '../../../app';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';
import type { AssetManager } from '../../assetmanager';

/**
 * The DDS texture loader
 * @internal
 */
export class DDSLoader extends AbstractTextureLoader {
  supportExtension(ext: string): boolean {
    return ext === '.dds';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'image/dds';
  }
  async load(
    assetManager: AssetManager,
    url: string,
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const arrayBuffer = data;
    const mipmapLevelData = getDDSMipLevelsInfo(arrayBuffer);
    if (!mipmapLevelData) {
      throw new Error(`read DDS file failed: ${url}`);
    }
    const options: TextureCreationOptions = {
      texture: texture,
      samplerOptions
    };
    return Application.instance.device.createTextureFromMipmapData(mipmapLevelData, srgb, options);
    /*
    if (mipmapLevelData.isCubemap) {
      return Application.instance.device.createCubeTextureFromMipmapData(mipmapLevelData, options);
    } else if (mipmapLevelData.isVolume) {
      throw new Error(`load DDS volume texture is not supported`);
    } else {
      return Application.instance.device.createTexture2DFromMipmapData(mipmapLevelData, options);
    }
    */
  }
}
