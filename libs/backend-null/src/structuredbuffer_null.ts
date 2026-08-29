import type { Immutable, TypedArray } from '@zephyr3d/base';
import type { PBStructTypeInfo, PBTypeInfo, StructuredBuffer, StructuredValue } from '@zephyr3d/device';
import { GPUResourceUsageFlags, PBPrimitiveType, StructuredBufferData } from '@zephyr3d/device';
import { NullGPUBuffer } from './buffer_null';
import type { NullDevice } from './device_null';

/**
 * Structured buffer of a null device
 * @public
 */
export class NullStructuredBuffer extends NullGPUBuffer implements StructuredBuffer<unknown> {
  /** @internal */
  private _structure: PBStructTypeInfo;
  /** @internal */
  private _data: StructuredBufferData;
  constructor(
    device: NullDevice,
    structure: Immutable<PBStructTypeInfo>,
    usage: number,
    source?: TypedArray
  ) {
    if (!structure?.isStructType()) {
      throw new Error('invalid structure type');
    }
    if (usage & GPUResourceUsageFlags.BF_INDEX) {
      throw new Error('structured buffer must not have Index usage flag');
    }
    if (usage & GPUResourceUsageFlags.BF_VERTEX) {
      if (structure.structMembers.length !== 1 || !structure.structMembers[0].type.isArrayType()) {
        throw new Error('structured buffer for vertex usage must have only one array member');
      }
      if (!NullStructuredBuffer.isValidArrayElementType(structure.structMembers[0].type.elementType)) {
        throw new Error('invalid vertex data type when creating vertex buffer');
      }
    }
    const layout = (structure as PBStructTypeInfo).toBufferLayout(0, structure.layout)!;
    if (source && layout.byteSize !== source.byteLength) {
      throw new Error(
        `create structured buffer failed: invalid source size: ${source.byteLength}, should be ${layout.byteSize}`
      );
    }
    super(device, usage, source || layout.byteSize);
    this._data = new StructuredBufferData(layout, this);
    this._structure = structure as PBStructTypeInfo;
  }
  get structure(): Immutable<PBStructTypeInfo> {
    return this._structure;
  }
  set structure(st: PBStructTypeInfo) {
    if (st && !st.isCompatibleType(this._structure)) {
      const layout = st.toBufferLayout(0, st.layout)!;
      if (layout.byteSize > this.byteLength) {
        throw new Error(`set structure type failed: new structure type is too large: ${layout.byteSize}`);
      }
      this._data = new StructuredBufferData(layout, this);
      this._structure = st;
    }
  }
  set(name: string, value: StructuredValue) {
    this._data.set(name, value);
  }
  /** The structured data view over this buffer */
  getUniformData() {
    return this._data;
  }
  /** @internal */
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
