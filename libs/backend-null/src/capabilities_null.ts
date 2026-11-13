import type { Immutable } from '@zephyr3d/base';
import type {
  FramebufferCaps,
  MiscCaps,
  ShaderCaps,
  TextureCaps,
  TextureFormat,
  TextureFormatInfo
} from '@zephyr3d/device';
import {
  getTextureFormatBlockHeight,
  getTextureFormatBlockSize,
  getTextureFormatBlockWidth,
  hasDepthChannel,
  isCompressedTextureFormat,
  isFloatTextureFormat,
  isIntegerTextureFormat
} from '@zephyr3d/device';
import type { NullDeviceCapsOptions, NullDeviceType } from './types';

/** Formats WebGPU storage textures can write without any feature */
const CORE_STORAGE_FORMATS: ReadonlySet<TextureFormat> = new Set<TextureFormat>([
  'rgba8unorm',
  'rgba8snorm',
  'rgba8ui',
  'rgba8i',
  'rgba16ui',
  'rgba16i',
  'rgba16f',
  'r32f',
  'r32ui',
  'r32i',
  'rg32f',
  'rg32ui',
  'rg32i',
  'rgba32f',
  'rgba32ui',
  'rgba32i'
]);
/** Formats texture-formats-tier1 adds to the WebGPU storage formats */
const TIER1_STORAGE_FORMATS: ReadonlySet<TextureFormat> = new Set<TextureFormat>([
  'r8unorm',
  'r8snorm',
  'r8ui',
  'r8i',
  'rg8unorm',
  'rg8snorm',
  'rg8ui',
  'rg8i',
  'r16ui',
  'r16i',
  'r16f',
  'rg16ui',
  'rg16i',
  'rg16f',
  'rg11b10uf'
]);
/** Formats WebGPU storage textures can read and write without any feature */
const CORE_READ_WRITE_FORMATS: ReadonlySet<TextureFormat> = new Set<TextureFormat>(['r32f', 'r32ui', 'r32i']);
/** Formats texture-formats-tier2 lets WebGPU storage textures read and write */
const TIER2_READ_WRITE_FORMATS: ReadonlySet<TextureFormat> = new Set<TextureFormat>([
  'r8unorm',
  'r8ui',
  'r8i',
  'rgba8unorm',
  'rgba8ui',
  'rgba8i',
  'r16ui',
  'r16i',
  'r16f',
  'rgba16ui',
  'rgba16i',
  'rgba16f',
  'rgba32ui',
  'rgba32i',
  'rgba32f'
]);

/**
 * Frame buffer capabilities of a null device
 * @public
 */
export class NullFramebufferCaps implements FramebufferCaps {
  maxDrawBuffers: number;
  supportPerTargetBlending: boolean;
  supportRenderMipmap: boolean;
  supportMultisampledFramebuffer: boolean;
  supportFloatBlending: boolean;
  supportDepth32float: boolean;
  supportDepth32floatStencil8: boolean;
  maxColorAttachmentBytesPerSample: number;
  constructor(type: NullDeviceType, overrides?: Partial<FramebufferCaps>) {
    this.maxDrawBuffers = 8;
    this.supportPerTargetBlending = type === 'webgpu';
    this.supportRenderMipmap = true;
    this.supportMultisampledFramebuffer = true;
    this.supportFloatBlending = type === 'webgpu';
    this.supportDepth32float = true;
    this.supportDepth32floatStencil8 = type === 'webgpu';
    this.maxColorAttachmentBytesPerSample = 32;
    Object.assign(this, overrides ?? {});
  }
}

/**
 * Miscellaneous capabilities of a null device
 * @public
 */
export class NullMiscCaps implements MiscCaps {
  supportOversizedViewport: boolean;
  supportBlendMinMax: boolean;
  support32BitIndex: boolean;
  maxBindGroups: number;
  maxTexCoordIndex: number;
  supportTimestampQuery: boolean;
  supportClipControl: boolean;
  supportDrawIndirect: boolean;
  supportDispatchIndirect: boolean;
  supportIndirectFirstInstance: boolean;
  constructor(type: NullDeviceType, overrides?: Partial<MiscCaps>) {
    this.supportOversizedViewport = type !== 'webgpu';
    this.supportBlendMinMax = true;
    this.support32BitIndex = true;
    this.maxBindGroups = 4;
    this.maxTexCoordIndex = 8;
    this.supportTimestampQuery = false;
    this.supportClipControl = type === 'webgpu';
    this.supportDrawIndirect = type === 'webgpu';
    this.supportDispatchIndirect = type === 'webgpu';
    this.supportIndirectFirstInstance = type === 'webgpu';
    Object.assign(this, overrides ?? {});
  }
}

/**
 * Shader capabilities of a null device
 * @public
 */
export class NullShaderCaps implements ShaderCaps {
  supportFragmentDepth: boolean;
  supportStandardDerivatives: boolean;
  supportShaderTextureLod: boolean;
  supportHighPrecisionFloat: boolean;
  supportShaderF16: boolean;
  maxUniformBufferSize: number;
  uniformBufferOffsetAlignment: number;
  maxStorageBufferSize: number;
  storageBufferOffsetAlignment: number;
  maxVertexUniformVectors: number;
  maxFragmentUniformVectors: number;
  constructor(type: NullDeviceType, overrides?: Partial<ShaderCaps>) {
    this.supportFragmentDepth = true;
    this.supportStandardDerivatives = true;
    this.supportShaderTextureLod = true;
    this.supportHighPrecisionFloat = true;
    this.supportShaderF16 = type === 'webgpu';
    this.maxUniformBufferSize = 65536;
    this.uniformBufferOffsetAlignment = 256;
    this.maxStorageBufferSize = 128 * 1024 * 1024;
    this.storageBufferOffsetAlignment = 256;
    this.maxVertexUniformVectors = type === 'webgpu' ? this.maxUniformBufferSize >> 4 : 256;
    this.maxFragmentUniformVectors = type === 'webgpu' ? this.maxUniformBufferSize >> 4 : 1024;
    Object.assign(this, overrides ?? {});
  }
}

/**
 * Texture capabilities of a null device
 * @public
 */
export class NullTextureCaps implements TextureCaps {
  maxTextureSize: number;
  maxCubeTextureSize: number;
  npo2Mipmapping: boolean;
  npo2Repeating: boolean;
  supportS3TC: boolean;
  supportBPTC: boolean;
  supportRGTC: boolean;
  supportASTC: boolean;
  supportETC2: boolean;
  supportS3TCSRGB: boolean;
  supportDepthTexture: boolean;
  support3DTexture: boolean;
  supportSRGBTexture: boolean;
  supportFloatTexture: boolean;
  supportLinearFloatTexture: boolean;
  supportHalfFloatTexture: boolean;
  supportLinearHalfFloatTexture: boolean;
  supportAnisotropicFiltering: boolean;
  maxAnisotropy: number;
  supportFloatColorBuffer: boolean;
  supportHalfFloatColorBuffer: boolean;
  supportFloatBlending: boolean;
  supportTextureFormatsTier1: boolean;
  supportTextureFormatsTier2: boolean;
  /** @internal */
  private readonly _formatInfos: Partial<Record<TextureFormat, TextureFormatInfo>>;
  /** @internal */
  private readonly _type: NullDeviceType;
  constructor(type: NullDeviceType, overrides?: Partial<Omit<TextureCaps, 'getTextureFormatInfo'>>) {
    this._type = type;
    this.maxTextureSize = 8192;
    this.maxCubeTextureSize = 8192;
    this.npo2Mipmapping = true;
    this.npo2Repeating = true;
    this.supportS3TC = true;
    this.supportBPTC = true;
    this.supportRGTC = true;
    this.supportASTC = true;
    this.supportETC2 = true;
    this.supportS3TCSRGB = true;
    this.supportDepthTexture = true;
    this.support3DTexture = true;
    this.supportSRGBTexture = true;
    this.supportFloatTexture = true;
    this.supportLinearFloatTexture = true;
    this.supportHalfFloatTexture = true;
    this.supportLinearHalfFloatTexture = true;
    this.supportAnisotropicFiltering = true;
    this.maxAnisotropy = 16;
    this.supportFloatColorBuffer = true;
    this.supportHalfFloatColorBuffer = true;
    this.supportFloatBlending = type === 'webgpu';
    this.supportTextureFormatsTier1 = false;
    this.supportTextureFormatsTier2 = false;
    Object.assign(this, overrides ?? {});
    this._formatInfos = {};
  }
  getTextureFormatInfo(format: TextureFormat): Immutable<TextureFormatInfo> {
    let info = this._formatInfos[format];
    if (!info) {
      const compressed = isCompressedTextureFormat(format);
      const float = isFloatTextureFormat(format);
      const integer = isIntegerTextureFormat(format);
      // Storage textures follow WebGPU, where the tiers widen the core formats; WebGL has none
      const webgpu = this._type === 'webgpu';
      const tier2 = this.supportTextureFormatsTier2;
      const tier1 = tier2 || this.supportTextureFormatsTier1;
      info = {
        // Integer formats are never filterable, compressed formats are never renderable.
        filterable: !integer && (!float || this.supportLinearFloatTexture || hasDepthChannel(format)),
        renderable: !compressed,
        compressed,
        size: getTextureFormatBlockSize(format),
        blockWidth: getTextureFormatBlockWidth(format),
        blockHeight: getTextureFormatBlockHeight(format),
        writable:
          webgpu && (CORE_STORAGE_FORMATS.has(format) || (tier1 && TIER1_STORAGE_FORMATS.has(format))),
        readWritable:
          webgpu && (CORE_READ_WRITE_FORMATS.has(format) || (tier2 && TIER2_READ_WRITE_FORMATS.has(format)))
      };
      this._formatInfos[format] = info;
    }
    return info;
  }
}

/**
 * Creates the capability set of a null device
 * @param type - The emulated device type
 * @param overrides - Capability overrides
 * @returns The device capabilities
 * @public
 */
export function createNullDeviceCaps(type: NullDeviceType, overrides?: NullDeviceCapsOptions) {
  return {
    miscCaps: new NullMiscCaps(type, overrides?.miscCaps),
    framebufferCaps: new NullFramebufferCaps(type, overrides?.framebufferCaps),
    shaderCaps: new NullShaderCaps(type, overrides?.shaderCaps),
    textureCaps: new NullTextureCaps(type, overrides?.textureCaps)
  };
}
