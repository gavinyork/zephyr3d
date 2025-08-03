import { PBPrimitiveType } from './builder/types';
import type { TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import type { StructuredValue, UniformBufferLayout, StructuredBuffer } from './gpuobject';

/**
 * Structured buffer data
 * @public
 */
export class StructuredBufferData {
  /** @internal */
  protected _cache: ArrayBuffer;
  /** @internal */
  protected _buffer: StructuredBuffer;
  /** @internal */
  protected _size: number;
  /** @internal */
  protected _uniformMap: Record<string, TypedArray>;
  /** @internal */
  protected _uniformPositions: Record<string, [number, number]>;
  /**
   * Creates a new structured buffer data
   * @param layout - Layout of the structure
   * @param buffer - Buffer that holds the data
   */
  constructor(layout: UniformBufferLayout, buffer?: StructuredBuffer | ArrayBuffer) {
    this._size = (layout.byteSize + 15) & ~15;
    if (this._size <= 0) {
      throw new Error(`UniformBuffer(): invalid uniform buffer byte size: ${this._size}`);
    }
    // this._cache = new ArrayBuffer(size);
    this._uniformMap = {};
    this._uniformPositions = {};
    this._cache = buffer instanceof ArrayBuffer ? buffer : null;
    this._buffer = buffer instanceof ArrayBuffer ? null : buffer;
    this.init(layout, 0, '');
  }
  /** The buffer size in bytes */
  get byteLength(): number {
    return this._size;
  }
  /** Get the data cache buffer */
  get buffer(): ArrayBuffer {
    return this._cache;
  }
  /** Get all the uniform datas */
  get uniforms(): Record<string, TypedArray> {
    return this._uniformMap;
  }
  /**
   * Sets the value of a structure member
   * @param name - Name of the member
   * @param value - Value to set
   */
  set(name: string, value: StructuredValue): void {
    if (value !== undefined) {
      const view = this._uniformMap[name];
      if (view) {
        if (this._cache) {
          if (typeof value === 'number') {
            view[0] = value;
          } else if ((value as any)?._v) {
            view.set((value as any)._v);
          } else if (typeof (value as any)?.length === 'number') {
            view.set(value as any);
          } else {
            throw new Error('invalid uniform value');
          }
        } else {
          const size = this._uniformPositions[name][1];
          if (typeof value === 'number') {
            view[0] = value;
            this._buffer.bufferSubData(this._uniformPositions[name][0], view);
          } else if (value['BYTES_PER_ELEMENT'] && size <= (value['byteLength'] as number)) {
            const arr = value as TypedArray;
            this._buffer.bufferSubData(
              this._uniformPositions[name][0],
              arr,
              0,
              (size / arr.BYTES_PER_ELEMENT) >> 0
            );
          } else {
            throw new Error('invalid uniform value');
          }
        }
      } else {
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.getPrototypeOf({})) {
          this.setStruct(name, value);
        } else {
          throw new Error('invalid uniform value');
        }
      }
    }
  }
  /** @internal */
  private setStruct(name: string, value: any): void {
    for (const k in value) {
      this.set(`${name}.${k}`, value[k]);
    }
  }
  /** @internal */
  private init(layout: UniformBufferLayout, offset: number, prefix: string): number {
    for (const entry of layout.entries) {
      if (entry.subLayout) {
        offset = this.init(entry.subLayout, offset, `${prefix}${entry.name}.`);
      } else {
        const name = `${prefix}${entry.name}`;
        if (this._uniformPositions[name]) {
          throw new Error(`UniformBuffer(): duplicate uniform name: ${name}`);
        }
        if (entry.offset < offset || entry.byteSize < 0) {
          throw new Error('UniformBuffer(): invalid layout');
        }
        this._uniformPositions[name] = [entry.offset, entry.byteSize];
        let viewCtor: TypedArrayConstructor = null;
        switch (entry.type) {
          case PBPrimitiveType.F32:
            viewCtor = Float32Array;
            break;
          case PBPrimitiveType.U32:
          case PBPrimitiveType.BOOL:
            viewCtor = Uint32Array;
            break;
          case PBPrimitiveType.I32:
            viewCtor = Int32Array;
            break;
          case PBPrimitiveType.U16:
          case PBPrimitiveType.U16_NORM:
          case PBPrimitiveType.F16:
            viewCtor = Uint16Array;
            break;
          case PBPrimitiveType.I16:
          case PBPrimitiveType.I16_NORM:
            viewCtor = Int16Array;
            break;
          case PBPrimitiveType.U8:
          case PBPrimitiveType.U8_NORM:
            viewCtor = Uint8Array;
            break;
          case PBPrimitiveType.I8:
          case PBPrimitiveType.I8_NORM:
            viewCtor = Int8Array;
            break;
        }
        if (!viewCtor) {
          throw new Error(`UniformBuffer(): invalid data type for uniform: ${name}`);
        }
        if (entry.byteSize % viewCtor.BYTES_PER_ELEMENT) {
          throw new Error(`UniformBuffer(): invalid byte size for uniform: ${name}`);
        }
        if (this._cache) {
          this._uniformMap[name] = new viewCtor(
            this._cache,
            entry.offset,
            entry.byteSize / viewCtor.BYTES_PER_ELEMENT
          );
        } else {
          this._uniformMap[name] = new viewCtor(1);
        }
        offset = entry.offset + entry.byteSize;
      }
    }
    return offset;
  }
}
