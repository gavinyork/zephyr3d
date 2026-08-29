import type { TypedArray } from '@zephyr3d/base';
import type { Texture2D, TextureFormat, TextureImageElement, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags, linearTextureFormatToSRGB } from '@zephyr3d/device';
import { NullBaseTexture } from './basetexture_null';
import type { NullDevice } from './device_null';

/**
 * 2D texture of a null device
 * @public
 */
export class NullTexture2D extends NullBaseTexture implements Texture2D<unknown> {
  constructor(device: NullDevice) {
    super(device, '2d');
  }
  isTexture2D(): this is Texture2D {
    return true;
  }
  update(data: TypedArray, xOffset: number, yOffset: number, width: number, height: number) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    this.writeRegion(data, xOffset, yOffset, width, height, 0, 0);
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    destX: number,
    destY: number,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    // No pixel source is available without a real 2D context: record the
    // upload extent by writing zeros so the level is considered initialized.
    this.writeRegion(this.createElementData(width, height), destX, destY, width, height, 0, 0);
    void srcX;
    void srcY;
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  loadFromElement(element: TextureImageElement, sRGB: boolean, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    const format = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
    this._alloc(format, Number(element.width), Number(element.height), 1, 0);
    this.writeRegion(
      this.createElementData(Number(element.width), Number(element.height)),
      0,
      0,
      Number(element.width),
      Number(element.height),
      0,
      0
    );
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  createEmpty(format: TextureFormat, width: number, height: number, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    this._alloc(format, width, height, 1, this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP ? 1 : 0);
  }
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number) {
    if (data.isCubemap || data.isVolume) {
      console.error('loading 2d texture with mipmap data failed: data is not 2d texture');
      return;
    }
    this._flags = Number(creationFlags) || 0;
    const format = sRGB ? linearTextureFormatToSRGB(data.format) : data.format;
    this._alloc(format, data.width, data.height, 1, data.mipLevels);
    for (let level = 0; level < Math.min(this._mipLevelCount, data.mipDatas[0].length); level++) {
      const mip = data.mipDatas[0][level];
      this.writeRegion(mip.data, 0, 0, mip.width, mip.height, 0, level);
    }
  }
  /** @internal */
  private createElementData(width: number, height: number) {
    return new Uint8Array(Math.max(width, 0) * Math.max(height, 0) * 4);
  }
}
