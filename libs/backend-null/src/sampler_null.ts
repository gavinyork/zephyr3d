import type { RequireOptionals } from '@zephyr3d/base';
import type { SamplerOptions, TextureSampler } from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

/**
 * Texture sampler of a null device
 * @public
 */
export class NullTextureSampler extends NullGPUObject<unknown> implements TextureSampler<unknown> {
  /** @internal */
  private readonly _options: RequireOptionals<SamplerOptions>;
  constructor(device: NullDevice, options?: SamplerOptions) {
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
      } as RequireOptionals<SamplerOptions>,
      options ?? {}
    );
    this._object = this._createFakeObject();
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
  /** The resolved sampler options */
  get options(): RequireOptionals<SamplerOptions> {
    return this._options;
  }
  isSampler(): this is TextureSampler {
    return true;
  }
}

/**
 * Caches samplers so that identical options share one sampler object
 * @internal
 */
export class NullSamplerCache {
  private readonly _device: NullDevice;
  private readonly _samplers: Record<string, NullTextureSampler>;
  constructor(device: NullDevice) {
    this._device = device;
    this._samplers = {};
  }
  fetchSampler(options?: SamplerOptions) {
    const hash = this.hashOptions(options);
    let sampler = this._samplers[hash];
    if (!sampler || sampler.disposed) {
      sampler = new NullTextureSampler(this._device, options);
      this._samplers[hash] = sampler;
    }
    return sampler;
  }
  private hashOptions(options?: SamplerOptions) {
    return [
      options?.addressU ?? 'clamp',
      options?.addressV ?? 'clamp',
      options?.addressW ?? 'clamp',
      options?.magFilter ?? 'nearest',
      options?.minFilter ?? 'nearest',
      options?.mipFilter ?? 'none',
      options?.lodMin ?? 0,
      options?.lodMax ?? 32,
      options?.compare ?? 'none',
      options?.maxAnisotropy ?? 1
    ].join(':');
  }
}
