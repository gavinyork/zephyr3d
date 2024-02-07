import type { VectorBase, CubeFace, TypedArray, IEventTarget } from '@zephyr3d/base';
import type { ShaderKind, AbstractDevice } from './base_types';
import type {
  PBTypeInfo} from './builder/types';
import {
  PBArrayTypeInfo,
  PBPrimitiveTypeInfo,
  PBStructTypeInfo,
  PBPrimitiveType
} from './builder/types';
import type { TextureType, CompareFunc, TextureAddressMode, TextureFilterMode, DataType, PrimitiveType, TextureFormat } from './base_types';
import type { VertexBufferInfo } from './vertexdata';

/**
 * The types of image element that can be uploaded to textures
 * @public
 */
export type TextureImageElement = ImageBitmap | HTMLCanvasElement;

/** @internal */
export const MAX_VERTEX_ATTRIBUTES = 16;
/** @internal */
export const MAX_BINDING_GROUPS = 4;
/** @internal */
export const MAX_TEXCOORD_INDEX_COUNT = 8;
/** @internal */
export const VERTEX_ATTRIB_POSITION = 0;
/** @internal */
export const VERTEX_ATTRIB_NORMAL = 1;
/** @internal */
export const VERTEX_ATTRIB_DIFFUSE = 2;
/** @internal */
export const VERTEX_ATTRIB_TANGENT = 3;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD0 = 4;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD1 = 5;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD2 = 6;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD3 = 7;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD4 = 8;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD5 = 9;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD6 = 10;
/** @internal */
export const VERTEX_ATTRIB_TEXCOORD7 = 11;
/** @internal */
export const VERTEX_ATTRIB_BLEND_WEIGHT = 12;
/** @internal */
export const VERTEX_ATTRIB_BLEND_INDICES = 13;

/**
 * The vertex format types
 * @public
 */
export type VertexAttribFormat =
  'position_u8normx2'|
  'position_u8normx4'|
  'position_i8normx2'|
  'position_i8normx4'|
  'position_u16x2'|
  'position_u16x4'|
  'position_i16x2'|
  'position_i16x4'|
  'position_u16normx2'|
  'position_u16normx4'|
  'position_i16normx2'|
  'position_i16normx4'|
  'position_f16x2'|
  'position_f16x4'|
  'position_f32'|
  'position_f32x2'|
  'position_f32x3'|
  'position_f32x4'|
  'position_i32'|
  'position_i32x2'|
  'position_i32x3'|
  'position_i32x4'|
  'position_u32'|
  'position_u32x2'|
  'position_u32x3'|
  'position_u32x4'|
  'normal_f16x4'|
  'normal_f32x3'|
  'normal_f32x4'|
  'diffuse_u8normx4'|
  'diffuse_u16x4'|
  'diffuse_u16normx4'|
  'diffuse_f16x4'|
  'diffuse_f32x3'|
  'diffuse_f32x4'|
  'diffuse_u32x3'|
  'diffuse_u32x4'|
  'tangent_f16x4'|
  'tangent_f32x3'|
  'tangent_f32x4'|
  'tex0_u8normx2'|
  'tex0_u8normx4'|
  'tex0_i8normx2'|
  'tex0_i8normx4'|
  'tex0_u16x2'|
  'tex0_u16x4'|
  'tex0_i16x2'|
  'tex0_i16x4'|
  'tex0_u16normx2'|
  'tex0_u16normx4'|
  'tex0_i16normx2'|
  'tex0_i16normx4'|
  'tex0_f16x2'|
  'tex0_f16x4'|
  'tex0_f32'|
  'tex0_f32x2'|
  'tex0_f32x3'|
  'tex0_f32x4'|
  'tex0_i32'|
  'tex0_i32x2'|
  'tex0_i32x3'|
  'tex0_i32x4'|
  'tex0_u32'|
  'tex0_u32x2'|
  'tex0_u32x3'|
  'tex0_u32x4'|
  'tex1_u8normx2'|
  'tex1_u8normx4'|
  'tex1_i8normx2'|
  'tex1_i8normx4'|
  'tex1_u16x2'|
  'tex1_u16x4'|
  'tex1_i16x2'|
  'tex1_i16x4'|
  'tex1_u16normx2'|
  'tex1_u16normx4'|
  'tex1_i16normx2'|
  'tex1_i16normx4'|
  'tex1_f16x2'|
  'tex1_f16x4'|
  'tex1_f32'|
  'tex1_f32x2'|
  'tex1_f32x3'|
  'tex1_f32x4'|
  'tex1_i32'|
  'tex1_i32x2'|
  'tex1_i32x3'|
  'tex1_i32x4'|
  'tex1_u32'|
  'tex1_u32x2'|
  'tex1_u32x3'|
  'tex1_u32x4'|
  'tex2_u8normx2'|
  'tex2_u8normx4'|
  'tex2_i8normx2'|
  'tex2_i8normx4'|
  'tex2_u16x2'|
  'tex2_u16x4'|
  'tex2_i16x2'|
  'tex2_i16x4'|
  'tex2_u16normx2'|
  'tex2_u16normx4'|
  'tex2_i16normx2'|
  'tex2_i16normx4'|
  'tex2_f16x2'|
  'tex2_f16x4'|
  'tex2_f32'|
  'tex2_f32x2'|
  'tex2_f32x3'|
  'tex2_f32x4'|
  'tex2_i32'|
  'tex2_i32x2'|
  'tex2_i32x3'|
  'tex2_i32x4'|
  'tex2_u32'|
  'tex2_u32x2'|
  'tex2_u32x3'|
  'tex2_u32x4'|
  'tex3_u8normx2'|
  'tex3_u8normx4'|
  'tex3_i8normx2'|
  'tex3_i8normx4'|
  'tex3_u16x2'|
  'tex3_u16x4'|
  'tex3_i16x2'|
  'tex3_i16x4'|
  'tex3_u16normx2'|
  'tex3_u16normx4'|
  'tex3_i16normx2'|
  'tex3_i16normx4'|
  'tex3_f16x2'|
  'tex3_f16x4'|
  'tex3_f32'|
  'tex3_f32x2'|
  'tex3_f32x3'|
  'tex3_f32x4'|
  'tex3_i32'|
  'tex3_i32x2'|
  'tex3_i32x3'|
  'tex3_i32x4'|
  'tex3_u32'|
  'tex3_u32x2'|
  'tex3_u32x3'|
  'tex3_u32x4'|
  'tex4_u8normx2'|
  'tex4_u8normx4'|
  'tex4_i8normx2'|
  'tex4_i8normx4'|
  'tex4_u16x2'|
  'tex4_u16x4'|
  'tex4_i16x2'|
  'tex4_i16x4'|
  'tex4_u16normx2'|
  'tex4_u16normx4'|
  'tex4_i16normx2'|
  'tex4_i16normx4'|
  'tex4_f16x2'|
  'tex4_f16x4'|
  'tex4_f32'|
  'tex4_f32x2'|
  'tex4_f32x3'|
  'tex4_f32x4'|
  'tex4_i32'|
  'tex4_i32x2'|
  'tex4_i32x3'|
  'tex4_i32x4'|
  'tex4_u32'|
  'tex4_u32x2'|
  'tex4_u32x3'|
  'tex4_u32x4'|
  'tex5_u8normx2'|
  'tex5_u8normx4'|
  'tex5_i8normx2'|
  'tex5_i8normx4'|
  'tex5_u16x2'|
  'tex5_u16x4'|
  'tex5_i16x2'|
  'tex5_i16x4'|
  'tex5_u16normx2'|
  'tex5_u16normx4'|
  'tex5_i16normx2'|
  'tex5_i16normx4'|
  'tex5_f16x2'|
  'tex5_f16x4'|
  'tex5_f32'|
  'tex5_f32x2'|
  'tex5_f32x3'|
  'tex5_f32x4'|
  'tex5_i32'|
  'tex5_i32x2'|
  'tex5_i32x3'|
  'tex5_i32x4'|
  'tex5_u32'|
  'tex5_u32x2'|
  'tex5_u32x3'|
  'tex5_u32x4'|
  'tex6_u8normx2'|
  'tex6_u8normx4'|
  'tex6_i8normx2'|
  'tex6_i8normx4'|
  'tex6_u16x2'|
  'tex6_u16x4'|
  'tex6_i16x2'|
  'tex6_i16x4'|
  'tex6_u16normx2'|
  'tex6_u16normx4'|
  'tex6_i16normx2'|
  'tex6_i16normx4'|
  'tex6_f16x2'|
  'tex6_f16x4'|
  'tex6_f32'|
  'tex6_f32x2'|
  'tex6_f32x3'|
  'tex6_f32x4'|
  'tex6_i32'|
  'tex6_i32x2'|
  'tex6_i32x3'|
  'tex6_i32x4'|
  'tex6_u32'|
  'tex6_u32x2'|
  'tex6_u32x3'|
  'tex6_u32x4'|
  'tex7_u8normx2'|
  'tex7_u8normx4'|
  'tex7_i8normx2'|
  'tex7_i8normx4'|
  'tex7_u16x2'|
  'tex7_u16x4'|
  'tex7_i16x2'|
  'tex7_i16x4'|
  'tex7_u16normx2'|
  'tex7_u16normx4'|
  'tex7_i16normx2'|
  'tex7_i16normx4'|
  'tex7_f16x2'|
  'tex7_f16x4'|
  'tex7_f32'|
  'tex7_f32x2'|
  'tex7_f32x3'|
  'tex7_f32x4'|
  'tex7_i32'|
  'tex7_i32x2'|
  'tex7_i32x3'|
  'tex7_i32x4'|
  'tex7_u32'|
  'tex7_u32x2'|
  'tex7_u32x3'|
  'tex7_u32x4'|
  'blendweights_f16x4'|
  'blendweights_f32x4'|
  'blendindices_u16x4'|
  'blendindices_f16x4'|
  'blendindices_f32x4'|
  'blendindices_u32x4';

const vertexAttribFormatMap: Record<VertexAttribFormat, [number, PBPrimitiveType, number, string, number]> = {
  position_u8normx2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  position_u8normx4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  position_i8normx2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  position_i8normx4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  position_u16x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  position_u16x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  position_i16x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  position_i16x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  position_u16normx2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  position_u16normx4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  position_i16normx2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  position_i16normx4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  position_f16x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  position_f16x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  position_f32: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F32, 4, 'f32', 1],
  position_f32x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  position_f32x3: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  position_f32x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  position_i32: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I32, 4, 'i32', 1],
  position_i32x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  position_i32x3: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  position_i32x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  position_u32: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U32, 4, 'u32', 1],
  position_u32x2: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  position_u32x3: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  position_u32x4: [VERTEX_ATTRIB_POSITION, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  normal_f16x4: [VERTEX_ATTRIB_NORMAL, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  normal_f32x3: [VERTEX_ATTRIB_NORMAL, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  normal_f32x4: [VERTEX_ATTRIB_NORMAL, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  diffuse_u8normx4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  diffuse_u16x4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  diffuse_u16normx4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  diffuse_f16x4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  diffuse_f32x3: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  diffuse_f32x4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  diffuse_u32x3: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  diffuse_u32x4: [VERTEX_ATTRIB_DIFFUSE, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tangent_f16x4: [VERTEX_ATTRIB_TANGENT, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tangent_f32x3: [VERTEX_ATTRIB_TANGENT, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tangent_f32x4: [VERTEX_ATTRIB_TANGENT, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex0_u8normx2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex0_u8normx4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex0_i8normx2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex0_i8normx4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex0_u16x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex0_u16x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex0_i16x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex0_i16x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex0_u16normx2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex0_u16normx4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex0_i16normx2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex0_i16normx4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex0_f16x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex0_f16x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex0_f32: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F32, 4, 'f32', 1],
  tex0_f32x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex0_f32x3: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex0_f32x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex0_i32: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I32, 4, 'i32', 1],
  tex0_i32x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex0_i32x3: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex0_i32x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex0_u32: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U32, 4, 'u32', 1],
  tex0_u32x2: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex0_u32x3: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex0_u32x4: [VERTEX_ATTRIB_TEXCOORD0, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex1_u8normx2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex1_u8normx4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex1_i8normx2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex1_i8normx4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex1_u16x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex1_u16x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex1_i16x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex1_i16x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex1_u16normx2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex1_u16normx4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex1_i16normx2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex1_i16normx4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex1_f16x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex1_f16x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex1_f32: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F32, 4, 'f32', 1],
  tex1_f32x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex1_f32x3: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex1_f32x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex1_i32: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I32, 4, 'i32', 1],
  tex1_i32x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex1_i32x3: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex1_i32x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex1_u32: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U32, 4, 'u32', 1],
  tex1_u32x2: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex1_u32x3: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex1_u32x4: [VERTEX_ATTRIB_TEXCOORD1, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex2_u8normx2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex2_u8normx4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex2_i8normx2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex2_i8normx4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex2_u16x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex2_u16x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex2_i16x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex2_i16x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex2_u16normx2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex2_u16normx4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex2_i16normx2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex2_i16normx4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex2_f16x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex2_f16x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex2_f32: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F32, 4, 'f32', 1],
  tex2_f32x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex2_f32x3: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex2_f32x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex2_i32: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I32, 4, 'i32', 1],
  tex2_i32x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex2_i32x3: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex2_i32x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex2_u32: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U32, 4, 'u32', 1],
  tex2_u32x2: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex2_u32x3: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex2_u32x4: [VERTEX_ATTRIB_TEXCOORD2, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex3_u8normx2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex3_u8normx4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex3_i8normx2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex3_i8normx4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex3_u16x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex3_u16x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex3_i16x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex3_i16x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex3_u16normx2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex3_u16normx4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex3_i16normx2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex3_i16normx4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex3_f16x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex3_f16x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex3_f32: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F32, 4, 'f32', 1],
  tex3_f32x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex3_f32x3: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex3_f32x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex3_i32: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I32, 4, 'i32', 1],
  tex3_i32x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex3_i32x3: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex3_i32x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex3_u32: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U32, 4, 'u32', 1],
  tex3_u32x2: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex3_u32x3: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex3_u32x4: [VERTEX_ATTRIB_TEXCOORD3, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex4_u8normx2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex4_u8normx4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex4_i8normx2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex4_i8normx4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex4_u16x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex4_u16x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex4_i16x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex4_i16x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex4_u16normx2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex4_u16normx4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex4_i16normx2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex4_i16normx4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex4_f16x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex4_f16x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex4_f32: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F32, 4, 'f32', 1],
  tex4_f32x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex4_f32x3: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex4_f32x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex4_i32: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I32, 4, 'i32', 1],
  tex4_i32x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex4_i32x3: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex4_i32x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex4_u32: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U32, 4, 'u32', 1],
  tex4_u32x2: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex4_u32x3: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex4_u32x4: [VERTEX_ATTRIB_TEXCOORD4, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex5_u8normx2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex5_u8normx4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex5_i8normx2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex5_i8normx4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex5_u16x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex5_u16x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex5_i16x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex5_i16x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex5_u16normx2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex5_u16normx4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex5_i16normx2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex5_i16normx4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex5_f16x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex5_f16x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex5_f32: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F32, 4, 'f32', 1],
  tex5_f32x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex5_f32x3: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex5_f32x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex5_i32: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I32, 4, 'i32', 1],
  tex5_i32x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex5_i32x3: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex5_i32x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex5_u32: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U32, 4, 'u32', 1],
  tex5_u32x2: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex5_u32x3: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex5_u32x4: [VERTEX_ATTRIB_TEXCOORD5, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex6_u8normx2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex6_u8normx4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex6_i8normx2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex6_i8normx4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex6_u16x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex6_u16x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex6_i16x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex6_i16x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex6_u16normx2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex6_u16normx4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex6_i16normx2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex6_i16normx4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex6_f16x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex6_f16x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex6_f32: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F32, 4, 'f32', 1],
  tex6_f32x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex6_f32x3: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex6_f32x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex6_i32: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I32, 4, 'i32', 1],
  tex6_i32x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex6_i32x3: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex6_i32x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex6_u32: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U32, 4, 'u32', 1],
  tex6_u32x2: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex6_u32x3: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex6_u32x4: [VERTEX_ATTRIB_TEXCOORD6, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  tex7_u8normx2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U8VEC2_NORM, 2, 'u8norm', 2],
  tex7_u8normx4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U8VEC4_NORM, 4, 'u8norm', 4],
  tex7_i8normx2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I8VEC2_NORM, 2, 'i8norm', 2],
  tex7_i8normx4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I8VEC4_NORM, 4, 'i8norm', 4],
  tex7_u16x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U16VEC2, 4, 'u16', 2],
  tex7_u16x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  tex7_i16x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I16VEC2, 4, 'i16', 2],
  tex7_i16x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I16VEC4, 8, 'i16', 4],
  tex7_u16normx2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U16VEC2_NORM, 4, 'u16norm', 2],
  tex7_u16normx4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U16VEC4_NORM, 8, 'u16norm', 4],
  tex7_i16normx2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I16VEC2_NORM, 4, 'i16norm', 2],
  tex7_i16normx4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I16VEC4_NORM, 8, 'i16norm', 4],
  tex7_f16x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F16VEC2, 4, 'f16', 2],
  tex7_f16x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  tex7_f32: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F32, 4, 'f32', 1],
  tex7_f32x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F32VEC2, 8, 'f32', 2],
  tex7_f32x3: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F32VEC3, 12, 'f32', 3],
  tex7_f32x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  tex7_i32: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I32, 4, 'i32', 1],
  tex7_i32x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I32VEC2, 8, 'i32', 2],
  tex7_i32x3: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I32VEC3, 12, 'i32', 3],
  tex7_i32x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.I32VEC4, 16, 'i32', 4],
  tex7_u32: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U32, 4, 'u32', 1],
  tex7_u32x2: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U32VEC2, 8, 'u32', 2],
  tex7_u32x3: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U32VEC3, 12, 'u32', 3],
  tex7_u32x4: [VERTEX_ATTRIB_TEXCOORD7, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
  blendweights_f16x4: [VERTEX_ATTRIB_BLEND_WEIGHT, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  blendweights_f32x4: [VERTEX_ATTRIB_BLEND_WEIGHT, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  blendindices_u16x4: [VERTEX_ATTRIB_BLEND_INDICES, PBPrimitiveType.U16VEC4, 8, 'u16', 4],
  blendindices_f16x4: [VERTEX_ATTRIB_BLEND_INDICES, PBPrimitiveType.F16VEC4, 8, 'f16', 4],
  blendindices_f32x4: [VERTEX_ATTRIB_BLEND_INDICES, PBPrimitiveType.F32VEC4, 16, 'f32', 4],
  blendindices_u32x4: [VERTEX_ATTRIB_BLEND_INDICES, PBPrimitiveType.U32VEC4, 16, 'u32', 4],
};

/**
 * The semantic type of vertex
 * @public
 */
export type VertexSemantic =
'position'|
'normal'|
'diffuse'|
'tangent'|
'blendIndices'|
'blendWeights'|
'texCoord0'|
'texCoord1'|
'texCoord2'|
'texCoord3'|
'texCoord4'|
'texCoord5'|
'texCoord6'|
'texCoord7';


const vertexAttribNameMap: Record<VertexSemantic, number> = {
  position: VERTEX_ATTRIB_POSITION,
  normal: VERTEX_ATTRIB_NORMAL,
  diffuse: VERTEX_ATTRIB_DIFFUSE,
  tangent: VERTEX_ATTRIB_TANGENT,
  blendIndices: VERTEX_ATTRIB_BLEND_INDICES,
  blendWeights: VERTEX_ATTRIB_BLEND_WEIGHT,
  texCoord0: VERTEX_ATTRIB_TEXCOORD0,
  texCoord1: VERTEX_ATTRIB_TEXCOORD1,
  texCoord2: VERTEX_ATTRIB_TEXCOORD2,
  texCoord3: VERTEX_ATTRIB_TEXCOORD3,
  texCoord4: VERTEX_ATTRIB_TEXCOORD4,
  texCoord5: VERTEX_ATTRIB_TEXCOORD5,
  texCoord6: VERTEX_ATTRIB_TEXCOORD6,
  texCoord7: VERTEX_ATTRIB_TEXCOORD7,
};

const vertexAttribNameRevMap = {
  [VERTEX_ATTRIB_POSITION]: 'position',
  [VERTEX_ATTRIB_NORMAL]: 'normal',
  [VERTEX_ATTRIB_DIFFUSE]: 'diffuse',
  [VERTEX_ATTRIB_TANGENT]: 'tangent',
  [VERTEX_ATTRIB_BLEND_INDICES]: 'blendIndices',
  [VERTEX_ATTRIB_BLEND_WEIGHT]: 'blendWeights',
  [VERTEX_ATTRIB_TEXCOORD0]: 'texCoord0',
  [VERTEX_ATTRIB_TEXCOORD1]: 'texCoord1',
  [VERTEX_ATTRIB_TEXCOORD2]: 'texCoord2',
  [VERTEX_ATTRIB_TEXCOORD3]: 'texCoord3',
  [VERTEX_ATTRIB_TEXCOORD4]: 'texCoord4',
  [VERTEX_ATTRIB_TEXCOORD5]: 'texCoord5',
  [VERTEX_ATTRIB_TEXCOORD6]: 'texCoord6',
  [VERTEX_ATTRIB_TEXCOORD7]: 'texCoord7',
};

/**
 * Options for creating vertex layout
 * @public
 */
export type VertexLayoutOptions = {
  /**
   * vertex buffers in this vertex layout
   */
  vertexBuffers: {
    /**
     * vertex buffer object created by device
     */
    buffer: StructuredBuffer,
    /**
     * the vertex buffer step mode,
     * value can be 'vertex' or 'instance', default is 'vertex'
     */
    stepMode?: VertexStepMode
  }[],
  /**
   * optional index buffer in this vertex layout
   */
  indexBuffer?: IndexBuffer
};

/**
 * Supported colorspace types for texture
 * @public
 */
export type TextureColorSpace = 'srgb' | 'linear';

/**
 * Buffer usage type
 * @public
 */
export type BufferUsage = 'vertex' | 'index' | 'uniform' | 'read' | 'write';

/**
 * Common options for createing texture or buffer
 * @public
 */
export interface BaseCreationOptions {
  /**
   * Whether the object should be dynamic, default is false
   */
  dynamic?: boolean;
}
/**
 * Options for creating texture
 * @public
 */
export interface TextureCreationOptions extends BaseCreationOptions {
  writable?: boolean;
  texture?: BaseTexture;
  samplerOptions?: SamplerOptions;
}
/**
 * Options for creating gpu buffer
 * @public
 */
export interface BufferCreationOptions extends BaseCreationOptions {
  /** The buffer usage */
  usage?: BufferUsage;
  /** true if we are creating a storage buffer */
  storage?: boolean;
  /** Whether the object content should be managed, default true for vertex buffer of index buffer */
  managed?: boolean;
}

/**
 * The gpu resource usage flags
 * @public
 */
export enum GPUResourceUsageFlags {
  TF_LINEAR_COLOR_SPACE = 1 << 1,
  TF_NO_MIPMAP = 1 << 2,
  TF_WRITABLE = 1 << 3,
  TF_NO_GC = 1 << 4,
  BF_VERTEX = 1 << 5,
  BF_INDEX = 1 << 6,
  BF_READ = 1 << 7,
  BF_WRITE = 1 << 8,
  BF_UNIFORM = 1 << 9,
  BF_STORAGE = 1 << 10,
  DYNAMIC = 1 << 11,
  MANAGED = 1 << 12
}

/**
 * Get vertex attribute index by semantic
 * @internal
 */
export function getVertexAttribByName(name: VertexSemantic): number {
  return vertexAttribNameMap[name];
}

/**
 * Get vertex semantic by attribute index
 * @internal
 */
export function getVertexAttribName(attrib: number): VertexSemantic {
  return vertexAttribNameRevMap[attrib];
}

/**
 * Get byte size of specified vertex format
 * @internal
 */
export function getVertexFormatSize(fmt: VertexAttribFormat): number {
  return vertexAttribFormatMap[fmt][2];
}

/**
 * Get vertex format by semantic and component type and component count
 * @param semantic - The vertex semantic
 * @param type - Data type of vertex component
 * @param count - The count of vertex components
 * @returns Vertex format
 * @public
 */
export function getVertexAttribFormat(
  semantic: VertexSemantic,
  type: DataType,
  count: number
): VertexAttribFormat {
  const loc = getVertexAttribByName(semantic);
  for (const k in vertexAttribFormatMap) {
    const v = vertexAttribFormatMap[k];
    if (v[0] === loc && v[3] === type && v[4] === count) {
      return k as VertexAttribFormat;
    }
  }
  return null;
}

/**
 * Get the length of a vertex buffer by specified structure type of the vertex buffer
 * @param vertexBufferType - The structure type of the vertex buffer
 * @returns The length of the vertex buffer
 * @public
 */
export function getVertexBufferLength(vertexBufferType: PBStructTypeInfo) {
  return (vertexBufferType.structMembers[0].type as PBArrayTypeInfo).dimension;
}

/**
 * Get byte stride of a vertex buffer by specified structure type of the vertex buffer
 * @param vertexBufferType - The structure type of the vertex buffer
 * @returns The byte stride of the vertex buffer
 * @public
 */
 export function getVertexBufferStride(vertexBufferType: PBStructTypeInfo) {
  const vertexType = (vertexBufferType.structMembers[0].type as PBArrayTypeInfo).elementType;
  if (vertexType.isStructType()) {
    let stride = 0;
    for (const member of vertexType.structMembers) {
      stride += (member.type as PBPrimitiveTypeInfo).getSize();
    }
    return stride;
  } else {
    return (vertexType as PBPrimitiveTypeInfo).getSize();
  }
}

/**
 * Get primitive type of a vertex attribute by specified vertex semantic
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex semantic
 * @returns - The primitive type of the vertex attribute
 * @public
 */
export function getVertexBufferAttribTypeBySemantic(
  vertexBufferType: PBStructTypeInfo,
  semantic: VertexSemantic
): PBPrimitiveTypeInfo {
  const k = vertexBufferType.structMembers[0];
  const vertexType = (k.type as PBArrayTypeInfo).elementType;
  if (vertexType.isStructType()) {
    for (const member of vertexType.structMembers) {
      if (member.name === semantic) {
        return member.type as PBPrimitiveTypeInfo;
      }
    }
    return null;
  } else {
    return k.name === semantic ? (vertexType as PBPrimitiveTypeInfo) : null;
  }
}

/**
 * Get primitive type of a vertex attribute by specified vertex attribute index
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex attribute index
 * @returns - The primitive type of the vertex attribute
 * @public
 */
 export function getVertexBufferAttribType(
  vertexBufferType: PBStructTypeInfo,
  attrib: number
): PBPrimitiveTypeInfo {
  const attribName = getVertexAttribName(attrib);
  if (!attribName) {
    return null;
  }
  return getVertexBufferAttribTypeBySemantic(vertexBufferType, attribName);
}

/**
 * Get the structure type of a vertex buffer by specified vertex attribute formats and the length of the vertex buffer
 * @param length - The length of the vertex buffer
 * @param attributes - The vertex attributes
 * @returns The structure type of the vertex buffer
 * @public
 */
export function makeVertexBufferType(length: number, ...attributes: VertexAttribFormat[]): PBStructTypeInfo {
  if (attributes.length === 0) {
    return null;
  }
  if (attributes.length === 1) {
    const format = vertexAttribFormatMap[attributes[0]];
    return new PBStructTypeInfo(null, 'packed', [
      {
        name: getVertexAttribName(format[0]),
        type: new PBArrayTypeInfo(PBPrimitiveTypeInfo.getCachedTypeInfo(format[1]), length)
      }
    ]);
  } else {
    const vertexType = new PBStructTypeInfo(
      null,
      'packed',
      attributes.map((attrib) => ({
        name: getVertexAttribName(vertexAttribFormatMap[attrib][0]),
        type: PBPrimitiveTypeInfo.getCachedTypeInfo(vertexAttribFormatMap[attrib][1])
      }))
    );
    return new PBStructTypeInfo(null, 'packed', [
      {
        name: 'value',
        type: new PBArrayTypeInfo(vertexType, length)
      }
    ]);
  }
}

/**
 * Vertex step mode.
 * @public
 */
export type VertexStepMode = 'vertex' | 'instance';

/**
 * Vertex semantic list
 * @public
 */
export const semanticList: string[] = (function () {
  const list: string[] = [];
  for (let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++) {
    list.push(semanticToAttrib(i));
  }
  return list;
})();

/** @internal */
export function semanticToAttrib(semantic: number): string {
  switch (semantic) {
    case VERTEX_ATTRIB_POSITION:
      return 'a_position';
    case VERTEX_ATTRIB_NORMAL:
      return 'a_normal';
    case VERTEX_ATTRIB_DIFFUSE:
      return 'a_diffuse';
    case VERTEX_ATTRIB_TANGENT:
      return 'a_tangent';
    case VERTEX_ATTRIB_TEXCOORD0:
      return 'a_texcoord0';
    case VERTEX_ATTRIB_TEXCOORD1:
      return 'a_texcoord1';
    case VERTEX_ATTRIB_TEXCOORD2:
      return 'a_texcoord2';
    case VERTEX_ATTRIB_TEXCOORD3:
      return 'a_texcoord3';
    case VERTEX_ATTRIB_TEXCOORD4:
      return 'a_texcoord4';
    case VERTEX_ATTRIB_TEXCOORD5:
      return 'a_texcoord5';
    case VERTEX_ATTRIB_TEXCOORD6:
      return 'a_texcoord6';
    case VERTEX_ATTRIB_TEXCOORD7:
      return 'a_texcoord7';
    case VERTEX_ATTRIB_BLEND_INDICES:
      return 'a_indices';
    case VERTEX_ATTRIB_BLEND_WEIGHT:
      return 'a_weight';
    default:
      return null;
  }
}

/**
 * A data structure that holds the texture data of a mipmap level
 * @public
 */
export interface TextureMipmapLevelData {
  /** The texture data */
  data: TypedArray;
  /** Width of the mipmap level */
  width: number;
  /** Height of the mipmap level */
  height: number;
}

/**
 * A data structure that holds the texture data of all mipmap levels
 * @public
 */
export interface TextureMipmapData {
  /** Texture width of mipmap level 0 */
  width: number;
  /** Texture height of mipmap level 0 */
  height: number;
  /** Texture depth of mipmap level 0 */
  depth: number;
  /** true if it holds texture data for cube texture */
  isCubemap: boolean;
  /** true if it holds texture data for 3d texture */
  isVolume: boolean;
  /** true if it holds texture array */
  isArray: boolean;
  /** true if the texture data are in compressed format */
  isCompressed: boolean;
  /** The array size if it holds texture data for array texture  */
  arraySize: number;
  /** How many mipmap levels in the texture data */
  mipLevels: number;
  /** The texture format */
  format: TextureFormat;
  /** The mipmap level datas */
  mipDatas: TextureMipmapLevelData[][];
}

/**
 * Frame buffer texture attachment information
 * @public
 */
export interface FrameBufferTextureAttachment {
  /** Texture for this attachment */
  texture?: BaseTexture;
  /** The attached face index for cube texture */
  face?: number;
  /** The layer index for array texture */
  layer?: number;
  /** Which mipmap level is currently attached */
  level?: number;
  /** Whether automatically generate mipmaps for color attachments */
  generateMipmaps?: boolean;
}

/**
 * The frame buffer creation options
 * @public
 */
export interface FrameBufferOptions {
  /** Sample count of the frame buffer */
  sampleCount?: number;
  /** Whether to ignore the depth stencil attachment when resolving multisample frame buffer */
  ignoreDepthStencil?: boolean;
}

/**
 * The uniform buffer layout
 * @public
 */
export interface UniformBufferLayout {
  /** Byte size of the uniform buffer */
  byteSize: number;
  /** Entries for the uniform buffer */
  entries: UniformLayout[];
}

/**
 * Layout of a uniform in a uniform buffer
 * @public
 */
export interface UniformLayout {
  /** Name of the uniform */
  name: string;
  /** Byte offset of the uniform buffer */
  offset: number;
  /** Byte size of the uniform */
  byteSize: number;
  /** The array length if the uniform is array type */
  arraySize: number;
  /** The primitive type of the uniform */
  type: PBPrimitiveType;
  /** Layout of the members if the uniform is struct type */
  subLayout: UniformBufferLayout;
}

/**
 * Binding layout of a uniform buffer or storage buffer
 * @public
 */
export interface BufferBindingLayout {
  /** The bind type */
  type?: 'uniform' | 'storage' | 'read-only-storage';
  /** Whether the buffer should be accessed by a dynamic offset */
  hasDynamicOffset: boolean;
  /** layout for the buffer */
  uniformLayout: UniformBufferLayout;
  /** minimum binding size of the buffer */
  minBindingSize?: number;
}

/**
 * Binding layout of a sampler
 * @public
 */
export interface SamplerBindingLayout {
  /** The bind type */
  type: 'filtering' | 'non-filtering' | 'comparison';
}

/**
 * Binding layout of a texture for sampling
 * @public
 */
export interface TextureBindingLayout {
  /** Sample type of the texture */
  sampleType: 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
  /** View dimension for the texture */
  viewDimension: '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
  /** Whether the textur is a multisampled texture */
  multisampled: boolean;
  /** name of the default sampler uniform when using WebGPU device */
  autoBindSampler: string;
  /** name of the default comparison sampler uniform when using WebGPU device */
  autoBindSamplerComparison: string;
}

/**
 * Binding layout of a storage texture
 * @public
 */
export interface StorageTextureBindingLayout {
  /** Access mode */
  access: 'write-only';
  /** The texture format */
  format: TextureFormat;
  /** View dimension */
  viewDimension: '1d' | '2d';
}

/**
 * Binding layout of an external texture
 * @public
 */
export interface ExternalTextureBindingLayout {
  /** name of the default sampler uniform when using WebGPU device */
  autoBindSampler: string;
}

/**
 * Information of bind group entries
 * @public
 */
export interface BindGroupLayoutEntry {
  /** The binding location */
  binding: number;
  /** Name of this binding resource */
  name: string;
  /** Visibility mask */
  visibility: number;
  /** Type of the binding resource */
  type: PBTypeInfo;
  /** Binding layout if the resource is a buffer */
  buffer?: BufferBindingLayout;
  /** Binding layout if the resource is a sampler */
  sampler?: SamplerBindingLayout;
  /** Binding layout if the resource is a texture for sampling */
  texture?: TextureBindingLayout;
  /** Binding layout if the resource is a storage texture */
  storageTexture?: StorageTextureBindingLayout;
  /** Binding layout if the resource is an external texture */
  externalTexture?: ExternalTextureBindingLayout;
}

/**
 * Defines how the resources bound in a {@link BindGroup}
 * @public
 */
export interface BindGroupLayout {
  /** Label of the layout */
  label?: string;
  /** The name map */
  nameMap?: Record<string, string>;
  /** A list of {@link BindGroupLayoutEntry} */
  entries: BindGroupLayoutEntry[];
}

/**
 * Binding point information for a uniform
 * @public
 */
export interface BindPointInfo {
  group: number;
  binding: number;
  type: PBTypeInfo;
}

/**
 * Sampler creation options
 * @public
 */
export interface SamplerOptions {
  addressU?: TextureAddressMode;
  addressV?: TextureAddressMode;
  addressW?: TextureAddressMode;
  magFilter?: TextureFilterMode;
  minFilter?: TextureFilterMode;
  mipFilter?: TextureFilterMode;
  lodMin?: number;
  lodMax?: number;
  compare?: CompareFunc;
  maxAnisotropy?: number;
}

/**
 * Base class for a GPU object
 * @public
 */
export interface GPUObject<T = unknown> extends IEventTarget<{ disposed: null }> {
  /** The object was created by which device */
  readonly device: AbstractDevice;
  /** The internal GPU object  */
  readonly object: T;
  /** unique id */
  readonly uid: number;
  readonly cid: number;
  readonly disposed: boolean;
  name: string;
  restoreHandler: (tex: GPUObject) => Promise<void>;
  isVertexLayout(): this is VertexLayout;
  isFramebuffer(): this is FrameBuffer;
  isSampler(): this is TextureSampler;
  isTexture(): this is BaseTexture;
  isTexture2D(): this is Texture2D;
  isTexture2DArray(): this is Texture2DArray;
  isTexture3D(): this is Texture3D;
  isTextureCube(): this is TextureCube;
  isTextureVideo(): this is TextureVideo;
  isProgram(): this is GPUProgram;
  isBuffer(): this is GPUDataBuffer;
  isBindGroup(): this is BindGroup;
  dispose(): void;
  reload(): Promise<void>;
  destroy(): void;
  restore(): Promise<void>;
}

/**
 * Abstract interface for texture sampler
 * @public
 */
export interface TextureSampler<T = unknown> extends GPUObject<T> {
  readonly addressModeU: TextureAddressMode;
  readonly addressModeV: TextureAddressMode;
  readonly addressModeW: TextureAddressMode;
  readonly magFilter: TextureFilterMode;
  readonly minFilter: TextureFilterMode;
  readonly mipFilter: TextureFilterMode;
  readonly lodMin: number;
  readonly lodMax: number;
  readonly compare: CompareFunc;
  readonly maxAnisotropy: number;
}

/**
 * Abstract interface for texture
 * @public
 */
export interface BaseTexture<T = unknown> extends GPUObject<T> {
  readonly target: TextureType;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly format: TextureFormat;
  readonly mipLevelCount: number;
  samplerOptions: SamplerOptions;
  init(): void;
  generateMipmaps(): void;
  isSRGBFormat(): boolean;
  isFloatFormat(): boolean;
  isIntegerFormat(): boolean;
  isSignedFormat(): boolean;
  isCompressedFormat(): boolean;
  isFilterable(): boolean;
  isDepth(): boolean;
  getDefaultSampler(comparison: boolean): TextureSampler;
  readPixels(x: number, y: number, w: number, h: number, faceOrLayer: number, mipLevel: number, buffer: TypedArray): Promise<void>;
  readPixelsToBuffer(x: number, y: number, w: number, h: number, faceOrLayer: number, mipLevel: number, buffer: GPUDataBuffer): void;
}

/**
 * Abstract interface for 2D texture
 * @public
 */
export interface Texture2D<T = unknown> extends BaseTexture<T> {
  update(data: TypedArray, xOffset: number, yOffset: number, width: number, height: number): void;
  updateFromElement(
    data: TextureImageElement,
    destX: number,
    destY: number,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ): void;
  loadFromElement(element: TextureImageElement, sRGB: boolean, creationFlags?: number): void;
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number): void;
}

/**
 * Abstract interface for 2D array texture
 * @public
 */
export interface Texture2DArray<T = unknown> extends BaseTexture<T> {
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    zOffset: number,
    width: number,
    height: number,
    depth: number
  ): void;
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    layerIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number): void;
}

/**
 * Abstract interface for 3D texture
 * @public
 */
export interface Texture3D<T = unknown> extends BaseTexture<T> {
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    zOffset: number,
    width: number,
    height: number,
    depth: number
  ): void;
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number): void;
}

/**
 * Abstract interface for cube texture
 * @public
 */
export interface TextureCube<T = unknown> extends BaseTexture<T> {
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number,
    face: CubeFace
  ): void;
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    face: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number): void;
}

/**
 * Abstract interface for video texture
 * @public
 */
export interface TextureVideo<T = unknown> extends BaseTexture<T> {
  readonly source: HTMLVideoElement;
  updateVideoFrame(): boolean;
}

/**
 * Abstract interface for GPU buffer
 * @public
 */
export interface GPUDataBuffer<T = unknown> extends GPUObject<T> {
  readonly byteLength: number;
  readonly usage: number;
  bufferSubData(dstByteOffset: number, data: TypedArray, srcOffset?: number, srcLength?: number): void;
  getBufferSubData(dstBuffer?: Uint8Array, offsetInBytes?: number, sizeInBytes?: number): Promise<Uint8Array>;
}

/**
 * Abstract interface for index buffer
 * @public
 */
export interface IndexBuffer<T = unknown> extends GPUDataBuffer<T> {
  readonly indexType: PBPrimitiveTypeInfo;
  readonly length: number;
}

/**
 * Abstract interface for structured buffer
 * @public
 */
export interface StructuredBuffer<T = unknown> extends GPUDataBuffer<T> {
  structure: PBStructTypeInfo;
  set(name: string, value: StructuredValue);
}

/**
 * Abstract interface for vertex layout
 * @public
 */
export interface VertexLayout<T = unknown> extends GPUObject<T> {
  readonly vertexBuffers: {
    [semantic: number]: { buffer: StructuredBuffer; offset: number };
  };
  readonly indexBuffer: IndexBuffer;
  setDrawOffset(buffer: StructuredBuffer, byteOffset: number): void;
  getVertexBuffer(semantic: VertexSemantic): StructuredBuffer;
  getVertexBufferInfo(semantic: VertexSemantic): VertexBufferInfo;
  getIndexBuffer(): IndexBuffer;
  bind(): void;
  draw(primitiveType: PrimitiveType, first: number, count: number): void;
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number);
}

/**
 * Abstract interface for frame buffer
 * @public
 */
export interface FrameBuffer<T = unknown> extends GPUObject<T> {
  getWidth(): number;
  getHeight(): number;
  getSampleCount(): number;
  setColorAttachmentCubeFace(index: number, face: CubeFace): void;
  setColorAttachmentMipLevel(index: number, level: number): void;
  setColorAttachmentLayer(index: number, layer: number): void;
  setColorAttachmentGenerateMipmaps(index: number, generateMipmaps: boolean): void;
  setDepthAttachmentCubeFace(face: CubeFace): void;
  setDepthAttachmentLayer(layer: number): void;
  getColorAttachments(): BaseTexture[];
  getDepthAttachment(): BaseTexture;
  bind(): boolean;
  unbind(): void;
}

/**
 * Abstract interface for GPU program
 * @public
 */
export interface GPUProgram<T = unknown> extends GPUObject<T> {
  readonly bindGroupLayouts: BindGroupLayout[];
  readonly type: 'render' | 'compute';
  getShaderSource(kind: ShaderKind): string;
  getCompileError(): string;
  getBindingInfo(name: string): BindPointInfo;
  createUniformBuffer(uniform: string): StructuredBuffer;
  use(): void;
}

/**
 * Type of values that can be set to a structured buffer
 * @public
 */
export type StructuredValue = number | TypedArray | VectorBase | { [name: string]: StructuredValue };

/**
 * Abstract interface for bind group
 * @public
 */
export interface BindGroup extends GPUObject<unknown> {
  getLayout(): BindGroupLayout;
  getBuffer(name: string): GPUDataBuffer;
  getTexture(name: string): BaseTexture;
  setBuffer(name: string, buffer: GPUDataBuffer): void;
  setValue(name: string, value: StructuredValue);
  setRawData(name: string, byteOffset: number, data: TypedArray, srcPos?: number, srcLength?: number);
  setTexture(name: string, texture: BaseTexture, sampler?: TextureSampler);
  setTextureView(name: string, value: BaseTexture, level?: number, face?: number, mipCount?: number, sampler?: TextureSampler);
  setSampler(name: string, sampler: TextureSampler);
}

/**
 * Creates the default name for the type of given gpu object
 * @param obj - The gpu object
 * @returns The default name
 * @public
 */
export function genDefaultName(obj: GPUObject) {
  if (obj.isTexture2D()) {
    return 'texture_2d';
  } else if (obj.isTexture2DArray()) {
    return 'texture_2darray';
  } else if (obj.isTexture3D()) {
    return 'texture_3d';
  } else if (obj.isTextureCube()) {
    return 'texture_cube';
  } else if (obj.isTextureVideo()) {
    return 'texture_video';
  } else if (obj.isBuffer()) {
    return 'buffer';
  } else if (obj.isFramebuffer()) {
    return 'framebuffer';
  } else if (obj.isProgram()) {
    return 'program';
  } else if (obj.isSampler()) {
    return 'sampler';
  } else if (obj.isVertexLayout()) {
    return 'vbo';
  } else {
    return 'unknown';
  }
}
