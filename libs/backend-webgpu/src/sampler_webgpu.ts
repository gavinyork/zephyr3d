import { WebGPUObject } from './gpuobject_webgpu';
import { textureWrappingMap, textureFilterMap, compareFuncMap } from './constants_webgpu';
import type { SamplerOptions, TextureSampler } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';

export class WebGPUTextureSampler extends WebGPUObject<GPUSampler> implements TextureSampler<GPUSampler> {
  private _options: SamplerOptions;
  constructor(device: WebGPUDevice, options: SamplerOptions) {
    super(device);
    this._options = Object.assign(
      {
        addressU: 'clamp',
        addressV: 'clamp',
        addressW: 'clamp',
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none',
        lodMin: 0,
        lodMax: 32,
        compare: null,
        maxAnisotropy: 1
      },
      options || {}
    );
    this._load();
  }
  get hash(): number {
    return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
  }
  get addressModeU() {
    return this._options.addressU;
  }
  get addressModeV() {
    return this._options.addressV;
  }
  get addressModeW() {
    return this._options.addressW;
  }
  get magFilter() {
    return this._options.magFilter;
  }
  get minFilter() {
    return this._options.minFilter;
  }
  get mipFilter() {
    return this._options.mipFilter;
  }
  get lodMin() {
    return this._options.lodMin;
  }
  get lodMax() {
    return this._options.lodMax;
  }
  get compare() {
    return this._options.compare;
  }
  get maxAnisotropy() {
    return this._options.maxAnisotropy;
  }
  destroy() {
    this._object = null;
  }
  async restore() {
    if (!this._device.isContextLost()) {
      this._load();
    }
  }
  private _load(): boolean {
    this._object = this._device.gpuCreateSampler({
      addressModeU: textureWrappingMap[this._options.addressU],
      addressModeV: textureWrappingMap[this._options.addressV],
      addressModeW: textureWrappingMap[this._options.addressW],
      magFilter: textureFilterMap[this._options.magFilter],
      minFilter: textureFilterMap[this._options.minFilter],
      mipmapFilter: textureFilterMap[this._options.mipFilter],
      lodMinClamp: this._options.lodMin,
      lodMaxClamp: this._options.lodMax,
      compare: compareFuncMap[this._options.compare] || undefined,
      maxAnisotropy: this._options.maxAnisotropy
    });
    return !!this._object;
  }
  isSampler(): boolean {
    return true;
  }
}
