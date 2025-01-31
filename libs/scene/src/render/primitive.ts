/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ray, TypedArray } from '@zephyr3d/base';
import {
  type VertexStepMode,
  type VertexLayout,
  type VertexLayoutOptions,
  type PrimitiveType,
  type StructuredBuffer,
  type IndexBuffer,
  type VertexSemantic,
  type VertexAttribFormat,
  type VertexBufferInfo,
  PBPrimitiveType,
  matchVertexBuffer
} from '@zephyr3d/device';
import { Application } from '../app/app';
import type { BoundingVolume } from '../utility/bounding_volume';
import { RenderBundleWrapper } from './renderbundle_wrapper';
import { Ref } from '../app';

/**
 * Primitive contains only the vertex and index data of a mesh
 * @public
 */
export class Primitive {
  /** @internal */
  protected _vertexLayout: VertexLayout;
  /** @internal */
  protected _vertexLayoutOptions: VertexLayoutOptions<{
    buffer: StructuredBuffer;
    bufferRef: Ref<StructuredBuffer>;
    stepMode?: VertexStepMode;
  }> & { indexBufferRef?: Ref<IndexBuffer> };
  /** @internal */
  protected _primitiveType: PrimitiveType;
  /** @internal */
  protected _indexStart: number;
  /** @internal */
  protected _indexCount: number;
  /** @internal */
  protected _defaultIndexCount: number;
  /** @internal */
  protected _vertexLayoutDirty: boolean;
  /** @internal */
  private static _nextId = 0;
  /** @internal */
  protected _id: number;
  /** @internal */
  protected _bbox: BoundingVolume;
  /** @internal */
  protected _bboxChangeCallback: (() => void)[];
  /** @internal */
  protected _disposed: boolean;
  /**
   * Creates an instance of a primitive
   */
  constructor() {
    this._vertexLayout = null;
    this._vertexLayoutOptions = { vertexBuffers: [] };
    this._primitiveType = 'triangle-list';
    this._indexStart = 0;
    this._indexCount = null;
    this._defaultIndexCount = 0;
    this._vertexLayoutDirty = false;
    this._id = ++Primitive._nextId;
    this._bbox = null;
    this._bboxChangeCallback = [];
    this._disposed = false;
  }
  /**
   * Unique identifier of the primitive
   * @internal
   */
  get id(): number {
    return this._id;
  }
  /**
   * Adds a callback function that will be called whenever the bounding box of the primitive changes.
   * @param cb - The callback function
   *
   * @internal
   */
  addBoundingboxChangeCallback(cb: () => void): void {
    if (cb) {
      this._bboxChangeCallback.push(cb);
    }
  }
  /**
   * Removes a callback function for bounding box changing
   * @param cb - The callback function to be removed
   */
  removeBoundingboxChangeCallback(cb: () => void) {
    const index = this._bboxChangeCallback.indexOf(cb);
    if (index >= 0) {
      this._bboxChangeCallback.splice(index, 1);
    }
  }
  /** Primitive type */
  get primitiveType() {
    return this._primitiveType;
  }
  set primitiveType(type) {
    if (type !== this._primitiveType) {
      this._primitiveType = type;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /** Start index for drawing */
  get indexStart() {
    return this._indexStart;
  }
  set indexStart(val) {
    if (val !== this._indexStart) {
      this._indexStart = val;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /** The number of the indices or vertices to be drawn */
  get indexCount() {
    this._indexCount = this._indexCount ?? this.calcDefaultIndexCount();
    return this._indexCount;
  }
  set indexCount(val) {
    if (val !== this._indexCount) {
      this._indexCount = val;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Query total vertex count
   * @returns Total vertex count, 0 if no position vertex buffer set
   */
  getNumVertices(): number {
    const posInfo = this.getVertexBufferInfo('position');
    return posInfo?.buffer ? (posInfo.buffer.byteLength / posInfo.stride) >> 0 : 0;
  }
  /**
   * Query total face count
   * @returns Total face count
   */
  getNumFaces(): number {
    const ib = this.getIndexBuffer();
    const count = ib
      ? ib.byteLength >> (ib.indexType.primitiveType === PBPrimitiveType.U16 ? 1 : 2)
      : this.getNumVertices();
    switch (this.primitiveType) {
      case 'line-list':
        return count >> 1;
      case 'point-list':
        return count;
      case 'line-strip':
        return count - 1;
      case 'triangle-fan':
        return count - 2;
      case 'triangle-strip':
        return count - 2;
      case 'triangle-list':
        return (count / 3) >> 0;
      default:
        return 0;
    }
  }
  /**
   * Removes a vertex buffer from the primitive
   * @param buffer - The vertex buffer to be removed
   */
  removeVertexBuffer(semantic: VertexSemantic): void {
    for (let i = this._vertexLayoutOptions.vertexBuffers.length - 1; i >= 0; i--) {
      const info = this._vertexLayoutOptions.vertexBuffers[i];
      if (matchVertexBuffer(info.buffer, semantic)) {
        info.bufferRef.dispose();
        this._vertexLayoutOptions.vertexBuffers.splice(i, 1);
        this._vertexLayoutDirty = true;
      }
    }
    if (this._vertexLayoutDirty) {
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Gets the vertex buffer by a given semantic
   * @param semantic - The semantic of the vertex buffer
   * @returns The vertex buffer which semantic matches the given value
   */
  getVertexBuffer(semantic: VertexSemantic): StructuredBuffer {
    for (const info of this._vertexLayoutOptions.vertexBuffers) {
      if (info.buffer && matchVertexBuffer(info.buffer, semantic)) {
        return info.buffer;
      }
    }
    return null;
  }
  /**
   * Gets the vertex buffer information by a given semantic
   * @param semantic - The semantic of the vertex buffer
   * @returns The vertex buffer information of the given semantic
   */
  getVertexBufferInfo(semantic: VertexSemantic): VertexBufferInfo {
    this.checkVertexLayout();
    return this._vertexLayout?.getVertexBufferInfo(semantic) ?? null;
  }
  /**
   * Creates a vertex buffer from the given options and then adds it to the primitive
   * @param format - Vertex format for the vertex buffer
   * @param data - Contents of the vertex buffer
   * @param stepMode - Step mode of the vertex buffer
   * @returns The created vertex buffer
   */
  createAndSetVertexBuffer(
    format: VertexAttribFormat[] | VertexAttribFormat,
    data: TypedArray,
    stepMode?: VertexStepMode
  ): StructuredBuffer {
    const device = Application.instance.device;
    const buffer = Array.isArray(format)
      ? device.createInterleavedVertexBuffer(format, data)
      : device.createVertexBuffer(format, data);
    return this.setVertexBuffer(buffer, stepMode);
  }
  /**
   * Adds a vertex buffer to the primitive
   * @param buffer - The vertex buffer to be added
   * @param stepMode - Step mode of the vertex buffer
   * @returns The added vertex buffer
   */
  setVertexBuffer(buffer: StructuredBuffer, stepMode?: VertexStepMode) {
    this._vertexLayoutOptions.vertexBuffers.push({
      buffer,
      bufferRef: new Ref(buffer),
      stepMode
    });
    this._vertexLayoutDirty = true;
    RenderBundleWrapper.primitiveChanged(this);
    return buffer;
  }
  /**
   * Creates an index buffer from the given options and then adds it to the prmitive
   * @param data - Contents of the index buffer
   * @param dynamic - true if the index buffer is dynamic
   * @returns The created index buffer
   */
  createAndSetIndexBuffer(data: Uint16Array | Uint32Array, dynamic?: boolean): IndexBuffer {
    const device = Application.instance.device;
    const buffer = device.createIndexBuffer(data, {
      dynamic: !!dynamic,
      managed: !dynamic
    });
    this.setIndexBuffer(buffer);
    return buffer;
  }
  /**
   * Adds an index buffer to the primitive
   * @param buffer - The index buffer to be added
   */
  setIndexBuffer(buffer: IndexBuffer): void {
    if (this._vertexLayoutOptions.indexBuffer !== buffer) {
      this._vertexLayoutOptions.indexBuffer = buffer;
      this._vertexLayoutDirty = true;
      if (this._vertexLayoutOptions.indexBufferRef) {
        this._vertexLayoutOptions.indexBufferRef.set(buffer);
      } else {
        this._vertexLayoutOptions.indexBufferRef = new Ref(buffer);
      }
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Gets the index buffer of the primitive
   * @returns The index buffer of the primitive
   */
  getIndexBuffer(): IndexBuffer {
    return this._vertexLayoutOptions.indexBuffer;
  }
  /**
   * Draw the prmitive
   */
  draw() {
    this.checkVertexLayout();
    if (this.indexCount > 0) {
      this._vertexLayout?.draw(this._primitiveType, this._indexStart, this.indexCount);
    }
  }
  /**
   * Draw multiple instances of the primitive
   * @param numInstances - How many instances of the primitive should be drawn
   */
  drawInstanced(numInstances: number): void {
    this.checkVertexLayout();
    if (this.indexCount > 0) {
      this._vertexLayout?.drawInstanced(this._primitiveType, this._indexStart, this.indexCount, numInstances);
    }
  }
  /**
   * Disposes the primitive
   *
   * @remarks
   * The vertex buffers and index buffer will also be disposed.
   * To prevent specific vertex buffer or index buffer to be disposed,
   * call removeVertexBuffer() or setIndexBuffer(null) first.
   */
  dispose() {
    if (!this._disposed) {
      this._disposed = true;
      this._vertexLayout?.dispose();
      this._vertexLayoutOptions.indexBufferRef?.dispose();
      for (const info of this._vertexLayoutOptions.vertexBuffers) {
        info.bufferRef?.dispose();
      }
    }
  }
  /**
   * Whether this primitive was disposed
   */
  get disposed() {
    return this._disposed;
  }
  /*
  createAABBTree(): AABBTree {
    const indices = this.getIndexBuffer() ? this.getIndexBuffer().getData() : null;
    const vertices = (this.getVertexBuffer(VERTEX_ATTRIB_POSITION)?.getData() as Float32Array) || null;
    const aabbtree = new AABBTree();
    aabbtree.buildFromPrimitives(vertices, indices, this._primitiveType);
    return aabbtree;
  }
  */
  /**
   * Gets the bounding volume of the primitive
   * @returns The bounding volume of the primitive, or null if no bounding volume set
   */
  getBoundingVolume(): BoundingVolume {
    return this._bbox;
  }
  /**
   * Sets the bounding volume of the primitive
   * @param bv - The bounding volume to be set
   */
  setBoundingVolume(bv: BoundingVolume): void {
    if (bv !== this._bbox) {
      this._bbox = bv;
      for (const cb of this._bboxChangeCallback) {
        cb();
      }
    }
  }
  /**
   * Ray intersection test
   * @param ray - Ray object used to do intersection test with this object
   * @returns The distance from ray origin to the intersection point if ray intersects with this object, otherwise null
   */
  raycast(ray: Ray): number {
    const aabb = this.getBoundingVolume()?.toAABB();
    return aabb ? ray.bboxIntersectionTestEx(aabb) : null;
  }
  /** @internal */
  private checkVertexLayout() {
    if (this._vertexLayoutDirty) {
      this._vertexLayout?.dispose();
      const device = Application.instance.device;
      this._vertexLayout = device.createVertexLayout(this._vertexLayoutOptions);
      this._vertexLayoutDirty = false;
    }
  }
  /** @internal */
  private calcDefaultIndexCount(): number {
    const indexBuffer = this.getIndexBuffer();
    if (indexBuffer) {
      return Math.max(0, indexBuffer.length - this._indexStart);
    }
    const info = this.getVertexBufferInfo('position');
    if (info) {
      return Math.max(
        0,
        Math.floor((info.buffer.byteLength - info.drawOffset) / info.stride) - this._indexStart
      );
    }
    return 0;
  }
}
