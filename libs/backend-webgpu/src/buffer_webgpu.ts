import type { GPUDataBuffer } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import { UploadRingBuffer } from './uploadringbuffer';
import type { Nullable, TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';
import type { MappedBuffer } from './uploadringbuffer';

type PendingUploadRange = {
  offset: number;
  size: number;
};

export class WebGPUBuffer extends WebGPUObject<GPUBuffer> implements GPUDataBuffer<GPUBuffer> {
  private readonly _size: number;
  private readonly _usage: number;
  private _gpuUsage: number;
  private _memCost: number;
  private readonly _ringBuffer: UploadRingBuffer;
  protected _pendingUploads: PendingUploadRange[];
  private _pendingUploadBuffer: Nullable<MappedBuffer>;
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
    this._pendingUploadBuffer = null;
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
  private mergePendingUpload(offset: number, size: number) {
    let start = offset;
    let end = offset + size;
    let insertIndex = this._pendingUploads.length;
    for (let i = 0; i < this._pendingUploads.length; i++) {
      const pending = this._pendingUploads[i];
      const pendingEnd = pending.offset + pending.size;
      if (pending.offset > end) {
        insertIndex = i;
        break;
      }
      if (pendingEnd >= start && pending.offset <= end) {
        start = Math.min(start, pending.offset);
        end = Math.max(end, pendingEnd);
        this._pendingUploads.splice(i, 1);
        i--;
        insertIndex = i + 1;
      }
    }
    this._pendingUploads.splice(insertIndex, 0, {
      offset: start,
      size: end - start
    });
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
    // Resolve segment ownership before mutating the shared staging page. If this
    // upload has to start a new segment, the previous segment must snapshot its
    // pending uploads against the old staging contents first.
    this._device.bufferUpload(this, dstByteOffset, uploadSize);
    this._pendingUploadBuffer ??= this._ringBuffer.fetchBufferMapped((this.byteLength + 15) & ~15);
    new Uint8Array(this._pendingUploadBuffer.mappedRange!, dstByteOffset, uploadSize).set(
      new Uint8Array(data.buffer, uploadOffset, uploadSize)
    );
    this.mergePendingUpload(dstByteOffset, uploadSize);
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
    let readOffsetInBytes = offsetInBytes;
    if (!(this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_PACK_PIXEL))) {
      if (this._gpuUsage & GPUBufferUsage.COPY_SRC) {
        const copyOffsetInBytes = offsetInBytes & ~3;
        readOffsetInBytes = offsetInBytes - copyOffsetInBytes;
        const copySizeInBytes = (readOffsetInBytes + sizeInBytes + 3) & ~3;
        sourceBuffer = this._device.createBuffer(copySizeInBytes, { usage: 'read' });
        this._device.copyBuffer(this, sourceBuffer, copyOffsetInBytes, 0, copySizeInBytes);
        this._device.flush();
      } else {
        throw new Error('getBufferSubData() failed: buffer does not have BF_READ or BF_PACK_PIXEL flag set');
      }
    } else {
      this.sync();
      // The staging buffer is filled by a copy encoded into the current command stream
      // (e.g. a texture readback) which has not been submitted yet. Ensure that submit
      // happens before mapping, otherwise mapAsync could resolve against stale contents.
      // Inside a render frame the copy rides the normal end-of-frame submit; for standalone
      // readbacks (outside any frame) scheduleAutoFlush guarantees a submit still occurs.
      this._device.scheduleAutoFlush();
      await this._device.commandQueue.onNextSubmit();
    }
    const buffer = sourceBuffer.object as GPUBuffer;
    await buffer.mapAsync(GPUMapMode.READ);
    const range = buffer.getMappedRange();
    dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
    dstBuffer.set(new Uint8Array(range, readOffsetInBytes, sizeInBytes));
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
    // Release staging buffers owned by this dynamic buffer as well. Without
    // this, pending mapAsync() operations can retain orphaned GPUBuffer
    // objects after the owner has been disposed.
    this._ringBuffer.purge();
    if (this._object) {
      this._device.gpuRemoveObjectHash(this._object);
      this._object.destroy();
      this._object = null;
      this._gpuUsage = 0;
      this._memCost = 0;
      this._pendingUploadBuffer = null;
      this._pendingUploads.length = 0;
    }
  }
  isBuffer(): this is GPUDataBuffer {
    return true;
  }
  beginSyncChanges(encoder: GPUCommandEncoder) {
    if (this._pendingUploads.length > 0) {
      if (!this._object || !this._pendingUploadBuffer) {
        this._pendingUploads.length = 0;
        this._pendingUploadBuffer = null;
        this._ringBuffer.beginUploads();
        return;
      }
      const cmdEncoder = encoder || this._device.device.createCommandEncoder();
      for (const upload of this._pendingUploads) {
        cmdEncoder.copyBufferToBuffer(
          this._pendingUploadBuffer.buffer,
          upload.offset,
          this._object!,
          upload.offset,
          upload.size
        );
      }
      if (!encoder) {
        this._device.device.queue.submit([cmdEncoder.finish()]);
      }
      this._pendingUploads.length = 0;
      this._pendingUploadBuffer = null;
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
        if (this._usage & GPUResourceUsageFlags.BF_INDIRECT) {
          this._gpuUsage |= GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
          label += '[indirect]';
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
    if (this._pendingUploads.length > 0) {
      this._device.flush();
    }
  }
}
