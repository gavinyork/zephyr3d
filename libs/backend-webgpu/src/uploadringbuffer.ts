import type { Nullable } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export interface MappedBuffer {
  buffer: GPUBuffer;
  size: number;
  offset: number;
  used: boolean;
  mappedRange: Nullable<ArrayBuffer>;
  destroyed: boolean;
}

export interface UploadBuffer {
  mappedBuffer: MappedBuffer;
  uploadSize: number;
  uploadBuffer: Nullable<GPUBuffer>;
  uploadOffset: number;
}

export interface UploadImage {
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  srcX: number;
  srcY: number;
  srcZ: number;
  width: number;
  height: number;
  depth: number;
  mipLevel: number;
  image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
}

export interface UploadTexture {
  mappedBuffer: MappedBuffer;
  uploadOffsetX: number;
  uploadOffsetY: number;
  uploadOffsetZ: number;
  uploadWidth: number;
  uploadHeight: number;
  uploadDepth: number;
  bufferStride: number;
  mipLevel: number;
}

export class UploadRingBuffer {
  private readonly _device: WebGPUDevice;
  private _bufferList: MappedBuffer[];
  private readonly _defaultSize: number;
  private _unmappedBufferList: MappedBuffer[];
  /** Buffers waiting for mapAsync() after a submitted upload. */
  private _pendingMapBuffers: Set<MappedBuffer>;
  constructor(device: WebGPUDevice, defaultSize = 64 * 1024) {
    this._device = device;
    this._bufferList = [];
    this._defaultSize = defaultSize;
    this._unmappedBufferList = [];
    this._pendingMapBuffers = new Set();
  }
  uploadBuffer(
    src: Nullable<ArrayBuffer>,
    dst: Nullable<GPUBuffer>,
    srcOffset: number,
    dstOffset: number,
    uploadSize: number
  ) {
    const size = (uploadSize + 3) & ~3;
    const mappedBuffer = this.fetchBufferMapped(size);
    if (src) {
      const mappedRange = mappedBuffer.mappedRange; //mappedBuffer.buffer.getMappedRange(mappedBuffer.offset, size);
      new Uint8Array(mappedRange!, mappedBuffer.offset, size).set(new Uint8Array(src, srcOffset, uploadSize));
    }
    const upload = {
      mappedBuffer: { ...mappedBuffer },
      uploadSize: size,
      uploadBuffer: dst,
      uploadOffset: dstOffset
    };
    mappedBuffer.offset += size;
    mappedBuffer.offset = (mappedBuffer.offset + 7) & ~7;
    return upload;
  }
  beginUploads() {
    for (let i = this._bufferList.length - 1; i >= 0; i--) {
      const buffer = this._bufferList[i];
      if (buffer.used) {
        buffer.buffer.unmap();
        this._unmappedBufferList.push(buffer);
        this._bufferList.splice(i, 1);
        buffer.mappedRange = null;
      }
    }
    return this._unmappedBufferList.length;
  }
  endUploads() {
    for (const buffer of this._unmappedBufferList) {
      this._pendingMapBuffers.add(buffer);
      buffer.buffer
        .mapAsync(GPUMapMode.WRITE)
        .then(() => {
          this._pendingMapBuffers.delete(buffer);
          // The owner may have been disposed while mapAsync was pending.
          if (buffer.destroyed) {
            return;
          }
          buffer.offset = 0;
          buffer.used = false;
          buffer.mappedRange = buffer.buffer.getMappedRange();
          this._bufferList.push(buffer);
        })
        .catch(() => {
          this._pendingMapBuffers.delete(buffer);
          this.destroyBuffer(buffer);
        });
    }
    this._unmappedBufferList = [];
  }
  purge() {
    for (let i = this._bufferList.length - 1; i >= 0; i--) {
      const buffer = this._bufferList[i];
      if (buffer.mappedRange) {
        buffer.buffer.unmap();
      }
      this.destroyBuffer(buffer);
    }
    this._bufferList = [];
    for (const buffer of this._unmappedBufferList) {
      this.destroyBuffer(buffer);
    }
    this._unmappedBufferList = [];
    // mapAsync() cannot be cancelled, but destroying these buffers makes the
    // promise reject and prevents the completion callback from resurrecting
    // them in _bufferList.
    for (const buffer of this._pendingMapBuffers) {
      this.destroyBuffer(buffer);
    }
    this._pendingMapBuffers.clear();
  }
  fetchBufferMapped(size: number) {
    for (const buffer of this._bufferList) {
      if (buffer.size - buffer.offset >= size) {
        buffer.used = true;
        return buffer;
      }
    }
    const bufferSize = (Math.max(size, this._defaultSize) + 3) & ~3;
    const buf = this._device.gpuCreateBuffer({
      label: `StagingRingBuffer${this._bufferList.length}:${bufferSize}`,
      size: bufferSize,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    const buffer: MappedBuffer = {
      buffer: buf,
      size: bufferSize,
      offset: 0,
      used: true,
      mappedRange: null,
      destroyed: false
    };
    try {
      buffer.mappedRange = buf.getMappedRange();
    } catch (err) {
      this.destroyBuffer(buffer);
      throw err;
    }
    this._bufferList.push(buffer);
    return this._bufferList[this._bufferList.length - 1];
  }

  private destroyBuffer(buffer: MappedBuffer): void {
    if (buffer.destroyed) {
      return;
    }
    buffer.destroyed = true;
    buffer.mappedRange = null;
    buffer.buffer.destroy();
  }
}
