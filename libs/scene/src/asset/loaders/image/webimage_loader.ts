import { AbstractTextureLoader } from '../loader';
import { Application } from '../../../app';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';
import type { AssetManager } from '../../assetmanager';

/**
 * Web image loader
 * @internal
 */
export class WebImageLoader extends AbstractTextureLoader {
  supportExtension(ext: string): boolean {
    return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'image/jpg' || mimeType === 'image/jpeg' || mimeType === 'image/png';
  }
  async load(
    assetManager: AssetManager,
    filename: string,
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    return new Promise<BaseTexture>((resolve, reject) => {
      if (!mimeType) {
        reject('unknown image file type');
      }
      const src = URL.createObjectURL(new Blob([data], { type: mimeType }));
      const img = document.createElement('img');
      img.src = src;
      img.onload = function(){
        createImageBitmap(img, {
          premultiplyAlpha: 'none'
        }).then((bm) => {
          const options: TextureCreationOptions = {
            noMipmap: samplerOptions?.mipFilter === 'none',
            texture: texture
          };
          const tex = Application.instance.device.createTexture2DFromImage(bm, srgb, options);
          if (tex) {
            resolve(tex);
          } else {
            reject('create texture from image element failed');
          }
        });
      };
      img.onerror = (err) => {
        reject(err);
      };
    });
  }
}
