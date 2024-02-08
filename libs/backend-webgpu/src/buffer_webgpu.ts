import type { GPUDataBuffer } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import type { UploadBuffer } from './uploadringbuffer';
import { UploadRingBuffer } from './uploadringbuffer';
import type { TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export class WebGPUBuffer extends WebGPUObject<GPUBuffer> implements GPUDataBuffer<GPUBuffer> {
  private _size: number;
  private _usage: number;
  private _gpuUsage: number;
  private _memCost: number;
  private _ringBuffer: UploadRingBuffer;
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
  get hash(): number {
    return this._object ? this._device.gpuGetObjectHash(this._object) : 0;
  }
  get byteLength() {
    return this._size;
  }
  get usage(): number {
    return this._usage;
  }
  get gpuUsage(): number {
    return this._gpuUsage;
  }
  getPendingUploads(): UploadBuffer[] {
    return this._pendingUploads;
  }
  clearPendingUploads() {
    if (this._pendingUploads.length > 0) {
      this._pendingUploads = [];
      this.beginSyncChanges(null);
      this.endSyncChanges();
    }
  }
  bufferSubData(dstByteOffset: number, data: TypedArray, srcOffset?: number, srcLength?: number): void {
    srcOffset = Number(srcOffset) || 0;
    dstByteOffset = Number(dstByteOffset) || 0;
    srcLength = Number(srcLength) || data.length - srcOffset;
    if (srcOffset + srcLength > data.length) {
      throw new Error('bufferSubData() failed: source buffer is too small');
    }
    if (dstByteOffset + srcLength * data.BYTES_PER_ELEMENT > this.byteLength) {
      throw new Error('bufferSubData() failed: dest buffer is too small');
    }
    let uploadSize = srcLength * data.BYTES_PER_ELEMENT;
    if ((dstByteOffset & 3) !== 0 || (uploadSize & 3) !== 0) {
      throw new Error(
        'bufferSubData() failed: destination byte offset or upload size must be 4 bytes aligned'
      );
    }
    const uploadOffset = data.byteOffset + srcOffset * data.BYTES_PER_ELEMENT;
    const writeOffset = dstByteOffset;
    const writeSize = uploadSize;
    if (this._pendingUploads.length === 0) {
      this.pushUpload(this._pendingUploads, data.buffer, uploadOffset, dstByteOffset, uploadSize);
    } else {
      let newPendings: UploadBuffer[] = [];
      let added = false;
      for (let i = 0; i < this._pendingUploads.length; i++) {
        const upload = this._pendingUploads[i];
        if (upload.uploadOffset + upload.uploadSize < dstByteOffset) {
          // current upload in front of new upload
          newPendings.push(upload);
        } else if (upload.uploadOffset > dstByteOffset + uploadSize) {
          // current upload behind of new upload
          if (!added) {
            added = true;
            this.pushUpload(newPendings, null, 0, dstByteOffset, uploadSize);
          }
          newPendings.push(upload);
        } else {
          const start = Math.min(dstByteOffset, upload.uploadOffset);
          const end = Math.max(dstByteOffset + uploadSize, upload.uploadOffset + upload.uploadSize);
          if (
            end - start < uploadSize + upload.uploadSize &&
            this._device.currentPass?.isBufferUploading(this)
          ) {
            // data overlaps and previous data is in use, refresh data by restarting current render pass or compute pass
            this._device.currentPass.end();
            // now, the pending uploads should be cleared
            newPendings = [];
            break;
          }
          dstByteOffset = start;
          uploadSize = end - start;
        }
      }
      if (!added) {
        this.pushUpload(newPendings, null, 0, dstByteOffset, uploadSize);
      }
      this._pendingUploads = newPendings;
      new Uint8Array(this._pendingUploads[0].mappedBuffer.mappedRange, writeOffset, writeSize).set(
        new Uint8Array(data.buffer, uploadOffset, writeSize)
      );
    }
  }
  async getBufferSubData(
    dstBuffer?: Uint8Array,
    offsetInBytes?: number,
    sizeInBytes?: number
  ): Promise<Uint8Array> {
    if (!(this._usage & GPUResourceUsageFlags.BF_READ)) {
      throw new Error('getBufferSubData() failed: buffer does not have BF_READ flag set');
    }
    this.sync();
    offsetInBytes = Number(offsetInBytes) || 0;
    sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
    if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
      throw new Error('data query range out of bounds');
    }
    if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
      throw new Error('no enough space for querying buffer data');
    }
    dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
    await this._object.mapAsync(GPUMapMode.READ);
    const range = this._object.getMappedRange();
    dstBuffer.set(new Uint8Array(range, offsetInBytes, sizeInBytes));
    this._object.unmap();
    return dstBuffer;
  }
  async restore() {
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
  isBuffer(): boolean {
    return true;
  }
  beginSyncChanges(encoder: GPUCommandEncoder) {
    if (this._pendingUploads.length > 0) {
      const cmdEncoder = encoder || this._device.device.createCommandEncoder();
      for (const upload of this._pendingUploads) {
        cmdEncoder.copyBufferToBuffer(
          upload.mappedBuffer.buffer,
          upload.mappedBuffer.offset,
          this._object,
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
  private load(data?: TypedArray): void {
    if (this._device.isContextLost()) {
      return;
    }
    this._memCost = 0;
    if (!this._device.isContextLost()) {
      if (!this._object) {
        this._gpuUsage = 0;
        let label = '';
        if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
          this._gpuUsage |= GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
          label += '[vertex]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
          this._gpuUsage |= GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
          label += '[index]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
          this._gpuUsage |= GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
          label += '[uniform]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_STORAGE) {
          this._gpuUsage |= GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
          label += '[storage]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_READ) {
          this._gpuUsage |= GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
          label += '[mapRead]';
        }
        if (this._usage & GPUResourceUsageFlags.BF_WRITE) {
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
      if (this._device.isBufferUploading(this)) {
        this._device.currentPass.end();
      } else {
        this.beginSyncChanges(null);
        this.endSyncChanges();
      }
    }
  }
  private pushUpload(
    pending: UploadBuffer[],
    data: ArrayBuffer,
    srcByteOffset: number,
    dstByteOffset: number,
    byteSize: number
  ) {
    const bufferMapped = this._ringBuffer.fetchBufferMapped(byteSize, true);
    if (data) {
      new Uint8Array(bufferMapped.mappedRange, dstByteOffset, byteSize).set(
        new Uint8Array(data, srcByteOffset, byteSize)
      );
    }
    pending.push({
      mappedBuffer: {
        buffer: bufferMapped.buffer,
        size: bufferMapped.size,
        offset: dstByteOffset,
        used: bufferMapped.used,
        mappedRange: bufferMapped.mappedRange
      },
      uploadSize: byteSize,
      uploadOffset: dstByteOffset,
      uploadBuffer: this._object
    });
  }
}
