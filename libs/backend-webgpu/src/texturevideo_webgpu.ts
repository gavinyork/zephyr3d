import type { TypedArray } from '@zephyr3d/base';
import type { GPUDataBuffer, TextureVideo } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUDevice } from './device';

export class WebGPUTextureVideo
  extends WebGPUBaseTexture<GPUExternalTexture>
  implements TextureVideo<GPUExternalTexture>
{
  private _source: HTMLVideoElement;
  constructor(device: WebGPUDevice, element: HTMLVideoElement) {
    super(device, '2d');
    this._source = element;
    this._width = 0;
    this._height = 0;
    this.loadFromElement();
  }
  isTextureVideo(): this is TextureVideo {
    return true;
  }
  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get source(): HTMLVideoElement {
    return this._source;
  }
  async restore() {
    if (!this._object && !this._device.isContextLost()) {
      this.loadElement(this._source);
    }
  }
  updateVideoFrame(): boolean {
    if (
      this._source.readyState > 2
    ) {
      const videoFrame = new ((window as any).VideoFrame)(this._source);
      videoFrame.close();
      this._object = this._device.gpuImportExternalTexture(this._source);
      return true;
    }
    return false;
  }
  createView(level?: number, face?: number, mipCount?: number): GPUTextureView {
    return null;
  }
  init(): void {
    this.loadFromElement();
  }
  readPixels(x: number, y: number, w: number, h: number, faceOrLayer: number, mipLevel: number, buffer: TypedArray): Promise<void> {
    throw new Error(`Video texture does not support readPixels()`);
  }
  readPixelsToBuffer(x: number, y: number, w: number, h: number, faceOrLayer: number, mipLevel: number, buffer: GPUDataBuffer<unknown>): void {
    throw new Error(`Video texture does not support readPixelsToBuffer()`);
  }
  /** @internal */
  loadFromElement(): void {
    this.loadElement(this._source);
  }
  /** @internal */
  private loadElement(element: HTMLVideoElement): boolean {
    this._format = 'rgba8unorm';
    this._width = element.videoWidth;
    this._height = element.videoHeight;
    this._depth = 1;
    this._mipLevelCount = 1;
    if (!this._device.isContextLost()) {
      if (element.readyState > 2) {
        this._object = this._device.gpuImportExternalTexture(element);
      }
    }
    return !!this._object;
  }
}