import type {
  TextureFormat,
  FramebufferCaps,
  TextureFormatInfo,
  MiscCaps,
  ShaderCaps,
  TextureCaps
} from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { Immutable } from '@zephyr3d/base';

export interface TextureParams {
  gpuFormat: GPUTextureFormat;
  stride: number;
  filterable: boolean;
  renderable: boolean;
  repeatable: boolean;
  compressed: boolean;
  writable: boolean;
  generateMipmap: boolean;
}

export interface TextureFormatInfoWebGPU extends TextureFormatInfo {
  gpuSampleType: GPUTextureSampleType;
  filterable: boolean;
  renderable: boolean;
  compressed: boolean;
  writable: boolean;
}

export class WebGPUFramebufferCaps implements FramebufferCaps {
  maxDrawBuffers: number;
  maxColorAttachmentBytesPerSample: number;
  supportRenderMipmap: boolean;
  supportMultisampledFramebuffer: boolean;
  supportFloatBlending: boolean;
  supportDepth32float: boolean;
  supportDepth32floatStencil8: boolean;
  constructor(device: WebGPUDevice) {
    this.maxDrawBuffers = device.device.limits.maxColorAttachments;
    this.maxColorAttachmentBytesPerSample = device.device.limits.maxColorAttachmentBytesPerSample;
    this.supportRenderMipmap = true;
    this.supportMultisampledFramebuffer = true;
    this.supportFloatBlending = device.device.features.has('float32-blendable');
    this.supportDepth32float = true;
    this.supportDepth32floatStencil8 = device.device.features.has('depth32float-stencil8');
  }
}

export class WebGPUMiscCaps implements MiscCaps {
  supportOversizedViewport: boolean;
  supportBlendMinMax: boolean;
  support32BitIndex: boolean;
  supportDepthClamp: boolean;
  maxBindGroups: number;
  maxTexCoordIndex: number;
  constructor(device: WebGPUDevice) {
    this.supportOversizedViewport = false;
    this.supportBlendMinMax = true;
    this.support32BitIndex = true;
    this.supportDepthClamp = device.device.features.has('depth-clip-control');
    this.maxBindGroups = 4;
    this.maxTexCoordIndex = 8;
  }
}
export class WebGPUShaderCaps implements ShaderCaps {
  supportFragmentDepth: boolean;
  supportStandardDerivatives: boolean;
  supportShaderTextureLod: boolean;
  supportHighPrecisionFloat: boolean;
  maxUniformBufferSize: number;
  uniformBufferOffsetAlignment: number;
  maxStorageBufferSize: number;
  storageBufferOffsetAlignment: number;
  constructor(device: WebGPUDevice) {
    this.supportFragmentDepth = true;
    this.supportStandardDerivatives = true;
    this.supportShaderTextureLod = true;
    this.supportHighPrecisionFloat = true;
    this.maxUniformBufferSize = device.device.limits.maxUniformBufferBindingSize || 65536;
    this.uniformBufferOffsetAlignment = device.device.limits.minUniformBufferOffsetAlignment || 256;
    this.maxStorageBufferSize = device.device.limits.maxStorageBufferBindingSize || 128 * 1024 * 1024;
    this.storageBufferOffsetAlignment = device.device.limits.minStorageBufferOffsetAlignment || 256;
  }
}
export class WebGPUTextureCaps implements TextureCaps {
  private readonly _textureFormatInfos: Record<TextureFormat, TextureFormatInfoWebGPU>;
  maxTextureSize: number;
  maxCubeTextureSize: number;
  npo2Mipmapping: boolean;
  npo2Repeating: boolean;
  supportS3TC: boolean;
  supportS3TCSRGB: boolean;
  supportBPTC: boolean;
  supportRGTC: boolean;
  supportASTC: boolean;
  supportDepthTexture: boolean;
  support3DTexture: boolean;
  supportSRGBTexture: boolean;
  supportFloatTexture: boolean;
  supportLinearFloatTexture: boolean;
  supportHalfFloatTexture: boolean;
  supportLinearHalfFloatTexture: boolean;
  supportAnisotropicFiltering: boolean;
  supportFloatColorBuffer: boolean;
  supportHalfFloatColorBuffer: boolean;
  supportFloatBlending: boolean;
  constructor(device: WebGPUDevice) {
    this.supportAnisotropicFiltering = true;
    this.supportDepthTexture = true;
    this.support3DTexture = true;
    this.supportSRGBTexture = true;
    this.supportFloatTexture = true;
    this.supportFloatColorBuffer = true;
    this.supportHalfFloatColorBuffer = true;
    this.supportFloatBlending = true;
    this.supportS3TC = device.device.features.has('texture-compression-bc');
    this.supportS3TCSRGB = this.supportS3TC;
    this.supportBPTC = this.supportS3TC;
    this.supportRGTC = this.supportS3TC;
    this.supportASTC = device.device.features.has('texture-compression-astc');
    this.supportHalfFloatTexture = true;
    this.maxTextureSize = device.device.limits.maxTextureDimension2D;
    this.maxCubeTextureSize = device.device.limits.maxTextureDimension2D;
    this.npo2Mipmapping = true;
    this.npo2Repeating = true;
    this._textureFormatInfos = {
      ['rgba8unorm']: {
        gpuSampleType: 'float',
        filterable: true,
        renderable: true,
        compressed: false,
        writable: true,
        blockWidth: 1,
        blockHeight: 1,
        size: 4
      },
      ['rgba8snorm']: {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: false,
        writable: true,
        blockWidth: 1,
        blockHeight: 1,
        size: 4
      },
      ['bgra8unorm']: {
        gpuSampleType: 'float',
        filterable: true,
        renderable: true,
        compressed: false,
        writable: false, // TODO: require "bgra8unorm-storage" feature
        blockWidth: 1,
        blockHeight: 1,
        size: 4
      }
    } as Record<TextureFormat, TextureFormatInfoWebGPU>;
    if (this.supportASTC) {
      for (const k of [
        '4x4',
        '5x4',
        '5x5',
        '6x5',
        '6x6',
        '8x5',
        '8x6',
        '8x8',
        '10x5',
        '10x6',
        '10x8',
        '10x10',
        '12x10',
        '12x12'
      ]) {
        const [w, h] = k.split('x').map((val) => Number(val));
        this._textureFormatInfos[`astc-${k}`] = {
          gpuSampleType: 'float',
          filterable: true,
          renderable: false,
          compressed: true,
          writable: false,
          size: 16,
          blockWidth: w,
          blockHeight: h
        };
        this._textureFormatInfos[`astc-${k}-srgb`] = {
          gpuSampleType: 'float',
          filterable: true,
          renderable: false,
          compressed: true,
          size: 16,
          writable: false,
          blockWidth: w,
          blockHeight: h
        };
      }
    }
    if (this.supportS3TC) {
      this._textureFormatInfos['dxt1'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 8,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['dxt3'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['dxt5'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
    }
    if (this.supportRGTC) {
      this._textureFormatInfos['bc4'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 8,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['bc4-signed'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 8,
        blockWidth: 4,
        blockHeight: 4
      };
    }
    this._textureFormatInfos['bc5'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: false,
      compressed: true,
      writable: false,
      size: 16,
      blockWidth: 4,
      blockHeight: 4
    };
    this._textureFormatInfos['bc5-signed'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: false,
      compressed: true,
      writable: false,
      size: 16,
      blockWidth: 4,
      blockHeight: 4
    };
    if (this.supportBPTC) {
      this._textureFormatInfos['bc6h'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['bc6h-signed'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['bc7'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['bc7-srgb'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
    }
    if (this.supportS3TCSRGB) {
      this._textureFormatInfos['dxt1-srgb'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 8,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['dxt3-srgb'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
      this._textureFormatInfos['dxt5-srgb'] = {
        gpuSampleType: 'float',
        filterable: true,
        renderable: false,
        compressed: true,
        writable: false,
        size: 16,
        blockWidth: 4,
        blockHeight: 4
      };
    }
    this._textureFormatInfos['r8unorm'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 1
    };
    this._textureFormatInfos['r8snorm'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: false,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 1
    };
    this._textureFormatInfos['r16f'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['r32f'] = {
      gpuSampleType: 'unfilterable-float',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['r8ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 1
    };
    this._textureFormatInfos['r8i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 1
    };
    this._textureFormatInfos['r16ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['r16i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['r32ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['r32i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rg8unorm'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['rg8snorm'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: false,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['rg16f'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rg32f'] = {
      gpuSampleType: 'unfilterable-float',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rg8ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['rg8i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['rg16ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rg16i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rg32ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rg32i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rgba8unorm-srgb'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['bgra8unorm-srgb'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rgba16f'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rgba32f'] = {
      gpuSampleType: 'unfilterable-float',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 16
    };
    this._textureFormatInfos['rgba8ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rgba8i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['rgba16ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rgba16i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['rgba32ui'] = {
      gpuSampleType: 'uint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 16
    };
    this._textureFormatInfos['rgba32i'] = {
      gpuSampleType: 'sint',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: true,
      blockWidth: 1,
      blockHeight: 1,
      size: 16
    };
    this._textureFormatInfos['rg11b10uf'] = {
      gpuSampleType: 'float',
      filterable: true,
      renderable: device.device.features.has('rg11b10ufloat-renderable'),
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['d16'] = {
      gpuSampleType: 'depth',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 2
    };
    this._textureFormatInfos['d24'] = {
      gpuSampleType: 'depth',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['d32f'] = {
      gpuSampleType: 'depth',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this._textureFormatInfos['d32fs8'] = {
      gpuSampleType: 'depth',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 8
    };
    this._textureFormatInfos['d24s8'] = {
      gpuSampleType: 'depth',
      filterable: false,
      renderable: true,
      compressed: false,
      writable: false,
      blockWidth: 1,
      blockHeight: 1,
      size: 4
    };
    this.supportLinearFloatTexture =
      this._textureFormatInfos['r32f'].filterable &&
      this._textureFormatInfos['rg32f'].filterable &&
      this._textureFormatInfos['rgba32f'].filterable;
    this.supportLinearHalfFloatTexture =
      this._textureFormatInfos['r16f'].filterable &&
      this._textureFormatInfos['rg16f'].filterable &&
      this._textureFormatInfos['rgba16f'].filterable;
  }
  calcMemoryUsage(format: TextureFormat, numPixels: number) {
    return this._textureFormatInfos[format] ? this._textureFormatInfos[format].size * numPixels : 0;
  }
  getTextureFormatInfo(format: TextureFormat): Immutable<TextureFormatInfoWebGPU> {
    return this._textureFormatInfos[format];
  }
}
