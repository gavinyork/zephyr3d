import type { CubeFace, TypedArray } from '@zephyr3d/base';
import type { TextureCube, TextureFormat, TextureImageElement, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags, linearTextureFormatToSRGB } from '@zephyr3d/device';
import { NullBaseTexture } from './basetexture_null';
import type { NullDevice } from './device_null';

/**
 * Cube texture of a null device
 * @public
 */
export class NullTextureCube extends NullBaseTexture implements TextureCube<unknown> {
  constructor(device: NullDevice) {
    super(device, 'cube');
  }
  isTextureCube(): this is TextureCube {
    return true;
  }
  update(data: TypedArray, xOffset: number, yOffset: number, width: number, height: number, face: CubeFace) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    this.writeRegion(data, xOffset, yOffset, width, height, face, 0);
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    face: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    void data;
    void x;
    void y;
    this.writeRegion(
      new Uint8Array(Math.max(width, 0) * Math.max(height, 0) * 4),
      xOffset,
      yOffset,
      width,
      height,
      face,
      0
    );
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  createEmpty(format: TextureFormat, size: number, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    this._alloc(format, size, size, 1, this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP ? 1 : 0);
  }
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number) {
    if (!data.isCubemap) {
      console.error('loading cube texture with mipmap data failed: data is not cube texture');
      return;
    }
    this._flags = Number(creationFlags) || 0;
    const format = sRGB ? linearTextureFormatToSRGB(data.format) : data.format;
    this._alloc(format, data.width, data.height, 1, data.mipLevels);
    for (let face = 0; face < Math.min(6, data.mipDatas.length); face++) {
      const levels = data.mipDatas[face];
      for (let level = 0; level < Math.min(this._mipLevelCount, levels.length); level++) {
        const mip = levels[level];
        this.writeRegion(mip.data, 0, 0, mip.width, mip.height, face, level);
      }
    }
  }
}
