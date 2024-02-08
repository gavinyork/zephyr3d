import type {
  PrimitiveType,
  StructuredBuffer,
  VertexLayout,
  IndexBuffer,
  VertexSemantic,
  VertexLayoutOptions,
  VertexBufferInfo
} from '@zephyr3d/device';
import { VertexData } from '@zephyr3d/device';
import { vertexFormatToHash } from './constants_webgpu';
import { WebGPUObject } from './gpuobject_webgpu';
import { WebGPUStructuredBuffer } from './structuredbuffer_webgpu';
import type { WebGPUDevice } from './device';

export class WebGPUVertexLayout extends WebGPUObject<unknown> implements VertexLayout<unknown> {
  private static _hashCounter = 0;
  private _vertexData: VertexData;
  private _hash: string;
  private _layouts: {
    [hash: string]: { layoutHash: string; buffers: VertexBufferInfo[] };
  };
  constructor(device: WebGPUDevice, options: VertexLayoutOptions) {
    super(device);
    this._vertexData = new VertexData();
    for (const vb of options.vertexBuffers) {
      this._vertexData.setVertexBuffer(vb.buffer, vb.stepMode);
    }
    if (options.indexBuffer) {
      this._vertexData.setIndexBuffer(options.indexBuffer);
    }
    this._hash = String(++WebGPUVertexLayout._hashCounter);
    this._layouts = {};
  }
  destroy() {
    this._object = null;
  }
  async restore(): Promise<void> {
    this._object = {};
  }
  setDrawOffset(buffer: StructuredBuffer, byteOffset: number) {
    for (const info of this._vertexData.vertexBuffers) {
      if (info?.buffer === buffer) {
        info.drawOffset = byteOffset;
      }
    }
  }
  get hash(): string {
    return this._hash;
  }
  get vertexBuffers() {
    return this._vertexData.vertexBuffers;
  }
  get indexBuffer() {
    return this._vertexData.indexBuffer;
  }
  getDrawOffset(): number {
    return this._vertexData.getDrawOffset();
  }
  getVertexBuffer(semantic: VertexSemantic): StructuredBuffer {
    return this._vertexData.getVertexBuffer(semantic);
  }
  getVertexBufferInfo(semantic: VertexSemantic): VertexBufferInfo {
    return this._vertexData.getVertexBufferInfo(semantic);
  }
  getIndexBuffer(): IndexBuffer {
    return this._vertexData.getIndexBuffer();
  }
  getLayouts(attributes: string): {
    layoutHash: string;
    buffers: VertexBufferInfo[];
  } {
    if (!attributes) {
      return null;
    }
    let layout = this._layouts[attributes];
    if (!layout) {
      layout = this.calcHash(attributes);
      this._layouts[attributes] = layout;
    }
    return layout;
  }
  private calcHash(attribHash: string): {
    layoutHash: string;
    buffers: VertexBufferInfo[];
  } {
    const layouts: string[] = [];
    const layoutVertexBuffers: VertexBufferInfo[] = [];
    const vertexBuffers = this._vertexData.vertexBuffers;
    const attributes = attribHash.split(':').map((val) => Number(val));
    for (let idx = 0; idx < attributes.length; idx++) {
      const attrib = attributes[idx];
      const bufferInfo = vertexBuffers[attrib];
      const buffer = bufferInfo?.buffer;
      if (!buffer) {
        console.log(`ERROR: No vertex buffer set for location ${idx}`);
        continue;
      }
      const gpuFormat = WebGPUStructuredBuffer.getGPUVertexFormat(bufferInfo.type);
      if (!gpuFormat) {
        throw new Error('Invalid vertex buffer format');
      }
      const index = layoutVertexBuffers.findIndex((val) => val.buffer === buffer);
      const stride = bufferInfo.stride;
      let layout = index >= 0 ? layouts[index] : `${stride}-${Number(bufferInfo.stepMode === 'instance')}`;
      layout += `-${vertexFormatToHash[gpuFormat]}-${bufferInfo.offset}-${idx}`;
      if (index >= 0) {
        layouts[index] = layout;
      } else {
        layouts.push(layout);
        layoutVertexBuffers.push(bufferInfo);
      }
    }
    return {
      layoutHash: layouts.join(':'),
      buffers: layoutVertexBuffers
    };
  }
  bind(): void {
    this._device.setVertexLayout(this);
  }
  draw(primitiveType: PrimitiveType, first: number, count: number): void {
    this.bind();
    this._device.draw(primitiveType, first, count);
  }
  drawInstanced(primitiveType: PrimitiveType, first: number, count: number, numInstances: number) {
    this.bind();
    this._device.drawInstanced(primitiveType, first, count, numInstances);
  }
}
