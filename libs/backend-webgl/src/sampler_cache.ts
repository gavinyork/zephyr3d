import { WebGLTextureSampler } from './sampler_webgl';
import type { SamplerOptions } from '@zephyr3d/device';
import type { WebGLDevice } from './device_webgl';
export class SamplerCache {
  private _device: WebGLDevice;
  private _samplers: Record<string, WebGLTextureSampler>;
  constructor(device: WebGLDevice) {
    this._device = device;
    this._samplers = {};
  }
  fetchSampler(options: SamplerOptions): WebGLTextureSampler {
    const hash = this.hash(options);
    let sampler = this._samplers[hash];
    if (!sampler) {
      sampler = this.createSampler(options);
      this._samplers[hash] = sampler;
    }
    return sampler;
  }
  private hash(options: SamplerOptions): string {
    const addressU = options.addressU ? String(options.addressU) : '';
    const addressV = options.addressV ? String(options.addressV) : '';
    const addressW = options.addressW ? String(options.addressW) : '';
    const magFilter = options.magFilter ? String(options.magFilter) : '';
    const minFilter = options.minFilter ? String(options.minFilter) : '';
    const mipFilter = options.mipFilter ? String(options.mipFilter) : '';
    const lodMin = options.lodMin ? String(options.lodMin) : '';
    const lodMax = options.lodMax ? String(options.lodMax) : '';
    const compare = options.compare ? String(options.compare) : '';
    const maxAnisotropy = options.maxAnisotropy ? String(options.maxAnisotropy) : '';
    return `${addressU}:${addressV}:${addressW}:${magFilter}:${minFilter}:${mipFilter}:${lodMin}:${lodMax}:${compare}:${maxAnisotropy}`;
  }
  private createSampler(options: SamplerOptions): WebGLTextureSampler {
    return new WebGLTextureSampler(this._device, options);
  }
}
