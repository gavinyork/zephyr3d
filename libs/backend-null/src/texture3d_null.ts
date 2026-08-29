import type { TypedArray } from '@zephyr3d/base';
import type { Texture3D, TextureFormat, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { NullBaseTexture } from './basetexture_null';
import type { NullDevice } from './device_null';

/**
 * 3D texture of a null device
 * @public
 */
export class NullTexture3D extends NullBaseTexture implements Texture3D<unknown> {
  constructor(device: NullDevice) {
    super(device, '3d');
  }
  isTexture3D(): this is Texture3D {
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
    // Volume slices are stored as one "layer" each, matching the 2d array layout.
    const bytesPerSlice = data.byteLength / Math.max(depth, 1);
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let slice = 0; slice < depth; slice++) {
      this.writeRegion(
        src.subarray(slice * bytesPerSlice, (slice + 1) * bytesPerSlice),
        xOffset,
        yOffset,
        width,
        height,
        zOffset + slice,
        0
      );
    }
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  createEmpty(format: TextureFormat, width: number, height: number, depth: number, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    this._alloc(format, width, height, depth, this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP ? 1 : 0);
  }
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number) {
    if (!data.isVolume) {
      console.error('loading 3d texture with mipmap data failed: data is not 3d texture');
      return;
    }
    this._flags = Number(creationFlags) || 0;
    this._alloc(data.format, data.width, data.height, data.depth, data.mipLevels);
    for (let level = 0; level < Math.min(this._mipLevelCount, data.mipDatas[0].length); level++) {
      const mip = data.mipDatas[0][level];
      this.writeRegion(mip.data, 0, 0, mip.width, mip.height, 0, level);
    }
  }
}
