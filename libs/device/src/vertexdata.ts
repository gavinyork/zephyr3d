import type { StructuredBuffer, IndexBuffer, VertexStepMode, VertexSemantic } from './gpuobject';
import {
  GPUResourceUsageFlags,
  MAX_VERTEX_ATTRIBUTES,
  getVertexAttribByName,
  getVertexBufferStride,
  getVertexBufferAttribType
} from './gpuobject';
import type { PBArrayTypeInfo, PBPrimitiveTypeInfo } from './builder/types';
import type { Nullable } from '@zephyr3d/base';

/**
 * Vertex buffer information
 * @public
 */
export type VertexBufferInfo = {
  buffer: StructuredBuffer;
  offset: number;
  stride: number;
  drawOffset: number;
  type: PBPrimitiveTypeInfo;
  stepMode: VertexStepMode;
};

/**
 * The vertex data class
 * @public
 */
export class VertexData {
  /** @internal */
  private _vertexBuffers: Nullable<VertexBufferInfo>[];
  /** @internal */
  private _indexBuffer: Nullable<IndexBuffer>;
  /** @internal */
  private _drawOffset: number;
  /** @internal */
  private _numVertices: number;
  constructor() {
    this._vertexBuffers = [];
    for (let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++) {
      this._vertexBuffers.push(null);
    }
    this._indexBuffer = null;
    this._drawOffset = 0;
    this._numVertices = 0;
  }
  /**
   * Creates a new instance of VertexData by copying from this object
   * @returns New instance of VertexData
   */
  clone() {
    const newVertexData = new VertexData();
    newVertexData._vertexBuffers = this._vertexBuffers.slice();
    newVertexData._indexBuffer = this._indexBuffer;
    newVertexData._drawOffset = this._drawOffset;
    newVertexData.calcNumVertices();
    return newVertexData;
  }
  /** Vertex buffer information list */
  get vertexBuffers() {
    return this._vertexBuffers;
  }
  /** Index buffer */
  get indexBuffer() {
    return this._indexBuffer;
  }
  /** Number of vertices */
  get numVertices() {
    return this._numVertices;
  }
  /** Draw offset */
  getDrawOffset() {
    return this._drawOffset;
  }
  setDrawOffset(offset: number) {
    if (offset !== this._drawOffset) {
      this._drawOffset = offset;
      this.calcNumVertices();
    }
  }
  /**
   * Gets the vertex buffer by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer of the given semantic
   */
  getVertexBuffer(semantic: VertexSemantic) {
    return this._vertexBuffers[getVertexAttribByName(semantic)!]?.buffer ?? null;
  }
  /**
   * Gets the vertex buffer information by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer information of the given semantic
   */
  getVertexBufferInfo(semantic: VertexSemantic) {
    return this._vertexBuffers[getVertexAttribByName(semantic)!] ?? null;
  }
  /**
   * Gets the index buffer
   * @returns The index buffer
   */
  getIndexBuffer() {
    return this._indexBuffer;
  }
  /**
   * Sets a vertex buffer
   * @param buffer - The vertex buffer object
   * @param stepMode - Step mode of the buffer
   * @returns The buffer that was set
   */
  setVertexBuffer(buffer: StructuredBuffer, stepMode?: VertexStepMode) {
    if (!buffer) {
      return null;
    }
    if (!(buffer.usage & GPUResourceUsageFlags.BF_VERTEX)) {
      throw new Error('setVertexBuffer() failed: buffer is null or buffer has not Vertex usage flag');
    }
    stepMode = stepMode || 'vertex';
    const vertexType = (buffer.structure.structMembers[0].type as PBArrayTypeInfo).elementType;
    if (vertexType.isStructType()) {
      let offset = 0;
      for (const attrib of vertexType.structMembers) {
        const loc = getVertexAttribByName(attrib.name as VertexSemantic);
        this.internalSetVertexBuffer(loc!, buffer, offset, stepMode);
        offset += attrib.size;
      }
    } else {
      const loc = getVertexAttribByName(buffer.structure.structMembers[0].name as VertexSemantic);
      this.internalSetVertexBuffer(loc!, buffer, 0, stepMode);
    }
    return buffer;
  }
  /**
   * Removes a vertex buffer
   * @param buffer - Vertex buffer to be removed
   * @returns true if the buffer was successfully removed, otherwise false
   */
  removeVertexBuffer(buffer: StructuredBuffer) {
    let removed = false;
    for (let loc = 0; loc < this._vertexBuffers.length; loc++) {
      const info = this._vertexBuffers[loc];
      const remove = info?.buffer === buffer;
      if (remove) {
        this._vertexBuffers[loc] = null;
        removed = true;
      }
    }
    if (removed) {
      this.calcNumVertices();
    }
    return removed;
  }
  /**
   * Sets the index buffer
   * @param buffer - Index buffer to be set
   * @returns The index buffer that was set
   */
  setIndexBuffer(buffer: Nullable<IndexBuffer>) {
    if (buffer !== this._indexBuffer) {
      this._indexBuffer = buffer;
    }
    return buffer;
  }
  /** @internal */
  private calcNumVertices() {
    this._numVertices = 0;
    for (let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++) {
      const info = this._vertexBuffers[i];
      if (info && info.stepMode !== 'instance') {
        const n = Math.floor(info.buffer.byteLength / info.stride);
        if (n > this._numVertices) {
          this._numVertices = n;
        }
      }
    }
  }
  /** @internal */
  private internalSetVertexBuffer(
    loc: number,
    buffer: StructuredBuffer,
    offset?: number,
    stepMode?: VertexStepMode
  ) {
    if (loc < 0 || loc >= MAX_VERTEX_ATTRIBUTES) {
      throw new Error(`setVertexBuffer() failed: location out of bounds: ${loc}`);
    }
    offset = Number(offset) || 0;
    stepMode = stepMode || 'vertex';
    const old = this._vertexBuffers[loc];
    if (!old || old.buffer !== buffer || old.offset !== offset || old.stepMode !== stepMode) {
      this._vertexBuffers[loc] = {
        buffer: buffer,
        offset: offset,
        type: getVertexBufferAttribType(buffer.structure, loc)!,
        stride: getVertexBufferStride(buffer.structure),
        drawOffset: 0,
        stepMode: stepMode
      };
      this.calcNumVertices();
      return buffer;
    }
    return null;
  }
}
