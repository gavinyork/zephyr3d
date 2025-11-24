import type { GPUDataBuffer, TextureVideo } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { textureTargetMap } from './constants_webgl';
import { WebGLBaseTexture } from './basetexture_webgl';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';
import type { TypedArray } from '@zephyr3d/base';

export class WebGLTextureVideo extends WebGLBaseTexture implements TextureVideo<WebGLTexture> {
  private _source: HTMLVideoElement;
  private _callbackId: number;
  constructor(device: WebGLDevice, source: HTMLVideoElement) {
    super(device, '2d');
    this._source = null;
    this._callbackId = null;
    this._format = 'unknown';
    this.loadFromElement(source);
  }
  isTextureVideo(): this is TextureVideo {
    return true;
  }
  get source(): HTMLVideoElement {
    return this._source;
  }
  destroy(): void {
    if (this._source && this._callbackId !== null) {
      this._source.cancelVideoFrameCallback(this._callbackId);
    }
    super.destroy();
  }
  init() {
    this.loadElement(this._source);
  }
  /** @internal */
  loadFromElement(el: HTMLVideoElement): void {
    this._flags = GPUResourceUsageFlags.TF_NO_MIPMAP;
    this.loadElement(el);
  }
  generateMipmaps() {
    // Does nothing
  }
  readPixels(
    _x: number,
    _y: number,
    _w: number,
    _h: number,
    _faceOrLayer: number,
    _mipLevel: number,
    _buffer: TypedArray
  ): Promise<void> {
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
  ): void {
    throw new Error(`Video texture does not support readPixelsToBuffer()`);
  }
  /** @internal */
  updateVideoFrame(): boolean {
    if (this.object && this._source.currentTime > 0 && !this._source.requestVideoFrameCallback) {
      this.update();
      return true;
    }
    return false;
  }
  /** @internal */
  private update(): void {
    this.allocInternal('rgba8unorm', this._source.videoWidth, this._source.videoHeight, 1, 1);
    if (!this._device.isContextLost()) {
      const target = textureTargetMap[this._target];
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      this._device.bindTexture(target, 0, this);
      //this._device.context.bindTexture(target, this._object);
      this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
      this._device.context.texImage2D(
        target,
        0,
        params.glInternalFormat,
        params.glFormat,
        params.glType[0],
        this._source
      );
    }
  }
  /** @internal */
  private loadElement(element: HTMLVideoElement): void {
    if (this._source && this._callbackId !== null) {
      this._source.cancelVideoFrameCallback(this._callbackId);
      this._callbackId = null;
    }
    this._source = element;
    if (this._source?.requestVideoFrameCallback) {
      const that = this;
      that._callbackId = this._source.requestVideoFrameCallback(function cb() {
        if (that._object) {
          that.update();
          that._callbackId = that._source.requestVideoFrameCallback(cb);
        }
      });
    }
    this.allocInternal(
      'rgba8unorm',
      Math.max(this._source.videoWidth, 1),
      Math.max(this._source.videoHeight, 1),
      1,
      1
    );
  }
}
