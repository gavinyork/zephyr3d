import type { TextureFormat } from '../base_types';
import type { UniformBufferLayout } from '../gpuobject';

const F16_BITMASK = 1;
const F32_BITMASK = 2;
const BOOL_BITMASK = 3;
const I8_BITMASK = 4;
const I16_BITMASK = 5;
const I32_BITMASK = 6;
const U8_BITMASK = 7;
const U16_BITMASK = 8;
const U32_BITMASK = 9;
const SCALAR_TYPE_BITMASK = 15;
const ROWS_BITMASK = 7;
const ROWS_BITSHIFT = 4;
const COLS_BITMASK = 7;
const COLS_BITSHIFT = 7;
const NORM_BITMASK = 1;
const NORM_BITSHIFT = 10;

type LayoutableType =
  | PBPrimitiveTypeInfo
  | PBArrayTypeInfo
  | PBStructTypeInfo
  | PBAtomicI32TypeInfo
  | PBAtomicU32TypeInfo;

function align(n: number, alignment: number): number {
  return (n + alignment - 1) & ~(alignment - 1);
}

function getAlignment(type: LayoutableType): number {
  if (type.isPrimitiveType()) {
    return type.isScalarType() ? 4 : 1 << Math.min(4, type.cols + 1);
  } else if (type.isAtomicI32() || type.isAtomicU32()) {
    return 4;
  } else if (type.isArrayType()) {
    return type.elementType.isAnyType() ? 1 : getAlignment(type.elementType);
  } else {
    let alignment = 0;
    for (const member of type.structMembers) {
      alignment = Math.max(alignment, getAlignment(member.type));
    }
    return Math.max(alignment, 16);
  }
}
function getAlignmentPacked(type: LayoutableType): number {
  return 1;
}
function getSize(type: LayoutableType): number {
  if (type.isPrimitiveType()) {
    return type.isMatrixType()
      ? type.rows * getAlignment(PBPrimitiveTypeInfo.getCachedTypeInfo(type.resizeType(1, type.cols)))
      : 4 * type.cols;
  } else if (type.isArrayType()) {
    return type.elementType.isAnyType()
      ? 0
      : type.dimension * align(getSize(type.elementType), getAlignment(type.elementType));
  } else if (type.isAtomicI32() || type.isAtomicU32()) {
    return 4;
  } else {
    let size = 0;
    let structAlignment = 0;
    for (const member of type.structMembers) {
      const memberAlignment = getAlignment(member.type);
      size = align(size, memberAlignment);
      size += getSize(member.type);
      structAlignment = Math.max(structAlignment, memberAlignment);
    }
    return align(size, structAlignment);
  }
}
function getSizePacked(type: LayoutableType): number {
  if (type.isPrimitiveType()) {
    let scalarSize: number;
    switch (type.scalarType) {
      case PBPrimitiveType.U8:
      case PBPrimitiveType.U8_NORM:
      case PBPrimitiveType.I8:
      case PBPrimitiveType.I8_NORM:
        scalarSize = 1;
        break;
      case PBPrimitiveType.F16:
      case PBPrimitiveType.I16:
      case PBPrimitiveType.I16_NORM:
      case PBPrimitiveType.U16:
      case PBPrimitiveType.U16_NORM:
        scalarSize = 2;
        break;
      default:
        scalarSize = 4;
        break;
    }
    return type.rows * type.cols * scalarSize;
  } else if (type.isArrayType()) {
    return type.elementType.isAnyType() ? 0 : type.dimension * getSizePacked(type.elementType);
  } else if (type.isAtomicI32() || type.isAtomicU32()) {
    return 4;
  } else {
    let size = 0;
    for (const member of type.structMembers) {
      size += getSizePacked(member.type);
    }
    return size;
  }
}

function makePrimitiveType(scalarTypeMask: number, rows: number, cols: number, norm: 0 | 1): PBPrimitiveType {
  return scalarTypeMask | (rows << ROWS_BITSHIFT) | (cols << COLS_BITSHIFT) | (norm << NORM_BITSHIFT);
}

function typeToTypedArray(type: LayoutableType): PBPrimitiveType {
  if (type.isPrimitiveType()) {
    return type.scalarType;
  } else if (type.isArrayType()) {
    return type.elementType.isAnyType() ? null : typeToTypedArray(type.elementType);
  } else {
    return PBPrimitiveType.U8;
  }
}

/**
 * Struct layout types
 * @public
 */
export type PBStructLayout = 'default' | 'std140' | 'std430' | 'packed';

/**
 * Primitive types
 * @public
 */
export enum PBPrimitiveType {
  NONE = 0,
  F16 = makePrimitiveType(F16_BITMASK, 1, 1, 0),
  F16VEC2 = makePrimitiveType(F16_BITMASK, 1, 2, 0),
  F16VEC3 = makePrimitiveType(F16_BITMASK, 1, 3, 0),
  F16VEC4 = makePrimitiveType(F16_BITMASK, 1, 4, 0),
  F32 = makePrimitiveType(F32_BITMASK, 1, 1, 0),
  F32VEC2 = makePrimitiveType(F32_BITMASK, 1, 2, 0),
  F32VEC3 = makePrimitiveType(F32_BITMASK, 1, 3, 0),
  F32VEC4 = makePrimitiveType(F32_BITMASK, 1, 4, 0),
  BOOL = makePrimitiveType(BOOL_BITMASK, 1, 1, 0),
  BVEC2 = makePrimitiveType(BOOL_BITMASK, 1, 2, 0),
  BVEC3 = makePrimitiveType(BOOL_BITMASK, 1, 3, 0),
  BVEC4 = makePrimitiveType(BOOL_BITMASK, 1, 4, 0),
  I8 = makePrimitiveType(I8_BITMASK, 1, 1, 0),
  I8VEC2 = makePrimitiveType(I8_BITMASK, 1, 2, 0),
  I8VEC3 = makePrimitiveType(I8_BITMASK, 1, 3, 0),
  I8VEC4 = makePrimitiveType(I8_BITMASK, 1, 4, 0),
  I8_NORM = makePrimitiveType(I8_BITMASK, 1, 1, 1),
  I8VEC2_NORM = makePrimitiveType(I8_BITMASK, 1, 2, 1),
  I8VEC3_NORM = makePrimitiveType(I8_BITMASK, 1, 3, 1),
  I8VEC4_NORM = makePrimitiveType(I8_BITMASK, 1, 4, 1),
  I16 = makePrimitiveType(I16_BITMASK, 1, 1, 0),
  I16VEC2 = makePrimitiveType(I16_BITMASK, 1, 2, 0),
  I16VEC3 = makePrimitiveType(I16_BITMASK, 1, 3, 0),
  I16VEC4 = makePrimitiveType(I16_BITMASK, 1, 4, 0),
  I16_NORM = makePrimitiveType(I16_BITMASK, 1, 1, 1),
  I16VEC2_NORM = makePrimitiveType(I16_BITMASK, 1, 2, 1),
  I16VEC3_NORM = makePrimitiveType(I16_BITMASK, 1, 3, 1),
  I16VEC4_NORM = makePrimitiveType(I16_BITMASK, 1, 4, 1),
  I32 = makePrimitiveType(I32_BITMASK, 1, 1, 0),
  I32VEC2 = makePrimitiveType(I32_BITMASK, 1, 2, 0),
  I32VEC3 = makePrimitiveType(I32_BITMASK, 1, 3, 0),
  I32VEC4 = makePrimitiveType(I32_BITMASK, 1, 4, 0),
  I32_NORM = makePrimitiveType(I32_BITMASK, 1, 1, 1),
  I32VEC2_NORM = makePrimitiveType(I32_BITMASK, 1, 2, 1),
  I32VEC3_NORM = makePrimitiveType(I32_BITMASK, 1, 3, 1),
  I32VEC4_NORM = makePrimitiveType(I32_BITMASK, 1, 4, 1),
  U8 = makePrimitiveType(U8_BITMASK, 1, 1, 0),
  U8VEC2 = makePrimitiveType(U8_BITMASK, 1, 2, 0),
  U8VEC3 = makePrimitiveType(U8_BITMASK, 1, 3, 0),
  U8VEC4 = makePrimitiveType(U8_BITMASK, 1, 4, 0),
  U8_NORM = makePrimitiveType(U8_BITMASK, 1, 1, 1),
  U8VEC2_NORM = makePrimitiveType(U8_BITMASK, 1, 2, 1),
  U8VEC3_NORM = makePrimitiveType(U8_BITMASK, 1, 3, 1),
  U8VEC4_NORM = makePrimitiveType(U8_BITMASK, 1, 4, 1),
  U16 = makePrimitiveType(U16_BITMASK, 1, 1, 0),
  U16VEC2 = makePrimitiveType(U16_BITMASK, 1, 2, 0),
  U16VEC3 = makePrimitiveType(U16_BITMASK, 1, 3, 0),
  U16VEC4 = makePrimitiveType(U16_BITMASK, 1, 4, 0),
  U16_NORM = makePrimitiveType(U16_BITMASK, 1, 1, 1),
  U16VEC2_NORM = makePrimitiveType(U16_BITMASK, 1, 2, 1),
  U16VEC3_NORM = makePrimitiveType(U16_BITMASK, 1, 3, 1),
  U16VEC4_NORM = makePrimitiveType(U16_BITMASK, 1, 4, 1),
  U32 = makePrimitiveType(U32_BITMASK, 1, 1, 0),
  U32VEC2 = makePrimitiveType(U32_BITMASK, 1, 2, 0),
  U32VEC3 = makePrimitiveType(U32_BITMASK, 1, 3, 0),
  U32VEC4 = makePrimitiveType(U32_BITMASK, 1, 4, 0),
  U32_NORM = makePrimitiveType(U32_BITMASK, 1, 1, 1),
  U32VEC2_NORM = makePrimitiveType(U32_BITMASK, 1, 2, 1),
  U32VEC3_NORM = makePrimitiveType(U32_BITMASK, 1, 3, 1),
  U32VEC4_NORM = makePrimitiveType(U32_BITMASK, 1, 4, 1),
  MAT2 = makePrimitiveType(F32_BITMASK, 2, 2, 0),
  MAT2x3 = makePrimitiveType(F32_BITMASK, 2, 3, 0),
  MAT2x4 = makePrimitiveType(F32_BITMASK, 2, 4, 0),
  MAT3x2 = makePrimitiveType(F32_BITMASK, 3, 2, 0),
  MAT3 = makePrimitiveType(F32_BITMASK, 3, 3, 0),
  MAT3x4 = makePrimitiveType(F32_BITMASK, 3, 4, 0),
  MAT4x2 = makePrimitiveType(F32_BITMASK, 4, 2, 0),
  MAT4x3 = makePrimitiveType(F32_BITMASK, 4, 3, 0),
  MAT4 = makePrimitiveType(F32_BITMASK, 4, 4, 0)
}

const primitiveTypeMapWebGL = {
  [PBPrimitiveType.F32]: 'float',
  [PBPrimitiveType.F32VEC2]: 'vec2',
  [PBPrimitiveType.F32VEC3]: 'vec3',
  [PBPrimitiveType.F32VEC4]: 'vec4',
  [PBPrimitiveType.BOOL]: 'bool',
  [PBPrimitiveType.BVEC2]: 'bvec2',
  [PBPrimitiveType.BVEC3]: 'bvec3',
  [PBPrimitiveType.BVEC4]: 'bvec4',
  [PBPrimitiveType.I32]: 'int',
  [PBPrimitiveType.I32VEC2]: 'ivec2',
  [PBPrimitiveType.I32VEC3]: 'ivec3',
  [PBPrimitiveType.I32VEC4]: 'ivec4',
  [PBPrimitiveType.U32]: 'uint',
  [PBPrimitiveType.U32VEC2]: 'uvec2',
  [PBPrimitiveType.U32VEC3]: 'uvec3',
  [PBPrimitiveType.U32VEC4]: 'uvec4',
  [PBPrimitiveType.MAT2]: 'mat2',
  [PBPrimitiveType.MAT2x3]: 'mat2x3',
  [PBPrimitiveType.MAT2x4]: 'mat2x4',
  [PBPrimitiveType.MAT3x2]: 'mat3x2',
  [PBPrimitiveType.MAT3]: 'mat3',
  [PBPrimitiveType.MAT3x4]: 'mat3x4',
  [PBPrimitiveType.MAT4x2]: 'mat4x2',
  [PBPrimitiveType.MAT4x3]: 'mat4x3',
  [PBPrimitiveType.MAT4]: 'mat4'
};

const primitiveTypeMapWGSL = {
  [PBPrimitiveType.F32]: 'f32',
  [PBPrimitiveType.F32VEC2]: 'vec2<f32>',
  [PBPrimitiveType.F32VEC3]: 'vec3<f32>',
  [PBPrimitiveType.F32VEC4]: 'vec4<f32>',
  [PBPrimitiveType.BOOL]: 'bool',
  [PBPrimitiveType.BVEC2]: 'vec2<bool>',
  [PBPrimitiveType.BVEC3]: 'vec3<bool>',
  [PBPrimitiveType.BVEC4]: 'vec4<bool>',
  [PBPrimitiveType.I32]: 'i32',
  [PBPrimitiveType.I32VEC2]: 'vec2<i32>',
  [PBPrimitiveType.I32VEC3]: 'vec3<i32>',
  [PBPrimitiveType.I32VEC4]: 'vec4<i32>',
  [PBPrimitiveType.U32]: 'u32',
  [PBPrimitiveType.U32VEC2]: 'vec2<u32>',
  [PBPrimitiveType.U32VEC3]: 'vec3<u32>',
  [PBPrimitiveType.U32VEC4]: 'vec4<u32>',
  [PBPrimitiveType.MAT2]: 'mat2x2<f32>',
  [PBPrimitiveType.MAT2x3]: 'mat2x3<f32>',
  [PBPrimitiveType.MAT2x4]: 'mat2x4<f32>',
  [PBPrimitiveType.MAT3x2]: 'mat3x2<f32>',
  [PBPrimitiveType.MAT3]: 'mat3x3<f32>',
  [PBPrimitiveType.MAT3x4]: 'mat3x4<f32>',
  [PBPrimitiveType.MAT4x2]: 'mat4x2<f32>',
  [PBPrimitiveType.MAT4x3]: 'mat4x3<f32>',
  [PBPrimitiveType.MAT4]: 'mat4x4<f32>'
};

const BITFLAG_1D = 1 << 0;
const BITFLAG_2D = 1 << 1;
const BITFLAG_3D = 1 << 2;
const BITFLAG_CUBE = 1 << 3;
const BITFLAG_ARRAY = 1 << 4;
const BITFLAG_MULTISAMPLED = 1 << 5;
const BITFLAG_STORAGE = 1 << 6;
const BITFLAG_DEPTH = 1 << 7;
const BITFLAG_FLOAT = 1 << 8;
const BITFLAG_INT = 1 << 9;
const BITFLAG_UINT = 1 << 10;
const BITFLAG_EXTERNAL = 1 << 11;

/**
 * Texture types
 * @public
 */
export enum PBTextureType {
  TEX_1D = BITFLAG_1D | BITFLAG_FLOAT,
  ITEX_1D = BITFLAG_1D | BITFLAG_INT,
  UTEX_1D = BITFLAG_1D | BITFLAG_UINT,
  TEX_2D = BITFLAG_2D | BITFLAG_FLOAT,
  ITEX_2D = BITFLAG_2D | BITFLAG_INT,
  UTEX_2D = BITFLAG_2D | BITFLAG_UINT,
  TEX_2D_ARRAY = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_ARRAY,
  ITEX_2D_ARRAY = BITFLAG_2D | BITFLAG_INT | BITFLAG_ARRAY,
  UTEX_2D_ARRAY = BITFLAG_2D | BITFLAG_UINT | BITFLAG_ARRAY,
  TEX_3D = BITFLAG_3D | BITFLAG_FLOAT,
  ITEX_3D = BITFLAG_3D | BITFLAG_INT,
  UTEX_3D = BITFLAG_3D | BITFLAG_UINT,
  TEX_CUBE = BITFLAG_CUBE | BITFLAG_FLOAT,
  ITEX_CUBE = BITFLAG_CUBE | BITFLAG_INT,
  UTEX_CUBE = BITFLAG_CUBE | BITFLAG_UINT,
  TEX_CUBE_ARRAY = BITFLAG_CUBE | BITFLAG_FLOAT | BITFLAG_ARRAY,
  ITEX_CUBE_ARRAY = BITFLAG_CUBE | BITFLAG_INT | BITFLAG_ARRAY,
  UTEX_CUBE_ARRAY = BITFLAG_CUBE | BITFLAG_UINT | BITFLAG_ARRAY,
  TEX_MULTISAMPLED_2D = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_MULTISAMPLED,
  ITEX_MULTISAMPLED_2D = BITFLAG_2D | BITFLAG_INT | BITFLAG_MULTISAMPLED,
  UTEX_MULTISAMPLED_2D = BITFLAG_2D | BITFLAG_UINT | BITFLAG_MULTISAMPLED,
  TEX_STORAGE_1D = BITFLAG_1D | BITFLAG_STORAGE,
  TEX_STORAGE_2D = BITFLAG_2D | BITFLAG_STORAGE,
  TEX_STORAGE_2D_ARRAY = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_STORAGE,
  TEX_STORAGE_3D = BITFLAG_3D | BITFLAG_STORAGE,
  TEX_DEPTH_2D = BITFLAG_2D | BITFLAG_DEPTH,
  TEX_DEPTH_2D_ARRAY = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_DEPTH,
  TEX_DEPTH_CUBE = BITFLAG_CUBE | BITFLAG_DEPTH,
  TEX_DEPTH_CUBE_ARRAY = BITFLAG_CUBE | BITFLAG_ARRAY | BITFLAG_DEPTH,
  TEX_DEPTH_MULTISAMPLED_2D = BITFLAG_2D | BITFLAG_MULTISAMPLED | BITFLAG_DEPTH,
  TEX_EXTERNAL = BITFLAG_EXTERNAL
}

const textureTypeMapWebGL = {
  [PBTextureType.TEX_1D]: 'highp sampler2D',
  [PBTextureType.TEX_2D]: 'highp sampler2D',
  [PBTextureType.TEX_CUBE]: 'highp samplerCube',
  [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};

const textureTypeMapWebGL2 = {
  [PBTextureType.TEX_1D]: 'highp sampler2D',
  [PBTextureType.TEX_2D]: 'highp sampler2D',
  [PBTextureType.ITEX_1D]: 'highp isampler2D',
  [PBTextureType.ITEX_2D]: 'highp isampler2D',
  [PBTextureType.UTEX_1D]: 'highp usampler2D',
  [PBTextureType.UTEX_2D]: 'highp usampler2D',
  [PBTextureType.TEX_2D_ARRAY]: 'highp sampler2DArray',
  [PBTextureType.ITEX_2D_ARRAY]: 'highp isampler2DArray',
  [PBTextureType.UTEX_2D_ARRAY]: 'highp usampler2DArray',
  [PBTextureType.TEX_3D]: 'highp sampler3D',
  [PBTextureType.ITEX_3D]: 'highp isampler3D',
  [PBTextureType.UTEX_3D]: 'highp usampler3D',
  [PBTextureType.TEX_CUBE]: 'highp samplerCube',
  [PBTextureType.ITEX_CUBE]: 'highp isamplerCube',
  [PBTextureType.UTEX_CUBE]: 'highp usamplerCube',
  [PBTextureType.TEX_DEPTH_2D]: 'highp sampler2DShadow',
  [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'highp sampler2DArrayShadow',
  [PBTextureType.TEX_DEPTH_CUBE]: 'highp samplerCubeShadow',
  [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};

const textureTypeMapWGSL = {
  [PBTextureType.TEX_1D]: 'texture_1d<f32>',
  [PBTextureType.ITEX_1D]: 'texture_1d<i32>',
  [PBTextureType.UTEX_1D]: 'texture_1d<u32>',
  [PBTextureType.TEX_2D]: 'texture_2d<f32>',
  [PBTextureType.ITEX_2D]: 'texture_2d<i32>',
  [PBTextureType.UTEX_2D]: 'texture_2d<u32>',
  [PBTextureType.TEX_2D_ARRAY]: 'texture_2d_array<f32>',
  [PBTextureType.ITEX_2D_ARRAY]: 'texture_2d_array<i32>',
  [PBTextureType.UTEX_2D_ARRAY]: 'texture_2d_array<u32>',
  [PBTextureType.TEX_3D]: 'texture_3d<f32>',
  [PBTextureType.ITEX_3D]: 'texture_3d<i32>',
  [PBTextureType.UTEX_3D]: 'texture_3d<u32>',
  [PBTextureType.TEX_CUBE]: 'texture_cube<f32>',
  [PBTextureType.ITEX_CUBE]: 'texture_cube<i32>',
  [PBTextureType.UTEX_CUBE]: 'texture_cube<u32>',
  [PBTextureType.TEX_CUBE_ARRAY]: 'texture_cube_array<f32>',
  [PBTextureType.ITEX_CUBE_ARRAY]: 'texture_cube_array<i32>',
  [PBTextureType.UTEX_CUBE_ARRAY]: 'texture_cube_array<u32>',
  [PBTextureType.TEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<f32>',
  [PBTextureType.ITEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<i32>',
  [PBTextureType.UTEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<u32>',
  [PBTextureType.TEX_STORAGE_1D]: 'texture_storage_1d',
  [PBTextureType.TEX_STORAGE_2D]: 'texture_storage_2d',
  [PBTextureType.TEX_STORAGE_2D_ARRAY]: 'texture_storage_2d_array',
  [PBTextureType.TEX_STORAGE_3D]: 'texture_storage_3d',
  [PBTextureType.TEX_DEPTH_2D]: 'texture_depth_2d',
  [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'texture_depth_2d_array',
  [PBTextureType.TEX_DEPTH_CUBE]: 'texture_depth_cube',
  [PBTextureType.TEX_DEPTH_CUBE_ARRAY]: 'texture_depth_cube_array',
  [PBTextureType.TEX_DEPTH_MULTISAMPLED_2D]: 'texture_depth_multisampled_2d',
  [PBTextureType.TEX_EXTERNAL]: 'texture_external'
};

const storageTexelFormatMap = {
  rgba8unorm: 'rgba8unorm',
  rgba8snorm: 'rgba8snorm',
  bgra8unorm: 'bgra8unorm',
  rgba8ui: 'rgba8uint',
  rgba8i: 'rgba8sint',
  rgba16ui: 'rgba16uint',
  rgba16i: 'rgba16sint',
  rgba16f: 'rgba16float',
  r32f: 'r32float',
  r32ui: 'r32uint',
  r32i: 'r32sint',
  rg32f: 'rg32float',
  rg32ui: 'rg32uint',
  rg32i: 'rg32sint',
  rgba32f: 'rgba32float',
  rgba32ui: 'rgba32uint',
  rgba32i: 'rgba32sint'
} as const;

/**
 * Sampler access mode
 * @public
 */
export enum PBSamplerAccessMode {
  UNKNOWN = 0,
  SAMPLE,
  COMPARISON
}

/**
 * Shader variable address space
 * @public
 */
export enum PBAddressSpace {
  UNKNOWN = 'unknown',
  FUNCTION = 'function',
  PRIVATE = 'private',
  WORKGROUP = 'workgroup',
  UNIFORM = 'uniform',
  STORAGE = 'storage'
}

enum PBTypeClass {
  UNKNOWN = 0,
  PLAIN,
  ARRAY,
  POINTER,
  ATOMIC_I32,
  ATOMIC_U32,
  TEXTURE,
  SAMPLER,
  FUNCTION,
  VOID,
  ANY
}

/**
 * Type detail information
 * @public
 */
export type TypeDetailInfo =
  | PrimitiveTypeDetail
  | StructTypeDetail
  | ArrayTypeDetail
  | PointerTypeDetail
  | AtomicTypeInfoDetail
  | SamplerTypeDetail
  | TextureTypeDetail
  | FunctionTypeDetail
  | null;

/**
 * Detail informations for primitive type
 * @public
 */
export interface PrimitiveTypeDetail {
  primitiveType?: PBPrimitiveType;
}

/**
 * Detail informations for struct type
 * @public
 */
export interface StructTypeDetail {
  /** Layout of the struct type */
  layout: PBStructLayout;
  /** Name of the struct type */
  structName?: string;
  /** Members of the struct type */
  structMembers?: {
    /** Name of the struct member */
    name: string;
    /** Type of the struct member */
    type:
      | PBPrimitiveTypeInfo
      | PBArrayTypeInfo
      | PBAtomicI32TypeInfo
      | PBAtomicU32TypeInfo
      | PBStructTypeInfo;
    /** Alignment of the struct member */
    alignment: number;
    /** Byte size of the struct member */
    size: number;
    /** @internal */
    defaultAlignment: number;
    /** @internal */
    defaultSize: number;
  }[];
}

/**
 * Detail informations for array type
 * @public
 */
export interface ArrayTypeDetail {
  /** Type of array elements */
  elementType: PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo | PBAnyTypeInfo | PBAtomicI32TypeInfo | PBAtomicU32TypeInfo;
  /** Array dimension */
  dimension: number;
}

/**
 * Detail informations for pointer type
 * @public
 */
export interface PointerTypeDetail {
  /** Type of the pointer */
  pointerType: PBTypeInfo;
  /** Address space of the pointer */
  addressSpace: PBAddressSpace;
}

/**
 * Detail information for atomic type
 * @public
 */
export interface AtomicTypeInfoDetail {
  /** Primitive type of the atomic type */
  type: PBPrimitiveType;
}

/**
 * Detail informations for sampler type
 * @public
 */
export interface SamplerTypeDetail {
  /** Access mode of the sampler type */
  accessMode: PBSamplerAccessMode;
}

/**
 * Detail informations for texture type
 * @public
 */
export interface TextureTypeDetail {
  /** type of the texture */
  textureType: PBTextureType;
  /** texture format if this is a storage texture */
  storageTexelFormat: TextureFormat;
  /** true if this is a readable storage texture type */
  readable: boolean;
  /** true if this is a writable storage texture type */
  writable: boolean;
}

/**
 * Detail information for a function type
 * @public
 */
export interface FunctionTypeDetail {
  /** The function name */
  name: string;
  /** Return type of the function */
  returnType: PBTypeInfo;
  /** Type information for function arguments */
  argTypes: {
    /** Type of the argument */
    type: PBTypeInfo;
    /** true if this argument will be passed by reference */
    byRef?: boolean;
  }[];
}

/**
 * Abstract base class for any type
 * @public
 */
export abstract class PBTypeInfo<DetailType extends TypeDetailInfo = TypeDetailInfo> {
  /** @internal */
  cls: PBTypeClass;
  /** @internal */
  detail: DetailType;
  /** @internal */
  protected id: string;
  /** @internal */
  constructor(cls: PBTypeClass, detail: DetailType) {
    this.cls = cls;
    this.detail = detail;
    this.id = null;
  }
  /** Get unique id for this type */
  get typeId(): string {
    if (!this.id) {
      this.id = this.genTypeId();
    }
    return this.id;
  }
  /** returns true if this is a void type */
  isVoidType(): this is PBVoidTypeInfo {
    return false;
  }
  /** returns true if this is an any type */
  isAnyType(): this is PBAnyTypeInfo {
    return false;
  }
  /** returns true if this is a primitive type */
  isPrimitiveType(): this is PBPrimitiveTypeInfo {
    return false;
  }
  /** Wether this type have atomic members */
  haveAtomicMembers(): boolean {
    return false;
  }
  /** returns true if this is a struct type */
  isStructType(): this is PBStructTypeInfo {
    return false;
  }
  /** returns true if this is an array type */
  isArrayType(): this is PBArrayTypeInfo {
    return false;
  }
  /** returns true if this is a pointer type */
  isPointerType(): this is PBPointerTypeInfo {
    return false;
  }
  /** returns true if this is an atomic int type */
  isAtomicI32(): this is PBAtomicI32TypeInfo {
    return false;
  }
  /** returns true if this is an atomic uint type */
  isAtomicU32(): this is PBAtomicU32TypeInfo {
    return false;
  }
  /** returns true if this is a sampler type */
  isSamplerType(): this is PBSamplerTypeInfo {
    return false;
  }
  /** returns true if this is a texture type */
  isTextureType(): this is PBTextureTypeInfo {
    return false;
  }
  /** @internal */
  isHostSharable(): boolean {
    return false;
  }
  /** @internal */
  isConstructible(): boolean {
    return false;
  }
  /** @internal */
  isStorable(): boolean {
    return false;
  }
  /** @internal */
  getConstructorOverloads(deviceType: string): PBFunctionTypeInfo[] {
    return [];
  }
  /**
   * Check whether a given type is compatible with this type
   * @param other - The type to be checked
   * @returns true if the given type is compatible with this type, othewise false
   */
  isCompatibleType(other: PBTypeInfo): boolean {
    return other.typeId === this.typeId;
  }
  /**
   * Creates a buffer layout from this type
   * @param offset - Byte offset of the layout
   * @param layout - Type of the layout
   * @returns The created buffer layout
   */
  abstract toBufferLayout(offset: number, layout: PBStructLayout): UniformBufferLayout;
  /** @internal */
  abstract toTypeName(deviceType: string, varName?: string): string;
  /** @internal */
  protected abstract genTypeId(): string;
}

/**
 * The void type info
 * @public
 */
export class PBVoidTypeInfo extends PBTypeInfo<null> {
  constructor() {
    super(PBTypeClass.VOID, null);
  }
  /** {@inheritDoc PBTypeInfo.isVoidType} */
  isVoidType(): this is PBVoidTypeInfo {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    return 'void';
  }
  /** @internal */
  protected genTypeId(): string {
    return 'void';
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
}

/**
 * The void type info
 * @public
 */
export class PBAnyTypeInfo extends PBTypeInfo<null> {
  constructor() {
    super(PBTypeClass.ANY, null);
  }
  /** {@inheritDoc PBTypeInfo.isAnyType} */
  isAnyType(): this is PBAnyTypeInfo {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    return 'any';
  }
  /** @internal */
  protected genTypeId(): string {
    return 'any';
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** {@inheritDoc PBTypeInfo.isCompatibleType} */
  isCompatibleType(other: PBTypeInfo<TypeDetailInfo>): boolean {
    return true;
  }
}

/**
 * The primitive type info
 * @public
 */
export class PBPrimitiveTypeInfo extends PBTypeInfo<PrimitiveTypeDetail> {
  /** @internal */
  private static cachedTypes: Record<number, PBPrimitiveTypeInfo> = {};
  /** @internal */
  private static cachedCtorOverloads: {
    [deviceType: string]: Record<number, PBFunctionTypeInfo[]>;
  } = {};
  constructor(type: PBPrimitiveType) {
    super(PBTypeClass.PLAIN, { primitiveType: type });
  }
  /** Get or create a PBPrimitiveTypeInfo instance for a given prmitive type */
  static getCachedTypeInfo(primitiveType: PBPrimitiveType): PBPrimitiveTypeInfo {
    let typeinfo = this.cachedTypes[primitiveType];
    if (!typeinfo) {
      typeinfo = new PBPrimitiveTypeInfo(primitiveType);
      this.cachedTypes[primitiveType] = typeinfo;
    }
    return typeinfo;
  }
  /** @internal */
  static getCachedOverloads(deviceType: string, primitiveType: PBPrimitiveType): PBFunctionTypeInfo[] {
    let deviceOverloads = this.cachedCtorOverloads[deviceType];
    if (!deviceOverloads) {
      deviceOverloads = {};
      this.cachedCtorOverloads[deviceType] = deviceOverloads;
    }
    let result = deviceOverloads[primitiveType];
    if (!result) {
      const typeinfo = this.getCachedTypeInfo(primitiveType);
      const name = typeinfo.toTypeName(deviceType);
      result = [new PBFunctionTypeInfo(name, typeinfo, [])];
      if (typeinfo.isScalarType()) {
        result.push(
          new PBFunctionTypeInfo(name, typeinfo, [{ type: this.getCachedTypeInfo(PBPrimitiveType.F32) }])
        );
        result.push(
          new PBFunctionTypeInfo(name, typeinfo, [{ type: this.getCachedTypeInfo(PBPrimitiveType.I32) }])
        );
        result.push(
          new PBFunctionTypeInfo(name, typeinfo, [{ type: this.getCachedTypeInfo(PBPrimitiveType.U32) }])
        );
        result.push(
          new PBFunctionTypeInfo(name, typeinfo, [{ type: this.getCachedTypeInfo(PBPrimitiveType.BOOL) }])
        );
      } else if (typeinfo.isVectorType()) {
        const scalarTypeInfo = { type: this.getCachedTypeInfo(typeinfo.scalarType) };
        const vec2TypeInfo = { type: this.getCachedTypeInfo(typeinfo.resizeType(1, 2)) };
        const vec3TypeInfo = { type: this.getCachedTypeInfo(typeinfo.resizeType(1, 3)) };
        result.push(new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo]));
        switch (typeinfo.cols) {
          case 2:
            result.push(new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, scalarTypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeF32Vec2 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeI32Vec2 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeU32Vec2 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeBVec2 }]));
            break;
          case 3:
            result.push(
              new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, scalarTypeInfo, scalarTypeInfo])
            );
            result.push(new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, vec2TypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [vec2TypeInfo, scalarTypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeF32Vec3 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeI32Vec3 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeU32Vec3 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeBVec3 }]));
            break;
          case 4:
            result.push(
              new PBFunctionTypeInfo(name, typeinfo, [
                scalarTypeInfo,
                scalarTypeInfo,
                scalarTypeInfo,
                scalarTypeInfo
              ])
            );
            result.push(
              new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, scalarTypeInfo, vec2TypeInfo])
            );
            result.push(
              new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, vec2TypeInfo, scalarTypeInfo])
            );
            result.push(
              new PBFunctionTypeInfo(name, typeinfo, [vec2TypeInfo, scalarTypeInfo, scalarTypeInfo])
            );
            result.push(new PBFunctionTypeInfo(name, typeinfo, [vec2TypeInfo, vec2TypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [scalarTypeInfo, vec3TypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [vec3TypeInfo, scalarTypeInfo]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeF32Vec4 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeI32Vec4 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeU32Vec4 }]));
            result.push(new PBFunctionTypeInfo(name, typeinfo, [{ type: typeBVec4 }]));
        }
      } else if (typeinfo.isMatrixType()) {
        const colType = this.getCachedTypeInfo(typeinfo.resizeType(1, typeinfo.cols));
        result.push(
          new PBFunctionTypeInfo(
            name,
            typeinfo,
            Array.from({ length: typeinfo.rows }).map(() => ({ type: colType }))
          )
        );
        result.push(
          new PBFunctionTypeInfo(
            name,
            typeinfo,
            Array.from({ length: typeinfo.rows * typeinfo.cols }).map(() => ({ type: typeF32 }))
          )
        );
      }
      deviceOverloads[primitiveType] = result;
    }
    return result;
  }
  /** Get the primitive type */
  get primitiveType(): PBPrimitiveType {
    return this.detail.primitiveType;
  }
  /** Whether the type is signed or unsigned integer scalar or vector */
  isInteger(): boolean {
    const st = this.primitiveType & SCALAR_TYPE_BITMASK;
    return (
      st === I8_BITMASK ||
      st === U8_BITMASK ||
      st === I16_BITMASK ||
      st === U16_BITMASK ||
      st === I32_BITMASK ||
      st === U32_BITMASK
    );
  }
  /** Get the scalar type */
  get scalarType(): PBPrimitiveType {
    return this.resizeType(1, 1);
  }
  /** Get number of rows */
  get rows(): number {
    return (this.primitiveType >> ROWS_BITSHIFT) & ROWS_BITMASK;
  }
  /** Get number of columns */
  get cols(): number {
    return (this.primitiveType >> COLS_BITSHIFT) & COLS_BITMASK;
  }
  /** Get if this is a normalized primitive type */
  get normalized(): boolean {
    return !!((this.primitiveType >> NORM_BITSHIFT) & NORM_BITMASK);
  }
  /** @internal */
  getLayoutAlignment(layout: PBStructLayout): number {
    return layout === 'packed' ? 1 : this.isScalarType() ? 4 : 1 << Math.min(4, this.cols + 1);
  }
  /** @internal */
  getLayoutSize(): number {
    return this.getSize();
  }
  /** @internal */
  getSize(): number {
    let scalarSize: number;
    switch (this.scalarType) {
      case PBPrimitiveType.BOOL:
      case PBPrimitiveType.I32:
      case PBPrimitiveType.I32_NORM:
      case PBPrimitiveType.U32:
      case PBPrimitiveType.U32_NORM:
      case PBPrimitiveType.F32:
        scalarSize = 4;
        break;
      case PBPrimitiveType.F16:
      case PBPrimitiveType.I16:
      case PBPrimitiveType.I16_NORM:
      case PBPrimitiveType.U16:
      case PBPrimitiveType.U16_NORM:
        scalarSize = 2;
        break;
      default:
        scalarSize = 1;
        break;
    }
    return scalarSize * this.cols * this.rows;
  }
  /**
   * Creates a new primitive type info by changing row and column of this type
   * @param rows - The new value of row
   * @param cols - The new value of column
   * @returns The new primitive type
   */
  resizeType(rows: number, cols: number): PBPrimitiveType {
    return makePrimitiveType(this.primitiveType & SCALAR_TYPE_BITMASK, rows, cols, this.normalized ? 1 : 0);
  }
  /** Returns true if this is a scalar type */
  isScalarType(): boolean {
    return this.rows === 1 && this.cols === 1;
  }
  /** Returns true if this is a vector type */
  isVectorType(): boolean {
    return this.rows === 1 && this.cols > 1;
  }
  /** Returns true if this is a matrix type */
  isMatrixType(): boolean {
    return this.rows > 1 && this.cols > 1;
  }
  /** {@inheritDoc PBTypeInfo.isPrimitiveType} */
  isPrimitiveType(): this is PBPrimitiveTypeInfo {
    return true;
  }
  /** @internal */
  isHostSharable(): boolean {
    return this.scalarType !== PBPrimitiveType.BOOL;
  }
  /** @internal */
  isConstructible(): boolean {
    return true;
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  getConstructorOverloads(deviceType: string): PBFunctionTypeInfo[] {
    return PBPrimitiveTypeInfo.getCachedOverloads(deviceType, this.primitiveType);
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      const typename = primitiveTypeMapWGSL[this.primitiveType];
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      const typename = primitiveTypeMapWebGL[this.primitiveType];
      return varName ? `${typename} ${varName}` : typename;
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  protected genTypeId(): string {
    return `PRIM:${this.primitiveType}`;
  }
}

/**
 * The struct type info
 * @public
 */
export class PBStructTypeInfo extends PBTypeInfo<StructTypeDetail> {
  constructor(
    name: string,
    layout: PBStructLayout,
    members: {
      name: string;
      type:
        | PBPrimitiveTypeInfo
        | PBArrayTypeInfo
        | PBAtomicI32TypeInfo
        | PBAtomicU32TypeInfo
        | PBStructTypeInfo;
    }[]
  ) {
    super(PBTypeClass.PLAIN, {
      layout: layout || 'default',
      structName: name,
      structMembers: members.map((val) => {
        const defaultAlignment = getAlignment(val.type);
        const defaultSize = getSize(val.type);
        return {
          name: val.name,
          type: val.type,
          alignment: defaultAlignment,
          size: defaultSize,
          defaultAlignment: defaultAlignment,
          defaultSize: defaultSize
        };
      })
    });
    if (this.layout === 'std140') {
      this.calcAlignmentAndSizeSTD140();
    } else if (this.layout === 'std430') {
      this.calcAlignmentAndSizePacked();
    }
  }
  /** Get the layout type */
  get layout(): PBStructLayout {
    return this.detail.layout;
  }
  /** Get name of the struct type */
  get structName(): string {
    return this.detail.structName;
  }
  set structName(val: string) {
    this.detail.structName = val;
  }
  /** Get member types of the struct type */
  get structMembers() {
    return this.detail.structMembers;
  }
  /** Whether this struct has atomic members */
  haveAtomicMembers(): boolean {
    for (const member of this.structMembers) {
      if (member.type.isStructType() && member.type.haveAtomicMembers()) {
        return true;
      } else if (member.type.isArrayType() && member.type.haveAtomicMembers()) {
        return true;
      } else {
        return member.type.isAtomicI32() || member.type.isAtomicU32();
      }
    }
  }
  /**
   * Creates a new struct type by extending this type
   * @param name - Name of the new struct type
   * @param members - additional struct members
   * @returns The new struct type
   */
  extends(
    name: string,
    members: { name: string; type: PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo }[]
  ): PBStructTypeInfo {
    const oldMembers = this.structMembers.map((member) => ({ name: member.name, type: member.type }));
    return new PBStructTypeInfo(name, this.layout, [...oldMembers, ...members]);
  }
  /** {@inheritDoc PBTypeInfo.isStructType} */
  isStructType(): this is PBStructTypeInfo {
    return true;
  }
  /** @internal */
  isHostSharable(): boolean {
    return this.detail.structMembers.every((val) => val.type.isHostSharable());
  }
  /** @internal */
  isConstructible(): boolean {
    return this.detail.structMembers.every((val) => val.type.isConstructible());
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  getConstructorOverloads(): PBFunctionTypeInfo[] {
    const result: PBFunctionTypeInfo[] = [new PBFunctionTypeInfo(this.structName, this, [])];
    if (this.isConstructible()) {
      result.push(
        new PBFunctionTypeInfo(
          this.structName,
          this,
          this.structMembers.map((val) => ({ type: val.type }))
        )
      );
    }
    return result;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      return varName ? `${varName}: ${this.structName}` : this.structName;
    } else {
      return varName ? `${this.structName} ${varName}` : this.structName;
    }
  }
  /** @internal */
  getLayoutAlignment(layout: PBStructLayout): number {
    if (layout === 'packed') {
      return 1;
    }
    let alignment = 0;
    for (const member of this.structMembers) {
      alignment = Math.max(alignment, member.type.getLayoutAlignment(layout));
    }
    if (layout === 'std140') {
      alignment = align(alignment, 16);
    }
    return alignment;
  }
  /** @internal */
  getLayoutSize(layout: PBStructLayout): number {
    let size = 0;
    let structAlignment = 0;
    for (const member of this.structMembers) {
      const memberAlignment = member.type.getLayoutAlignment(layout);
      size = align(size, memberAlignment);
      size += member.type.getLayoutSize(layout);
      structAlignment = Math.max(structAlignment, memberAlignment);
    }
    return align(size, structAlignment);
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number, layout: PBStructLayout): UniformBufferLayout {
    const bufferLayout: UniformBufferLayout = {
      byteSize: 0,
      entries: []
    };
    const start = offset;
    for (const member of this.structMembers) {
      offset = align(offset, member.type.getLayoutAlignment(layout));
      const size = member.type.getLayoutSize(layout);
      bufferLayout.entries.push({
        name: member.name,
        offset: offset,
        byteSize: size,
        type: typeToTypedArray(member.type),
        subLayout: member.type.isStructType() ? member.type.toBufferLayout(offset, layout) : null,
        arraySize: member.type.isArrayType() ? member.type.dimension : 0
      });
      offset += size;
    }
    bufferLayout.byteSize = layout === 'std140' ? align(offset - start, 16) : offset - start;
    return bufferLayout;
  }
  /** @internal */
  clone(newName?: string): PBStructTypeInfo {
    return new PBStructTypeInfo(newName || this.structName, this.layout, this.structMembers);
  }
  /** @internal */
  reset(
    name: string,
    layout: PBStructLayout,
    members: { name: string; type: PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo }[]
  ) {
    this.detail = {
      layout: layout || 'default',
      structName: name,
      structMembers: members.map((val) => {
        const defaultAlignment = getAlignment(val.type);
        const defaultSize = getSize(val.type);
        return {
          name: val.name,
          type: val.type,
          alignment: defaultAlignment,
          size: defaultSize,
          defaultAlignment: defaultAlignment,
          defaultSize: defaultSize
        };
      })
    };
    if (this.layout === 'std140') {
      this.calcAlignmentAndSizeSTD140();
    } else if (this.layout === 'std430') {
      this.calcAlignmentAndSizePacked();
    }
    this.id = null;
  }
  /** @internal */
  protected genTypeId(): string {
    return `STRUCT:${this.structName}:${this.layout}:${this.structMembers
      .map((val) => `${val.name}(${val.type.typeId})`)
      .join(':')}`;
  }
  /** @internal */
  private calcAlignmentAndSizeSTD140() {
    for (const member of this.structMembers) {
      if (member.type.isPrimitiveType()) {
        if (member.type.isMatrixType() && member.type.cols === 2) {
          throw new Error(`matrix${member.type.rows}x${member.type.cols} can not be used in std140 layout`);
        }
      } else if (
        member.type.isArrayType() &&
        (member.type.elementType.isAnyType() || getAlignment(member.type.elementType) !== 16)
      ) {
        throw new Error('array element must be 16 bytes aligned in std140 layout');
      } else if (member.type.isStructType()) {
        member.alignment = 16;
        member.size = align(member.defaultSize, 16);
      }
    }
  }
  /** @internal */
  private calcAlignmentAndSizePacked() {
    for (const member of this.structMembers) {
      member.alignment = getAlignmentPacked(member.type);
      member.size = getSizePacked(member.type);
    }
  }
}

/**
 * The array type info
 * @public
 */
export class PBArrayTypeInfo extends PBTypeInfo<ArrayTypeDetail> {
  constructor(
    elementType: PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo | PBAnyTypeInfo | PBAtomicI32TypeInfo | PBAtomicU32TypeInfo,
    dimension?: number
  ) {
    super(PBTypeClass.ARRAY, {
      elementType: elementType,
      dimension: Number(dimension) || 0
    });
  }
  /** Get the element type */
  get elementType(): PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo | PBAnyTypeInfo | PBAtomicI32TypeInfo | PBAtomicU32TypeInfo {
    return this.detail.elementType;
  }
  /** Get dimension of the array type */
  get dimension(): number {
    return this.detail.dimension;
  }
  /** Wether array have atomic members */
  haveAtomicMembers(): boolean {
    if (this.elementType.isStructType() || this.elementType.isArrayType()) {
      return this.elementType.haveAtomicMembers();
    } else {
      return this.elementType.isAtomicI32() || this.elementType.isAtomicU32();
    }
  }
  /** {@inheritDoc PBTypeInfo.isArrayType} */
  isArrayType(): this is PBArrayTypeInfo {
    return true;
  }
  /** @internal */
  isHostSharable(): boolean {
    return this.detail.elementType.isHostSharable();
  }
  /** @internal */
  isConstructible(): boolean {
    return this.dimension && this.detail.elementType.isConstructible();
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  getConstructorOverloads(deviceType: string): PBFunctionTypeInfo[] {
    const name = this.toTypeName(deviceType);
    const result: PBFunctionTypeInfo[] = [new PBFunctionTypeInfo(name, this, [])];
    if (deviceType !== 'webgl' && this.isConstructible()) {
      result.push(
        new PBFunctionTypeInfo(
          name,
          this,
          Array.from({ length: this.dimension }).map(() => ({ type: this.elementType }))
        )
      );
    }
    return result;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      const elementTypeName = this.elementType.toTypeName(deviceType);
      const typename = `array<${elementTypeName}${this.dimension ? ', ' + this.dimension : ''}>`;
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      console.assert(!!this.dimension, 'runtime-sized array not supported for webgl');
      console.assert(!this.elementType.isArrayType(), 'multi-dimensional arrays not supported for webgl');
      const elementTypeName = this.elementType.toTypeName(deviceType, varName);
      return `${elementTypeName}[${this.dimension}]`;
    }
  }
  /** @internal */
  getLayoutAlignment(layout: PBStructLayout): number {
    return layout === 'packed' || this.elementType.isAnyType()
      ? 1
      : layout === 'std430'
      ? this.elementType.getLayoutAlignment(layout)
      : align(this.elementType.getLayoutAlignment(layout), 16);
  }
  /** @internal */
  getLayoutSize(layout: PBStructLayout): number {
    const elementAlignment = this.elementType.isAnyType() ? 1 : this.elementType.getLayoutAlignment(layout);
    if (layout === 'std140' && !!(elementAlignment & 15)) {
      // array element stride of std140 layout must be multiple of 16
      throw new Error('Error: array element stride of std140 must be multiple of 16');
    }
    return this.elementType.isAnyType()
      ? 0
      : this.dimension * align(this.elementType.getLayoutSize(layout), elementAlignment);
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  isCompatibleType(other: PBTypeInfo<TypeDetailInfo>): boolean {
    if (!other.isArrayType()) {
      return false;
    }
    if (this.dimension !== 0 && other.dimension !== this.dimension) {
      return false;
    }
    return this.elementType.isCompatibleType(other.elementType);
  }
  /** @internal */
  protected genTypeId(): string {
    return `ARRAY:(${this.elementType.typeId})[${this.dimension}]`;
  }
}

/**
 * The pointer type info
 * @public
 */
export class PBPointerTypeInfo extends PBTypeInfo<PointerTypeDetail> {
  /** @internal */
  writable: boolean;
  constructor(pointerType: PBTypeInfo, addressSpace: PBAddressSpace) {
    super(PBTypeClass.POINTER, {
      pointerType,
      addressSpace
    });
    console.assert(pointerType.isStorable(), 'the pointee type must be storable');
    this.writable = false;
  }
  /** Get type of the pointer */
  get pointerType(): PBTypeInfo {
    return this.detail.pointerType;
  }
  /** Get address space of the pointer */
  get addressSpace(): PBAddressSpace {
    return this.detail.addressSpace;
  }
  set addressSpace(val: PBAddressSpace) {
    if (this.detail.addressSpace !== val) {
      this.detail.addressSpace = val;
      this.id = null;
    }
  }
  /** {@inheritDoc PBTypeInfo.haveAtomicMembers} */
  haveAtomicMembers(): boolean {
    return this.pointerType.haveAtomicMembers();
  }
  /** {@inheritDoc PBTypeInfo.isPointerType} */
  isPointerType(): this is PBPointerTypeInfo {
    return true;
  }
  /** @internal */
  toTypeName(device: string, varName?: string): string {
    if (device === 'webgpu') {
      const addressSpace =
        this.addressSpace === PBAddressSpace.UNKNOWN ? PBAddressSpace.FUNCTION : this.addressSpace;
      /*
      const mode = addressSpace === PBAddressSpace.UNIFORM || (addressSpace === PBAddressSpace.STORAGE && !this.writable) ? 'read' : 'read_write'
      const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)}, ${mode}>`;
      */
      /* WGSL spec:
        When writing a variable declaration or a pointer type in WGSL source:
        For the storage address space, the access mode is optional, and defaults to read.
        For other address spaces, the access mode must not be written.
      */
      const mode = addressSpace === PBAddressSpace.STORAGE && this.writable ? ', read_write' : '';
      const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)} ${mode}>`;
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      throw new Error('pointer type not supported for webgl');
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  protected genTypeId(): string {
    return `PTR:(${this.pointerType.typeId})`;
  }
}

/**
 * The atomic int type info
 * @public
 */
export class PBAtomicI32TypeInfo extends PBTypeInfo<null> {
  constructor() {
    super(PBTypeClass.ATOMIC_I32, null);
  }
  /** {@inheritDoc PBTypeInfo.isPointerType} */
  haveAtomicMembers(): boolean {
    return true;
  }
  /** @internal */
  isAtomicI32(): this is PBAtomicI32TypeInfo {
    return true;
  }
  /** @internal */
  isHostSharable(): boolean {
    return true;
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      const typename = 'atomic<i32>';
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      throw new Error('atomic type not supported for webgl');
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  getLayoutAlignment(layout: PBStructLayout): number {
    return 4;
  }
  /** @internal */
  getLayoutSize(): number {
    return this.getSize();
  }
  /** @internal */
  getSize(): number {
    return 4;
  }
  /** @internal */
  protected genTypeId(): string {
    return `ATOMICI32`;
  }
}

/**
 * The atomic int type info
 * @public
 */
export class PBAtomicU32TypeInfo extends PBTypeInfo<null> {
  constructor() {
    super(PBTypeClass.ATOMIC_U32, null);
  }
  /** {@inheritDoc PBTypeInfo.isPointerType} */
  haveAtomicMembers(): boolean {
    return true;
  }
  /** @internal */
  isAtomicU32(): this is PBAtomicU32TypeInfo {
    return true;
  }
  /** @internal */
  isHostSharable(): boolean {
    return true;
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      const typename = 'atomic<u32>';
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      throw new Error('atomic type not supported for webgl');
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  getLayoutAlignment(layout: PBStructLayout): number {
    return 4;
  }
  /** @internal */
  getLayoutSize(): number {
    return this.getSize();
  }
  /** @internal */
  getSize(): number {
    return 4;
  }
  /** @internal */
  protected genTypeId(): string {
    return `ATOMICU32`;
  }
}

/**
 * The sampler type info
 * @public
 */
export class PBSamplerTypeInfo extends PBTypeInfo<SamplerTypeDetail> {
  constructor(accessMode: PBSamplerAccessMode) {
    super(PBTypeClass.SAMPLER, {
      accessMode: accessMode
    });
  }
  /** Get the access mode */
  get accessMode(): PBSamplerAccessMode {
    return this.detail.accessMode;
  }
  /** @internal */
  isSamplerType(): this is PBSamplerTypeInfo {
    return true;
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      const typename = this.accessMode === PBSamplerAccessMode.SAMPLE ? 'sampler' : 'sampler_comparison';
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      throw new Error('sampler type not supported for webgl');
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  protected genTypeId(): string {
    return `SAMPLER:${this.accessMode}`;
  }
}

/**
 * The texture type info
 * @public
 */
export class PBTextureTypeInfo extends PBTypeInfo<TextureTypeDetail> {
  constructor(
    textureType: PBTextureType,
    texelFormat?: TextureFormat,
    readable?: boolean,
    writable?: boolean
  ) {
    super(PBTypeClass.TEXTURE, {
      textureType: textureType,
      readable,
      writable,
      storageTexelFormat: texelFormat || null
    });
    console.assert(!!textureTypeMapWGSL[textureType], 'unsupported texture type');
    console.assert(
      !(textureType & BITFLAG_STORAGE) || !!storageTexelFormatMap[texelFormat],
      'invalid texel format for storage texture'
    );
  }
  /** Get the texture type */
  get textureType(): PBTextureType {
    return this.detail.textureType;
  }
  /** Get texture format if this is a storage texture */
  get storageTexelFormat(): TextureFormat {
    return this.detail.storageTexelFormat;
  }
  /** Returns true if this is a readable storage texture type */
  get readable(): boolean {
    return this.detail.readable;
  }
  set readable(val: boolean) {
    this.detail.readable = !!val;
  }
  /** Returns true if this is a writable storage texture type */
  get writable(): boolean {
    return this.detail.writable;
  }
  set writable(val: boolean) {
    this.detail.writable = !!val;
  }
  /** @internal */
  isStorable(): boolean {
    return true;
  }
  /** @internal */
  is1DTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_1D);
  }
  /** Returns true if this is a 2D texture type */
  is2DTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_2D);
  }
  /** Returns true if this is a 3D texture type */
  is3DTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_3D);
  }
  /** Returns true if this is a cube texture type */
  isCubeTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_CUBE);
  }
  /** Returns true if this is an array texture type */
  isArrayTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_ARRAY);
  }
  /** Returns true if this is a storage texture type */
  isStorageTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_STORAGE);
  }
  /** Return s true if this is a depth texture type */
  isDepthTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_DEPTH);
  }
  /** Returns true if this is a multisampled texture type */
  isMultisampledTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_MULTISAMPLED);
  }
  /** Returns true if this is an external texture type */
  isExternalTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_EXTERNAL);
  }
  /** Returns true if the texture format is of type integer  */
  isIntTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_INT);
  }
  /** Returns true if the texture format is of type unsigned integer  */
  isUIntTexture(): boolean {
    return !!(this.detail.textureType & BITFLAG_UINT);
  }
  /** @internal */
  isTextureType(): this is PBTextureTypeInfo {
    return true;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    if (deviceType === 'webgpu') {
      let typename = textureTypeMapWGSL[this.textureType];
      if (this.isStorageTexture()) {
        const storageTexelFormat = storageTexelFormatMap[this.storageTexelFormat];
        // storage textures currently only support 'write' access control
        const accessMode = this.writable ? this.readable ? 'read_write' : 'write' : 'read';// this.readable ? (this.writable ? 'read_write' : 'read') : 'write';
        typename = `${typename}<${storageTexelFormat}, ${accessMode}>`;
      }
      return varName ? `${varName}: ${typename}` : typename;
    } else {
      const typename = (deviceType === 'webgl' ? textureTypeMapWebGL : textureTypeMapWebGL2)[
        this.textureType
      ];
      console.assert(!!typename, 'unsupported texture type');
      return varName ? `${typename} ${varName}` : typename;
    }
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  protected genTypeId(): string {
    return `TEXTURE:${this.textureType}`;
  }
}

/**
 * The function type info
 * @public
 */
export class PBFunctionTypeInfo extends PBTypeInfo<FunctionTypeDetail> {
  constructor(name: string, returnType: PBTypeInfo, argTypes: { type: PBTypeInfo; byRef?: boolean }[]) {
    super(PBTypeClass.FUNCTION, {
      name,
      returnType,
      argTypes
    });
  }
  /** Get name of the function */
  get name(): string {
    return this.detail.name;
  }
  /** Get return type of the function */
  get returnType(): PBTypeInfo {
    return this.detail.returnType;
  }
  /** Get all the argument types for this function */
  get argTypes(): { type: PBTypeInfo; byRef?: boolean }[] {
    return this.detail.argTypes;
  }
  /** Get hash for parameter types */
  get argHash(): string {
    return this.argTypes.map((val) => val.type.typeId).join(',');
  }
  /** @internal */
  protected genTypeId(): string {
    return `fn(${this.argHash}):${this.returnType.typeId}`;
  }
  /** {@inheritDoc PBTypeInfo.toBufferLayout} */
  toBufferLayout(offset: number): UniformBufferLayout {
    return null;
  }
  /** @internal */
  toTypeName(deviceType: string, varName?: string): string {
    throw new Error('not supported');
  }
}

/** @internal */
export const typeF16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16);
/** @internal */
export const typeF16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC2);
/** @internal */
export const typeF16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC3);
/** @internal */
export const typeF16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC4);
/** @internal */
export const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
/** @internal */
export const typeF32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC2);
/** @internal */
export const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
/** @internal */
export const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
/** @internal */
export const typeI8 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8);
/** @internal */
export const typeI8Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2);
/** @internal */
export const typeI8Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3);
/** @internal */
export const typeI8Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4);
/** @internal */
export const typeI8_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8_NORM);
/** @internal */
export const typeI8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2_NORM);
/** @internal */
export const typeI8Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3_NORM);
/** @internal */
export const typeI8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4_NORM);
/** @internal */
export const typeI16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16);
/** @internal */
export const typeI16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2);
/** @internal */
export const typeI16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3);
/** @internal */
export const typeI16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4);
/** @internal */
export const typeI16_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16_NORM);
/** @internal */
export const typeI16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2_NORM);
/** @internal */
export const typeI16Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3_NORM);
/** @internal */
export const typeI16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4_NORM);
/** @internal */
export const typeAtomicI32 = new PBAtomicI32TypeInfo();
/** @internal */
export const typeAtomicU32 = new PBAtomicU32TypeInfo();
/** @internal */
export const typeI32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */
export const typeI32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2);
/** @internal */
export const typeI32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3);
/** @internal */
export const typeI32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4);
/** @internal */
export const typeI32_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */
export const typeI32Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2_NORM);
/** @internal */
export const typeI32Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3_NORM);
/** @internal */
export const typeI32Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4_NORM);
/** @internal */
export const typeU8 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8);
/** @internal */
export const typeU8Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2);
/** @internal */
export const typeU8Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3);
/** @internal */
export const typeU8Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4);
/** @internal */
export const typeU8_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8_NORM);
/** @internal */
export const typeU8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2_NORM);
/** @internal */
export const typeU8Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3_NORM);
/** @internal */
export const typeU8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4_NORM);
/** @internal */
export const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
/** @internal */
export const typeU16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2);
/** @internal */
export const typeU16Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3);
/** @internal */
export const typeU16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4);
/** @internal */
export const typeU16_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16_NORM);
/** @internal */
export const typeU16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2_NORM);
/** @internal */
export const typeU16Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3_NORM);
/** @internal */
export const typeU16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4_NORM);
/** @internal */
export const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
/** @internal */
export const typeU32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2);
/** @internal */
export const typeU32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3);
/** @internal */
export const typeU32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4);
/** @internal */
export const typeU32_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32_NORM);
/** @internal */
export const typeU32Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2_NORM);
/** @internal */
export const typeU32Vec3_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3_NORM);
/** @internal */
export const typeU32Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4_NORM);
/** @internal */
export const typeBool = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BOOL);
/** @internal */
export const typeBVec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC2);
/** @internal */
export const typeBVec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC3);
/** @internal */
export const typeBVec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC4);
/** @internal */
export const typeMat2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2);
/** @internal */
export const typeMat2x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x3);
/** @internal */
export const typeMat2x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x4);
/** @internal */
export const typeMat3x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x2);
/** @internal */
export const typeMat3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3);
/** @internal */
export const typeMat3x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x4);
/** @internal */
export const typeMat4x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x2);
/** @internal */
export const typeMat4x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x3);
/** @internal */
export const typeMat4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4);
/** @internal */
export const typeTex1D = new PBTextureTypeInfo(PBTextureType.TEX_1D);
/** @internal */
export const typeITex1D = new PBTextureTypeInfo(PBTextureType.ITEX_1D);
/** @internal */
export const typeUTex1D = new PBTextureTypeInfo(PBTextureType.UTEX_1D);
/** @internal */
export const typeTex2D = new PBTextureTypeInfo(PBTextureType.TEX_2D);
/** @internal */
export const typeITex2D = new PBTextureTypeInfo(PBTextureType.ITEX_2D);
/** @internal */
export const typeUTex2D = new PBTextureTypeInfo(PBTextureType.UTEX_2D);
/** @internal */
export const typeTex2DArray = new PBTextureTypeInfo(PBTextureType.TEX_2D_ARRAY);
/** @internal */
export const typeITex2DArray = new PBTextureTypeInfo(PBTextureType.ITEX_2D_ARRAY);
/** @internal */
export const typeUTex2DArray = new PBTextureTypeInfo(PBTextureType.UTEX_2D_ARRAY);
/** @internal */
export const typeTex3D = new PBTextureTypeInfo(PBTextureType.TEX_3D);
/** @internal */
export const typeITex3D = new PBTextureTypeInfo(PBTextureType.ITEX_3D);
/** @internal */
export const typeUTex3D = new PBTextureTypeInfo(PBTextureType.UTEX_3D);
/** @internal */
export const typeTexCube = new PBTextureTypeInfo(PBTextureType.TEX_CUBE);
/** @internal */
export const typeITexCube = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE);
/** @internal */
export const typeUTexCube = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE);
/** @internal */
export const typeTexExternal = new PBTextureTypeInfo(PBTextureType.TEX_EXTERNAL);
/** @internal */
export const typeTexCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_CUBE_ARRAY);
/** @internal */
export const typeITexCubeArray = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE_ARRAY);
/** @internal */
export const typeUTexCubeArray = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE_ARRAY);
/** @internal */
export const typeTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_MULTISAMPLED_2D);
/** @internal */
export const typeITexMultisampled2D = new PBTextureTypeInfo(PBTextureType.ITEX_MULTISAMPLED_2D);
/** @internal */
export const typeUTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.UTEX_MULTISAMPLED_2D);
/** @internal */
export const typeTexStorage1D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */
export const typeTexStorage1D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8snorm');
/** @internal */
export const typeTexStorage1D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */
export const typeTexStorage1D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8ui');
/** @internal */
export const typeTexStorage1D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8i');
/** @internal */
export const typeTexStorage1D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16ui');
/** @internal */
export const typeTexStorage1D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16i');
/** @internal */
export const typeTexStorage1D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16f');
/** @internal */
export const typeTexStorage1D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32ui');
/** @internal */
export const typeTexStorage1D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32i');
/** @internal */
export const typeTexStorage1D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32f');
/** @internal */
export const typeTexStorage1D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32ui');
/** @internal */
export const typeTexStorage1D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32i');
/** @internal */
export const typeTexStorage1D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32f');
/** @internal */
export const typeTexStorage1D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32ui');
/** @internal */
export const typeTexStorage1D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32i');
/** @internal */
export const typeTexStorage1D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32f');
/** @internal */
export const typeTexStorage2D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8unorm');
/** @internal */
export const typeTexStorage2D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8snorm');
/** @internal */
export const typeTexStorage2D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'bgra8unorm');
/** @internal */
export const typeTexStorage2D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8ui');
/** @internal */
export const typeTexStorage2D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8i');
/** @internal */
export const typeTexStorage2D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16ui');
/** @internal */
export const typeTexStorage2D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16i');
/** @internal */
export const typeTexStorage2D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16f');
/** @internal */
export const typeTexStorage2D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32ui');
/** @internal */
export const typeTexStorage2D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32i');
/** @internal */
export const typeTexStorage2D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32f');
/** @internal */
export const typeTexStorage2D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32ui');
/** @internal */
export const typeTexStorage2D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32i');
/** @internal */
export const typeTexStorage2D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32f');
/** @internal */
export const typeTexStorage2D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32ui');
/** @internal */
export const typeTexStorage2D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32i');
/** @internal */
export const typeTexStorage2D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32f');
/** @internal */
export const typeTexStorage2DArray_rgba8unorm = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba8unorm'
);
/** @internal */
export const typeTexStorage2DArray_rgba8snorm = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba8snorm'
);
/** @internal */
export const typeTexStorage2DArray_bgra8unorm = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'bgra8unorm'
);
/** @internal */
export const typeTexStorage2DArray_rgba8uint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba8ui'
);
/** @internal */
export const typeTexStorage2DArray_rgba8sint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba8i'
);
/** @internal */
export const typeTexStorage2DArray_rgba16uint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba16ui'
);
/** @internal */
export const typeTexStorage2DArray_rgba16sint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba16i'
);
/** @internal */
export const typeTexStorage2DArray_rgba16float = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba16f'
);
/** @internal */
export const typeTexStorage2DArray_rgba32uint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba32ui'
);
/** @internal */
export const typeTexStorage2DArray_rgba32sint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba32i'
);
/** @internal */
export const typeTexStorage2DArray_rgba32float = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rgba32f'
);
/** @internal */
export const typeTexStorage2DArray_rg32uint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rg32ui'
);
/** @internal */
export const typeTexStorage2DArray_rg32sint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rg32i'
);
/** @internal */
export const typeTexStorage2DArray_rg32float = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'rg32f'
);
/** @internal */
export const typeTexStorage2DArray_r32uint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'r32ui'
);
/** @internal */
export const typeTexStorage2DArray_r32sint = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'r32i'
);
/** @internal */
export const typeTexStorage2DArray_r32float = new PBTextureTypeInfo(
  PBTextureType.TEX_STORAGE_2D_ARRAY,
  'r32f'
);
/** @internal */
export const typeTexStorage3D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8unorm');
/** @internal */
export const typeTexStorage3D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8snorm');
/** @internal */
export const typeTexStorage3D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'bgra8unorm');
/** @internal */
export const typeTexStorage3D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8ui');
/** @internal */
export const typeTexStorage3D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8i');
/** @internal */
export const typeTexStorage3D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16ui');
/** @internal */
export const typeTexStorage3D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16i');
/** @internal */
export const typeTexStorage3D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16f');
/** @internal */
export const typeTexStorage3D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32ui');
/** @internal */
export const typeTexStorage3D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32i');
/** @internal */
export const typeTexStorage3D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32f');
/** @internal */
export const typeTexStorage3D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32ui');
/** @internal */
export const typeTexStorage3D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32i');
/** @internal */
export const typeTexStorage3D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32f');
/** @internal */
export const typeTexStorage3D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32ui');
/** @internal */
export const typeTexStorage3D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32i');
/** @internal */
export const typeTexStorage3D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32f');
/** @internal */
export const typeTexDepth2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D);
/** @internal */
export const typeTexDepth2DArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D_ARRAY);
/** @internal */
export const typeTexDepthCube = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE);
/** @internal */
export const typeTexDepthCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE_ARRAY);
/** @internal */
export const typeTexDepthMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_MULTISAMPLED_2D);
/** @internal */
export const typeSampler = new PBSamplerTypeInfo(PBSamplerAccessMode.SAMPLE);
/** @internal */
export const typeSamplerComparison = new PBSamplerTypeInfo(PBSamplerAccessMode.COMPARISON);
/** @internal */
export const typeVoid = new PBVoidTypeInfo();
/** @internal */
export const typeAny = new PBAnyTypeInfo();
/** @internal */
export const typeFrexpResult = new PBStructTypeInfo('FrexpResult', 'default', [
  { name: 'sig', type: typeF32 },
  { name: 'exp', type: typeI32 }
]);
/** @internal */
export const typeFrexpResultVec2 = new PBStructTypeInfo('FrexpResultVec2', 'default', [
  { name: 'sig', type: typeF32Vec2 },
  { name: 'exp', type: typeI32Vec2 }
]);
/** @internal */
export const typeFrexpResultVec3 = new PBStructTypeInfo('FrexpResultVec3', 'default', [
  { name: 'sig', type: typeF32Vec3 },
  { name: 'exp', type: typeI32Vec3 }
]);
/** @internal */
export const typeFrexpResultVec4 = new PBStructTypeInfo('FrexpResultVec4', 'default', [
  { name: 'sig', type: typeF32Vec4 },
  { name: 'exp', type: typeI32Vec4 }
]);
