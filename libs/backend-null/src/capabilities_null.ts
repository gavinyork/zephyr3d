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
    const webgl1 = type === 'webgl';
    this.maxDrawBuffers = webgl1 ? 1 : 8;
    this.supportPerTargetBlending = type === 'webgpu';
    this.supportRenderMipmap = !webgl1;
    this.supportMultisampledFramebuffer = !webgl1;
    this.supportFloatBlending = type === 'webgpu';
    this.supportDepth32float = !webgl1;
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
  constructor(type: NullDeviceType, overrides?: Partial<MiscCaps>) {
    const webgl1 = type === 'webgl';
    this.supportOversizedViewport = type !== 'webgpu';
    this.supportBlendMinMax = !webgl1;
    this.support32BitIndex = !webgl1;
    this.maxBindGroups = 4;
    this.maxTexCoordIndex = 8;
    this.supportTimestampQuery = false;
    this.supportClipControl = type === 'webgpu';
    this.supportDrawIndirect = type === 'webgpu';
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
  constructor(type: NullDeviceType, overrides?: Partial<ShaderCaps>) {
    const webgl1 = type === 'webgl';
    this.supportFragmentDepth = !webgl1;
    this.supportStandardDerivatives = !webgl1;
    this.supportShaderTextureLod = !webgl1;
    this.supportHighPrecisionFloat = true;
    this.supportShaderF16 = type === 'webgpu';
    this.maxUniformBufferSize = 65536;
    this.uniformBufferOffsetAlignment = 256;
    this.maxStorageBufferSize = 128 * 1024 * 1024;
    this.storageBufferOffsetAlignment = 256;
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
  supportS3TCSRGB: boolean;
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
  /** @internal */
  private readonly _formatInfos: Partial<Record<TextureFormat, TextureFormatInfo>>;
  constructor(type: NullDeviceType, overrides?: Partial<Omit<TextureCaps, 'getTextureFormatInfo'>>) {
    const webgl1 = type === 'webgl';
    this.maxTextureSize = 8192;
    this.maxCubeTextureSize = 8192;
    this.npo2Mipmapping = !webgl1;
    this.npo2Repeating = !webgl1;
    this.supportS3TC = true;
    this.supportBPTC = !webgl1;
    this.supportRGTC = !webgl1;
    this.supportASTC = true;
    this.supportS3TCSRGB = true;
    this.supportDepthTexture = true;
    this.support3DTexture = !webgl1;
    this.supportSRGBTexture = true;
    this.supportFloatTexture = true;
    this.supportLinearFloatTexture = !webgl1;
    this.supportHalfFloatTexture = true;
    this.supportLinearHalfFloatTexture = true;
    this.supportAnisotropicFiltering = true;
    this.supportFloatColorBuffer = true;
    this.supportHalfFloatColorBuffer = true;
    this.supportFloatBlending = type === 'webgpu';
    Object.assign(this, overrides ?? {});
    this._formatInfos = {};
  }
  getTextureFormatInfo(format: TextureFormat): Immutable<TextureFormatInfo> {
    let info = this._formatInfos[format];
    if (!info) {
      const compressed = isCompressedTextureFormat(format);
      const float = isFloatTextureFormat(format);
      const integer = isIntegerTextureFormat(format);
      info = {
        // Integer formats are never filterable, compressed formats are never renderable.
        filterable: !integer && (!float || this.supportLinearFloatTexture || hasDepthChannel(format)),
        renderable: !compressed,
        compressed,
        size: getTextureFormatBlockSize(format),
        blockWidth: getTextureFormatBlockWidth(format),
        blockHeight: getTextureFormatBlockHeight(format)
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
