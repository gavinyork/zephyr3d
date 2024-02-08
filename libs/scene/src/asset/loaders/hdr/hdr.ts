import { AbstractTextureLoader } from '../loader';
import { floatToHalf, packFloat3 } from '@zephyr3d/base';
import { Application } from '../../../app';
import type { BaseTexture, SamplerOptions, TextureCreationOptions, TextureFormat } from '@zephyr3d/device';
import type { AssetManager } from '../../assetmanager';

const _f16one = floatToHalf(1);
/**
 * The HDR texture loader
 * @internal
 */
export class HDRLoader extends AbstractTextureLoader {
  supportExtension(ext: string): boolean {
    return ext === '.hdr';
  }
  supportMIMEType(mimeType: string): boolean {
    return mimeType === 'image/hdr';
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
    let format: TextureFormat;
    for (const fmt of ['rg11b10uf', 'rgba16f', 'rgba32f', 'rgba8unorm'] as const) {
      const info = Application.instance.device.getDeviceCaps().textureCaps.getTextureFormatInfo(fmt);
      if (info && info.filterable && info.renderable) {
        format = fmt;
        break;
      }
    }
    const textureData = await this.loadHDR(new Uint8Array(data), format);
    const options: TextureCreationOptions = {
      texture: texture,
      samplerOptions
    };
    const tex = Application.instance.device.createTexture2D(
      format,
      textureData.width,
      textureData.height,
      options
    );
    tex.update(textureData.dataFloat, 0, 0, textureData.width, textureData.height);
    return tex;
  }
  private _rgbeToFloat32(buffer: Uint8Array): Float32Array {
    const length = buffer.byteLength >> 2;
    const result = new Float32Array(length * 4);

    for (let i = 0; i < length; i++) {
      const s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8));

      result[i * 4] = buffer[i * 4] * s;
      result[i * 4 + 1] = buffer[i * 4 + 1] * s;
      result[i * 4 + 2] = buffer[i * 4 + 2] * s;
      result[i * 4 + 3] = 1;
    }
    return result;
  }
  private _rgbeToFloat16(buffer: Uint8Array): Uint16Array {
    const length = buffer.byteLength >> 2;
    const result = new Uint16Array(length * 4);
    for (let i = 0; i < length; i++) {
      const s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8));
      result[i * 4 + 0] = floatToHalf(Math.max(-65504, Math.min(buffer[i * 4] * s, 65504)));
      result[i * 4 + 1] = floatToHalf(Math.max(-65504, Math.min(buffer[i * 4 + 1] * s, 65504)));
      result[i * 4 + 2] = floatToHalf(Math.max(-65504, Math.min(buffer[i * 4 + 2] * s, 65504)));
      result[i * 4 + 3] = _f16one;
    }
    return result;
  }
  private _rgbeToR11G11B10(buffer: Uint8Array): Uint32Array {
    const length = buffer.byteLength >> 2;
    const result = new Uint32Array(length);

    for (let i = 0; i < length; i++) {
      const s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8));
      const r = buffer[i * 4] * s;
      const g = buffer[i * 4 + 1] * s;
      const b = buffer[i * 4 + 2] * s;
      result[i] = packFloat3(r, g, b);
    }
    return result;
  }
  /*
    Decode: rgb = pow(6 * rgbm.rgb * rgbm.a, 2.2);
   */
  private _rgbeToRGBM(buffer: Uint8Array): Uint8Array {
    const length = buffer.byteLength >> 2;
    const result = new Uint8Array(length * 4);

    for (let i = 0; i < length; i++) {
      const s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8));
      const r = Math.pow(buffer[i * 4] * s, 1 / 2.2);
      const g = Math.pow(buffer[i * 4 + 1] * s, 1 / 2.2);
      const b = Math.pow(buffer[i * 4 + 2] * s, 1 / 2.2);
      const rgbMax = Math.max(r, g, b);
      const M = Math.ceil((255 * rgbMax) / 6) / 255;
      const t = M * 6;
      result[i * 4] = Math.ceil((255 * r) / t);
      result[i * 4 + 1] = Math.ceil((255 * g) / t);
      result[i * 4 + 2] = Math.ceil((255 * b) / t);
      result[i * 4 + 3] = Math.ceil(255 * Math.min(M, 1));
    }
    return result;
  }
  private async loadHDR(buffer: Uint8Array, dstFormat: TextureFormat) {
    let header = '';
    let pos = 0;
    const d8 = buffer;
    let format = undefined;
    // read header.
    while (!header.match(/\n\n[^\n]+\n/g)) header += String.fromCharCode(d8[pos++]);
    // check format.
    format = header.match(/FORMAT=(.*)$/m);
    if (format.length < 2) {
      return undefined;
    }
    format = format[1];
    if (format != '32-bit_rle_rgbe') {
      console.warn('unknown format : ' + format);
      return null;
    }
    // parse resolution
    let rez = header.split(/\n/).reverse();
    if (rez.length < 2) {
      return undefined;
    }
    rez = rez[1].split(' ');
    if (rez.length < 4) {
      return undefined;
    }
    const width = Number(rez[3]) * 1,
      height = Number(rez[1]) * 1;
    // Create image.
    const img = new Uint8Array(width * height * 4);
    let ipos = 0;
    // Read all scanlines
    for (let j = 0; j < height; j++) {
      const scanline = [];

      let rgbe = d8.slice(pos, (pos += 4));
      const isNewRLE =
        rgbe[0] == 2 && rgbe[1] == 2 && rgbe[2] == ((width >> 8) & 0xff) && rgbe[3] == (width & 0xff);

      if (isNewRLE && width >= 8 && width < 32768) {
        for (let i = 0; i < 4; i++) {
          let ptr = i * width;
          const ptr_end = (i + 1) * width;
          let buf = undefined;
          let count = undefined;
          while (ptr < ptr_end) {
            buf = d8.slice(pos, (pos += 2));
            if (buf[0] > 128) {
              count = buf[0] - 128;
              while (count-- > 0) scanline[ptr++] = buf[1];
            } else {
              count = buf[0] - 1;
              scanline[ptr++] = buf[1];
              while (count-- > 0) scanline[ptr++] = d8[pos++];
            }
          }
        }

        for (let i = 0; i < width; i++) {
          img[ipos++] = scanline[i + 0 * width];
          img[ipos++] = scanline[i + 1 * width];
          img[ipos++] = scanline[i + 2 * width];
          img[ipos++] = scanline[i + 3 * width];
        }
      } else {
        pos -= 4;

        for (let i = 0; i < width; i++) {
          rgbe = d8.slice(pos, (pos += 4));

          img[ipos++] = rgbe[0];
          img[ipos++] = rgbe[1];
          img[ipos++] = rgbe[2];
          img[ipos++] = rgbe[3];
        }
      }
    }

    const imageFloatBuffer =
      dstFormat === 'rgba32f'
        ? this._rgbeToFloat32(img)
        : dstFormat === 'rgba16f'
        ? this._rgbeToFloat16(img)
        : dstFormat === 'rg11b10uf'
        ? this._rgbeToR11G11B10(img)
        : this._rgbeToRGBM(img);

    return {
      dataFloat: imageFloatBuffer,
      width: width,
      height: height
    };
  }
}
