import type { SamplerOptions, TextureSampler } from '@zephyr3d/device';
import { Application } from '../app';

export type SamplerType =
  | 'clamp_linear'
  | 'clamp_linear_nomip'
  | 'clamp_nearest'
  | 'clamp_nearest_nomip'
  | 'repeat_linear'
  | 'repeat_linear_nomip'
  | 'repeat_nearest'
  | 'repeat_nearest_nomip';

const samplerOptions: Record<SamplerType, SamplerOptions> = {
  clamp_linear: {
    addressU: 'clamp',
    addressV: 'clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipFilter: 'linear'
  },
  clamp_linear_nomip: {
    addressU: 'clamp',
    addressV: 'clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipFilter: 'none'
  },
  clamp_nearest: {
    addressU: 'clamp',
    addressV: 'clamp',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'nearest'
  },
  clamp_nearest_nomip: {
    addressU: 'clamp',
    addressV: 'clamp',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'none'
  },
  repeat_linear: {
    addressU: 'repeat',
    addressV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipFilter: 'linear'
  },
  repeat_linear_nomip: {
    addressU: 'repeat',
    addressV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipFilter: 'none'
  },
  repeat_nearest: {
    addressU: 'repeat',
    addressV: 'repeat',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'nearest'
  },
  repeat_nearest_nomip: {
    addressU: 'repeat',
    addressV: 'repeat',
    magFilter: 'nearest',
    minFilter: 'nearest',
    mipFilter: 'none'
  }
};

const samplers: Partial<Record<SamplerType, TextureSampler>> = {};

export function fetchSampler(type: SamplerType): TextureSampler {
  let sampler = samplers[type];
  if (!sampler) {
    const opt = samplerOptions[type];
    if (opt) {
      sampler = Application.instance.device.createSampler(opt);
      samplers[type] = sampler;
    }
  }
  return sampler;
}
