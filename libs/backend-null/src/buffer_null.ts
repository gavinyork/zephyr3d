import type { Nullable, TypedArray } from '@zephyr3d/base';
import type { GPUDataBuffer, IndexBuffer } from '@zephyr3d/device';
import { GPUResourceUsageFlags, PBPrimitiveType, PBPrimitiveTypeInfo } from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);

/**
 * GPU buffer of a null device
 *
 * @remarks
 * The buffer content is stored in system memory, so writes made through
 * {@link NullGPUBuffer.bufferSubData} are observable through
 * {@link NullGPUBuffer.getBufferSubData} exactly like on a real device.
 *
 * @public
 */
export class NullGPUBuffer extends NullGPUObject<unknown> implements GPUDataBuffer<unknown> {
  protected _size: number;
  protected _usage: number;
  protected _memory: Uint8Array<ArrayBuffer>;
  protected _memCost: number;
  constructor(device: NullDevice, usage: number, data: TypedArray | number) {
    super(device);
    if (usage & GPUResourceUsageFlags.BF_VERTEX && usage & GPUResourceUsageFlags.BF_INDEX) {
      throw new Error('buffer usage must not have Vertex and Index simultaneously');
    }
    if (usage & GPUResourceUsageFlags.DYNAMIC && usage & GPUResourceUsageFlags.MANAGED) {
      throw new Error('buffer usage DYNAMIC and MANAGED can not be both set');
    }
    this._usage = usage;
    this._size = typeof data === 'number' ? data : data.byteLength;
    if (this._size <= 0) {
      throw new Error('can not create buffer with zero size');
    }
    this._memory = new Uint8Array(this._size);
    if (typeof data !== 'number') {
      this._memory.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    this._memCost = this._size;
    this._object = this._createFakeObject();
    this._device.updateVideoMemoryCost(this._memCost);
  }
  get byteLength() {
    return this._size;
  }
  get usage() {
    return this._usage;
  }
  /** The system memory holding the buffer content */
  get memory(): Uint8Array<ArrayBuffer> {
    return this._memory;
  }
  bufferSubData(dstByteOffset: number, data: TypedArray, srcPos?: number, srcLength?: number) {
    srcPos = Number(srcPos) || 0;
    dstByteOffset = Number(dstByteOffset) || 0;
    srcLength = Number(srcLength) || data.length - srcPos;
    if (srcPos + srcLength > data.length) {
      throw new Error('bufferSubData() failed: source buffer is too small');
    }
    if (dstByteOffset + srcLength * data.BYTES_PER_ELEMENT > this.byteLength) {
      throw new Error('bufferSubData() failed: dest buffer is too small');
    }
    if (this.disposed) {
      this.reload();
    }
    this._memory.set(
      new Uint8Array(
        data.buffer,
        data.byteOffset + srcPos * data.BYTES_PER_ELEMENT,
        srcLength * data.BYTES_PER_ELEMENT
      ),
      dstByteOffset
    );
  }
  async getBufferSubData(
    dstBuffer?: Nullable<Uint8Array<ArrayBuffer>>,
    offsetInBytes?: number,
    sizeInBytes?: number
  ) {
    if (this.disposed) {
      this.reload();
    }
    offsetInBytes = Number(offsetInBytes) || 0;
    sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
    if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
      throw new Error('data query range out of bounds');
    }
    if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
      throw new Error('no enough space for querying buffer data');
    }
    dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
    dstBuffer.set(new Uint8Array(this._memory.buffer, offsetInBytes, sizeInBytes));
    return dstBuffer;
  }
  isBuffer(): this is GPUDataBuffer {
    return true;
  }
  destroy() {
    if (this._object) {
      this._object = null;
      this._device.updateVideoMemoryCost(-this._memCost);
      this._memCost = 0;
    }
  }
  restore() {
    if (!this._object) {
      this._object = this._createFakeObject();
      this._memCost = this._size;
      this._device.updateVideoMemoryCost(this._memCost);
    }
  }
}

/**
 * Index buffer of a null device
 * @public
 */
export class NullIndexBuffer extends NullGPUBuffer implements IndexBuffer<unknown> {
  readonly indexType: PBPrimitiveTypeInfo;
  readonly length: number;
  constructor(device: NullDevice, data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, usage?: number) {
    if (!(data instanceof Uint16Array) && !(data instanceof Uint32Array)) {
      throw new Error('invalid index data');
    }
    super(device, GPUResourceUsageFlags.BF_INDEX | (usage ?? 0), data);
    this.indexType = data instanceof Uint16Array ? typeU16 : typeU32;
    this.length = data.length;
  }
}
