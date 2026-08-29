import type {
  PrimitiveType,
  StructuredBuffer,
  VertexLayout,
  VertexLayoutOptions,
  VertexSemantic
} from '@zephyr3d/device';
import { VertexData } from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

/**
 * Vertex layout of a null device
 * @public
 */
export class NullVertexLayout extends NullGPUObject<unknown> implements VertexLayout<unknown> {
  /** @internal */
  private readonly _vertexData: VertexData;
  constructor(device: NullDevice, options: VertexLayoutOptions) {
    super(device);
    this._vertexData = new VertexData();
    for (const vb of options.vertexBuffers) {
      this._vertexData.setVertexBuffer(vb.buffer, vb.stepMode);
    }
    if (options.indexBuffer) {
      this._vertexData.setIndexBuffer(options.indexBuffer);
    }
    this._object = this._createFakeObject();
  }
  get vertexBuffers() {
    return this._vertexData.vertexBuffers;
  }
  get indexBuffer() {
    return this._vertexData.indexBuffer;
  }
  /** Number of vertices held by the non-instanced vertex buffers */
  get numVertices() {
    return this._vertexData.numVertices;
  }
  setDrawOffset(buffer: StructuredBuffer, byteOffset: number) {
    for (const info of this._vertexData.vertexBuffers) {
      if (info?.buffer === buffer) {
        info.drawOffset = byteOffset;
      }
    }
  }
  getVertexBuffer(semantic: VertexSemantic) {
    return this._vertexData.getVertexBuffer(semantic);
  }
  getVertexBufferInfo(semantic: VertexSemantic) {
    return this._vertexData.getVertexBufferInfo(semantic);
  }
  getIndexBuffer() {
    return this._vertexData.getIndexBuffer();
  }
  bind() {
    // Nothing to bind on a null device
  }
  draw(primitiveType: PrimitiveType, first: number, count: number) {
    this._device.setVertexLayout(this);
    this._device.draw(primitiveType, first, count);
  }
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number) {
    this._device.setVertexLayout(this);
    this._device.drawInstanced(primitiveType, first, count, numInstances);
  }
  isVertexLayout(): this is VertexLayout {
    return true;
  }
}
