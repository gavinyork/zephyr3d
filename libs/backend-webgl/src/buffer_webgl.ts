import type { GPUDataBuffer } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGLGPUObject } from './gpuobject_webgl';
import { WebGLEnum } from './webgl_enum';
import { isWebGL2 } from './utils';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';

export class WebGLGPUBuffer extends WebGLGPUObject<WebGLBuffer> implements GPUDataBuffer<WebGLBuffer> {
  protected _size: number;
  protected _usage: number;
  protected _systemMemoryBuffer: Nullable<Uint8Array<ArrayBuffer>>;
  protected _systemMemory: boolean;
  protected _memCost: number;
  constructor(device: WebGLDevice, usage: number, data: TypedArray | number, systemMemory = false) {
    super(device);
    if (usage & GPUResourceUsageFlags.BF_VERTEX && usage & GPUResourceUsageFlags.BF_INDEX) {
      throw new Error('buffer usage must not have Vertex and Index simultaneously');
    }
    if (
      !device.isWebGL2 &&
      !(usage & GPUResourceUsageFlags.BF_VERTEX) &&
      !(usage & GPUResourceUsageFlags.BF_INDEX) &&
      !(usage & GPUResourceUsageFlags.BF_UNIFORM)
    ) {
      throw new Error('no Vertex or Index or Uniform usage set when creating buffer');
    }
    if (device.isWebGL2 && !(usage & ~GPUResourceUsageFlags.DYNAMIC)) {
      throw new Error('buffer usage not set when creating buffer');
    }
    if (usage & GPUResourceUsageFlags.DYNAMIC && usage & GPUResourceUsageFlags.MANAGED) {
      throw new Error('buffer usage DYNAMIC and MANAGED can not be both set');
    }
    this._object = null;
    this._memCost = 0;
    this._usage = usage;
    this._size = typeof data === 'number' ? data : data.byteLength;
    if (this._size <= 0) {
      throw new Error('can not create buffer with zero size');
    }
    this._systemMemory = !!systemMemory;
    if (this._systemMemory || this._usage & GPUResourceUsageFlags.MANAGED) {
      this._systemMemoryBuffer = new Uint8Array(this._size);
      if (data && typeof data !== 'number') {
        this._systemMemoryBuffer.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      }
    } else {
      this._systemMemoryBuffer = null;
    }
    if (!this._systemMemory) {
      this.load(this._systemMemoryBuffer || (typeof data === 'number' ? null : data));
    }
  }
  get byteLength() {
    return this._size;
  }
  get systemMemoryBuffer() {
    return this._systemMemoryBuffer?.buffer || null;
  }
  get usage() {
    return this._usage;
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
    if (this._systemMemoryBuffer) {
      // copy to system backup buffer if present
      this._systemMemoryBuffer.set(
        new Uint8Array(
          data.buffer,
          data.byteOffset + srcPos * data.BYTES_PER_ELEMENT,
          srcLength * data.BYTES_PER_ELEMENT
        ),
        dstByteOffset
      );
    }
    if (!this._systemMemory && !this.device.isContextLost()) {
      if (this.disposed) {
        this.reload();
      }
      if (!this._device.isWebGL2 && (srcPos !== 0 || srcLength !== data.length)) {
        data = data.subarray(srcPos, srcPos + srcLength);
      }
      this._device.vaoExt?.bindVertexArray(null);
      let target: number;
      if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
        target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
        target = WebGLEnum.ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
        target = WebGLEnum.UNIFORM_BUFFER;
      } else if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_WRITE)) {
        target = WebGLEnum.COPY_WRITE_BUFFER;
      } else if (
        this._usage &
        (GPUResourceUsageFlags.BF_PACK_PIXEL | GPUResourceUsageFlags.BF_UNPACK_PIXEL)
      ) {
        target = WebGLEnum.PIXEL_PACK_BUFFER;
      } else {
        throw new Error(`Invalid buffer usage`);
      }
      this._device.context.bindBuffer(target, this._object);
      if (this._device.isWebGL2) {
        (this._device.context as WebGL2RenderingContext).bufferSubData(
          target,
          dstByteOffset,
          data,
          srcPos,
          srcLength
        );
      } else {
        this._device.context.bufferSubData(target, dstByteOffset, data);
      }
    }
  }
  async getBufferSubData(
    dstBuffer?: Nullable<Uint8Array<ArrayBuffer>>,
    offsetInBytes?: number,
    sizeInBytes?: number
  ) {
    if (this.disposed) {
      this.reload();
    }
    return this._getBufferData(dstBuffer, offsetInBytes, sizeInBytes);
  }
  protected async _getBufferData(
    dstBuffer?: Nullable<Uint8Array<ArrayBuffer>>,
    offsetInBytes?: number,
    sizeInBytes?: number
  ) {
    offsetInBytes = Number(offsetInBytes) || 0;
    sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
    if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
      throw new Error('data query range out of bounds');
    }
    if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
      throw new Error('no enough space for querying buffer data');
    }
    dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
    if (this._systemMemoryBuffer) {
      dstBuffer.set(new Uint8Array(this._systemMemoryBuffer.buffer, offsetInBytes, sizeInBytes));
    } else {
      const gl = this._device.context as WebGL2RenderingContext;
      if (isWebGL2(gl)) {
        const sync = gl.fenceSync(WebGLEnum.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (sync) {
          await this.clientWaitAsync(gl, sync, 0, 10);
          gl.deleteSync(sync);
        }
      }
      this._device.vaoExt?.bindVertexArray(null);
      let target: number;
      if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
        target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
        target = WebGLEnum.ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
        target = WebGLEnum.UNIFORM_BUFFER;
      } else if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_WRITE)) {
        target = WebGLEnum.COPY_READ_BUFFER;
      } else if (
        this._usage &
        (GPUResourceUsageFlags.BF_PACK_PIXEL | GPUResourceUsageFlags.BF_UNPACK_PIXEL)
      ) {
        target = WebGLEnum.PIXEL_UNPACK_BUFFER;
      } else {
        throw new Error(`Invalid buffer usage`);
      }
      gl.bindBuffer(target, this._object);
      gl.getBufferSubData(target, offsetInBytes, dstBuffer, 0, sizeInBytes);
      gl.bindBuffer(target, null);
    }
    return dstBuffer;
  }
  restore() {
    if (!this._systemMemory && !this._object && !this._device.isContextLost()) {
      this.load(this._systemMemoryBuffer);
    }
  }
  destroy() {
    if (!this._systemMemory && this._object) {
      this._device.context.deleteBuffer(this._object);
      this._object = null;
      this._device.updateVideoMemoryCost(-this._memCost);
      this._memCost = 0;
    }
  }
  isBuffer(): this is GPUDataBuffer {
    return true;
  }
  protected load(data: Nullable<TypedArray>) {
    if (!this._device.isContextLost()) {
      if (!this._object) {
        this._object = this._device.context.createBuffer();
      }
      this._device.vaoExt?.bindVertexArray(null);
      let usage =
        this._usage & GPUResourceUsageFlags.DYNAMIC ? WebGLEnum.DYNAMIC_DRAW : WebGLEnum.STATIC_DRAW;
      let target: number;
      if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
        target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
        target = WebGLEnum.ARRAY_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
        target = WebGLEnum.UNIFORM_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_READ) {
        target = WebGLEnum.PIXEL_PACK_BUFFER;
        usage = WebGLEnum.STREAM_READ;
      } else if (this._usage & GPUResourceUsageFlags.BF_WRITE) {
        target = WebGLEnum.COPY_WRITE_BUFFER;
      } else if (this._usage & GPUResourceUsageFlags.BF_PACK_PIXEL) {
        target = WebGLEnum.PIXEL_PACK_BUFFER;
        usage = WebGLEnum.STREAM_READ;
      } else if (this._usage & GPUResourceUsageFlags.BF_UNPACK_PIXEL) {
        target = WebGLEnum.PIXEL_UNPACK_BUFFER;
      } else {
        throw new Error(`WebGLGPUBuffer.load() failed: invalid buffer usage: ${this._usage}`);
      }
      this._device.context.bindBuffer(target, this._object);
      if (data) {
        this._device.context.bufferData(target, data, usage);
      } else {
        this._device.context.bufferData(target, (this._size + 15) & ~15, usage);
      }
    }
    this._device.updateVideoMemoryCost(this._size - this._memCost);
    this._memCost = this._size;
  }
  /** @internal */
  private async clientWaitAsync(
    gl: WebGL2RenderingContext,
    sync: WebGLSync,
    flags: number,
    interval_ms: number
  ) {
    return new Promise<void>((resolve, reject) => {
      function test() {
        const res = gl.clientWaitSync(sync, flags, 0);
        if (res == gl.WAIT_FAILED) {
          reject();
          return;
        }
        if (res == gl.TIMEOUT_EXPIRED) {
          setTimeout(test, interval_ms);
          return;
        }
        resolve();
      }
      test();
    });
  }
}
