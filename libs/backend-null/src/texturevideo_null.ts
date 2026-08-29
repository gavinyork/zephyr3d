import type { TypedArray } from '@zephyr3d/base';
import type { GPUDataBuffer, TextureVideo } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { NullBaseTexture } from './basetexture_null';
import type { NullDevice } from './device_null';

/**
 * Video texture of a null device
 * @public
 */
export class NullTextureVideo extends NullBaseTexture implements TextureVideo<unknown> {
  /** @internal */
  private _source: HTMLVideoElement;
  constructor(device: NullDevice, source: HTMLVideoElement) {
    super(device, '2d');
    this._source = source;
    this._flags = GPUResourceUsageFlags.TF_NO_MIPMAP;
    this.init();
  }
  isTextureVideo(): this is TextureVideo {
    return true;
  }
  get source() {
    return this._source;
  }
  init() {
    this._alloc(
      'rgba8unorm',
      Math.max(this._source?.videoWidth ?? 0, 1),
      Math.max(this._source?.videoHeight ?? 0, 1),
      1,
      1
    );
  }
  generateMipmaps() {
    // Video textures never have mipmaps
  }
  updateVideoFrame() {
    return false;
  }
  async readPixels(
    _x: number,
    _y: number,
    _w: number,
    _h: number,
    _faceOrLayer: number,
    _mipLevel: number,
    _buffer: TypedArray
  ) {
    throw new Error(`Video texture does not support readPixels()`);
  }
  readPixelsToBuffer(
    _x: number,
    _y: number,
    _w: number,
    _h: number,
    _faceOrLayer: number,
    _mipLevel: number,
    _buffer: GPUDataBuffer<unknown>
  ) {
    throw new Error(`Video texture does not support readPixelsToBuffer()`);
  }
}
