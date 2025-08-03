import type { WebGPUDevice } from './device';

export interface MappedBuffer {
  buffer: GPUBuffer;
  size: number;
  offset: number;
  used: boolean;
  mappedRange: ArrayBuffer;
}

export interface UploadBuffer {
  mappedBuffer: MappedBuffer;
  uploadSize: number;
  uploadBuffer: GPUBuffer;
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
  constructor(device: WebGPUDevice, defaultSize = 64 * 1024) {
    this._device = device;
    this._bufferList = [];
    this._defaultSize = defaultSize;
    this._unmappedBufferList = [];
  }
  uploadBuffer(
    src: ArrayBuffer,
    dst: GPUBuffer,
    srcOffset: number,
    dstOffset: number,
    uploadSize: number,
    allowOverlap?: boolean
  ): UploadBuffer {
    const size = (uploadSize + 3) & ~3;
    const mappedBuffer = this.fetchBufferMapped(size, !!allowOverlap);
    if (src) {
      const mappedRange = mappedBuffer.mappedRange; //mappedBuffer.buffer.getMappedRange(mappedBuffer.offset, size);
      new Uint8Array(mappedRange, mappedBuffer.offset, size).set(new Uint8Array(src, srcOffset, uploadSize));
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
  beginUploads(): number {
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
      buffer.buffer.mapAsync(GPUMapMode.WRITE).then(() => {
        buffer.offset = 0;
        buffer.used = false;
        buffer.mappedRange = buffer.buffer.getMappedRange();
        this._bufferList.push(buffer);
      });
    }
    this._unmappedBufferList = [];
  }
  purge() {
    for (let i = this._bufferList.length - 1; i >= 0; i--) {
      const buffer = this._bufferList[i];
      if (buffer.mappedRange) {
        buffer.buffer.unmap();
        buffer.buffer.destroy();
      }
    }
    this._bufferList = [];
    for (const buffer of this._unmappedBufferList) {
      buffer.buffer.destroy();
    }
    this._unmappedBufferList = [];
  }
  fetchBufferMapped(size: number, allowOverlap: boolean): MappedBuffer {
    for (const buffer of this._bufferList) {
      if (allowOverlap || buffer.size - buffer.offset >= size) {
        buffer.used = true;
        return buffer;
      }
    }
    const bufferSize = (Math.max(size, this._defaultSize) + 3) & ~3;
    const buf = this._device.device.createBuffer({
      label: `StagingRingBuffer${this._bufferList.length}:${bufferSize}`,
      size: bufferSize,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    this._bufferList.push({
      buffer: buf,
      size: bufferSize,
      offset: 0,
      used: true,
      mappedRange: buf.getMappedRange()
    });
    return this._bufferList[this._bufferList.length - 1];
  }
}
