import type { TypedArray } from '@zephyr3d/base';
import type { VertexAttribFormat, VertexStepMode } from '@zephyr3d/device';

export class MeshWriter {
  protected buffers: ArrayBuffer[];
  protected bufferViews: { buffer: number; byteOffset: number; byteLength: number }[];
  protected vertexBuffers: { [k: string]: { view: number; stepMode: VertexStepMode } };
  protected indexBuffer: number;
  constructor() {
    this.buffers = [];
    this.bufferViews = [];
    this.vertexBuffers = {};
    this.indexBuffer = -1;
  }
  addVertexBuffer(attrib: VertexAttribFormat, data: TypedArray, stepMode?: VertexStepMode) {
    let bufferIndex = this.buffers.indexOf(data.buffer);
    if (bufferIndex < 0) {
      this.buffers.push(data.buffer);
      bufferIndex = this.buffers.length - 1;
    }
    let viewIndex = this.bufferViews.findIndex(
      (view) =>
        view.buffer === bufferIndex &&
        view.byteOffset === data.byteOffset &&
        view.byteLength === data.byteLength
    );
    if (viewIndex < 0) {
      this.bufferViews.push({
        buffer: bufferIndex,
        byteOffset: data.byteOffset,
        byteLength: data.byteLength
      });
      viewIndex = this.bufferViews.length - 1;
    }
    this.vertexBuffers[attrib] = {
      view: viewIndex,
      stepMode: stepMode ?? 'vertex'
    };
  }
  addIndexBuffer(data: TypedArray) {
    let bufferIndex = this.buffers.indexOf(data.buffer);
    if (bufferIndex < 0) {
      this.buffers.push(data.buffer);
      bufferIndex = this.buffers.length - 1;
    }
    let viewIndex = this.bufferViews.findIndex(
      (view) =>
        view.buffer === bufferIndex &&
        view.byteOffset === data.byteOffset &&
        view.byteLength === data.byteLength
    );
    if (viewIndex < 0) {
      this.bufferViews.push({
        buffer: bufferIndex,
        byteOffset: data.byteOffset,
        byteLength: data.byteLength
      });
      viewIndex = this.bufferViews.length - 1;
    }
    this.indexBuffer = viewIndex;
  }
}
export class ResourceService {}
