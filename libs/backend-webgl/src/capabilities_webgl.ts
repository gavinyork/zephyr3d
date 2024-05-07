import { WebGLEnum } from './webgl_enum';
import { isWebGL2 } from './utils';
import type {
  WebGLContext,
  TextureFormat,
  FramebufferCaps,
  MiscCaps,
  ShaderCaps,
  TextureCaps,
  TextureFormatInfo
} from '@zephyr3d/device';

export interface TextureParams {
  target: number;
  format: number;
  internalFormat: number;
  type: number;
  filterable: boolean;
  renderable: boolean;
  repeatable: boolean;
  compressed: boolean;
  generateMipmap: boolean;
}

/*********************************************************************************************************************
 * Unsized Internal Formats
 * --------------------------------------------------------------------------------------------
 * GL_RGB                  | GL_RGB               | GL_UNSIGNED_BYTE
 *                         |                      | GL_UNSIGNED_SHORT_5_6_5
 * --------------------------------------------------------------------------------------------
 * GL_RGBA                 | GL_RGBA              | GL_UNSIGNED_BYTE
 *                         |                      | GL_UNSIGNED_SHORT_4_4_4_4
 *                         |                      | GL_UNSIGNED_SHORT_5_5_5_1
 * --------------------------------------------------------------------------------------------
 * GL_LUMINANCE_ALPHA      | GL_LUMINANCE_ALPHA   | GL_UNSIGNED_BYTE
 * --------------------------------------------------------------------------------------------
 * GL_LUMINANCE            | GL_LUMINANCE         | GL_UNSIGNED_BYTE
 * --------------------------------------------------------------------------------------------
 * GL_ALPHA                | GL_ALPHA             | GL_UNSIGNED_BYTE
 * --------------------------------------------------------------------------------------------
 *
 *
 * Sized Internal Formats
 * ------------------------------------------------------------------------------------------------------
 * Sized Internal Format   | Format               | Type                            | Renderable | Filterable
 * ------------------------------------------------------------------------------------------------------
 * GL_R8                   | GL_RED               | GL_UNSIGNED_BYTE                | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_R8_SNORM             | GL_RED               | GL_BYTE                         | No         | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_R16F                 | GL_RED               | GL_HALF_FLOAT                   | No         | Yes
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_R32F                 | GL_RED               | GL_FLOAT                        | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R8UI                 | GL_RED_INTEGER       | GL_UNSIGNED_BYTE                | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R8I                  | GL_RED_INTEGER       | GL_BYTE                         | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R16UI                | GL_RED_INTEGER       | GL_UNSIGNED_SHORT               | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R16I                 | GL_RED_INTEGER       | GL_SHORT                        | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R32UI                | GL_RED_INTEGER       | GL_UNSIGNED_INT                 | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_R32I                 | GL_RED_INTEGER       | GL_INT                          | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG8                  | GL_RG                | GL_UNSIGNED_BYTE                | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RG8_SNORM            | GL_RG                | GL_BYTE                         | No         | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RG16F                | GL_RG                | GL_HALF_FLOAT                   | No         | Yes
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RG32F                | GL_RG                | GL_FLOAT                        | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG8UI                | GL_RG_INTEGER        | GL_UNSIGNED_BYTE                | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG8I                 | GL_RG_INTEGER        | GL_BYTE                         | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG16UI               | GL_RG_INTEGER        | GL_UNSIGNED_SHORT               | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG16I                | GL_RG_INTEGER        | GL_SHORT                        | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG32UI               | GL_RG_INTEGER        | GL_UNSIGNED_INT                 | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RG32I                | GL_RG_INTEGER        | GL_INT                          | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB8                 | GL_RGB               | GL_UNSIGNED_BYTE                | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_SRGB8                | GL_RGB               | GL_UNSIGNED_BYTE                | No         | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB565               | GL_RGB               | GL_UNSIGNED_BYTE                | Yes        | Yes
 *                         |                      | GL_UNSIGNED_SHORT_5_6_5         |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB8_SNORM           | GL_RGB               | GL_BYTE                         | No         | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_R11F_G11F_B10F       | GL_RGB               | GL_UNSIGNED_INT_10F_11F_11F_REV | No         | Yes
 *                         |                      | GL_HALF_FLOAT                   |            |
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB9_E5              | GL_RGB               | GL_UNSIGNED_INT_5_9_9_9_REV     | No         | Yes
 *                         |                      | GL_HALF_FLOAT                   |            |
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB16F               | GL_RGB               | GL_HALF_FLOAT                   | No         | Yes
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB32F               | GL_RGB               | GL_FLOAT                        | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB8UI               | GL_RGB_INTEGER       | GL_UNSIGNED_BYTE                | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB8I                | GL_RGB_INTEGER       | GL_BYTE                         | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB16UI              | GL_RGB_INTEGER       | GL_UNSIGNED_SHORT               | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB16I               | GL_RGB_INTEGER       | GL_SHORT                        | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB32UI              | GL_RGB_INTEGER       | GL_UNSIGNED_INT                 | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB32I               | GL_RGB_INTEGER       | GL_INT                          | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA8                | GL_RGBA              | GL_UNSIGNED_BYTE                | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_SRGB8_ALPHA8         | GL_RGBA              | GL_UNSIGNED_BYTE                | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA8_SNORM          | GL_RGBA              | GL_BYTE                         | No         | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB5_A1              | GL_RGBA              | GL_UNSIGNED_BYTE                | Yes        | Yes
 *                         |                      | GL_UNSIGNED_SHORT_5_5_5_1       |            |
 *                         |                      | GL_UNSIGNED_INT_2_10_10_10_REV  |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA4                | GL_RGBA              | GL_UNSIGNED_BYTE                | Yes        | Yes
 *                         |                      | GL_UNSIGNED_SHORT_4_4_4_4       |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGB10_A2             | GL_RGBA              | GL_UNSIGNED_INT_2_10_10_10_REV  | Yes        | Yes
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA16F              | GL_RGBA              | GL_HALF_FLOAT                   | No         | Yes
 *                         |                      | GL_FLOAT                        |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA32F              | GL_RGBA              | GL_FLOAT                        | No         | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA8UI              | GL_RGBA_INTEGER      | GL_UNSIGNED_BYTE                | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA8I               | GL_RGBA_INTEGER      | GL_BYTE                         | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA16UI             | GL_RGBA_INTEGER      | GL_UNSIGNED_SHORT               | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA16I              | GL_RGBA_INTEGER      | GL_SHORT                        | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA32UI             | GL_RGBA_INTEGER      | GL_UNSIGNED_INT                 | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_RGBA32I              | GL_RGBA_INTEGER      | GL_INT                          | Yes        | No
 * ------------------------------------------------------------------------------------------------------
 * GL_DEPTH_COMPONENT16    | GL_DEPTH_COMPONENT   | GL_UNSIGNED_SHORT               | N/A        | N/A
 *                         |                      | GL_UNSIGNED_INT                 |            |
 * ------------------------------------------------------------------------------------------------------
 * GL_DEPTH_COMPONENT24    | GL_DEPTH_COMPONENT   | GL_UNSIGNED_INT                 | N/A        | N/A
 * ------------------------------------------------------------------------------------------------------
 * GL_DEPTH_COMPONENT32F   | GL_DEPTH_COMPONENT   | GL_FLOAT                        | N/A        | N/A
 * ------------------------------------------------------------------------------------------------------
 * GL_DEPTH24_STENCIL8     | GL_DEPTH_STENCIL     | GL_UNSIGNED_INT_24_8            | N/A        | N/A
 * ------------------------------------------------------------------------------------------------------
 * GL_DEPTH32F_STENCIL8    | GL_DEPTH_STENCIL     | GL_FLOAT_32_UNSIGNED_INT_24_8_REV | N/A      | N/A
 * ------------------------------------------------------------------------------------------------------
 *********************************************************************************************************************/

export interface TextureFormatInfoWebGL extends TextureFormatInfo {
  glFormat: number;
  glInternalFormat: number;
  glType: number[];
  filterable: boolean;
  renderable: boolean;
  compressed: boolean;
}

export class WebGLFramebufferCaps implements FramebufferCaps {
  private _isWebGL2: boolean;
  private _extDrawBuffers: WEBGL_draw_buffers;
  private _extFloatBlending: EXT_float_blend;
  maxDrawBuffers: number;
  maxColorAttachmentBytesPerSample: number;
  supportMultisampledFramebuffer: boolean;
  supportFloatBlending: boolean;
  supportDepth32float: boolean;
  supportDepth32floatStencil8: boolean;
  constructor(gl: WebGLContext) {
    this._isWebGL2 = isWebGL2(gl);
    this._extDrawBuffers = this._isWebGL2 ? null : gl.getExtension('WEBGL_draw_buffers');
    this._extFloatBlending = gl.getExtension('EXT_float_blend');
    this.maxDrawBuffers =
      this._isWebGL2 || this._extDrawBuffers
        ? Math.min(
            gl.getParameter(WebGLEnum.MAX_COLOR_ATTACHMENTS),
            gl.getParameter(WebGLEnum.MAX_DRAW_BUFFERS)
          )
        : 1;
    this.maxColorAttachmentBytesPerSample = this.maxDrawBuffers * 16;
    this.supportMultisampledFramebuffer = isWebGL2(gl);
    this.supportFloatBlending = !!this._extFloatBlending;
    this.supportDepth32float = this._isWebGL2;
    this.supportDepth32floatStencil8 = this._isWebGL2;
  }
}

export class WebGLMiscCaps implements MiscCaps {
  private _isWebGL2: boolean;
  private _extIndexUint32: OES_element_index_uint;
  private _extBlendMinMax: EXT_blend_minmax;
  supportOversizedViewport: boolean;
  supportBlendMinMax: boolean;
  support32BitIndex: boolean;
  supportDepthClamp: boolean;
  maxBindGroups: number;
  maxTexCoordIndex: number;
  constructor(gl: WebGLContext) {
    this._isWebGL2 = isWebGL2(gl);
    this._extBlendMinMax = null;
    this._extIndexUint32 = isWebGL2 ? gl.getExtension('OES_element_index_uint') : null;
    if (this._isWebGL2) {
      this.supportBlendMinMax = true;
      this.support32BitIndex = true;
    } else {
      this._extBlendMinMax = gl.getExtension('EXT_blend_minmax');
      this.supportBlendMinMax = !!this._extBlendMinMax;
      this.support32BitIndex = !!this._extIndexUint32;
    }
    this.supportOversizedViewport = true;
    this.supportDepthClamp = false;
    this.maxBindGroups = 4;
    this.maxTexCoordIndex = 8;
  }
}
export class WebGLShaderCaps implements ShaderCaps {
  private _extFragDepth: EXT_frag_depth;
  private _extStandardDerivatives: OES_standard_derivatives;
  private _extShaderTextureLod: EXT_shader_texture_lod;
  supportFragmentDepth: boolean;
  supportStandardDerivatives: boolean;
  supportShaderTextureLod: boolean;
  supportHighPrecisionFloat: boolean;
  supportHighPrecisionInt: boolean;
  maxUniformBufferSize: number;
  uniformBufferOffsetAlignment: number;
  maxStorageBufferSize: number;
  storageBufferOffsetAlignment: number;
  constructor(gl: WebGLContext) {
    this._extFragDepth = null;
    this._extStandardDerivatives = null;
    this.maxStorageBufferSize = 0;
    this.storageBufferOffsetAlignment = 0;
    if (isWebGL2(gl)) {
      this.supportFragmentDepth = true;
      this.supportStandardDerivatives = true;
      this.supportShaderTextureLod = true;
      this.supportHighPrecisionFloat = true;
      this.maxUniformBufferSize = gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) || 16384;
      this.uniformBufferOffsetAlignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) || 256;
    } else {
      this._extFragDepth = gl.getExtension('EXT_frag_depth');
      this.supportFragmentDepth = !!this._extFragDepth;
      this._extStandardDerivatives = gl.getExtension('OES_standard_derivatives');
      this.supportStandardDerivatives = !!this._extStandardDerivatives;
      this._extShaderTextureLod = gl.getExtension('EXT_shader_texture_lod');
      this.supportShaderTextureLod = !!this._extShaderTextureLod;
      this.supportHighPrecisionFloat =
        gl.getShaderPrecisionFormat &&
        !!gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT)?.precision &&
        !!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
      this.maxUniformBufferSize = 0;
      this.uniformBufferOffsetAlignment = 1;
    }
  }
}
export class WebGLTextureCaps implements TextureCaps {
  private _isWebGL2: boolean;
  private _extS3TC: WEBGL_compressed_texture_s3tc;
  private _extS3TCSRGB: WEBGL_compressed_texture_s3tc_srgb;
  private _extBPTC: EXT_texture_compression_bptc;
  private _extTextureFilterAnisotropic: EXT_texture_filter_anisotropic;
  private _extDepthTexture: WEBGL_depth_texture;
  private _extSRGB: EXT_sRGB;
  private _extTextureFloat: OES_texture_float;
  private _extTextureFloatLinear: OES_texture_float_linear;
  private _extTextureHalfFloat: OES_texture_half_float;
  private _extTextureHalfFloatLinear: OES_texture_half_float_linear;
  private _textureFormatInfos: Record<TextureFormat, TextureFormatInfoWebGL>;
  maxTextureSize: number;
  maxCubeTextureSize: number;
  npo2Mipmapping: boolean;
  npo2Repeating: boolean;
  supportS3TC: boolean;
  supportS3TCSRGB: boolean;
  supportBPTC: boolean;
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
  constructor(gl: WebGLContext) {
    this._isWebGL2 = isWebGL2(gl);
    this._extTextureFilterAnisotropic =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    this.supportAnisotropicFiltering = !!this._extTextureFilterAnisotropic;
    if (this._isWebGL2) {
      this.supportDepthTexture = true;
    } else {
      this._extDepthTexture = gl.getExtension('WEBGL_depth_texture');
      this.supportDepthTexture = !!this._extDepthTexture;
    }
    this.support3DTexture = this._isWebGL2;
    this._extSRGB = this._isWebGL2 ? null : gl.getExtension('EXT_sRGB');
    this.supportSRGBTexture = this._isWebGL2 || !!this._extSRGB;
    if (this._isWebGL2) {
      this.supportFloatTexture = true;
    } else {
      this._extTextureFloat = gl.getExtension('OES_texture_float');
      this.supportFloatTexture = !!this._extTextureFloat;
    }
    this._extTextureFloatLinear = gl.getExtension('OES_texture_float_linear');
    this.supportLinearFloatTexture = !!this._extTextureFloatLinear;
    if (this._isWebGL2) {
      this.supportHalfFloatTexture = true;
      this.supportLinearHalfFloatTexture = true;
    } else {
      this._extTextureHalfFloat = gl.getExtension('OES_texture_half_float');
      this.supportHalfFloatTexture = !!this._extTextureHalfFloat;
      this._extTextureHalfFloatLinear = gl.getExtension('OES_texture_half_float_linear');
      this.supportLinearHalfFloatTexture = !!this._extTextureHalfFloatLinear;
    }

    if (this._isWebGL2) {
      if (gl.getExtension('EXT_color_buffer_float')) {
        this.supportHalfFloatColorBuffer = true;
        this.supportFloatColorBuffer = true;
      } else if (gl.getExtension('EXT_color_buffer_half_float')) {
        this.supportHalfFloatColorBuffer = true;
        this.supportFloatColorBuffer = false;
      } else {
        this.supportHalfFloatColorBuffer = false;
        this.supportFloatColorBuffer = false;
      }
    } else {
      this.supportFloatColorBuffer = !!gl.getExtension('WEBGL_color_buffer_float');
      this.supportHalfFloatColorBuffer = !!gl.getExtension('EXT_color_buffer_half_float');
    }
    this.supportFloatBlending = this.supportFloatColorBuffer && !!gl.getExtension('EXT_float_blend');

    this._extS3TC =
      gl.getExtension('WEBGL_compressed_texture_s3tc') ||
      gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc') ||
      gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc');
    this.supportS3TC = !!this._extS3TC;
    this._extS3TCSRGB = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');
    this.supportS3TCSRGB = !!this._extS3TCSRGB;
    this._extBPTC = gl.getExtension('EXT_texture_compression_bptc');
    this.supportBPTC = !!this._extBPTC;

    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.maxCubeTextureSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
    if (this._isWebGL2) {
      this.npo2Mipmapping = true;
      this.npo2Repeating = true;
    } else {
      this.npo2Mipmapping = false;
      this.npo2Repeating = false;
    }
    this._textureFormatInfos = {
      rgba8unorm: {
        glFormat: gl.RGBA,
        glInternalFormat: this._isWebGL2 ? (gl as WebGL2RenderingContext).RGBA8 : gl.RGBA,
        glType: [gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT_4_4_4_4, gl.UNSIGNED_SHORT_5_5_5_1],
        filterable: true,
        renderable: true,
        compressed: false
      }
    } as Record<TextureFormat, TextureFormatInfoWebGL>;
    if (this.supportS3TC) {
      this._textureFormatInfos['dxt1'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TC.COMPRESSED_RGB_S3TC_DXT1_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['dxt3'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TC.COMPRESSED_RGBA_S3TC_DXT3_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['dxt5'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TC.COMPRESSED_RGBA_S3TC_DXT5_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
    }
    if (this.supportS3TCSRGB) {
      this._textureFormatInfos['dxt1-srgb'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_S3TC_DXT1_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['dxt3-srgb'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['dxt5-srgb'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
    }
    if (this.supportBPTC) {
      this._textureFormatInfos['bc6h'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extBPTC.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['bc6h-signed'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extBPTC.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['bc7'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extBPTC.COMPRESSED_RGBA_BPTC_UNORM_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
      this._textureFormatInfos['bc7-srgb'] = {
        glFormat: gl.NONE,
        glInternalFormat: this._extBPTC.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT,
        glType: [gl.NONE],
        filterable: true,
        renderable: false,
        compressed: true
      };
    }
    if (isWebGL2(gl)) {
      this._textureFormatInfos['r8unorm'] = {
        glFormat: gl.RED,
        glInternalFormat: gl.R8,
        glType: [gl.UNSIGNED_BYTE],
        filterable: true,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r8snorm'] = {
        glFormat: gl.RED,
        glInternalFormat: gl.R8_SNORM,
        glType: [gl.BYTE],
        filterable: true,
        renderable: false,
        compressed: false
      };
      this._textureFormatInfos['r16f'] = {
        glFormat: gl.RED,
        glInternalFormat: gl.R16F,
        glType: [gl.HALF_FLOAT, gl.FLOAT],
        filterable: this.supportLinearHalfFloatTexture,
        renderable: this.supportHalfFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['r32f'] = {
        glFormat: gl.RED,
        glInternalFormat: gl.R32F,
        glType: [gl.FLOAT],
        filterable: this.supportLinearFloatTexture,
        renderable: this.supportFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['r8ui'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R8UI,
        glType: [gl.UNSIGNED_BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r8i'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R8I,
        glType: [gl.BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r16ui'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R16UI,
        glType: [gl.UNSIGNED_SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r16i'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R16I,
        glType: [gl.SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r32ui'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R32UI,
        glType: [gl.UNSIGNED_INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['r32i'] = {
        glFormat: gl.RED_INTEGER,
        glInternalFormat: gl.R32I,
        glType: [gl.INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg8unorm'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG8,
        glType: [gl.UNSIGNED_BYTE],
        filterable: true,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg8snorm'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG8_SNORM,
        glType: [gl.BYTE],
        filterable: true,
        renderable: false,
        compressed: false
      };
      this._textureFormatInfos['rg16f'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG16F,
        glType: [gl.HALF_FLOAT, gl.FLOAT],
        filterable: this.supportLinearHalfFloatTexture,
        renderable: this.supportHalfFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['rg32f'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG32F,
        glType: [gl.FLOAT],
        filterable: this.supportLinearFloatTexture,
        renderable: this.supportFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['rg8ui'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG8UI,
        glType: [gl.UNSIGNED_BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg8i'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG8I,
        glType: [gl.BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg16ui'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG16UI,
        glType: [gl.UNSIGNED_SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg16i'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG16I,
        glType: [gl.SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg32ui'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG32UI,
        glType: [gl.UNSIGNED_INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg32i'] = {
        glFormat: gl.RG,
        glInternalFormat: gl.RG32I,
        glType: [gl.INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba8unorm-srgb'] = {
        glFormat: gl.RGBA,
        glInternalFormat: gl.SRGB8_ALPHA8,
        glType: [gl.UNSIGNED_BYTE],
        filterable: true,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba8snorm'] = {
        glFormat: gl.RGBA,
        glInternalFormat: gl.RGBA8_SNORM,
        glType: [gl.BYTE],
        filterable: true,
        renderable: false,
        compressed: false
      };
      this._textureFormatInfos['rgba16f'] = {
        glFormat: gl.RGBA,
        glInternalFormat: gl.RGBA16F,
        glType: [gl.HALF_FLOAT, gl.FLOAT],
        filterable: this.supportLinearHalfFloatTexture,
        renderable: this.supportHalfFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['rgba32f'] = {
        glFormat: gl.RGBA,
        glInternalFormat: gl.RGBA32F,
        glType: [gl.FLOAT],
        filterable: this.supportLinearFloatTexture,
        renderable: this.supportFloatColorBuffer,
        compressed: false
      };
      this._textureFormatInfos['rgba8ui'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA8UI,
        glType: [gl.UNSIGNED_BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba8i'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA8I,
        glType: [gl.BYTE],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba16ui'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA16UI,
        glType: [gl.UNSIGNED_SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba16i'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA16I,
        glType: [gl.SHORT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba32ui'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA32UI,
        glType: [gl.UNSIGNED_INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rgba32i'] = {
        glFormat: gl.RGBA_INTEGER,
        glInternalFormat: gl.RGBA32I,
        glType: [gl.INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['rg11b10uf'] = {
        glFormat: gl.RGB,
        glInternalFormat: gl.R11F_G11F_B10F,
        glType: [gl.UNSIGNED_INT_10F_11F_11F_REV],
        filterable: true,
        renderable: false,
        compressed: false
      };
      this._textureFormatInfos['d16'] = {
        glFormat: gl.DEPTH_COMPONENT,
        glInternalFormat: gl.DEPTH_COMPONENT16,
        glType: [gl.UNSIGNED_SHORT, gl.UNSIGNED_INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['d24'] = {
        glFormat: gl.DEPTH_COMPONENT,
        glInternalFormat: gl.DEPTH_COMPONENT24,
        glType: [gl.UNSIGNED_INT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['d32f'] = {
        glFormat: gl.DEPTH_COMPONENT,
        glInternalFormat: gl.DEPTH_COMPONENT32F,
        glType: [gl.FLOAT],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['d24s8'] = {
        glFormat: gl.DEPTH_STENCIL,
        glInternalFormat: gl.DEPTH24_STENCIL8,
        glType: [gl.UNSIGNED_INT_24_8],
        filterable: false,
        renderable: true,
        compressed: false
      };
      this._textureFormatInfos['d32fs8'] = {
        glFormat: gl.DEPTH_STENCIL,
        glInternalFormat: gl.DEPTH32F_STENCIL8,
        glType: [gl.FLOAT_32_UNSIGNED_INT_24_8_REV],
        filterable: false,
        renderable: true,
        compressed: false
      };
    } else {
      if (this.supportFloatTexture) {
        this._textureFormatInfos['rgba32f'] = {
          glFormat: gl.RGBA,
          glInternalFormat: gl.RGBA,
          glType: [gl.FLOAT, gl.UNSIGNED_BYTE, gl.UNSIGNED_SHORT_4_4_4_4, gl.UNSIGNED_SHORT_5_5_5_1],
          filterable: this.supportLinearFloatTexture,
          renderable: this.supportFloatColorBuffer,
          compressed: false
        };
      }
      if (this.supportHalfFloatTexture) {
        this._textureFormatInfos['rgba16f'] = {
          glFormat: gl.RGBA,
          glInternalFormat: gl.RGBA,
          glType: [
            this._extTextureHalfFloat.HALF_FLOAT_OES,
            gl.UNSIGNED_BYTE,
            gl.UNSIGNED_SHORT_4_4_4_4,
            gl.UNSIGNED_SHORT_5_5_5_1
          ],
          filterable: this.supportLinearHalfFloatTexture,
          renderable: this.supportHalfFloatColorBuffer,
          compressed: false
        };
      }
      if (this.supportSRGBTexture) {
        this._textureFormatInfos['rgba8unorm-srgb'] = {
          glFormat: this._extSRGB.SRGB_ALPHA_EXT,
          glInternalFormat: this._extSRGB.SRGB_ALPHA_EXT,
          glType: [gl.UNSIGNED_BYTE],
          filterable: true,
          renderable: false,
          compressed: false
        };
      }
      if (this.supportDepthTexture) {
        this._textureFormatInfos['d16'] = {
          glFormat: gl.DEPTH_COMPONENT,
          glInternalFormat: gl.DEPTH_COMPONENT,
          glType: [gl.UNSIGNED_SHORT],
          filterable: false,
          renderable: true,
          compressed: false
        };
        this._textureFormatInfos['d24'] = {
          glFormat: gl.DEPTH_COMPONENT,
          glInternalFormat: gl.DEPTH_COMPONENT,
          glType: [gl.UNSIGNED_INT],
          filterable: false,
          renderable: true,
          compressed: false
        };
        this._textureFormatInfos['d24s8'] = {
          glFormat: gl.DEPTH_STENCIL,
          glInternalFormat: gl.DEPTH_STENCIL,
          glType: [this._extDepthTexture.UNSIGNED_INT_24_8_WEBGL],
          filterable: false,
          renderable: true,
          compressed: false
        };
      }
    }
  }
  calcMemoryUsage(format: TextureFormat, type: number, numPixels): number {
    switch (format) {
      case 'd16':
      case 'd24':
      case 'd24s8':
      case 'd32f':
        switch (type) {
          case WebGLEnum.UNSIGNED_SHORT:
            return numPixels * 2;
          default:
            return numPixels * 4;
        }
      case 'd32fs8':
        return numPixels * 8;
      case 'dxt1':
      case 'dxt1-srgb':
        return numPixels / 2;
      case 'dxt3':
      case 'dxt3-srgb':
      case 'dxt5':
      case 'dxt5-srgb':
        return numPixels;
      case 'r16f':
        switch (type) {
          case WebGLEnum.HALF_FLOAT:
            return numPixels * 2;
          default:
            return numPixels * 4;
        }
      case 'r16i':
      case 'r16ui':
        return numPixels * 2;
      case 'r32f':
      case 'r32i':
      case 'r32ui':
        return numPixels * 4;
      case 'r8unorm':
      case 'r8snorm':
      case 'r8i':
      case 'r8ui':
        return numPixels;
      case 'rg16f':
        switch (type) {
          case WebGLEnum.HALF_FLOAT:
            return numPixels * 4;
          default:
            return numPixels * 8;
        }
      case 'rg16i':
      case 'rg16ui':
        return numPixels * 4;
      case 'rg32f':
      case 'rg32i':
      case 'rg32ui':
        return numPixels * 8;
      case 'rg8unorm':
      case 'rg8snorm':
      case 'rg8i':
      case 'rg8ui':
        return numPixels * 2;
      case 'rgba16f':
        switch (type) {
          case WebGLEnum.HALF_FLOAT:
            return numPixels * 8;
          default:
            return numPixels * 16;
        }
      case 'rgba16i':
      case 'rgba16ui':
        return numPixels * 8;
      case 'rgba32f':
      case 'rgba32i':
      case 'rgba32ui':
        return numPixels * 16;
      case 'rgba8unorm':
      case 'rgba8unorm-srgb':
      case 'rgba8snorm':
      case 'rgba8i':
      case 'rgba8ui':
        return numPixels * 4;
      default:
        return 0;
    }
  }
  getTextureFormatInfo(format: TextureFormat): TextureFormatInfoWebGL {
    return this._textureFormatInfos[format];
  }
}
