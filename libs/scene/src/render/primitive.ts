import type { Nullable } from '@zephyr3d/base';
import {
  Disposable,
  makeObservable,
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
  type GPUDataBuffer,
  type BufferCreationOptions,
  PBPrimitiveType,
  matchVertexBuffer
} from '@zephyr3d/device';
import type { BoundingVolume } from '../utility/bounding_volume';
import { RenderBundleWrapper } from './renderbundle_wrapper';
import { getDevice } from '../app/api';

/**
 * A coarser level of detail of a {@link Primitive}: a range of its index buffer drawing the same
 * vertices with fewer triangles (UE static mesh LODs built from one vertex buffer).
 * @public
 */
export interface PrimitiveLod {
  /** First index of the level */
  indexStart: number;
  /** Number of indices of the level */
  indexCount: number;
  /**
   * Projected bounds size below which the level is used, UE's LOD ScreenSize: the diameter of the
   * bounding sphere over the half screen extent (see computeBoundsScreenSize)
   */
  screenSize: number;
  /**
   * Added to screenSize when switching back to a finer level, so the level does not flip at the
   * threshold every frame (UE skeletal mesh LODHysteresis)
   */
  hysteresis: number;
}

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
 * @public
 */
export class Primitive
  extends makeObservable(Disposable)<{
    bv_changed: [];
  }>()
  implements Clonable<Primitive>
{
  /** @internal Current vertex layout object (created lazily from options). */
  protected _vertexLayout: Nullable<VertexLayout>;
  /** @internal Mutable options used to build the vertex layout. */
  protected _vertexLayoutOptions: VertexLayoutOptions;
  /** @internal Primitive topology (e.g., 'triangle-list', 'line-strip'). */
  protected _primitiveType: PrimitiveType;
  /** @internal First index/vertex to draw. */
  protected _indexStart: number;
  /** @internal Number of indices/vertices to draw (computed lazily if null). */
  protected _indexCount: Nullable<number>;
  /** @internal Cached default index count (derived when needed). */
  protected _defaultIndexCount: number;
  /** @internal Marks layout dirty when buffers/topology change. */
  protected _vertexLayoutDirty: boolean;
  /** @internal Monotonic runtime id. */
  private static _nextId = 0;
  /** @internal Unique runtime id for the instance. */
  protected _id: number;
  /** @internal Optional bounding volume for culling/raycast. */
  protected _bbox: Nullable<BoundingVolume>;
  /** @internal Change tag increments when draw-affecting state changes. */
  private _changeTag: number;
  /** @internal Levels of detail after the first, finest to coarsest */
  protected _lods: PrimitiveLod[];
  /** @internal Line list of the triangle edges, see getWireframe() */
  private _wireframe: Nullable<Primitive>;
  /** @internal Change tag the wireframe was built or is being built for, -1 for none */
  private _wireframeTag: number;
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
    this._changeTag = 0;
    this._bbox = null;
    this._lods = [];
    this._wireframe = null;
    this._wireframeTag = -1;
  }
  /**
   * Unique runtime identifier of this primitive.
   *
   * @returns The numeric instance id.
   * @public
   */
  get id() {
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
   * Create a shallow clone: copies topology, draw range, and buffers.
   *
   * Note: Buffers are re-retained on the new primitive.
   *
   * @returns A cloned Primitive instance.
   */
  clone() {
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
    this.setIndexBuffer(other._vertexLayoutOptions.indexBuffer ?? null);
    this.primitiveType = other.primitiveType;
    this.indexStart = other.indexStart;
    this.indexCount = other.indexCount;
    this.lods = other.lods;
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
   * Levels of detail after the first, finest to coarsest, each a range of the index buffer.
   * Level 0 is the draw range given by indexStart and indexCount. Empty by default.
   */
  get lods(): readonly Readonly<PrimitiveLod>[] {
    return this._lods;
  }
  set lods(val: readonly Readonly<PrimitiveLod>[]) {
    this._lods = (val ?? []).map((lod) => ({ ...lod }));
    this._changeTag++;
    RenderBundleWrapper.primitiveChanged(this);
  }
  /**
   * Number of levels of detail, the first one included
   */
  get lodCount() {
    return this._lods.length + 1;
  }
  /**
   * Query total vertex count from the position buffer, if present.
   *
   * @returns Total vertex count; 0 if no position buffer is set.
   */
  getNumVertices() {
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
  getNumFaces() {
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
  removeVertexBuffer(semantic: VertexSemantic) {
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
  getVertexBuffer(semantic: VertexSemantic) {
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
  getVertexBufferInfo(semantic: VertexSemantic) {
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
   * @param options - Optional buffer creation options, e.g. `dynamic` for data rewritten often.
   * @returns The created `StructuredBuffer`.
   */
  createAndSetVertexBuffer(
    format: VertexAttribFormat[] | VertexAttribFormat,
    data: TypedArray,
    stepMode?: VertexStepMode,
    options?: BufferCreationOptions
  ) {
    const device = getDevice();
    const buffer = Array.isArray(format)
      ? device.createInterleavedVertexBuffer(format, data, options)!
      : device.createVertexBuffer(format, data, options)!;
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
  createAndSetIndexBuffer(data: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, dynamic?: boolean) {
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
  setIndexBuffer(buffer: Nullable<IndexBuffer>) {
    if (this._vertexLayoutOptions.indexBuffer !== buffer) {
      retainObject(buffer);
      releaseObject(this._vertexLayoutOptions.indexBuffer ?? null);
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
  getIndexBuffer() {
    return this._vertexLayoutOptions.indexBuffer ?? null;
  }
  /**
   * Issue a non-instanced draw for the current topology and range.
   *
   * Preconditions: A valid vertex layout and `indexCount > 0`.
   *
   * @param lod - Level of detail to draw, clamped to the available levels. Default 0.
   */
  draw(lod = 0) {
    this.checkVertexLayout();
    const [start, count] = this.getLodRange(lod);
    if (count > 0) {
      this._vertexLayout?.draw(this._primitiveType, start, count);
    }
  }
  /**
   * Issue an instanced draw for the current topology and range.
   *
   * Preconditions: A valid vertex layout and `indexCount > 0`.
   *
   * @param numInstances - Number of instances to draw.
   * @param lod - Level of detail to draw, clamped to the available levels. Default 0.
   */
  drawInstanced(numInstances: number, lod = 0) {
    this.checkVertexLayout();
    const [start, count] = this.getLodRange(lod);
    if (count > 0) {
      this._vertexLayout?.drawInstanced(this._primitiveType, start, count, numInstances);
    }
  }
  /** @internal Draw range of a level of detail as [indexStart, indexCount] */
  getLodRange(lod: number): [number, number] {
    if (lod > 0 && this._lods.length > 0) {
      const level = this._lods[Math.min(lod, this._lods.length) - 1];
      return [level.indexStart, level.indexCount];
    }
    return [this._indexStart, this.indexCount];
  }
  /**
   * Issue a draw whose arguments are read from a GPU buffer, typically written by a compute pass
   * (WebGPU only, see `MiscCaps.supportDrawIndirect`).
   *
   * Uses `drawIndexedIndirect` when the primitive has an index buffer and `drawIndirect`
   * otherwise. The buffer supplies the whole range and instance count, so `indexStart` and
   * `indexCount` are ignored. It must be created with the 'indirect' usage and hold, at
   * `indirectOffset`, five uint32 values (indexCount, instanceCount, firstIndex, baseVertex,
   * firstInstance) for indexed primitives or four (vertexCount, instanceCount, firstVertex,
   * firstInstance) otherwise. A non-zero firstInstance needs the 'indirect-first-instance'
   * feature.
   *
   * Render bundles capturing an indirect draw read the arguments when they are executed.
   *
   * @param indirectBuffer - Buffer holding the draw arguments.
   * @param indirectOffset - Byte offset of the arguments, a multiple of 4.
   */
  drawIndirect(indirectBuffer: GPUDataBuffer, indirectOffset = 0) {
    this.checkVertexLayout();
    if (this._vertexLayout) {
      const device = getDevice();
      device.setVertexLayout(this._vertexLayout);
      if (this.getIndexBuffer()) {
        device.drawIndexedIndirect(this._primitiveType, indirectBuffer, indirectOffset);
      } else {
        device.drawIndirect(this._primitiveType, indirectBuffer, indirectOffset);
      }
    }
  }
  /**
   * The triangle edges of this primitive as a line list over the same vertex buffers, for
   * wireframe display: one range of the index buffer per level of detail, so it draws at the same
   * levels. Built asynchronously from the index buffer, which is read back from the GPU; returns
   * null until ready, after any change to this primitive, and for primitives that are not
   * triangle lists.
   */
  getWireframe(): Nullable<Primitive> {
    if (this._primitiveType !== 'triangle-list') {
      return null;
    }
    if (this._wireframeTag !== this._changeTag) {
      this._wireframeTag = this._changeTag;
      this._wireframe?.dispose();
      this._wireframe = null;
      const tag = this._changeTag;
      this.buildWireframe().then(
        (wireframe) => {
          // Superseded by a change made while reading back
          if (this.disposed || this._wireframeTag !== tag) {
            wireframe?.dispose();
          } else {
            this._wireframe = wireframe;
          }
        },
        (err) => console.error(`Building the wireframe of a primitive failed: ${err}`)
      );
    }
    return this._wireframe;
  }
  /** @internal */
  private async buildWireframe() {
    const numVertices = this.getNumVertices();
    if (numVertices <= 0) {
      return null;
    }
    const ib = this.getIndexBuffer();
    let indices: ArrayLike<number>;
    if (ib) {
      const bytes = await ib.getBufferSubData();
      indices =
        ib.indexType.primitiveType === PBPrimitiveType.U16
          ? new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
          : new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
    } else {
      indices = Array.from({ length: numVertices }, (_, i) => i);
    }
    const ranges: [number, number][] = [
      [this._indexStart, this.indexCount],
      ...this._lods.map((lod): [number, number] => [lod.indexStart, lod.indexCount])
    ];
    // Each triangle edge once per level, whichever triangle lists it first
    const lines: number[] = [];
    const lineRanges: [number, number][] = [];
    for (const [start, count] of ranges) {
      const first = lines.length;
      const seen = new Set<number>();
      const end = Math.min(start + count, indices.length);
      for (let i = start; i + 2 < end; i += 3) {
        for (let e = 0; e < 3; e++) {
          const a = indices[i + e];
          const b = indices[i + ((e + 1) % 3)];
          const key = a < b ? a * numVertices + b : b * numVertices + a;
          if (!seen.has(key)) {
            seen.add(key);
            lines.push(a, b);
          }
        }
      }
      lineRanges.push([first, lines.length - first]);
    }
    const wireframe = new Primitive();
    for (const info of this._vertexLayoutOptions.vertexBuffers) {
      wireframe.setVertexBuffer(info.buffer, info.stepMode);
    }
    wireframe.createAndSetIndexBuffer(numVertices > 0xffff ? new Uint32Array(lines) : new Uint16Array(lines));
    wireframe.primitiveType = 'line-list';
    wireframe.indexStart = lineRanges[0][0];
    wireframe.indexCount = lineRanges[0][1];
    wireframe.lods = this._lods.map((lod, i) => ({
      ...lod,
      indexStart: lineRanges[i + 1][0],
      indexCount: lineRanges[i + 1][1]
    }));
    if (this._bbox) {
      wireframe.setBoundingVolume(this._bbox);
    }
    return wireframe;
  }
  /**
   * Dispose this primitive and release associated GPU resources.
   */
  protected onDispose() {
    super.onDispose();
    this._wireframe?.dispose();
    this._wireframe = null;
    this._vertexLayout?.dispose();
    this._vertexLayout = null;
    if (this._vertexLayoutOptions) {
      releaseObject(this._vertexLayoutOptions.indexBuffer ?? null);
      for (const info of this._vertexLayoutOptions.vertexBuffers) {
        releaseObject(info.buffer);
      }
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
  getBoundingVolume() {
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
  setBoundingVolume(bv: BoundingVolume) {
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
  raycast(ray: Ray) {
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
  private calcDefaultIndexCount() {
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
