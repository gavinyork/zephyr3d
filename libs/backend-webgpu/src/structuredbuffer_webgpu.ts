import type { StructuredBuffer, StructuredValue, PBStructTypeInfo, PBTypeInfo } from '@zephyr3d/device';
import {
  StructuredBufferData,
  GPUResourceUsageFlags,
  PBPrimitiveType,
  PBPrimitiveTypeInfo
} from '@zephyr3d/device';
import { WebGPUBuffer } from './buffer_webgpu';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

const typeU8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2_NORM);
const typeU8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4_NORM);
const typeI8Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2_NORM);
const typeI8Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4_NORM);
const typeU16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2);
const typeU16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4);
const typeI16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2);
const typeI16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4);
const typeU16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2_NORM);
const typeU16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4_NORM);
const typeI16Vec2_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2_NORM);
const typeI16Vec4_Norm = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4_NORM);
const typeF16Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC2);
const typeF16Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC4);
const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
const typeF32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC2);
const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
const typeU32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2);
const typeU32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3);
const typeU32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4);
const typeI32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
const typeI32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2);
const typeI32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3);
const typeI32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4);

const vertexFormatTable: Record<string, GPUVertexFormat> = {
  [typeU8Vec2_Norm.typeId]: 'unorm8x2',
  [typeU8Vec4_Norm.typeId]: 'unorm8x4',
  [typeI8Vec2_Norm.typeId]: 'snorm8x2',
  [typeI8Vec4_Norm.typeId]: 'snorm8x4',
  [typeU16Vec2.typeId]: 'uint16x2',
  [typeU16Vec4.typeId]: 'uint16x4',
  [typeI16Vec2.typeId]: 'sint16x2',
  [typeI16Vec4.typeId]: 'sint16x4',
  [typeU16Vec2_Norm.typeId]: 'unorm16x2',
  [typeU16Vec4_Norm.typeId]: 'unorm16x4',
  [typeI16Vec2_Norm.typeId]: 'snorm16x2',
  [typeI16Vec4_Norm.typeId]: 'snorm16x4',
  [typeF16Vec2.typeId]: 'float16x2',
  [typeF16Vec4.typeId]: 'float16x4',
  [typeF32.typeId]: 'float32',
  [typeF32Vec2.typeId]: 'float32x2',
  [typeF32Vec3.typeId]: 'float32x3',
  [typeF32Vec4.typeId]: 'float32x4',
  [typeU32.typeId]: 'uint32',
  [typeU32Vec2.typeId]: 'uint32x2',
  [typeU32Vec3.typeId]: 'uint32x3',
  [typeU32Vec4.typeId]: 'uint32x4',
  [typeI32.typeId]: 'sint32',
  [typeI32Vec2.typeId]: 'sint32x2',
  [typeI32Vec3.typeId]: 'sint32x3',
  [typeI32Vec4.typeId]: 'sint32x4'
};

export class WebGPUStructuredBuffer extends WebGPUBuffer implements StructuredBuffer {
  private _structure: PBStructTypeInfo;
  private _data: StructuredBufferData;
  constructor(device: WebGPUDevice, structure: PBStructTypeInfo, usage: number, source?: TypedArray) {
    if (!structure?.isStructType()) {
      throw new Error('invalid structure type');
    }
    if (usage & GPUResourceUsageFlags.BF_INDEX) {
      throw new Error('structured buffer must not have Index usage flag');
    }
    if (
      usage &
      (GPUResourceUsageFlags.BF_READ |
        GPUResourceUsageFlags.BF_WRITE |
        GPUResourceUsageFlags.BF_PACK_PIXEL |
        GPUResourceUsageFlags.BF_UNPACK_PIXEL)
    ) {
      throw new Error('structured buffer must not have Read or Write usage flags');
    }
    if (usage & GPUResourceUsageFlags.BF_VERTEX) {
      if (structure.structMembers.length !== 1 || !structure.structMembers[0].type.isArrayType()) {
        throw new Error('structured buffer for vertex usage must have only one array member');
      }
    }
    if (usage & GPUResourceUsageFlags.BF_UNIFORM || usage & GPUResourceUsageFlags.BF_STORAGE) {
      usage |= GPUResourceUsageFlags.DYNAMIC;
    }
    const layout = structure.toBufferLayout(0, structure.layout);
    if (source && layout.byteSize !== source.byteLength) {
      throw new Error(
        `create structured buffer failed: invalid source size: ${source.byteLength}, should be ${layout.byteSize}`
      );
    }
    super(device, usage, source || layout.byteSize);
    this._data = new StructuredBufferData(layout, this);
    this._structure = structure;
  }
  set(name: string, value: StructuredValue) {
    this._data.set(name, value);
  }
  get structure(): PBStructTypeInfo {
    return this._structure;
  }
  set structure(st: PBStructTypeInfo) {
    if (st && !st.isCompatibleType(this._structure)) {
      const layout = st.toBufferLayout(0, st.layout);
      if (layout.byteSize > this.byteLength) {
        throw new Error(`set structure type failed: new structure type is too large: ${layout.byteSize}`);
      }
      this._data = new StructuredBufferData(layout, this);
      this._structure = st;
    }
  }
  static getGPUVertexFormat(type: PBTypeInfo): GPUVertexFormat {
    return vertexFormatTable[type.typeId];
  }
}
