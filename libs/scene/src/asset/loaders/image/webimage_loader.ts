import { AbstractTextureLoader } from '../loader';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';
import type { TypedArray } from '@zephyr3d/base';
import { getDevice } from '../../../app/api';

/**
 * Web image loader
 * @internal
 */
export class WebImageLoader extends AbstractTextureLoader {
  supportMIMEType(mimeType: string) {
    return mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp';
  }
  async load(
    mimeType: string,
    data: ArrayBuffer | TypedArray,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ) {
    if (!mimeType) {
      throw new Error('unknown image file type');
    }

    const blob = new Blob([data], { type: mimeType });
    const options: TextureCreationOptions = { texture, samplerOptions };

    try {
      const bm = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
      const tex = getDevice().createTexture2DFromImage(bm, srgb, options);
      if (!tex) {
        throw new Error('create texture from ImageBitmap failed');
      }
      bm.close?.();
      return tex;
    } catch {
      const src = URL.createObjectURL(blob);
      try {
        const img = await this.loadHTMLImage(src);
        const cvs = document.createElement('canvas');
        cvs.width = img.naturalWidth || img.width;
        cvs.height = img.naturalHeight || img.height;
        const ctx = cvs.getContext('2d');
        if (!ctx) {
          throw new Error('2D context not available');
        }
        ctx.drawImage(img, 0, 0);
        const tex = getDevice().createTexture2DFromImage(cvs, srgb, options);
        if (!tex) {
          throw new Error('create texture from canvas failed');
        }
        return tex;
      } finally {
        URL.revokeObjectURL(src);
      }
    }
  }

  private async loadHTMLImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }
}
