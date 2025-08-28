import type {
  BaseTexture,
  FrameBuffer,
  RenderStateSet,
  SamplerOptions,
  TextureSampler
} from '@zephyr3d/device';
import { CopyBlitter } from '../blitter/copy';
import { getDevice } from '../app/api';

/**
 * Metadata interface for storing additional information
 * @public
 */
export interface Metadata {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | Metadata
    | Array<string | number | boolean | null | undefined | Metadata>;
}

/**
 * Sampler types
 * @public
 */
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
let copyBlitter: CopyBlitter = null;
let defaultCopyRenderState: RenderStateSet = null;

/**
 * Fetch a sampler by type
 * @param type - The sampler type to fetch
 * @returns The sampler for the given type
 * @public
 */
export function fetchSampler(type: SamplerType): TextureSampler {
  let sampler = samplers[type];
  if (!sampler) {
    const opt = samplerOptions[type];
    if (opt) {
      sampler = getDevice().createSampler(opt);
      samplers[type] = sampler;
    }
  }
  return sampler;
}

/**
 * Utility function to copy a texture
 * @param src - Source texture to copy from
 * @param dest - Destination texture to copy to
 * @param sampler - Sampler object use to sample the source texture
 * @param renderState - RenderStateSet object used to copy texture
 * @param layer - Texture layer to copy
 * @param srgbOut - true if output color in sRGB color space
 * @internal
 */
export function copyTexture(
  src: BaseTexture,
  dest: BaseTexture | FrameBuffer,
  sampler: TextureSampler = null,
  renderState: RenderStateSet = null,
  layer = 0,
  srgbOut = false
) {
  if (!renderState && !defaultCopyRenderState) {
    defaultCopyRenderState = src.device.createRenderStateSet();
    defaultCopyRenderState.useDepthState().enableTest(false).enableWrite(false);
    defaultCopyRenderState.useRasterizerState().setCullMode('none');
  }
  if (!copyBlitter) {
    copyBlitter = new CopyBlitter();
  }
  copyBlitter.renderStates = renderState ?? defaultCopyRenderState;
  copyBlitter.srgbOut = srgbOut;
  copyBlitter.blit(src, dest, layer, sampler);
}
