import { AbstractTextureLoader } from '../loader';
import { Application } from '../../../app/app';
import type { BaseTexture, SamplerOptions, TextureCreationOptions } from '@zephyr3d/device';

/**
 * TGA image loader
 * @internal
 */
export class TGALoader extends AbstractTextureLoader {
  supportExtension(ext: string): boolean {
    return ext === '.tga';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'image/tga' || mimeType === 'image/x-tga';
  }
  private parseTGA(content: ArrayBuffer, sRGB: boolean, noMipmap: boolean, texture: BaseTexture) {
    const dataView = new DataView(content);
    const p: number[] = [0, 0, 0, 0];
    do {
      let skip = 0;
      const idLength = dataView.getUint8(0);
      skip += idLength;
      const colorMapType = dataView.getUint8(1);
      if (colorMapType !== 0 && colorMapType !== 1) {
        break;
      }
      const dataTypeCode = dataView.getUint8(2);
      if (dataTypeCode !== 2 && dataTypeCode !== 10) {
        break;
      }
      const colorMapLength = dataView.getUint16(5, true);
      skip += colorMapLength * colorMapType;
      const width = dataView.getUint16(12, true);
      const height = dataView.getUint16(14, true);
      const bpp = dataView.getUint8(16);
      if (bpp !== 16 && bpp !== 24 && bpp !== 32) {
        break;
      }
      let dataOffset = 18 + skip;
      const bytesPerPixel = bpp / 8;
      const pixels = new Uint8Array(width * height * 4);
      let n = 0;
      while (n < width * height) {
        if (dataTypeCode === 2) {
          for (let i = 0; i < bytesPerPixel; i++) {
            p[i] = dataView.getUint8(dataOffset++);
          }
          this.mergeBytes(pixels, n * 4, p, bytesPerPixel);
          n++;
        } else {
          const t = dataView.getUint8(dataOffset++);
          for (let i = 0; i < bytesPerPixel; i++) {
            p[i] = dataView.getUint8(dataOffset++);
          }
          const j = t & 0x7f;
          this.mergeBytes(pixels, n * 4, p, bytesPerPixel);
          n++;
          if (t & 0x80) {
            for (let i = 0; i < j; i++) {
              this.mergeBytes(pixels, n * 4, p, bytesPerPixel);
              n++;
            }
          } else {
            for (let i = 0; i < j; i++) {
              for (let k = 0; k < bytesPerPixel; k++) {
                p[i] = dataView.getUint8(dataOffset++);
              }
              this.mergeBytes(pixels, n * 4, p, bytesPerPixel);
              n++;
            }
          }
        }
      }
      const opt: TextureCreationOptions = { texture };
      if (noMipmap) {
        opt.samplerOptions = { mipFilter: 'none' };
      }
      const tex = Application.instance.device.createTexture2D(
        sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm',
        width,
        height,
        opt
      );
      tex.update(pixels, 0, 0, width, height);
      return tex;
    } while (false);
    throw new Error(`Unsupported TGA file format`);
  }
  private mergeBytes(dest: Uint8Array, offset: number, pixel: number[], numBytes: number) {
    if (numBytes === 4) {
      dest[offset + 0] = pixel[2];
      dest[offset + 1] = pixel[1];
      dest[offset + 2] = pixel[0];
      dest[offset + 3] = pixel[3];
    } else if (numBytes === 3) {
      dest[offset + 0] = pixel[2];
      dest[offset + 1] = pixel[1];
      dest[offset + 2] = pixel[0];
      dest[offset + 3] = 255;
    } else if (numBytes === 2) {
      dest[offset + 0] = (pixel[1] & 0x7c) << 1;
      dest[offset + 1] = ((pixel[1] & 0x03) << 6) | ((pixel[0] & 0xe0) >> 2);
      dest[offset + 2] = (pixel[0] & 0x1f) << 3;
      dest[offset + 3] = pixel[1] & 0x80;
    }
  }
  async load(
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    return new Promise<BaseTexture>((resolve) => {
      resolve(this.parseTGA(data, srgb, samplerOptions?.mipFilter === 'none', texture));
    });
  }
}
