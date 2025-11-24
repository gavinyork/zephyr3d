import { WebGPUTextureSampler } from './sampler_webgpu';
import type { SamplerOptions } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
export class SamplerCache {
  private readonly _device: WebGPUDevice;
  private _samplers: Record<string, WebGPUTextureSampler>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._samplers = {};
  }
  fetchSampler(options: SamplerOptions): WebGPUTextureSampler {
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
  private createSampler(options: SamplerOptions): WebGPUTextureSampler {
    return new WebGPUTextureSampler(this._device, options);
  }
}
