import type { TypedArray } from '@zephyr3d/base';
import type { Texture2DArray, TextureFormat, TextureImageElement, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { NullBaseTexture } from './basetexture_null';
import type { NullDevice } from './device_null';

/**
 * 2D array texture of a null device
 * @public
 */
export class NullTexture2DArray extends NullBaseTexture implements Texture2DArray<unknown> {
  constructor(device: NullDevice) {
    super(device, '2darray');
  }
  isTexture2DArray(): this is Texture2DArray {
    return true;
  }
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    zOffset: number,
    width: number,
    height: number,
    depth: number
  ) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, this._depth, this._mipLevelCount);
    }
    const bytesPerLayer = data.byteLength / Math.max(depth, 1);
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let layer = 0; layer < depth; layer++) {
      this.writeRegion(
        src.subarray(layer * bytesPerLayer, (layer + 1) * bytesPerLayer),
        xOffset,
        yOffset,
        width,
        height,
        zOffset + layer,
        0
      );
    }
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    layerIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ) {
    if (!this._object) {
      this._alloc(this._format!, this._width, this._height, this._depth, this._mipLevelCount);
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
      layerIndex,
      0
    );
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  createEmpty(format: TextureFormat, width: number, height: number, depth: number, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    this._alloc(format, width, height, depth, this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP ? 1 : 0);
  }
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number) {
    if (!data.isArray) {
      console.error('loading 2d array texture with mipmap data failed: data is not 2d array texture');
      return;
    }
    this._flags = Number(creationFlags) || 0;
    this._alloc(data.format, data.width, data.height, data.arraySize, data.mipLevels);
    for (let layer = 0; layer < Math.min(data.arraySize, data.mipDatas.length); layer++) {
      const levels = data.mipDatas[layer];
      for (let level = 0; level < Math.min(this._mipLevelCount, levels.length); level++) {
        const mip = levels[level];
        this.writeRegion(mip.data, 0, 0, mip.width, mip.height, layer, level);
      }
    }
  }
}
