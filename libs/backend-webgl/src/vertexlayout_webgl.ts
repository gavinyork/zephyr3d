import { WebGLGPUObject } from './gpuobject_webgl';
import { WebGLEnum } from './webgl_enum';
import type {
  VertexLayout,
  StructuredBuffer,
  IndexBuffer,
  VertexSemantic,
  VertexLayoutOptions,
  PrimitiveType,
  VertexBufferInfo
} from '@zephyr3d/device';
import { VertexData } from '@zephyr3d/device';
import { typeMap } from './constants_webgl';
import type { WebGLDevice } from './device_webgl';
import type { Nullable } from '@zephyr3d/base';

export class WebGLVertexLayout
  extends WebGLGPUObject<WebGLVertexArrayObject | WebGLVertexArrayObjectOES>
  implements VertexLayout<WebGLVertexArrayObject | WebGLVertexArrayObjectOES>
{
  private readonly _vertexData: VertexData;
  private _dirty: boolean;
  constructor(device: WebGLDevice, options: VertexLayoutOptions) {
    super(device);
    this._vertexData = new VertexData();
    this._dirty = false;
    for (const vb of options.vertexBuffers) {
      this._vertexData.setVertexBuffer(vb.buffer, vb.stepMode);
    }
    if (options.indexBuffer) {
      this._vertexData.setIndexBuffer(options.indexBuffer);
    }
    this.load();
  }
  destroy() {
    if (this._object && this._device.vaoExt) {
      this._device.vaoExt.deleteVertexArray(this._object);
    }
    this._object = null;
  }
  restore() {
    if (!this._device.isContextLost()) {
      this.load();
    }
  }
  get vertexBuffers() {
    return this._vertexData.vertexBuffers;
  }
  get indexBuffer() {
    return this._vertexData.indexBuffer;
  }
  setDrawOffset(buffer: StructuredBuffer, byteOffset: number) {
    for (const info of this._vertexData.vertexBuffers) {
      if (info?.buffer === buffer && info.drawOffset !== byteOffset) {
        info.drawOffset = byteOffset;
        this._dirty = true;
      }
    }
  }
  getVertexBuffer(semantic: VertexSemantic): Nullable<StructuredBuffer> {
    return this._vertexData.getVertexBuffer(semantic);
  }
  getVertexBufferInfo(semantic: VertexSemantic): Nullable<VertexBufferInfo> {
    return this._vertexData.getVertexBufferInfo(semantic);
  }
  getIndexBuffer(): Nullable<IndexBuffer> {
    return this._vertexData.getIndexBuffer();
  }
  bind() {
    if (this._object && this._device.vaoExt) {
      this._device.vaoExt.bindVertexArray(this._object);
      if (this._dirty) {
        this._dirty = false;
        this.bindBuffers();
      }
    } else {
      this.bindBuffers();
    }
  }
  draw(primitiveType: PrimitiveType, first: number, count: number): void {
    this._device.setVertexLayout(this);
    this._device.draw(primitiveType, first, count);
  }
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number): void {
    this._device.setVertexLayout(this);
    this._device.drawInstanced(primitiveType, first, count, numInstances);
  }
  isVertexLayout(): this is VertexLayout {
    return true;
  }
  private load(): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (this._device.vaoExt) {
      if (!this._object) {
        this._object = this._device.vaoExt.createVertexArray();
        this._device.vaoExt.bindVertexArray(this._object);
        this.bindBuffers();
        this._device.vaoExt.bindVertexArray(null);
      }
    } else {
      this._object = {};
    }
  }
  private bindBuffers() {
    const vertexBuffers = this._vertexData.vertexBuffers;
    const gl = this._device.context;
    for (let loc = 0; loc < vertexBuffers.length; loc++) {
      const bufferInfo = vertexBuffers[loc];
      const buffer = bufferInfo?.buffer;
      if (buffer) {
        if (buffer.disposed) {
          buffer.reload();
        }
        gl.bindBuffer(WebGLEnum.ARRAY_BUFFER, buffer.object!);
        gl.enableVertexAttribArray(loc);
        if (bufferInfo.stepMode === 'instance' && this._device.instancedArraysExt) {
          gl.vertexAttribPointer(
            loc,
            bufferInfo.type.cols,
            typeMap[bufferInfo.type.scalarType],
            bufferInfo.type.normalized,
            bufferInfo.stride,
            bufferInfo.offset
          );
          this._device.instancedArraysExt.vertexAttribDivisor(loc, 1);
        } else {
          gl.vertexAttribPointer(
            loc,
            bufferInfo.type.cols,
            typeMap[bufferInfo.type.scalarType],
            bufferInfo.type.normalized,
            bufferInfo.stride,
            bufferInfo.drawOffset + bufferInfo.offset
          );
        }
      } else {
        gl.disableVertexAttribArray(loc);
      }
    }
    if (this._vertexData.indexBuffer?.disposed) {
      this._vertexData.indexBuffer.reload();
    }
    gl.bindBuffer(
      WebGLEnum.ELEMENT_ARRAY_BUFFER,
      this._vertexData.indexBuffer ? this._vertexData.indexBuffer.object! : null
    );
  }
}
