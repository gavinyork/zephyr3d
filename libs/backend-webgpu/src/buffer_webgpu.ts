import type { GPUDataBuffer } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import type { UploadBuffer } from './uploadringbuffer';
import { UploadRingBuffer } from './uploadringbuffer';
import type { Nullable, TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export class WebGPUBuffer extends WebGPUObject<GPUBuffer> implements GPUDataBuffer<GPUBuffer> {
  private readonly _size: number;
  private readonly _usage: number;
  private _gpuUsage: number;
  private _memCost: number;
  private readonly _ringBuffer: UploadRingBuffer;
  protected _pendingUploads: UploadBuffer[];
  constructor(device: WebGPUDevice, usage: number, data: TypedArray | number) {
    super(device);
    this._object = null;
    this._memCost = 0;
    this._usage = usage;
    this._gpuUsage = 0;
    this._size = typeof data === 'number' ? data : data.byteLength;
    if (this._size <= 0) {
      throw new Error('can not create buffer with zero size');
    }
    this._ringBuffer = new UploadRingBuffer(device, (this._size + 15) & ~15);
    this._pendingUploads = [];
    this.load(typeof data === 'number' ? null : data);
  }
  get hash() {
    return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
  }
  get byteLength() {
    return this._size;
  }
  get usage() {
    return this._usage;
  }
  get gpuUsage() {
    return this._gpuUsage;
  }
  private searchInsertPosition(dstByteOffset: number) {
    let left = 0;
    let right = this._pendingUploads.length - 1;
    let insertIndex = this._pendingUploads.length;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const upload = this._pendingUploads[mid];
      if (upload.uploadOffset < dstByteOffset) {
        left = mid + 1;
      } else {
        insertIndex = mid;
        right = mid - 1;
      }
    }
    return insertIndex;
  }
  bufferSubData(dstByteOffset: number, data: TypedArray, srcOffset?: number, srcLength?: number) {
    srcOffset = Number(srcOffset) || 0;
    dstByteOffset = Number(dstByteOffset) || 0;
    srcLength = Number(srcLength) || data.length - srcOffset;
    if (srcOffset + srcLength > data.length) {
      throw new Error('bufferSubData() failed: source buffer is too small');
    }
    if (dstByteOffset + srcLength * data.BYTES_PER_ELEMENT > this.byteLength) {
      throw new Error('bufferSubData() failed: dest buffer is too small');
    }
    const uploadSize = srcLength * data.BYTES_PER_ELEMENT;
    if ((dstByteOffset & 3) !== 0 || (uploadSize & 3) !== 0) {
      throw new Error(
        'bufferSubData() failed: destination byte offset or upload size must be 4 bytes aligned'
      );
    }
    const uploadOffset = data.byteOffset + srcOffset * data.BYTES_PER_ELEMENT;
    const insertIndex = this.searchInsertPosition(dstByteOffset);
    if (insertIndex < this._pendingUploads.length) {
      const upload = this._pendingUploads[insertIndex];
      if (
        upload.uploadOffset < dstByteOffset + uploadSize &&
        upload.uploadOffset + upload.uploadSize > dstByteOffset
      ) {
        // Flush if overlapped
        this._device.bufferUpload(this);
      }
    }
    let commit = false;
    if (this._pendingUploads.length === 0) {
      this.pushUpload(dstByteOffset, uploadSize, 0);
      commit = true;
    } else {
      let start = dstByteOffset;
      let end = dstByteOffset + uploadSize;
      while (insertIndex < this._pendingUploads.length) {
        const upload = this._pendingUploads[insertIndex];
        const uploadStart = upload.uploadOffset;
        const uploadEnd = uploadStart + upload.uploadSize;
        if (uploadStart < end && uploadEnd > start) {
          start = Math.min(start, uploadStart);
          end = Math.max(end, uploadEnd);
          this._pendingUploads.splice(insertIndex, 1);
        } else {
          break;
        }
      }
      this.pushUpload(start, end - start, insertIndex);
    }
    new Uint8Array(this._pendingUploads[0].mappedBuffer.mappedRange!, dstByteOffset, uploadSize).set(
      new Uint8Array(data.buffer, uploadOffset, uploadSize)
    );
    if (commit) {
      this._device.bufferUpload(this);
    }
  }
  async getBufferSubData(
    dstBuffer?: Nullable<Uint8Array<ArrayBuffer>>,
    offsetInBytes?: number,
    sizeInBytes?: number
  ) {
    let sourceBuffer: GPUDataBuffer = this;
    offsetInBytes = Number(offsetInBytes) || 0;
    sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
    if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
      throw new Error('data query range out of bounds');
    }
    if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
      throw new Error('no enough space for querying buffer data');
    }
    if (!(this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_PACK_PIXEL))) {
      if (this._gpuUsage & GPUBufferUsage.COPY_SRC) {
        sourceBuffer = this._device.createBuffer(sizeInBytes, { usage: 'read' });
        this.sync();
        this._device.copyBuffer(this, sourceBuffer, offsetInBytes, 0, sizeInBytes);
      } else {
        throw new Error('getBufferSubData() failed: buffer does not have BF_READ or BF_PACK_PIXEL flag set');
      }
    } else {
      this.sync();
    }
    const buffer = sourceBuffer.object as GPUBuffer;
    await buffer.mapAsync(GPUMapMode.READ);
    const range = buffer.getMappedRange();
    dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
    dstBuffer.set(new Uint8Array(range, offsetInBytes, sizeInBytes));
    buffer.unmap();

    if (sourceBuffer !== this) {
      sourceBuffer.dispose();
    }

    return dstBuffer;
  }
  restore() {
    if (!this._device.isContextLost()) {
      this.load();
    }
  }
  destroy() {
    if (this._object) {
      this._object.destroy();
      this._object = null;
      this._gpuUsage = 0;
      this._memCost = 0;
    }
  }
  isBuffer(): this is GPUDataBuffer {
    return true;
  }
  beginSyncChanges(encoder: GPUCommandEncoder) {
    if (this._pendingUploads.length > 0) {
      const cmdEncoder = encoder || this._device.device.createCommandEncoder();
      for (const upload of this._pendingUploads) {
        cmdEncoder.copyBufferToBuffer(
          upload.mappedBuffer.buffer,
          upload.mappedBuffer.offset,
          this._object!,
          upload.uploadOffset,
          upload.uploadSize
        );
      }
      if (!encoder) {
        this._device.device.queue.submit([cmdEncoder.finish()]);
      }
      this._pendingUploads.length = 0;
      this._ringBuffer.beginUploads();
    }
  }
  endSyncChanges() {
    if (this._usage & GPUResourceUsageFlags.DYNAMIC) {
      this._ringBuffer.endUploads();
    } else {
      this._ringBuffer.purge();
    }
  }
  private load(data?: Nullable<TypedArray>) {
    if (this._device.isContextLost()) {
      return;
    }
    this._memCost = 0;
    if (!this._device.isContextLost()) {
      if (!this._object) {
        this._gpuUsage = 0;
        let label = '';
        if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
          this._gpuUsage |= GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
          label += '[vertex]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
          this._gpuUsage |= GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
          label += '[index]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
          this._gpuUsage |= GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
          label += '[uniform]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_STORAGE) {
          this._gpuUsage |= GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
          label += '[storage]';
        }
        if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_PACK_PIXEL)) {
          this._gpuUsage |= GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
          label += '[mapRead]';
        }
        if (this._usage & (GPUResourceUsageFlags.BF_WRITE | GPUResourceUsageFlags.BF_UNPACK_PIXEL)) {
          this._gpuUsage |= GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE;
          label += '[mapWrite]';
        }
        if (data) {
          this._object = this._device.gpuCreateBuffer({
            label: label,
            size: (data.byteLength + 15) & ~15,
            usage: this._gpuUsage,
            mappedAtCreation: true
          });
          const range = this._object.getMappedRange();
          new (data.constructor as TypedArrayConstructor)(range).set(data);
          this._object.unmap();
        } else {
          this._object = this._device.gpuCreateBuffer({
            label: label,
            size: (this.byteLength + 15) & ~15,
            usage: this._gpuUsage
          });
        }
        const memCost = this.byteLength;
        this._device.updateVideoMemoryCost(memCost - this._memCost);
        this._memCost = memCost;
      }
    }
  }
  private sync() {
    if (this._pendingUploads) {
      this._device.flushUploads();
    }
  }
  private pushUpload(dstByteOffset: number, byteSize: number, insertIndex: number) {
    const bufferMapped = this._ringBuffer.fetchBufferMapped(byteSize, true);
    this._pendingUploads.splice(insertIndex, 0, {
      mappedBuffer: {
        buffer: bufferMapped.buffer,
        size: bufferMapped.size,
        offset: dstByteOffset,
        used: bufferMapped.used,
        mappedRange: bufferMapped.mappedRange
      },
      uploadSize: byteSize,
      uploadOffset: dstByteOffset,
      uploadBuffer: this._object!
    });
  }
}
