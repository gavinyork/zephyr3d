import type { WebGPUDevice } from './device';

/** Bytes of a chunk, unless one upload needs more */
const DEFAULT_CHUNK_SIZE = 1 << 20;
/** Submits a chunk beyond the first may go unused before it is released */
const UNUSED_SUBMITS_TO_RELEASE = 600;
/** Staged bytes start at multiples of this; copyBufferToBuffer() needs 4 */
const ALIGNMENT = 16;

interface UploadChunk {
  buffer: GPUBuffer;
  data: Uint8Array<ArrayBuffer>;
  used: number;
  lastUsedSubmit: number;
}

/**
 * Staging memory shared by the buffer uploads of a submit.
 *
 * The bytes are gathered on the CPU while the copies from staging to the destination buffers are
 * recorded in the command encoder; right before the submit, one `queue.writeBuffer()` per chunk
 * puts them on the GPU. Queue operations run in order, so the copies of a submit read what was
 * written for it, and the chunks can be filled again for the next submit at once: there is
 * nothing to map, and no callback per staging buffer to wait for.
 *
 * Every submit that may run a recorded copy must call {@link UploadStaging.flush} right before
 * `queue.submit()`, and no other.
 * @internal
 */
export class UploadStaging {
  private readonly _device: WebGPUDevice;
  private readonly _chunks: UploadChunk[];
  /** Index of the chunk being filled */
  private _current: number;
  private _submits: number;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._chunks = [];
    this._current = 0;
    this._submits = 0;
  }
  /**
   * Copies bytes to staging for the next submit.
   * @param src - Source bytes
   * @param srcOffset - Byte offset in `src`
   * @param size - Byte count, a multiple of 4
   * @returns The staging buffer and the offset the bytes go to, to copy from
   */
  stage(src: Uint8Array, srcOffset: number, size: number): { buffer: GPUBuffer; offset: number } {
    for (;;) {
      let chunk = this._chunks[this._current];
      if (!chunk) {
        chunk = this.createChunk(size);
        this._chunks.push(chunk);
      }
      const offset = (chunk.used + ALIGNMENT - 1) & ~(ALIGNMENT - 1);
      if (offset + size <= chunk.data.byteLength) {
        chunk.data.set(src.subarray(srcOffset, srcOffset + size), offset);
        chunk.used = offset + size;
        chunk.lastUsedSubmit = this._submits;
        return { buffer: chunk.buffer, offset };
      }
      if (chunk.used === 0 && !this._chunks[this._current + 1]) {
        // An empty last chunk too small for this upload: replace it by one that fits
        chunk.buffer.destroy();
        this._chunks[this._current] = this.createChunk(size);
        continue;
      }
      this._current++;
    }
  }
  /** Puts the bytes staged since the last submit on the GPU; call right before `queue.submit()` */
  flush(queue: GPUQueue) {
    for (let i = 0; i <= this._current && i < this._chunks.length; i++) {
      const chunk = this._chunks[i];
      if (chunk.used > 0) {
        queue.writeBuffer(chunk.buffer, 0, chunk.data, 0, (chunk.used + 3) & ~3);
        chunk.used = 0;
      }
    }
    this._current = 0;
    this._submits++;
    // Chunks a burst of uploads needed once (scene loading) are not kept for good
    while (
      this._chunks.length > 1 &&
      this._submits - this._chunks[this._chunks.length - 1].lastUsedSubmit > UNUSED_SUBMITS_TO_RELEASE
    ) {
      this._chunks.pop()!.buffer.destroy();
    }
  }
  dispose() {
    for (const chunk of this._chunks) {
      chunk.buffer.destroy();
    }
    this._chunks.length = 0;
    this._current = 0;
  }
  private createChunk(minSize: number): UploadChunk {
    const size = Math.max(DEFAULT_CHUNK_SIZE, (minSize + ALIGNMENT - 1) & ~(ALIGNMENT - 1));
    return {
      buffer: this._device.gpuCreateBuffer({
        label: `UploadStaging:${size}`,
        size,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
      }),
      data: new Uint8Array(size),
      used: 0,
      lastUsedSubmit: this._submits
    };
  }
}
