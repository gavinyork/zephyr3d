import type { TypedArray, Vector4, IEventTarget } from '@zephyr3d/base';
import { floatToHalf } from '@zephyr3d/base';
import type { PBComputeOptions, PBRenderOptions, PBStructTypeInfo, ProgramBuilder } from './builder';
import type {
  BaseTexture,
  BindGroup,
  BindGroupLayout,
  BufferCreationOptions,
  FrameBuffer,
  FrameBufferOptions,
  GPUDataBuffer,
  GPUObject,
  GPUProgram,
  IndexBuffer,
  RenderBundle,
  SamplerOptions,
  StructuredBuffer,
  Texture2D,
  Texture2DArray,
  Texture3D,
  TextureCreationOptions,
  TextureCube,
  TextureImageElement,
  TextureMipmapData,
  TextureSampler,
  TextureVideo,
  VertexAttribFormat,
  VertexLayout,
  VertexLayoutOptions,
  VertexSemantic
} from './gpuobject';
import type {
  BlendingState,
  ColorState,
  DepthState,
  RasterizerState,
  RenderStateSet,
  StencilState
} from './render_states';
import type { Pool } from './pool';

/**
 * The webgl context type
 * @public
 */
export type WebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

/**
 * The texture type
 * @public
 */
export type TextureType = '2d' | '3d' | 'cube' | '2darray';

/**
 * The comparison function type
 * @public
 */
export type CompareFunc = 'always' | 'le' | 'ge' | 'lt' | 'gt' | 'eq' | 'ne' | 'never';

/**
 * The texture address mode
 * @public
 */
export type TextureAddressMode = 'repeat' | 'mirrored-repeat' | 'clamp';

/**
 * The texture filter mode
 * @public
 */
export type TextureFilterMode = 'none' | 'nearest' | 'linear';

/**
 * Scalar data type
 * @public
 */
export type DataType =
  | 'u8'
  | 'u8norm'
  | 'i8'
  | 'i8norm'
  | 'u16'
  | 'u16norm'
  | 'i16'
  | 'i16norm'
  | 'u32'
  | 'i32'
  | 'f16'
  | 'f32';

const RED_SHIFT = 0;
const GREEN_SHIFT = 1;
const BLUE_SHIFT = 2;
const ALPHA_SHIFT = 3;
const DEPTH_SHIFT = 4;
const STENCIL_SHIFT = 5;
const FLOAT_SHIFT = 6;
const INTEGER_SHIFT = 7;
const SIGNED_SHIFT = 8;
const SRGB_SHIFT = 9;
const BGR_SHIFT = 10;
const BLOCK_SIZE_SHIFT = 11;
const BLOCK_SIZE_MASK = 0x1f << BLOCK_SIZE_SHIFT;
const BLOCK_WIDTH_SHIFT = 16;
const BLOCK_WIDTH_MASK = 0xf << BLOCK_WIDTH_SHIFT;
const BLOCK_HEIGHT_SHIFT = 20;
const BLOCK_HEIGHT_MASK = 0xf << BLOCK_HEIGHT_SHIFT;
const COMPRESSED_FORMAT_SHIFT = 24;

const COMPRESSION_FORMAT_BC1 = 1 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC2 = 2 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC3 = 3 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC4 = 4 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC5 = 5 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC6H = 6 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC7 = 7 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC = 8 << COMPRESSED_FORMAT_SHIFT;
/*
const COMPRESSION_FORMAT_ETC2_RGB8 = 8 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGB8_A1 = 9 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGBA8 = 10 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_4x4 = 11 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x4 = 12 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x5 = 13 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x5 = 14 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x6 = 15 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x5 = 16 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x6 = 17 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x8 = 18 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x5 = 19 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x6 = 20 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x8 = 21 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x10 = 22 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x10 = 23 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x12 = 24 << COMPRESSED_FORMAT_SHIFT;
*/
const COMPRESSION_FORMAT_BITMASK = 0x1f << COMPRESSED_FORMAT_SHIFT;
const RED_BITMASK = 1 << RED_SHIFT;
const GREEN_BITMASK = 1 << GREEN_SHIFT;
const BLUE_BITMASK = 1 << BLUE_SHIFT;
const ALPHA_BITMASK = 1 << ALPHA_SHIFT;
const DEPTH_BITMASK = 1 << DEPTH_SHIFT;
const STENCIL_BITMASK = 1 << STENCIL_SHIFT;
const FLOAT_BITMASK = 1 << FLOAT_SHIFT;
const INTEGER_BITMASK = 1 << INTEGER_SHIFT;
const SIGNED_BITMASK = 1 << SIGNED_SHIFT;
const SRGB_BITMASK = 1 << SRGB_SHIFT;
const BGR_BITMASK = 1 << BGR_SHIFT;

function makeTextureFormat(
  compression: number,
  r: boolean,
  g: boolean,
  b: boolean,
  a: boolean,
  depth: boolean,
  stencil: boolean,
  float: boolean,
  integer: boolean,
  signed: boolean,
  srgb: boolean,
  bgr: boolean,
  blockWidth: number,
  blockHeight: number,
  blockSize: number
): number {
  const compressionBits = compression;
  const colorBits =
    (r ? RED_BITMASK : 0) | (g ? GREEN_BITMASK : 0) | (b ? BLUE_BITMASK : 0) | (a ? ALPHA_BITMASK : 0);
  const depthStencilBits = (depth ? DEPTH_BITMASK : 0) | (stencil ? STENCIL_BITMASK : 0);
  const floatBits = float ? FLOAT_BITMASK : 0;
  const integerBits = integer ? INTEGER_BITMASK : 0;
  const signedBits = signed ? SIGNED_BITMASK : 0;
  const srgbBits = srgb ? SRGB_BITMASK : 0;
  const bgrBits = bgr ? BGR_BITMASK : 0;
  const blockBits =
    (blockWidth << BLOCK_WIDTH_SHIFT) | (blockHeight << BLOCK_HEIGHT_SHIFT) | (blockSize << BLOCK_SIZE_SHIFT);
  return (
    compressionBits |
    colorBits |
    depthStencilBits |
    floatBits |
    integerBits |
    signedBits |
    srgbBits |
    bgrBits |
    blockBits
  );
}

/**
 * Texture format type
 * @public
 */
export type TextureFormat =
  | 'unknown'
  | 'r8unorm'
  | 'r8snorm'
  | 'r16f'
  | 'r32f'
  | 'r8ui'
  | 'r8i'
  | 'r16ui'
  | 'r16i'
  | 'r32ui'
  | 'r32i'
  | 'rg8unorm'
  | 'rg8snorm'
  | 'rg16f'
  | 'rg32f'
  | 'rg8ui'
  | 'rg8i'
  | 'rg16ui'
  | 'rg16i'
  | 'rg32ui'
  | 'rg32i'
  | 'rgba8unorm'
  | 'rgba8unorm-srgb'
  | 'rgba8snorm'
  | 'bgra8unorm'
  | 'bgra8unorm-srgb'
  | 'rgba16f'
  | 'rgba32f'
  | 'rgba8ui'
  | 'rgba8i'
  | 'rgba16ui'
  | 'rgba16i'
  | 'rgba32ui'
  | 'rgba32i'
  | 'rg11b10uf'
  | 'd16'
  | 'd24'
  | 'd32f'
  | 'd24s8'
  | 'd32fs8'
  | 'dxt1'
  | 'dxt1-srgb'
  | 'dxt3'
  | 'dxt3-srgb'
  | 'dxt5'
  | 'dxt5-srgb'
  | 'bc4'
  | 'bc4-signed'
  | 'bc5'
  | 'bc5-signed'
  | 'bc7'
  | 'bc7-srgb'
  | 'bc6h'
  | 'bc6h-signed'
  | 'astc-4x4'
  | 'astc-4x4-srgb'
  | 'astc-5x4'
  | 'astc-5x4-srgb'
  | 'astc-5x5'
  | 'astc-5x5-srgb'
  | 'astc-6x5'
  | 'astc-6x5-srgb'
  | 'astc-6x6'
  | 'astc-6x6-srgb'
  | 'astc-8x5'
  | 'astc-8x5-srgb'
  | 'astc-8x6'
  | 'astc-8x6-srgb'
  | 'astc-8x8'
  | 'astc-8x8-srgb'
  | 'astc-10x5'
  | 'astc-10x5-srgb'
  | 'astc-10x6'
  | 'astc-10x6-srgb'
  | 'astc-10x8'
  | 'astc-10x8-srgb'
  | 'astc-10x10'
  | 'astc-10x10-srgb'
  | 'astc-12x10'
  | 'astc-12x10-srgb'
  | 'astc-12x12'
  | 'astc-12x12-srgb';

const textureFormatMap: Record<TextureFormat, number> = {
  unknown: 0,
  r8unorm: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    1,
    1,
    1
  ),
  r8snorm: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    1,
    1,
    1
  ),
  r16f: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    2
  ),
  r32f: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  r8ui: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    1
  ),
  r8i: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    1
  ),
  r16ui: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    2
  ),
  r16i: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    2
  ),
  r32ui: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  r32i: makeTextureFormat(
    0,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  rg8unorm: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    1,
    1,
    2
  ),
  rg8snorm: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    1,
    1,
    2
  ),
  rg16f: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  rg32f: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    8
  ),
  rg8ui: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    2
  ),
  rg8i: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    2
  ),
  rg16ui: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  rg16i: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  rg32ui: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    8
  ),
  rg32i: makeTextureFormat(
    0,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    8
  ),
  rgba8unorm: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  'rgba8unorm-srgb': makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    1,
    1,
    4
  ),
  rgba8snorm: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  bgra8unorm: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    1,
    1,
    4
  ),
  'bgra8unorm-srgb': makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
    1,
    1,
    4
  ),
  rgba16f: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    8
  ),
  rgba32f: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    16
  ),
  rgba8ui: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  rgba8i: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  rgba16ui: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    8
  ),
  rgba16i: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    8
  ),
  rgba32ui: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    1,
    1,
    16
  ),
  rgba32i: makeTextureFormat(
    0,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    1,
    1,
    16
  ),
  rg11b10uf: makeTextureFormat(
    0,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  d16: makeTextureFormat(
    0,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    1,
    1,
    2
  ),
  d24: makeTextureFormat(
    0,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    0,
    0,
    0
  ),
  d32f: makeTextureFormat(
    0,
    false,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    4
  ),
  d24s8: makeTextureFormat(
    0,
    false,
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    1,
    1,
    4
  ),
  d32fs8: makeTextureFormat(
    0,
    false,
    false,
    false,
    false,
    true,
    true,
    true,
    false,
    true,
    false,
    false,
    1,
    1,
    5
  ),
  // compressed texture formats
  dxt1: makeTextureFormat(
    COMPRESSION_FORMAT_BC1,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    8
  ),
  'dxt1-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_BC1,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    4,
    4,
    8
  ),
  dxt3: makeTextureFormat(
    COMPRESSION_FORMAT_BC2,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'dxt3-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_BC2,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    4,
    4,
    16
  ),
  dxt5: makeTextureFormat(
    COMPRESSION_FORMAT_BC3,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'dxt5-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_BC3,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    4,
    4,
    16
  ),
  bc4: makeTextureFormat(
    COMPRESSION_FORMAT_BC4,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    8
  ),
  'bc4-signed': makeTextureFormat(
    COMPRESSION_FORMAT_BC4,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    4,
    4,
    8
  ),
  bc5: makeTextureFormat(
    COMPRESSION_FORMAT_BC5,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'bc5-signed': makeTextureFormat(
    COMPRESSION_FORMAT_BC5,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    4,
    4,
    16
  ),
  bc6h: makeTextureFormat(
    COMPRESSION_FORMAT_BC6H,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'bc6h-signed': makeTextureFormat(
    COMPRESSION_FORMAT_BC6H,
    true,
    true,
    true,
    false,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    4,
    4,
    16
  ),
  bc7: makeTextureFormat(
    COMPRESSION_FORMAT_BC7,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'bc7-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_BC7,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    4,
    4,
    16
  ),
  'astc-4x4': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    4,
    4,
    16
  ),
  'astc-4x4-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    4,
    4,
    16
  ),
  'astc-5x4': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    5,
    4,
    16
  ),
  'astc-5x4-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    5,
    4,
    16
  ),
  'astc-5x5': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    5,
    5,
    16
  ),
  'astc-5x5-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    5,
    5,
    16
  ),
  'astc-6x5': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    6,
    5,
    16
  ),
  'astc-6x5-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    6,
    5,
    16
  ),
  'astc-6x6': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    6,
    6,
    16
  ),
  'astc-6x6-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    6,
    6,
    16
  ),
  'astc-8x5': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    8,
    5,
    16
  ),
  'astc-8x5-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    8,
    5,
    16
  ),
  'astc-8x6': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    8,
    6,
    16
  ),
  'astc-8x6-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    8,
    6,
    16
  ),
  'astc-8x8': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    8,
    8,
    16
  ),
  'astc-8x8-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    8,
    8,
    16
  ),
  'astc-10x5': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    10,
    5,
    16
  ),
  'astc-10x5-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    10,
    5,
    16
  ),
  'astc-10x6': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    10,
    6,
    16
  ),
  'astc-10x6-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    10,
    6,
    16
  ),
  'astc-10x8': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    10,
    8,
    16
  ),
  'astc-10x8-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    10,
    8,
    16
  ),
  'astc-10x10': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    10,
    10,
    16
  ),
  'astc-10x10-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    10,
    10,
    16
  ),
  'astc-12x10': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    12,
    10,
    16
  ),
  'astc-12x10-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    12,
    10,
    16
  ),
  'astc-12x12': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    12,
    12,
    16
  ),
  'astc-12x12-srgb': makeTextureFormat(
    COMPRESSION_FORMAT_ASTC,
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    12,
    12,
    16
  )
};

/**
 * Converts a non-sRGB texture format to the corresponding sRGB texture format
 * @param format - The texture format to be converted
 * @returns The sRGB texture format
 * @public
 */
export function linearTextureFormatToSRGB(format: TextureFormat): TextureFormat {
  switch (format) {
    case 'rgba8unorm':
      return 'rgba8unorm-srgb';
    case 'bgra8unorm':
      return 'bgra8unorm-srgb';
    case 'dxt1':
      return 'dxt1-srgb';
    case 'dxt3':
      return 'dxt3-srgb';
    case 'dxt5':
      return 'dxt5-srgb';
    case 'bc7':
      return 'bc7-srgb';
    case 'astc-4x4':
      return 'astc-4x4-srgb';
    case 'astc-5x4':
      return 'astc-5x4-srgb';
    case 'astc-5x5':
      return 'astc-5x5-srgb';
    case 'astc-6x5':
      return 'astc-6x5-srgb';
    case 'astc-6x6':
      return 'astc-6x6-srgb';
    case 'astc-8x5':
      return 'astc-8x5-srgb';
    case 'astc-8x6':
      return 'astc-8x6-srgb';
    case 'astc-8x8':
      return 'astc-8x8-srgb';
    case 'astc-10x5':
      return 'astc-10x5-srgb';
    case 'astc-10x6':
      return 'astc-10x6-srgb';
    case 'astc-10x8':
      return 'astc-10x8-srgb';
    case 'astc-10x10':
      return 'astc-10x10-srgb';
    case 'astc-12x10':
      return 'astc-12x10-srgb';
    case 'astc-12x12':
      return 'astc-12x12-srgb';
    default:
      return format;
  }
}

/**
 * Check if a given texture format contains an alpha channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains an alpha channel, otherwise false
 * @public
 */
export function hasAlphaChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & ALPHA_BITMASK);
}

/**
 * Check if a given texture format contains a red channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a red channel, otherwise false
 * @public
 */
export function hasRedChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & RED_BITMASK);
}

/**
 * Check if a given texture format contains a green channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a green channel, otherwise false
 * @public
 */
export function hasGreenChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & GREEN_BITMASK);
}

/**
 * Check if a given texture format contains a blue channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a blue channel, otherwise false
 * @public
 */
export function hasBlueChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & BLUE_BITMASK);
}

/**
 * Check if a given texture format contains a depth channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a depth channel, otherwise false
 * @public
 */
export function hasDepthChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & DEPTH_BITMASK);
}

/**
 * Check if a given texture format contains a stencil channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a stencil channel, otherwise false
 * @public
 */
export function hasStencilChannel(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & STENCIL_BITMASK);
}

/**
 * Check whether a given texture format is floating-point.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is floating-point, otherwise false
 * @public
 */
export function isFloatTextureFormat(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & FLOAT_BITMASK);
}

/**
 * Check whether a given texture format is integer.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is integer, otherwise false
 * @public
 */
export function isIntegerTextureFormat(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & INTEGER_BITMASK);
}

/**
 * Check whether a given texture format is signed.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is signed, otherwise false
 * @public
 */
export function isSignedTextureFormat(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & SIGNED_BITMASK);
}

/**
 * Check whether a given texture format is a compressed format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is a compressed format, otherwise false
 * @public
 */
export function isCompressedTextureFormat(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & COMPRESSION_FORMAT_BITMASK);
}
/**
 * Check whether a given texture format is sRGB format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is sRGB format, otherwise false
 * @public
 */
export function isSRGBTextureFormat(format: TextureFormat): boolean {
  return !!(textureFormatMap[format] & SRGB_BITMASK);
}

/**
 * Get block size of given texture format
 * @param format - The texture format
 * @returns The block size
 * @public
 */
export function getTextureFormatBlockSize(format: TextureFormat): number {
  return (textureFormatMap[format] & BLOCK_SIZE_MASK) >> BLOCK_SIZE_SHIFT;
}

/**
 * Get block width of given texture format
 * @param format - The texture format
 * @returns The block width
 * @public
 */
export function getTextureFormatBlockWidth(format: TextureFormat): number {
  return (textureFormatMap[format] & BLOCK_WIDTH_MASK) >> BLOCK_WIDTH_SHIFT;
}

/**
 * Get block height of given texture format
 * @param format - The texture format
 * @returns The block height
 * @public
 */
export function getTextureFormatBlockHeight(format: TextureFormat): number {
  return (textureFormatMap[format] & BLOCK_HEIGHT_MASK) >> BLOCK_HEIGHT_SHIFT;
}

function normalizeColorComponent(val: number, maxval: number): number {
  return Math.min(maxval, Math.max(Math.floor(val * maxval), 0));
}

function normalizeColorComponentSigned(val: number, maxval: number): number {
  return normalizeColorComponent(val * 0.5 + 0.5, maxval) - (maxval + 1) / 2;
}

/** @internal */
export function encodePixel(format: TextureFormat, r: number, g: number, b: number, a: number): TypedArray {
  switch (format) {
    case 'r8unorm':
      return new Uint8Array([normalizeColorComponent(r, 255)]);
    case 'r8snorm':
      return new Int8Array([normalizeColorComponentSigned(r, 255)]);
    case 'r16f':
      return new Uint16Array([floatToHalf(r)]);
    case 'r32f':
      return new Float32Array([r]);
    case 'r8ui':
      return new Uint8Array([r | 0]);
    case 'r8i':
      return new Int8Array([r | 0]);
    case 'r16ui':
      return new Uint16Array([r | 0]);
    case 'r16i':
      return new Int16Array([r | 0]);
    case 'r32ui':
      return new Uint32Array([r | 0]);
    case 'r32i':
      return new Int32Array([r | 0]);
    case 'rg8unorm':
      return new Uint8Array([normalizeColorComponent(r, 255), normalizeColorComponent(g, 255)]);
    case 'rg8snorm':
      return new Int8Array([normalizeColorComponentSigned(r, 255), normalizeColorComponentSigned(g, 255)]);
    case 'rg16f':
      return new Uint16Array([floatToHalf(r), floatToHalf(g)]);
    case 'rg32f':
      return new Float32Array([r, g]);
    case 'rg8ui':
      return new Uint8Array([r | 0, g | 0]);
    case 'rg8i':
      return new Int8Array([r | 0, g | 0]);
    case 'rg16ui':
      return new Uint16Array([r | 0, g | 0]);
    case 'rg16i':
      return new Int16Array([r | 0, g | 0]);
    case 'rg32ui':
      return new Uint32Array([r | 0, g | 0]);
    case 'rg32i':
      return new Int32Array([r | 0, g | 0]);
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
      return new Uint8Array([
        normalizeColorComponent(r, 255),
        normalizeColorComponent(g, 255),
        normalizeColorComponent(b, 255),
        normalizeColorComponent(a, 255)
      ]);
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
      return new Uint8Array([
        normalizeColorComponent(b, 255),
        normalizeColorComponent(g, 255),
        normalizeColorComponent(r, 255),
        normalizeColorComponent(a, 255)
      ]);
    case 'rgba8snorm':
      return new Int8Array([
        normalizeColorComponentSigned(r, 255),
        normalizeColorComponentSigned(g, 255),
        normalizeColorComponentSigned(b, 255),
        normalizeColorComponentSigned(a, 255)
      ]);
    case 'rgba16f':
      return new Uint16Array([floatToHalf(r), floatToHalf(g), floatToHalf(b), floatToHalf(a)]);
    case 'rgba32f':
      return new Float32Array([r, g, b, a]);
    case 'rgba8ui':
      return new Uint8Array([r | 0, g | 0, b | 0, a | 0]);
    case 'rgba8i':
      return new Int8Array([r | 0, g | 0, b | 0, a | 0]);
    case 'rgba16ui':
      return new Uint16Array([r | 0, g | 0, b | 0, a | 0]);
    case 'rgba16i':
      return new Int16Array([r | 0, g | 0, b | 0, a | 0]);
    case 'rgba32ui':
      return new Uint32Array([r | 0, g | 0, b | 0, a | 0]);
    case 'rgba32i':
      return new Int32Array([r | 0, g | 0, b | 0, a | 0]);
    default:
      return null;
  }
}

/** @internal */
export function encodePixelToArray(
  format: TextureFormat,
  r: number,
  g: number,
  b: number,
  a: number,
  arr: Array<number>
): void {
  switch (format) {
    case 'r8unorm':
      arr.push(normalizeColorComponent(r, 255));
      break;
    case 'r8snorm':
      arr.push(normalizeColorComponentSigned(r, 255));
      break;
    case 'r16f':
      arr.push(floatToHalf(r));
      break;
    case 'r32f':
      arr.push(r);
      break;
    case 'r8ui':
      arr.push(r | 0);
      break;
    case 'r8i':
      arr.push(r | 0);
      break;
    case 'r16ui':
      arr.push(r | 0);
      break;
    case 'r16i':
      arr.push(r | 0);
      break;
    case 'r32ui':
      arr.push(r | 0);
      break;
    case 'r32i':
      arr.push(r | 0);
      break;
    case 'rg8unorm':
      arr.push(normalizeColorComponent(r, 255), normalizeColorComponent(g, 255));
      break;
    case 'rg8snorm':
      arr.push(normalizeColorComponentSigned(r, 255), normalizeColorComponentSigned(g, 255));
      break;
    case 'rg16f':
      arr.push(floatToHalf(r), floatToHalf(g));
      break;
    case 'rg32f':
      arr.push(r, g);
      break;
    case 'rg8ui':
      arr.push(r | 0, g | 0);
      break;
    case 'rg8i':
      arr.push(r | 0, g | 0);
      break;
    case 'rg16ui':
      arr.push(r | 0, g | 0);
      break;
    case 'rg16i':
      arr.push(r | 0, g | 0);
      break;
    case 'rg32ui':
      arr.push(r | 0, g | 0);
      break;
    case 'rg32i':
      arr.push(r | 0, g | 0);
      break;
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
      arr.push(
        normalizeColorComponent(r, 255),
        normalizeColorComponent(g, 255),
        normalizeColorComponent(b, 255),
        normalizeColorComponent(a, 255)
      );
      break;
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
      arr.push(
        normalizeColorComponent(b, 255),
        normalizeColorComponent(g, 255),
        normalizeColorComponent(r, 255),
        normalizeColorComponent(a, 255)
      );
      break;
    case 'rgba8snorm':
      arr.push(
        normalizeColorComponentSigned(r, 255),
        normalizeColorComponentSigned(g, 255),
        normalizeColorComponentSigned(b, 255),
        normalizeColorComponentSigned(a, 255)
      );
      break;
    case 'rgba16f':
      arr.push(floatToHalf(r), floatToHalf(g), floatToHalf(b), floatToHalf(a));
      break;
    case 'rgba32f':
      arr.push(r, g, b, a);
      break;
    case 'rgba8ui':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
    case 'rgba8i':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
    case 'rgba16ui':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
    case 'rgba16i':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
    case 'rgba32ui':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
    case 'rgba32i':
      arr.push(r | 0, g | 0, b | 0, a | 0);
      break;
  }
}

/**
 * The primitive type
 * @public
 */
export type PrimitiveType =
  | 'triangle-list'
  | 'triangle-strip'
  | 'triangle-fan'
  | 'line-list'
  | 'line-strip'
  | 'point-list';

/**
 * Shader type
 * @public
 */
export enum ShaderType {
  Vertex = 1 << 0,
  Fragment = 1 << 1,
  Compute = 1 << 2
}

/**
 * Shader kind
 * @public
 */
export type ShaderKind = 'vertex' | 'fragment' | 'compute';

/**
 * Frame information
 * @public
 */
export interface FrameInfo {
  /** counter of frames */
  frameCounter: number;
  /** timestamp of current frame, in milliseconds */
  frameTimestamp: number;
  /** time spent by the CPU from last frame, in milliseconds */
  elapsedTimeCPU: number;
  /** time spent by the GPU from last frame, in milliseconds */
  elapsedTimeGPU: number;
  /** time spent from last frame, in milliseconds */
  elapsedFrame: number;
  /** time spent from the first frame, in milliseconds */
  elapsedOverall: number;
  /** the FPS calculated for the last one second  */
  FPS: number;
  /** How many draw calls were sent to the GPU in current frame */
  drawCalls: number;
  /** How many compute calls were sent to the GPU in current frame */
  computeCalls: number;
  /** @internal */
  nextFrameCall: (() => void)[];
  /** @internal */
  nextFrameCallNext: (() => void)[];
}

/**
 * List of all gpu objects
 * @public
 */
export interface GPUObjectList {
  /** list of textures */
  textures: BaseTexture[];
  /** list of samplers */
  samplers: TextureSampler[];
  /** list of buffers */
  buffers: GPUDataBuffer[];
  /** list of programs */
  programs: GPUProgram[];
  /** list of frame buffers */
  framebuffers: FrameBuffer[];
  /** list of vertex layouts */
  vertexArrayObjects: VertexLayout[];
  /** list of bind groups */
  bindGroups: BindGroup[];
}

/**
 * The device capabilities
 * @public
 */
export interface DeviceCaps {
  /** Miscellaneous capabilities */
  miscCaps: MiscCaps;
  /** Frame buffer related capabilities */
  framebufferCaps: FramebufferCaps;
  /** Shader related capabilities */
  shaderCaps: ShaderCaps;
  /** Texture related capabilities */
  textureCaps: TextureCaps;
}

/**
 * Frame buffer related capabilities of the device
 * @public
 */
export interface FramebufferCaps {
  /** The maximum number of framebuffer color attachment points */
  maxDrawBuffers: number;
  /** True if device supports multisampled frame buffer */
  supportMultisampledFramebuffer: boolean;
  /** True if device supports blending on float point frame buffer */
  supportFloatBlending: boolean;
  /** True if device supports 32bits float depth buffer */
  supportDepth32float: boolean;
  /** True if device supports 32bits float depth buffer with 8bits stencil */
  supportDepth32floatStencil8: boolean;
  /** Maximum color attachment bytes per sample */
  maxColorAttachmentBytesPerSample: number;
}

/**
 * Miscellaneous capabilities of the device
 * @public
 */
export interface MiscCaps {
  /** True if the device supports oversized viewport */
  supportOversizedViewport: boolean;
  /** True if the device supports minimum and maximum blending equations */
  supportBlendMinMax: boolean;
  /** True if the device supports 32-bits index buffer */
  support32BitIndex: boolean;
  /** The maximum number of {@link BindGroupLayout}'s in a shader program */
  maxBindGroups: number;
  /** The maximum number of texture coordinate index */
  maxTexCoordIndex: number;
}

/**
 * Shader related capabilities of the device
 * @public
 */
export interface ShaderCaps {
  /** True if the device supports writing depth value in a fragment shader */
  supportFragmentDepth: boolean;
  /** True if the device supports derivative functions in a fragment shader */
  supportStandardDerivatives: boolean;
  /** True if the device supports explicit control of texture LOD in a fragment shader */
  supportShaderTextureLod: boolean;
  /** True if the device supports high precison float number for shader programs */
  supportHighPrecisionFloat: boolean;
  /** True if the device supports high precison integer number for shader programs */
  supportHighPrecisionInt: boolean;
  /** The maximum number of bytes of uniform buffer */
  maxUniformBufferSize: number;
  /** The uniform buffer offset alignment */
  uniformBufferOffsetAlignment: number;
  /** The maximum number of bytes of storage buffer */
  maxStorageBufferSize: number;
  /** The storage buffer offset alignment */
  storageBufferOffsetAlignment: number;
}

/**
 * Information of a texture format
 * @public
 */
export interface TextureFormatInfo {
  /** True if the texture format supports linear filtering */
  filterable: boolean;
  /** True if the texture format can be used as a render target */
  renderable: boolean;
  /** True if the texture format is a compressed format */
  compressed: boolean;
  /** Number of bytes per-block */
  size: number;
  /** Block width */
  blockWidth: number;
  /** Block height */
  blockHeight: number;
}

/**
 * Texture related capabilities of the device'
 * @public
 */
export interface TextureCaps {
  /** The maximum size for 2d texture */
  maxTextureSize: number;
  /** The maximum size for cube texture */
  maxCubeTextureSize: number;
  /** True if mipmapping is supported for non power of 2 textures */
  npo2Mipmapping: boolean;
  /** True if repeat address mode is supported for non power of 2 textures */
  npo2Repeating: boolean;
  /** True if device supports dxt1, dxt3, dxt5 texture format */
  supportS3TC: boolean;
  /** True if device supports bptc texture format */
  supportBPTC: boolean;
  /** True if device supports rgtc texture format */
  supportRGTC: boolean;
  /** True if device supports astc texture format */
  supportASTC: boolean;
  /** True if device supports dxt1_srgb, dxt3-srgb, dxt5-srgb texture format */
  supportS3TCSRGB: boolean;
  /** True if device supports depth texture */
  supportDepthTexture: boolean;
  /** True if device supports 3d texture */
  support3DTexture: boolean;
  /** True if device supports sRGB texture */
  supportSRGBTexture: boolean;
  /** True if device supports 32bit floating-point texture */
  supportFloatTexture: boolean;
  /** True if device supports linear filtering on 32bit floating-point textures */
  supportLinearFloatTexture: boolean;
  /** True if device supports 16bit floating-point texture */
  supportHalfFloatTexture: boolean;
  /** True if device supports linear filtering on 16bit floating-point textures */
  supportLinearHalfFloatTexture: boolean;
  /** True if device supports anisotropic filtering */
  supportAnisotropicFiltering: boolean;
  /** True if device supports rendering into a 32bit floating-point frame buffer */
  supportFloatColorBuffer: boolean;
  /** True if device supports rendering into a 16bit floating-point frame buffer */
  supportHalfFloatColorBuffer: boolean;
  /** True if device supports alpha blending with floating-point frame buffer */
  supportFloatBlending: boolean;
  /**
   * Get information of a given texture format
   * @param format - The texture format
   * @returns the texture format infomation
   */
  getTextureFormatInfo(format: TextureFormat): TextureFormatInfo;
}

/**
 * Creation options of rendering shader program
 * @public
 */
export interface RenderProgramConstructParams {
  /** The vertex shader source code */
  vs: string;
  /** The fragment shader source code */
  fs: string;
  /** Bind group layouts for the program */
  bindGroupLayouts: BindGroupLayout[];
  /** Vertex attributes used in the program */
  vertexAttributes: number[];
}

/**
 * Creation options of computing shader program
 * @public
 */
export interface ComputeProgramConstructParams {
  /** The shader source */
  source: string;
  /** Bind group layouts for the program */
  bindGroupLayouts: BindGroupLayout[];
}

/**
 * Creation options for shader program
 * @public
 */
export interface GPUProgramConstructParams {
  /** Type of the program to be created */
  type: 'render' | 'compute';
  /** Label of the program */
  label?: string;
  /** The creation options */
  params: RenderProgramConstructParams | ComputeProgramConstructParams;
}

/**
 * Creation options for device
 * @public
 */
export interface DeviceOptions {
  /** True if the device must have a MSAA back buffer */
  msaa?: boolean;
  /** The device pixel ratio */
  dpr?: number;
}

/**
 * The device event map
 * @public
 */
export type DeviceEventMap = {
  resize: [width: number, height: number];
  devicelost: [];
  devicerestored: [];
  gpuobject_added: [obj: GPUObject];
  gpuobject_removed: [obj: GPUObject];
  gpuobject_rename: [obj: GPUObject, lastName: string];
};

/**
 * Structure that contains the device viewport information
 * @public
 */
export type DeviceViewport = {
  /** viewport left */
  x: number;
  /** viewport top */
  y: number;
  /** viewport width */
  width: number;
  /** viewport height */
  height: number;
  /**
   * A boolean value that indicates whether this is full screen viewport
   * @remarks
   * The full screen viewport will be automatically resized when the screen size chenged
   */
  default: boolean;
};

/**
 * Abstract interface for the rendering device.
 * @public
 */
export interface AbstractDevice extends IEventTarget<DeviceEventMap> {
  /** Get pool object */
  pool: Pool;
  /** vSync */
  vSync: boolean;
  /** Check if a pool with given key exists */
  poolExists(key: string | symbol): boolean;
  /** Get the pool with given key, or create a new one if not exists */
  getPool(key: string | symbol): Pool;
  /** Get adapter information */
  getAdapterInfo(): any;
  /** Get sample count of current frame buffer */
  getFrameBufferSampleCount(): number;
  /** Returns true if device context is lost. */
  isContextLost(): boolean;
  /** Get the value of device pixel ratio */
  getScale(): number;
  /** Get the width of current frame buffer */
  getDrawingBufferWidth(): number;
  /** Get the height of current frame buffer */
  getDrawingBufferHeight(): number;
  /** Get the width of back buffer */
  getBackBufferWidth(): number;
  /** Get the height of back buffer */
  getBackBufferHeight(): number;
  /** Get the device capabilities */
  getDeviceCaps(): DeviceCaps;
  /** Schedule next frame */
  nextFrame(callback: () => void): number;
  /** Cancel schedule next frame */
  cancelNextFrame(handle: number);
  /** Set font for drawText function */
  setFont(fontName: string);
  /**
   * Draw a string
   * @param text - The string that will be drawn
   * @param x - x coordinate in pixels related to the viewport origin
   * @param y - y coordinate in pixels related to the viewport origin
   * @param color - A CSS color value
   */
  drawText(text: string, x: number, y: number, color: string);
  /**
   * Clears the current frame buffer
   * @param clearColor - If not null, the color buffer will be cleared to this value.
   * @param clearDepth - If not null, the depth buffer will be cleared to this value.
   * @param clearStencil - If not null, the stencil buffer will be cleared to this value.
   */
  clearFrameBuffer(clearColor: Vector4, clearDepth: number, clearStencil: number);
  /** Creates a render state set object */
  createRenderStateSet(): RenderStateSet;
  /** Creates a blending state object */
  createBlendingState(): BlendingState;
  /** Creates a color state object */
  createColorState(): ColorState;
  /** Creates a rasterizer state object */
  createRasterizerState(): RasterizerState;
  /** Creates a depth state object */
  createDepthState(): DepthState;
  /** Creates a stencil state object */
  createStencilState(): StencilState;
  /**
   * Creates a texture sampler object
   * @param options - The creation options
   * @returns The created texture sampler
   */
  createSampler(options: SamplerOptions): TextureSampler;
  /**
   * Creates a texture from given mipmap data
   * @param data - Mipmap data
   * @param options - Texture creation options
   * @returns The created texture
   */
  createTextureFromMipmapData<T extends BaseTexture = BaseTexture>(
    data: TextureMipmapData,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): T;
  /**
   * Creates a 2d texture
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param options - The creation options
   * @returns The created 2D texture
   */
  createTexture2D(
    format: TextureFormat,
    width: number,
    height: number,
    options?: TextureCreationOptions
  ): Texture2D;
  /**
   * Creates a 2d texture from a image element
   * @param element - The image element
   * @param options - The creation options
   * @returns The created 2D texture.
   */
  createTexture2DFromImage(
    element: TextureImageElement,
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2D;
  /**
   * Creates a 2d array texture
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param depth - Array length of the texture
   * @param options - The creation options
   * @returns The created 2D array texture.
   */
  createTexture2DArray(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture2DArray;
  /**
   * Creates a 2d array texture from a seris of image elements
   * @remarks image elements must have the same size.
   * @param elements - image elements
   * @param options - The creation options
   * @returns The created 2D array texture.
   */
  createTexture2DArrayFromImages(
    elements: TextureImageElement[],
    sRGB: boolean,
    options?: TextureCreationOptions
  ): Texture2DArray;
  /**
   * Creates a 3D texture
   * @param format - The texture format
   * @param width - Pixel width of the texture
   * @param height - Pixel height of the texture
   * @param depth - Pixel depth of the texture
   * @param options - The creation options
   * @returns The created 3D texture.
   */
  createTexture3D(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    options?: TextureCreationOptions
  ): Texture3D;
  /**
   * Creates a cube texture
   * @param format - The texture format
   * @param size - Pixel width of the texture
   * @param options - The creation options
   * @returns The created cube texture.
   */
  createCubeTexture(format: TextureFormat, size: number, options?: TextureCreationOptions): TextureCube;
  /**
   * Creates a video texture from a video element
   * @param el - The video element
   * @returns The created video texture.
   */
  createTextureVideo(el: HTMLVideoElement, samplerOptions?: SamplerOptions): TextureVideo;
  /**
   * Copies a 2d texture to another texture.
   *
   * @remarks
   * The two textures must have the same size and format
   *
   * @param src - Texture that will be copied from.
   * @param srcLevel - Which mipmap level to be copied from.
   * @param dst - Texture that will be copied to.
   * @param dstLevel - Which mipmap level to be copied to.
   */
  copyTexture2D(src: Texture2D, srcLevel: number, dst: Texture2D, dstLevel: number);
  /**
   * Copies a color attachment of a framebuffer to a mipmap level of a texture.
   *
   * @remarks
   * The color attachment and the mipmap level must have the same size and format
   *
   * @param src - Framebuffer that will be copied from.
   * @param index - Color attachment index of the framebuffer.
   * @param dst - Texture that will be copied to.
   * @param level - Which mipmap level should be copied to.
   */
  copyFramebufferToTexture2D(src: FrameBuffer, index: number, dst: Texture2D, level: number);
  /**
   * Set wether to reverse the winding order
   *
   * @remarks
   * The default winding order is counter-clockwise.
   *
   * @param reverse - true if the winding order should be reversed.
   */
  reverseVertexWindingOrder(reverse: boolean): void;
  /**
   * Check if the current winding order is reversed.
   */
  isWindingOrderReversed(): boolean;
  /**
   * Creates a gpu program
   * @param params - The creation options
   * @returns The created program.
   */
  createGPUProgram(params: GPUProgramConstructParams): GPUProgram;
  /**
   * Creates a bind group
   * @param layout - Layout of the bind group
   * @returns The created bind group.
   */
  createBindGroup(layout: BindGroupLayout): BindGroup;
  /**
   * Creates a gpu buffer
   * @param sizeInBytes - Size of the buffer in bytes
   * @param options - The creation options
   * @returns The created buffer.
   */
  createBuffer(sizeInBytes: number, options: BufferCreationOptions): GPUDataBuffer;
  /**
   * Copies a buffer to another buffer
   * @param sourceBuffer - Source buffer
   * @param destBuffer - destination buffer
   * @param srcOffset - Source offset in bytes
   * @param dstOffset - Destination offset in bytes
   * @param bytes - How many bytes to be copy
   */
  copyBuffer(
    sourceBuffer: GPUDataBuffer,
    destBuffer: GPUDataBuffer,
    srcOffset: number,
    dstOffset: number,
    bytes: number
  );
  /**
   * Creates an index buffer
   * @param data - Data of the index buffer
   * @param options - The creation options
   * @returns The created index buffer.
   */
  createIndexBuffer(data: Uint16Array | Uint32Array, options?: BufferCreationOptions): IndexBuffer;
  /**
   * Creates a structured buffer
   * @param structureType - The structure type
   * @param options - The creation options
   * @param data - Data to be filled with
   * @returns The created structured buffer.
   */
  createStructuredBuffer(
    structureType: PBStructTypeInfo,
    options: BufferCreationOptions,
    data?: TypedArray
  ): StructuredBuffer;
  /**
   * Creates a vertex layout object.
   * @param options - The creation options
   * @returns The created vertex layout object.
   */
  createVertexLayout(options: VertexLayoutOptions): VertexLayout;
  /**
   * Creates a frame buffer
   * @param options - The creation options
   * @returns The created framebuffer.
   */
  createFrameBuffer(
    colorAttachments: BaseTexture[],
    depthAttachment: BaseTexture,
    options?: FrameBufferOptions
  ): FrameBuffer;
  /**
   * Set viewport from an array that contains the position and size
   *
   * @param vp - The viewport position and size, if not specified, the viewport will be set to [0, 0, drawingBufferWidth, drawingBufferHeight]
   */
  setViewport(vp?: DeviceViewport | number[]): void;
  /** Get current viewport as [x, y, width, height] */
  getViewport(): DeviceViewport;
  /**
   * Set scissor rectangle from an array that contains the position and size
   * @param scissor - The scissor rectangle position and size, if not specified, the scissor rectangle will be set to [0, 0, drawingBufferWidth,drawingBufferHeight]
   */
  setScissor(scissor?: DeviceViewport | number[]): void;
  /**
   * Get current scissor rectangle
   */
  getScissor(): DeviceViewport;
  /**
   * Set current GPU program
   * @param program - The GPU program to be set
   */
  setProgram(program: GPUProgram): void;
  /**
   * Get current GPU program
   */
  getProgram(): GPUProgram;
  /**
   * Set current vertex layout
   *
   * @param vertexData - The vertex layout to be set
   */
  setVertexLayout(vertexData: VertexLayout): void;
  /** Get current vertex layout */
  getVertexLayout(): VertexLayout;
  /**
   * Set current render states
   *
   * @param renderStates - The render state set
   */
  setRenderStates(renderStates: RenderStateSet): void;
  /** Get current render states */
  getRenderStates(): RenderStateSet;
  /**
   * Sets the current framebuffer to the specified FrameBuffer object.
   *
   * @param rt - The FrameBuffer object to set as the current framebuffer.
   */
  setFramebuffer(rt: FrameBuffer);
  /**
   * Sets the current framebuffer specifying complex color attachments, an optional depth attachment, MIP level, face, and sample count.
   *
   * @param color - An array of BaseTextures or objects containing a BaseTexture and optional properties. Each BaseTexture or object will serve as a color attachment.
   *                - If an object is provided, it can specify:
   *                  - `texture`: The BaseTexture to use.
   *                  - `miplevel`: Optional MIP level for this specific texture. default is 0.
   *                  - `face`: Optional face index for cube map textures, specifying the cube face this texture is attached to. default is 0.
   *                  - `layer`: Optional layer index, useful for texture arrays. default is 0.
   * @param depth - Optional BaseTexture to serve as the depth attachment.
   * @param sampleCount - Optional sample count defining the number of samples for multisampling.
   */
  setFramebuffer(
    color: (BaseTexture | { texture: BaseTexture; miplevel?: number; face?: number; layer?: number })[],
    depth?: BaseTexture,
    miplevel?: number,
    face?: number,
    sampleCount?: number
  );
  /** Get current frame buffer */
  getFramebuffer(): FrameBuffer;
  /**
   * Set current bind group
   *
   * @param index - index of the bind group
   * @param bindGroup - The bind group to be set
   * @param dynamicOffsets - dynamic uniform buffer offsets of the bind group or null
   */
  setBindGroup(index: number, bindGroup: BindGroup, dynamicOffsets?: Iterable<number>);
  /**
   * Get current bind group
   * @param index - index of the bind group to get
   */
  getBindGroup(index: number): [BindGroup, Iterable<number>];
  /** Flush the gpu command buffer */
  flush(): void;
  /**
   * Read pixel values from current frame buffer
   *
   * @remarks
   * This method reads the data asynchronously to prevent GPU stall.
   * For WebGL1 devices, the GPU stall is still inevitable.
   *
   * @param index - color attachment index
   * @param x - x position of the reading area
   * @param y - y position of the reading area
   * @param w - width of the reading area
   * @param h - height of the reading area
   * @param buffer - The output buffer
   */
  readPixels(index: number, x: number, y: number, w: number, h: number, buffer: TypedArray): Promise<void>;
  /**
   * Read pixel values from current frame buffer to a GPU buffer
   *
   * @remarks
   * This method does not support WebGL1 device
   *
   * @param index - color attachment index
   * @param x - x position of the reading area
   * @param y - y position of the reading area
   * @param w - width of the reading area
   * @param h - height of the reading area
   * @param buffer - The output buffer
   */
  readPixelsToBuffer(index: number, x: number, y: number, w: number, h: number, buffer: GPUDataBuffer): void;
  /**
   * Begin capture draw commands
   */
  beginCapture(): void;
  /**
   * Executes render bundle
   * @param renderBundle - RenderBundle to be execute
   */
  executeRenderBundle(renderBundle: RenderBundle);
  /**
   * End capture draw commands
   * @returns A RenderBundle that holds the captured draw commands
   */
  endCapture(): RenderBundle;
  /** Get the video memory usage in bytes */
  videoMemoryUsage: number;
  /** Get the current frame information */
  frameInfo: FrameInfo;
  /** Check if the device is running a rendering loop by calling {@link AbstractDevice.runLoop} */
  isRendering: boolean;
  /** Get the canvas element for this device */
  canvas: HTMLCanvasElement;
  /** Get the device type */
  type: string;
  /** Get the program builder */
  programBuilder: ProgramBuilder;
  /** Get the run loop callback function */
  runLoopFunction: (device: AbstractDevice) => void;
  /**
   * Begins a frame for rendering
   *
   * @remarks
   * All rendering call must occur between the @see AbstractDevice.beginFrame and @see AbstractDevice.endFrame methods
   */
  beginFrame(): boolean;
  /**
   * Ends a frame for rendering
   *
   * @remarks
   * All rendering call must occur between the @see AbstractDevice.beginFrame and @see AbstractDevice.endFrame methods
   */
  endFrame(): void;
  /**
   * Get the vertex attribute format from vertex semantic and data type
   *
   * @param semantic - The vertex semantic
   * @param dataType - The data type
   * @param componentCount - The component count
   */
  getVertexAttribFormat(
    semantic: VertexSemantic,
    dataType: DataType,
    componentCount: number
  ): VertexAttribFormat;
  /**
   * Creates an interleaved vertex buffer
   *
   * @param attribFormats - The vertex attribute formats for each vertex stream in the vertex buffer
   * @param data - Data to be filled with
   * @param options - The creation options
   * @returns The created vertex buffer.
   */
  createInterleavedVertexBuffer(
    attribFormats: VertexAttribFormat[],
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer;
  /**
   * Creates a non-interleaved vertex buffer
   *
   * @param attribFormat - The vertex attribute format
   * @param data - Data to be filled with
   * @param options - The creation options
   * @returns The created vertex buffer
   */
  createVertexBuffer(
    attribFormat: VertexAttribFormat,
    data: TypedArray,
    options?: BufferCreationOptions
  ): StructuredBuffer;
  /**
   * Draw primitives
   *
   * @param primitiveType - The primitive type
   * @param first - The vertex offset (or index offset if an index buffer exists)
   * @param count - The vertex count (or index count if an index buffer exists) to be drawn
   */
  draw(primitiveType: PrimitiveType, first: number, count: number): void;
  /**
   * Draw multiple instances of primitives
   *
   * @param primitiveType - The primitive type
   * @param first - The vertex offset (or index offset if an index buffer exists)
   * @param count - The vertex count (or index count if an index buffer exists) to be drawn
   * @param numInstances - How many instances to be drawn
   */
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number): void;
  /**
   * Dispatches a compute task to the GPU
   *
   * @param workgroupCountX - X dimension of the grid of workgroups to be dispatch
   * @param workgroupCountY - Y dimension of the grid of workgroups to be dispatch
   * @param workgroupCountZ - Z dimension of the grid of workgroups to be dispatch
   */
  compute(workgroupCountX: number, workgroupCountY: number, workgroupCountZ: number): void;
  /**
   * Schedules a function to be executed at the beginning of the next frame
   *
   * @param f - The function to be scheduled
   */
  runNextFrame(f: () => void): void;
  /** Exits from current rendering loop */
  exitLoop(): void;
  /**
   * Begins a rendering loop
   *
   * @param func - The function to be executed at every frame
   */
  runLoop(func: (device: AbstractDevice) => void): void;
  /** Get all GPU objects */
  getGPUObjects(): GPUObjectList;
  /**
   * Get GPU object by id
   *
   * @param uid - id of the GPU object
   */
  getGPUObjectById(uid: number): GPUObject;
  /**
   * Calculates the actual position of current frame buffer from screen position.
   *
   * @remarks
   * If current frame buffer is the back buffer, the value will be scaled by the device pixel ratio.
   *
   * @param val - The screen position in pixels
   */
  screenToDevice(val: number): number;
  /**
   * Calculates the screen position from position of current frame buffer.
   *
   * @remarks
   * If current frame buffer is the back buffer, the value will be divided by the device pixel ratio.
   *
   * @param val - The position of current frame buffer in pixels
   */
  deviceToScreen(val: number): number;
  /** Builds render program */
  buildRenderProgram(options: PBRenderOptions): GPUProgram;
  /** Builds compute program */
  buildComputeProgram(options: PBComputeOptions): GPUProgram;
  /** Pushes current FrameBuffer state */
  pushDeviceStates();
  /** Pops last FrameBuffer state */
  popDeviceStates();
}
