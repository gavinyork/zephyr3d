import { WebGLGPUBuffer } from './buffer_webgl';
import type { StructuredBuffer, StructuredValue, PBTypeInfo, PBStructTypeInfo } from '@zephyr3d/device';
import { StructuredBufferData, GPUResourceUsageFlags, PBPrimitiveType } from '@zephyr3d/device';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';

export class WebGLStructuredBuffer extends WebGLGPUBuffer implements StructuredBuffer {
  private _structure: PBStructTypeInfo;
  private _data: StructuredBufferData;
  constructor(device: WebGLDevice, structure: PBStructTypeInfo, usage: number, source?: TypedArray) {
    if (!structure?.isStructType()) {
      throw new Error('invalid structure type');
    }
    if (usage & GPUResourceUsageFlags.BF_INDEX) {
      throw new Error('structured buffer must not have Index usage flag');
    }
    if (usage & GPUResourceUsageFlags.BF_READ || usage & GPUResourceUsageFlags.BF_WRITE) {
      throw new Error('structured buffer must not have Read or Write usage flags');
    }
    if (usage & GPUResourceUsageFlags.BF_VERTEX) {
      if (structure.structMembers.length !== 1 || !structure.structMembers[0].type.isArrayType()) {
        throw new Error('structured buffer for vertex usage must have only one array member');
      }
      if (!WebGLStructuredBuffer.isValidArrayElementType(structure.structMembers[0].type.elementType)) {
        throw new Error('invalid vertex data type when creating vertex buffer');
      }
    }
    const layout = structure.toBufferLayout(0, structure.layout);
    if (source && layout.byteSize !== source.byteLength) {
      throw new Error(
        `create structured buffer failed: invalid source size: ${source.byteLength}, should be ${layout.byteSize}`
      );
    }
    const useSystemMemory = !device.isWebGL2 && (usage & GPUResourceUsageFlags.BF_UNIFORM) !== 0;
    super(device, usage, source || layout.byteSize, useSystemMemory);
    this._data = new StructuredBufferData(layout, useSystemMemory ? this.systemMemoryBuffer : this);
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
  getUniformData(): StructuredBufferData {
    return this._data;
  }
  private static isValidArrayElementType(type: PBTypeInfo) {
    if (type.isPrimitiveType()) {
      return type.scalarType !== PBPrimitiveType.BOOL && !type.isMatrixType();
    } else if (type.isStructType()) {
      for (const member of type.structMembers) {
        if (
          !member.type.isPrimitiveType() ||
          member.type.scalarType === PBPrimitiveType.BOOL ||
          member.type.isMatrixType()
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
}
