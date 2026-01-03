import type { TypedArray } from '@zephyr3d/base';
import type { GPUDataBuffer, TextureVideo } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUDevice } from './device';
import type { WebGPUBindGroup } from './bindgroup_webgpu';

export class WebGPUTextureVideo
  extends WebGPUBaseTexture<GPUExternalTexture>
  implements TextureVideo<GPUExternalTexture>
{
  private readonly _source: HTMLVideoElement;
  private readonly _refBindGroups: WebGPUBindGroup[];
  constructor(device: WebGPUDevice, element: HTMLVideoElement) {
    super(device, '2d');
    this._source = element;
    this._width = 0;
    this._height = 0;
    this._refBindGroups = [];
    this.loadFromElement();
  }
  isTextureVideo(): this is TextureVideo {
    return true;
  }
  addBindGroupReference(bindGroup: WebGPUBindGroup) {
    this._refBindGroups.push(bindGroup);
  }
  removeBindGroupReference(bindGroup: WebGPUBindGroup) {
    const index = this._refBindGroups.indexOf(bindGroup);
    if (index >= 0) {
      this._refBindGroups.splice(index, 1);
    }
  }
  get width() {
    return this._width;
  }
  get height() {
    return this._height;
  }
  get source() {
    return this._source;
  }
  restore() {
    if (!this._object && !this._device.isContextLost()) {
      this.loadElement(this._source);
    }
  }
  updateVideoFrame() {
    if (this._source.readyState > 2) {
      const videoFrame = new (window as any).VideoFrame(this._source);
      videoFrame.close();
      this._object = this._device.gpuImportExternalTexture(this._source);
      return true;
    }
    return false;
  }
  createView(_level?: number, _face?: number, _mipCount?: number) {
    return null;
  }
  init() {
    this.loadFromElement();
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
  /** @internal */
  loadFromElement() {
    this.loadElement(this._source);
  }
  /** @internal */
  private loadElement(element: HTMLVideoElement) {
    this._format = 'rgba8unorm';
    this._width = element.videoWidth;
    this._height = element.videoHeight;
    this._depth = 1;
    this._mipLevelCount = 1;
    if (!this._device.isContextLost()) {
      if (element.readyState > 2) {
        this._object = this._device.gpuImportExternalTexture(element);
        const that = this;
        this._device.runNextFrame(function updateVideoFrame() {
          if (!that.disposed) {
            if (that._source.readyState > 2) {
              const videoFrame = new (window as any).VideoFrame(that._source);
              videoFrame.close();
              that._object = that._device.gpuImportExternalTexture(that._source);
              for (const bindGroup of that._refBindGroups) {
                bindGroup.invalidate();
              }
            }
            that._device.runNextFrame(updateVideoFrame);
          }
        });
      }
    }
    return !!this._object;
  }
}
