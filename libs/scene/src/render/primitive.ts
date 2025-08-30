import {
  Disposable,
  DWeakRef,
  makeObservable,
  randomUUID,
  releaseObject,
  retainObject,
  type Clonable,
  type Ray,
  type TypedArray
} from '@zephyr3d/base';
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
import type { BoundingVolume } from '../utility/bounding_volume';
import { RenderBundleWrapper } from './renderbundle_wrapper';
import { getDevice } from '../app/api';

/**
 * Holds vertex/index data and draw parameters for a mesh geometry.
 *
 * Responsibilities:
 * - Owns one or more vertex buffers and an optional index buffer.
 * - Defines primitive topology, draw range (start/count), and vertex layout.
 * - Provides utilities to create/set/remove buffers and query vertex/face counts.
 * - Tracks changes via a change tag and notifies render-bundle caching.
 * - Optionally stores a bounding volume and supports ray intersection tests.
 *
 * Ownership and lifecycle:
 * - When adding buffers (`setVertexBuffer`, `setIndexBuffer`), the primitive retains them.
 * - When removing/overwriting buffers, the primitive releases the previous buffers.
 * - Disposing the primitive also disposes the internal `VertexLayout` and releases retained buffers.
 *
 * Serialization:
 * - Maintains a persistent UUID (`persistentId`) and a weak registry for lookup.
 *
 * @public
 */
export class Primitive
  extends makeObservable(Disposable)<{
    bv_changed: [];
  }>()
  implements Clonable<Primitive>
{
  /** @internal Global weak registry keyed by persistentId for serialization/lookup. */
  private static readonly _registry: Map<string, DWeakRef<Primitive>> = new Map();
  /** @internal Current vertex layout object (created lazily from options). */
  protected _vertexLayout: VertexLayout;
  /** @internal Mutable options used to build the vertex layout. */
  protected _vertexLayoutOptions: VertexLayoutOptions;
  /** @internal Primitive topology (e.g., 'triangle-list', 'line-strip'). */
  protected _primitiveType: PrimitiveType;
  /** @internal First index/vertex to draw. */
  protected _indexStart: number;
  /** @internal Number of indices/vertices to draw (computed lazily if null). */
  protected _indexCount: number;
  /** @internal Cached default index count (derived when needed). */
  protected _defaultIndexCount: number;
  /** @internal Marks layout dirty when buffers/topology change. */
  protected _vertexLayoutDirty: boolean;
  /** @internal Monotonic runtime id. */
  private static _nextId = 0;
  /** @internal Unique runtime id for the instance. */
  protected _id: number;
  /** @internal Persistent UUID for serialization. */
  protected _persistentId: string;
  /** @internal Optional bounding volume for culling/raycast. */
  protected _bbox: BoundingVolume;
  /** @internal Change tag increments when draw-affecting state changes. */
  private _changeTag: number;
  /**
   * Create an empty primitive.
   *
   * Defaults:
   * - Primitive type: 'triangle-list'
   * - `indexStart = 0`, `indexCount = null` (auto-computed)
   * - No vertex/index buffers attached
   * - No bounding volume
   */
  constructor() {
    super();
    this._vertexLayout = null;
    this._vertexLayoutOptions = { vertexBuffers: [] };
    this._primitiveType = 'triangle-list';
    this._indexStart = 0;
    this._indexCount = null;
    this._defaultIndexCount = 0;
    this._vertexLayoutDirty = false;
    this._id = ++Primitive._nextId;
    this._persistentId = randomUUID();
    this._changeTag = 0;
    this._bbox = null;
    Primitive._registry.set(this._persistentId, new DWeakRef(this));
  }
  /**
   * Lookup a primitive from the global registry by persistent id.
   *
   * @param id - The persistent UUID to search for.
   * @returns The primitive if alive, otherwise `null`.
   * @internal
   */
  static findPrimitiveById(id: string) {
    const m = this._registry.get(id);
    if (m && !m.get()) {
      this._registry.delete(id);
      return null;
    }
    return m ? m.get() : null;
  }
  /**
   * Unique runtime identifier of this primitive.
   *
   * @returns The numeric instance id.
   * @internal
   */
  get id(): number {
    return this._id;
  }
  /**
   * Change tag that increments whenever draw-affecting state changes.
   * Useful for invalidating cached render bundles.
   *
   * @returns The current change tag value.
   */
  get changeTag() {
    return this._changeTag;
  }
  /**
   * Persistent UUID used for serialization and registry lookup.
   *
   * Reassigning this updates the registry entry. Throws if the old entry
   * does not match this instance (integrity check).
   */
  get persistentId() {
    return this._persistentId;
  }
  set persistentId(val) {
    if (val !== this._persistentId) {
      const m = Primitive._registry.get(this._persistentId);
      if (!m || m.get() !== this) {
        throw new Error('Registry primitive mismatch');
      }
      Primitive._registry.delete(this._persistentId);
      this._persistentId = val;
      Primitive._registry.set(this._persistentId, m);
    }
  }
  /**
   * Create a shallow clone: copies topology, draw range, and buffers.
   *
   * Note: Buffers are re-retained on the new primitive.
   *
   * @returns A cloned Primitive instance.
   */
  clone(): Primitive {
    const other = new Primitive();
    other.copyFrom(this);
    return other;
  }
  /**
   * Copy from another primitive.
   *
   * Copies:
   * - All vertex buffers and the index buffer
   * - Primitive type, index start, index count
   *
   * @param other - The source primitive to copy from.
   * @returns void
   */
  copyFrom(other: this) {
    for (const info of other._vertexLayoutOptions.vertexBuffers) {
      this.setVertexBuffer(info.buffer, info.stepMode);
    }
    this.setIndexBuffer(other._vertexLayoutOptions.indexBuffer);
    this.primitiveType = other.primitiveType;
    this.indexStart = other.indexStart;
    this.indexCount = other.indexCount;
  }
  /**
   * Primitive topology.
   */
  get primitiveType() {
    return this._primitiveType;
  }
  set primitiveType(type) {
    if (type !== this._primitiveType) {
      this._primitiveType = type;
      this._changeTag++;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Starting index/vertex for drawing.
   */
  get indexStart() {
    return this._indexStart;
  }
  set indexStart(val) {
    if (val !== this._indexStart) {
      this._indexStart = val;
      this._changeTag++;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Number of indices/vertices to draw.
   */
  get indexCount() {
    this._indexCount = this._indexCount ?? this.calcDefaultIndexCount();
    return this._indexCount;
  }
  set indexCount(val) {
    if (val !== this._indexCount) {
      this._indexCount = val;
      this._changeTag++;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Query total vertex count from the position buffer, if present.
   *
   * @returns Total vertex count; 0 if no position buffer is set.
   */
  getNumVertices(): number {
    const posInfo = this.getVertexBufferInfo('position');
    return posInfo?.buffer ? (posInfo.buffer.byteLength / posInfo.stride) >> 0 : 0;
  }
  /**
   * Query total face/segment count based on topology and buffer size.
   *
   * - For indexed geometry: derived from index buffer.
   * - For non-indexed: derived from position vertex count.
   *
   * @returns Total primitive count for the current topology.
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
   * Remove all vertex buffers that match a given semantic.
   *
   * This releases retained buffers, marks the layout dirty, and invalidates bundles.
   *
   * @param semantic - The vertex semantic to remove (e.g., 'position', 'normal').
   * @returns void
   */
  removeVertexBuffer(semantic: VertexSemantic): void {
    for (let i = this._vertexLayoutOptions.vertexBuffers.length - 1; i >= 0; i--) {
      const info = this._vertexLayoutOptions.vertexBuffers[i];
      if (matchVertexBuffer(info.buffer, semantic)) {
        releaseObject(info.buffer);
        this._vertexLayoutOptions.vertexBuffers.splice(i, 1);
        this._vertexLayoutDirty = true;
      }
    }
    if (this._vertexLayoutDirty) {
      this._changeTag++;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Get the vertex buffer that matches a given semantic.
   *
   * @param semantic - The vertex semantic to look up.
   * @returns The matching vertex buffer, or `null` if not found.
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
   * Get vertex buffer information for a given semantic.
   *
   * @param semantic - The vertex semantic to look up.
   * @returns The `VertexBufferInfo`, or `null` if not found.
   */
  getVertexBufferInfo(semantic: VertexSemantic): VertexBufferInfo {
    this.checkVertexLayout();
    return this._vertexLayout?.getVertexBufferInfo(semantic) ?? null;
  }
  /**
   * Create a vertex buffer from data and add it to the primitive.
   *
   * - For interleaved layouts, pass an array of `VertexAttribFormat`.
   * - For a single attribute, pass a single `VertexAttribFormat`.
   *
   * @param format - Vertex attribute format(s).
   * @param data - Typed array with vertex data.
   * @param stepMode - Optional step mode (e.g., 'vertex', 'instance').
   * @returns The created `StructuredBuffer`.
   */
  createAndSetVertexBuffer(
    format: VertexAttribFormat[] | VertexAttribFormat,
    data: TypedArray,
    stepMode?: VertexStepMode
  ): StructuredBuffer {
    const device = getDevice();
    const buffer = Array.isArray(format)
      ? device.createInterleavedVertexBuffer(format, data)
      : device.createVertexBuffer(format, data);
    return this.setVertexBuffer(buffer, stepMode);
  }
  /**
   * Add an existing vertex buffer to the primitive.
   *
   * Ownership note: The primitive retains the buffer; it will be released or disposed when replaced or on dispose.
   *
   * @param buffer - The vertex buffer to add.
   * @param stepMode - Optional step mode for the buffer.
   * @returns The same buffer.
   */
  setVertexBuffer(buffer: StructuredBuffer, stepMode?: VertexStepMode) {
    retainObject(buffer);
    this._vertexLayoutOptions.vertexBuffers.push({
      buffer,
      stepMode
    });
    this._vertexLayoutDirty = true;
    this._changeTag++;
    RenderBundleWrapper.primitiveChanged(this);
    return buffer;
  }
  /**
   * Create an index buffer from data and set it on the primitive.
   *
   * @param data - Index data as Uint16Array or Uint32Array.
   * @param dynamic - Whether the index buffer is dynamic (unmanaged).
   * @returns The created `IndexBuffer`.
   */
  createAndSetIndexBuffer(
    data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    dynamic?: boolean
  ): IndexBuffer {
    const device = getDevice();
    const buffer = device.createIndexBuffer(data, {
      dynamic: !!dynamic,
      managed: !dynamic
    });
    this.setIndexBuffer(buffer);
    return buffer;
  }
  /**
   * Set or replace the index buffer.
   *
   * Ownership note: The primitive retains the buffer; previous buffer is released.
   * Marks the vertex layout dirty and invalidates bundles.
   *
   * @param buffer - The index buffer to set (non-null).
   * @returns void
   */
  setIndexBuffer(buffer: IndexBuffer): void {
    if (this._vertexLayoutOptions.indexBuffer !== buffer) {
      retainObject(buffer);
      releaseObject(this._vertexLayoutOptions.indexBuffer);
      this._vertexLayoutOptions.indexBuffer = buffer;
      this._vertexLayoutDirty = true;
      this._changeTag++;
      RenderBundleWrapper.primitiveChanged(this);
    }
  }
  /**
   * Get the current index buffer.
   *
   * @returns The index buffer, or `undefined`/`null` if none set.
   */
  getIndexBuffer(): IndexBuffer {
    return this._vertexLayoutOptions.indexBuffer;
  }
  /**
   * Issue a non-instanced draw for the current topology and range.
   *
   * Preconditions: A valid vertex layout and `indexCount > 0`.
   */
  draw() {
    this.checkVertexLayout();
    if (this.indexCount > 0) {
      this._vertexLayout?.draw(this._primitiveType, this._indexStart, this.indexCount);
    }
  }
  /**
   * Issue an instanced draw for the current topology and range.
   *
   * Preconditions: A valid vertex layout and `indexCount > 0`.
   *
   * @param numInstances - Number of instances to draw.
   */
  drawInstanced(numInstances: number): void {
    this.checkVertexLayout();
    if (this.indexCount > 0) {
      this._vertexLayout?.drawInstanced(this._primitiveType, this._indexStart, this.indexCount, numInstances);
    }
  }
  /**
   * Dispose this primitive and release associated GPU resources.
   */
  protected onDispose() {
    super.onDispose();
    const m = Primitive._registry.get(this.persistentId);
    if (m?.get() === this) {
      Primitive._registry.delete(this._persistentId);
      m.dispose();
    }
    this._vertexLayout?.dispose();
    this._vertexLayout = null;
    if (this._vertexLayoutOptions) {
      releaseObject(this._vertexLayoutOptions.indexBuffer);
      for (const info of this._vertexLayoutOptions.vertexBuffers) {
        releaseObject(info.buffer);
      }
      this._vertexLayoutOptions = null;
    }
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
   * Get the bounding volume associated with this primitive.
   *
   * @returns The current bounding volume, or `null` if not set.
   */
  getBoundingVolume(): BoundingVolume {
    return this._bbox;
  }
  /**
   * Set or replace the bounding volume of this primitive.
   *
   * Triggers registered bounding-volume change callbacks.
   *
   * @param bv - The bounding volume to set.
   * @returns void
   */
  setBoundingVolume(bv: BoundingVolume): void {
    if (bv !== this._bbox) {
      this._bbox = bv;
      this.dispatchEvent('bv_changed');
    }
  }
  /**
   * Test intersection against the current axis-aligned bounding box (AABB).
   *
   * @param ray - Ray to test against the primitive's AABB (derived from its bounding volume).
   * @returns The distance from ray origin to the intersection, or `null` if no hit or no AABB.
   */
  raycast(ray: Ray): number {
    const aabb = this.getBoundingVolume()?.toAABB();
    return aabb ? ray.bboxIntersectionTestEx(aabb) : null;
  }
  /** @internal */
  private checkVertexLayout() {
    if (this._vertexLayoutDirty) {
      this._vertexLayout?.dispose();
      const device = getDevice();
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
