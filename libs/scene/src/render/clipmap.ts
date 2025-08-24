/**
 * copy from http://git.mikejsavage.co.uk/medfall/file/clipmap.cc.html#l197
 */

import type { Vector4 } from '@zephyr3d/base';
import { AABB, ClipState, Disposable, Matrix4x4, Vector2, Vector3 } from '@zephyr3d/base';
import type { Camera } from '../camera';
import { Primitive } from './primitive';
import {
  getVertexAttributeFormat,
  getVertexAttributeIndex,
  VERTEX_ATTRIB_POSITION,
  VERTEX_ATTRIB_TEXCOORD0,
  type VertexAttribFormat
} from '@zephyr3d/device';

const tmpAABB = new AABB();
const tmpV3 = new Vector3();
const rotationValues = [0, Math.PI * 1.5, Math.PI * 0.5, Math.PI] as const;

/** @internal */
export type PrimitiveInstanceInfo = {
  primitive: Primitive;
  numInstances: number;
  instanceDatas: Float32Array<ArrayBuffer>;
  mipLevels: Float32Array<ArrayBuffer>;
  maxMiplevel: number;
};
/** @internal */
export interface ClipmapGatherContext {
  camera: Camera;
  gridScale: number;
  minMaxWorldPos: Vector4;
  userData: unknown;
  calcAABB(
    userData: unknown,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    outAABB: AABB,
    level: number
  );
}

/** @internal */
export interface ClipmapDrawContext extends ClipmapGatherContext {
  drawPrimitive(
    prim: Primitive,
    rotation: number,
    offset: Vector2,
    scale: number,
    gridScale: number,
    level: number
  );
}

/** @internal */
export class Clipmap extends Disposable {
  private readonly _instanceDataPool: Float32Array<ArrayBuffer>[];
  private _instanceDataPoolSize: number;
  private readonly _mipLevelDataPool: Float32Array<ArrayBuffer>[];
  private _mipLevelDataPoolSize: number;
  private readonly _nonInstanceDataPool: Float32Array<ArrayBuffer>[];
  private _nonInstanceDataPoolSize: number;
  private readonly _nonInstanceMipLevelDataPool: Float32Array<ArrayBuffer>[];
  private _nonInstanceMipLevelDataPoolSize: number;
  private readonly _extraInstanceBuffers: VertexAttribFormat[];
  private _tileResolution: number;
  private readonly _maxMipLevels: number;

  private _tileMesh: Primitive;
  private _tileMeshLines: Primitive;
  private _tileMeshBBox: AABB;

  private _fillerMesh: Primitive;
  private _fillerMeshLines: Primitive;
  private _fillerMeshAABB: AABB;

  private _trimMesh: Primitive;
  private _trimMeshLines: Primitive;
  private _trimMeshAABB: AABB;

  private _crossMesh: Primitive;
  private _crossMeshLines: Primitive;
  private _crossMeshAABB: AABB;

  private _seamMesh: Primitive;
  private _seamMeshLines: Primitive;
  private _seamMeshAABB: AABB;

  private _wireframe: boolean;

  constructor(resolution: number, extraInstanceBuffers: VertexAttribFormat[], maxMipLevels = 64) {
    super();
    if (
      extraInstanceBuffers &&
      extraInstanceBuffers.findIndex(
        (val) =>
          getVertexAttributeIndex(val) === VERTEX_ATTRIB_POSITION ||
          getVertexAttributeIndex(val) === VERTEX_ATTRIB_TEXCOORD0 ||
          getVertexAttributeFormat(val) !== 'f32'
      ) >= 0
    ) {
      throw new Error(
        'Extra instance buffers must be f32 format and cannot have vertex attribute of POSITOIN and TEXCOORD0'
      );
    }
    this._extraInstanceBuffers = extraInstanceBuffers?.slice() ?? [];
    this._tileResolution = resolution;
    this._maxMipLevels = Math.min(64, Math.max(1, maxMipLevels >>> 0));
    this._instanceDataPool = [];
    this._instanceDataPoolSize = 0;
    this._mipLevelDataPool = [];
    this._mipLevelDataPoolSize = 0;
    this._nonInstanceDataPool = [];
    this._nonInstanceDataPoolSize = 0;
    this._nonInstanceMipLevelDataPool = [];
    this._nonInstanceMipLevelDataPoolSize = 0;
    this._wireframe = false;
    this.generateCrossMesh();
    this.generateFillerMesh();
    this.generateSeamMesh();
    this.generateTileMesh();
    this.generateTrimMesh();
  }
  get wireframe() {
    return this._wireframe;
  }
  set wireframe(val: boolean) {
    this._wireframe = !!val;
  }
  get tileResolution() {
    return this._tileResolution;
  }
  set tileResolution(val: number) {
    if (val !== this._tileResolution) {
      this._tileResolution = val;
      this.generateCrossMesh();
      this.generateFillerMesh();
      this.generateSeamMesh();
      this.generateTileMesh();
      this.generateTrimMesh();
    }
  }
  private allocInstanceBuffer(): Float32Array<ArrayBuffer> {
    if (this._instanceDataPoolSize === 0) {
      const buffer = new Float32Array(this._maxMipLevels * 16 * 4);
      this._instanceDataPool.push(buffer);
      return buffer;
    } else {
      return this._instanceDataPool[--this._instanceDataPoolSize];
    }
  }
  private allocNonInstanceBuffer(x: number, y: number, z: number, w: number): Float32Array<ArrayBuffer> {
    let buffer: Float32Array<ArrayBuffer>;
    if (this._nonInstanceDataPoolSize === 0) {
      buffer = new Float32Array(4);
      this._nonInstanceDataPool.push(buffer);
    } else {
      buffer = this._nonInstanceDataPool[--this._nonInstanceDataPoolSize];
    }
    buffer[0] = x;
    buffer[1] = y;
    buffer[2] = z;
    buffer[3] = w;
    return buffer;
  }
  private allocMipLevelBuffer(): Float32Array<ArrayBuffer> {
    if (this._mipLevelDataPoolSize === 0) {
      const buffer = new Float32Array(this._maxMipLevels * 16);
      this._mipLevelDataPool.push(buffer);
      return buffer;
    } else {
      return this._mipLevelDataPool[--this._mipLevelDataPoolSize];
    }
  }
  private allocNonInstanceMipLevelBuffer(val: number): Float32Array<ArrayBuffer> {
    let buffer: Float32Array<ArrayBuffer>;
    if (this._nonInstanceMipLevelDataPoolSize === 0) {
      buffer = new Float32Array(1);
      this._nonInstanceMipLevelDataPool.push(buffer);
    } else {
      buffer = this._nonInstanceMipLevelDataPool[--this._nonInstanceMipLevelDataPoolSize];
    }
    buffer[0] = val;
    return buffer;
  }
  private patch2d(tileResolution: number, x: number, y: number) {
    return y * (tileResolution + 1) + x;
  }
  private calcAABB(vertices: Float32Array): AABB {
    let maxX = -Number.MAX_VALUE;
    let maxY = -Number.MAX_VALUE;
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    for (let i = 0; i < vertices.length / 3; i++) {
      const x = vertices[i * 3 + 0];
      const y = vertices[i * 3 + 1];
      if (x > maxX) {
        maxX = x;
      }
      if (x < minX) {
        minX = x;
      }
      if (y > maxY) {
        maxY = y;
      }
      if (y < minY) {
        minY = y;
      }
    }
    return new AABB(new Vector3(minX, minY, 0), new Vector3(maxX, maxY, 0));
  }
  generateTileMesh() {
    this._tileMesh?.dispose();
    this._tileMesh = new Primitive();
    const patchVertResolution = this._tileResolution + 1;
    const vertices = new Float32Array(patchVertResolution * patchVertResolution * 3);
    let n = 0;
    for (let y = 0; y < patchVertResolution; y++) {
      for (let x = 0; x < patchVertResolution; x++) {
        vertices[n++] = x;
        vertices[n++] = y;
        vertices[n++] = 0;
      }
    }
    n = 0;
    const indices = new Uint16Array(this._tileResolution * this._tileResolution * 6);
    for (let y = 0; y < this._tileResolution; y++) {
      for (let x = 0; x < this._tileResolution; x++) {
        indices[n++] = this.patch2d(this._tileResolution, x, y);
        indices[n++] = this.patch2d(this._tileResolution, x, y + 1);
        indices[n++] = this.patch2d(this._tileResolution, x + 1, y + 1);
        indices[n++] = this.patch2d(this._tileResolution, x, y);
        indices[n++] = this.patch2d(this._tileResolution, x + 1, y + 1);
        indices[n++] = this.patch2d(this._tileResolution, x + 1, y);
      }
    }
    this._tileMesh.createAndSetVertexBuffer('position_f32x3', vertices);
    this._tileMesh.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._tileMesh.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._tileMesh.createAndSetIndexBuffer(indices);
    this._tileMesh.indexStart = 0;
    this._tileMesh.indexCount = indices.length;
    this._tileMesh.primitiveType = 'triangle-list';
    this._tileMeshBBox = this.calcAABB(vertices);

    const indicesLines = new Uint16Array(indices.length * 2);
    for (let i = 0; i < indices.length / 3; i++) {
      indicesLines[i * 6 + 0] = indices[i * 3 + 0];
      indicesLines[i * 6 + 1] = indices[i * 3 + 1];
      indicesLines[i * 6 + 2] = indices[i * 3 + 1];
      indicesLines[i * 6 + 3] = indices[i * 3 + 2];
      indicesLines[i * 6 + 4] = indices[i * 3 + 2];
      indicesLines[i * 6 + 5] = indices[i * 3 + 0];
    }
    this._tileMeshLines?.dispose();
    this._tileMeshLines = new Primitive();
    this._tileMeshLines.setVertexBuffer(this._tileMesh.getVertexBuffer('position'));
    this._tileMeshLines.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._tileMeshLines.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._tileMeshLines.createAndSetIndexBuffer(indicesLines);
    this._tileMeshLines.indexStart = 0;
    this._tileMeshLines.indexCount = indicesLines.length;
    this._tileMeshLines.primitiveType = 'line-list';
  }
  generateFillerMesh() {
    this._fillerMesh?.dispose();
    this._fillerMesh = new Primitive();
    const patchVertResolution = this._tileResolution + 1;
    const vertices = new Float32Array(patchVertResolution * 8 * 3);
    let n = 0;
    const offset = this._tileResolution;
    for (let i = 0; i < patchVertResolution; i++) {
      vertices[n++] = offset + i + 1;
      vertices[n++] = 0;
      vertices[n++] = 0;
      vertices[n++] = offset + i + 1;
      vertices[n++] = 1;
      vertices[n++] = 0;
    }
    for (let i = 0; i < patchVertResolution; i++) {
      vertices[n++] = 1;
      vertices[n++] = offset + i + 1;
      vertices[n++] = 0;
      vertices[n++] = 0;
      vertices[n++] = offset + i + 1;
      vertices[n++] = 0;
    }
    for (let i = 0; i < patchVertResolution; i++) {
      vertices[n++] = -offset - i;
      vertices[n++] = 1;
      vertices[n++] = 0;
      vertices[n++] = -offset - i;
      vertices[n++] = 0;
      vertices[n++] = 0;
    }
    for (let i = 0; i < patchVertResolution; i++) {
      vertices[n++] = 0;
      vertices[n++] = -offset - i;
      vertices[n++] = 0;
      vertices[n++] = 1;
      vertices[n++] = -offset - i;
      vertices[n++] = 0;
    }
    n = 0;
    const indices = new Uint16Array(this._tileResolution * 24);
    for (let i = 0; i < this._tileResolution * 4; i++) {
      const arm = (i / this._tileResolution) >> 0;
      const bl = (arm + i) * 2 + 0;
      const br = (arm + i) * 2 + 1;
      const tl = (arm + i) * 2 + 2;
      const tr = (arm + i) * 2 + 3;
      if (arm % 2 === 0) {
        indices[n++] = br;
        indices[n++] = tr;
        indices[n++] = bl;
        indices[n++] = bl;
        indices[n++] = tr;
        indices[n++] = tl;
      } else {
        indices[n++] = br;
        indices[n++] = tl;
        indices[n++] = bl;
        indices[n++] = br;
        indices[n++] = tr;
        indices[n++] = tl;
      }
    }
    this._fillerMesh.createAndSetVertexBuffer('position_f32x3', vertices);
    this._fillerMesh.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._fillerMesh.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._fillerMesh.createAndSetIndexBuffer(indices);
    this._fillerMesh.indexStart = 0;
    this._fillerMesh.indexCount = indices.length;
    this._fillerMesh.primitiveType = 'triangle-list';
    this._fillerMeshAABB = this.calcAABB(vertices);

    const indicesLines = new Uint16Array(indices.length * 2);
    for (let i = 0; i < indices.length / 3; i++) {
      indicesLines[i * 6 + 0] = indices[i * 3 + 0];
      indicesLines[i * 6 + 1] = indices[i * 3 + 1];
      indicesLines[i * 6 + 2] = indices[i * 3 + 1];
      indicesLines[i * 6 + 3] = indices[i * 3 + 2];
      indicesLines[i * 6 + 4] = indices[i * 3 + 2];
      indicesLines[i * 6 + 5] = indices[i * 3 + 0];
    }
    this._fillerMeshLines?.dispose();
    this._fillerMeshLines = new Primitive();
    this._fillerMeshLines.setVertexBuffer(this._fillerMesh.getVertexBuffer('position'));
    this._fillerMeshLines.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._fillerMeshLines.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._fillerMeshLines.createAndSetIndexBuffer(indicesLines);
    this._fillerMeshLines.indexStart = 0;
    this._fillerMeshLines.indexCount = indicesLines.length;
    this._fillerMeshLines.primitiveType = 'line-list';
  }
  generateTrimMesh() {
    this._trimMesh?.dispose();
    this._trimMesh = new Primitive();
    const clipmapVertResolution = this._tileResolution * 4 + 2;
    const vertices = new Float32Array((clipmapVertResolution * 2 + 1) * 2 * 3);
    let n = 0;
    const d = 0.5 * (clipmapVertResolution + 1);
    for (let i = 0; i < clipmapVertResolution + 1; i++) {
      vertices[n++] = 0 - d;
      vertices[n++] = clipmapVertResolution - i - d;
      vertices[n++] = 0;
      vertices[n++] = 1 - d;
      vertices[n++] = clipmapVertResolution - i - d;
      vertices[n++] = 0;
    }
    const startOfHorizonal = n / 3;
    for (let i = 0; i < clipmapVertResolution; i++) {
      vertices[n++] = i + 1 - d;
      vertices[n++] = 0 - d;
      vertices[n++] = 0;
      vertices[n++] = i + 1 - d;
      vertices[n++] = 1 - d;
      vertices[n++] = 0;
    }
    n = 0;
    const indices = new Uint16Array((clipmapVertResolution * 2 - 1) * 6);
    for (let i = 0; i < clipmapVertResolution; i++) {
      indices[n++] = (i + 0) * 2 + 1;
      indices[n++] = (i + 1) * 2 + 0;
      indices[n++] = (i + 0) * 2 + 0;
      indices[n++] = (i + 1) * 2 + 1;
      indices[n++] = (i + 1) * 2 + 0;
      indices[n++] = (i + 0) * 2 + 1;
    }
    for (let i = 0; i < clipmapVertResolution - 1; i++) {
      indices[n++] = startOfHorizonal + (i + 0) * 2 + 1;
      indices[n++] = startOfHorizonal + (i + 1) * 2 + 0;
      indices[n++] = startOfHorizonal + (i + 0) * 2 + 0;
      indices[n++] = startOfHorizonal + (i + 1) * 2 + 1;
      indices[n++] = startOfHorizonal + (i + 1) * 2 + 0;
      indices[n++] = startOfHorizonal + (i + 0) * 2 + 1;
    }
    this._trimMesh.createAndSetVertexBuffer('position_f32x3', vertices);
    this._trimMesh.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._trimMesh.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._trimMesh.createAndSetIndexBuffer(indices);
    this._trimMesh.indexStart = 0;
    this._trimMesh.indexCount = indices.length;
    this._trimMesh.primitiveType = 'triangle-list';
    this._trimMeshAABB = this.calcAABB(vertices);

    const indicesLines = new Uint16Array(indices.length * 2);
    for (let i = 0; i < indices.length / 3; i++) {
      indicesLines[i * 6 + 0] = indices[i * 3 + 0];
      indicesLines[i * 6 + 1] = indices[i * 3 + 1];
      indicesLines[i * 6 + 2] = indices[i * 3 + 1];
      indicesLines[i * 6 + 3] = indices[i * 3 + 2];
      indicesLines[i * 6 + 4] = indices[i * 3 + 2];
      indicesLines[i * 6 + 5] = indices[i * 3 + 0];
    }
    this._trimMeshLines?.dispose();
    this._trimMeshLines = new Primitive();
    this._trimMeshLines.setVertexBuffer(this._trimMesh.getVertexBuffer('position'));
    this._trimMeshLines.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._trimMeshLines.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._trimMeshLines.createAndSetIndexBuffer(indicesLines);
    this._trimMeshLines.indexStart = 0;
    this._trimMeshLines.indexCount = indicesLines.length;
    this._trimMeshLines.primitiveType = 'line-list';
  }
  generateCrossMesh() {
    const patchVertResolution = this._tileResolution + 1;
    const vertices = new Float32Array(patchVertResolution * 8 * 3);
    let n = 0;
    for (let i = 0; i < patchVertResolution * 2; i++) {
      vertices[n++] = i - this._tileResolution;
      vertices[n++] = 0;
      vertices[n++] = 0;
      vertices[n++] = i - this._tileResolution;
      vertices[n++] = 1;
      vertices[n++] = 0;
    }
    const startOfVertical = n / 3;
    for (let i = 0; i < patchVertResolution * 2; i++) {
      vertices[n++] = 0;
      vertices[n++] = i - this._tileResolution;
      vertices[n++] = 0;
      vertices[n++] = 1;
      vertices[n++] = i - this._tileResolution;
      vertices[n++] = 0;
    }
    n = 0;
    const indices = new Uint16Array(this._tileResolution * 24 + 6);
    for (let i = 0; i < this._tileResolution * 2 + 1; i++) {
      const bl = i * 2 + 0;
      const br = i * 2 + 1;
      const tl = i * 2 + 2;
      const tr = i * 2 + 3;
      indices[n++] = br;
      indices[n++] = tr;
      indices[n++] = bl;
      indices[n++] = bl;
      indices[n++] = tr;
      indices[n++] = tl;
    }
    for (let i = 0; i < this._tileResolution * 2 + 1; i++) {
      if (i === this._tileResolution) {
        continue;
      }
      const bl = i * 2 + 0;
      const br = i * 2 + 1;
      const tl = i * 2 + 2;
      const tr = i * 2 + 3;
      indices[n++] = startOfVertical + br;
      indices[n++] = startOfVertical + bl;
      indices[n++] = startOfVertical + tr;
      indices[n++] = startOfVertical + bl;
      indices[n++] = startOfVertical + tl;
      indices[n++] = startOfVertical + tr;
    }
    this._crossMesh?.dispose();
    this._crossMesh = new Primitive();
    this._crossMesh.createAndSetVertexBuffer('position_f32x3', vertices);
    this._crossMesh.createAndSetVertexBuffer(
      'tex0_f32x4',
      this.allocNonInstanceBuffer(0, 0, 0, 0),
      'instance'
    );
    this._nonInstanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._crossMesh.createAndSetVertexBuffer(fmt, this.allocNonInstanceBuffer(0, 0, 0, 0), 'instance');
      this._nonInstanceDataPoolSize++;
    }
    this._crossMesh.createAndSetIndexBuffer(indices);
    this._crossMesh.indexStart = 0;
    this._crossMesh.indexCount = indices.length;
    this._crossMesh.primitiveType = 'triangle-list';
    this._crossMeshAABB = this.calcAABB(vertices);

    const indicesLines = new Uint16Array(indices.length * 2);
    for (let i = 0; i < indices.length / 3; i++) {
      indicesLines[i * 6 + 0] = indices[i * 3 + 0];
      indicesLines[i * 6 + 1] = indices[i * 3 + 1];
      indicesLines[i * 6 + 2] = indices[i * 3 + 1];
      indicesLines[i * 6 + 3] = indices[i * 3 + 2];
      indicesLines[i * 6 + 4] = indices[i * 3 + 2];
      indicesLines[i * 6 + 5] = indices[i * 3 + 0];
    }
    this._crossMeshLines?.dispose();
    this._crossMeshLines = new Primitive();
    this._crossMeshLines.setVertexBuffer(this._crossMesh.getVertexBuffer('position'));
    this._crossMeshLines.createAndSetVertexBuffer(
      'tex0_f32x4',
      this.allocNonInstanceBuffer(0, 0, 0, 0),
      'instance'
    );
    this._nonInstanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._crossMeshLines.createAndSetVertexBuffer(fmt, this.allocNonInstanceBuffer(0, 0, 0, 0), 'instance');
      this._nonInstanceDataPoolSize++;
    }
    this._crossMeshLines.createAndSetIndexBuffer(indicesLines);
    this._crossMeshLines.indexStart = 0;
    this._crossMeshLines.indexCount = indicesLines.length;
    this._crossMeshLines.primitiveType = 'line-list';
  }
  generateSeamMesh() {
    this._seamMesh?.dispose();
    this._seamMesh = new Primitive();
    const clipmapVertResolution = this._tileResolution * 4 + 2;
    const vertices = new Float32Array(clipmapVertResolution * 4 * 3);
    for (let i = 0; i < clipmapVertResolution; i++) {
      vertices[(clipmapVertResolution * 0 + i) * 3 + 0] = i;
      vertices[(clipmapVertResolution * 0 + i) * 3 + 1] = 0;
      vertices[(clipmapVertResolution * 0 + i) * 3 + 2] = 0;
      vertices[(clipmapVertResolution * 1 + i) * 3 + 0] = clipmapVertResolution;
      vertices[(clipmapVertResolution * 1 + i) * 3 + 1] = i;
      vertices[(clipmapVertResolution * 1 + i) * 3 + 2] = 0;
      vertices[(clipmapVertResolution * 2 + i) * 3 + 0] = clipmapVertResolution - i;
      vertices[(clipmapVertResolution * 2 + i) * 3 + 1] = clipmapVertResolution;
      vertices[(clipmapVertResolution * 2 + i) * 3 + 2] = 0;
      vertices[(clipmapVertResolution * 3 + i) * 3 + 0] = 0;
      vertices[(clipmapVertResolution * 3 + i) * 3 + 1] = clipmapVertResolution - i;
      vertices[(clipmapVertResolution * 3 + i) * 3 + 2] = 0;
    }
    const indices = new Uint16Array(clipmapVertResolution * 6);
    let n = 0;
    for (let i = 0; i < clipmapVertResolution * 4; i += 2) {
      indices[n++] = i + 1;
      indices[n++] = i + 2;
      indices[n++] = i;
    }
    indices[indices.length - 1] = 0;
    this._seamMesh.createAndSetVertexBuffer('position_f32x3', vertices);
    this._seamMesh.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._seamMesh.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._seamMesh.createAndSetIndexBuffer(indices);
    this._seamMesh.indexStart = 0;
    this._seamMesh.indexCount = indices.length;
    this._seamMesh.primitiveType = 'triangle-list';
    this._seamMeshAABB = this.calcAABB(vertices);

    const indicesLines = new Uint16Array(indices.length * 2);
    for (let i = 0; i < indices.length / 3; i++) {
      indicesLines[i * 6 + 0] = indices[i * 3 + 0];
      indicesLines[i * 6 + 1] = indices[i * 3 + 1];
      indicesLines[i * 6 + 2] = indices[i * 3 + 1];
      indicesLines[i * 6 + 3] = indices[i * 3 + 2];
      indicesLines[i * 6 + 4] = indices[i * 3 + 2];
      indicesLines[i * 6 + 5] = indices[i * 3 + 0];
    }
    this._seamMeshLines?.dispose();
    this._seamMeshLines = new Primitive();
    this._seamMeshLines.setVertexBuffer(this._seamMesh.getVertexBuffer('position'));
    this._seamMeshLines.createAndSetVertexBuffer('tex0_f32x4', this.allocInstanceBuffer(), 'instance');
    this._instanceDataPoolSize++;
    for (const fmt of this._extraInstanceBuffers) {
      this._seamMeshLines.createAndSetVertexBuffer(fmt, this.allocInstanceBuffer(), 'instance');
      this._instanceDataPoolSize++;
    }
    this._seamMeshLines.createAndSetIndexBuffer(indicesLines);
    this._seamMeshLines.indexStart = 0;
    this._seamMeshLines.indexCount = indicesLines.length;
    this._seamMeshLines.primitiveType = 'line-list';
  }
  private intervalsOverlap(a0: number, a1: number, b0: number, b1: number) {
    return a0 <= b1 && b0 <= a1;
  }
  private updateAABB(
    aabb: AABB,
    rotation: number,
    offset: Vector2,
    scale: number,
    gridScale: number,
    outAABB: AABB
  ) {
    if (!rotation) {
      tmpAABB.minPoint.set(aabb.minPoint);
      tmpAABB.maxPoint.set(aabb.maxPoint);
    } else {
      AABB.transform(aabb, Matrix4x4.rotationZ(rotation), tmpAABB);
    }
    const minX = (tmpAABB.minPoint.x * scale + offset.x) * gridScale;
    const maxX = (tmpAABB.maxPoint.x * scale + offset.x) * gridScale;
    const minZ = (tmpAABB.minPoint.y * scale + offset.y) * gridScale;
    const maxZ = (tmpAABB.maxPoint.y * scale + offset.y) * gridScale;
    if (minX < outAABB.minPoint.x) {
      outAABB.minPoint.x = minX;
    }
    if (maxX > outAABB.maxPoint.x) {
      outAABB.maxPoint.x = maxX;
    }
    if (minZ < outAABB.minPoint.z) {
      outAABB.minPoint.z = minZ;
    }
    if (maxZ > outAABB.maxPoint.z) {
      outAABB.maxPoint.z = maxZ;
    }
  }
  private visible(
    ctx: ClipmapGatherContext,
    aabb: AABB,
    camera: Camera,
    rotation: number,
    offset: Vector2,
    scale: number,
    gridScale: number,
    level: number
  ) {
    if (!rotation) {
      tmpAABB.minPoint.set(aabb.minPoint);
      tmpAABB.maxPoint.set(aabb.maxPoint);
    } else {
      AABB.transform(aabb, Matrix4x4.rotationZ(rotation), tmpAABB);
    }
    const minX = (tmpAABB.minPoint.x * scale + offset.x) * gridScale;
    const maxX = (tmpAABB.maxPoint.x * scale + offset.x) * gridScale;
    const minZ = (tmpAABB.minPoint.y * scale + offset.y) * gridScale;
    const maxZ = (tmpAABB.maxPoint.y * scale + offset.y) * gridScale;
    ctx.calcAABB(ctx.userData, minX, maxX, minZ, maxZ, tmpAABB, level);
    return tmpAABB.getClipStateWithFrustum(camera.frustum) !== ClipState.NOT_CLIPPED;
  }
  calcLevelAABB(camera: Camera, minMaxWorldPos: Vector4, gridScale: number): AABB[] {
    const mipLevels = this.calcMipLevels(camera, minMaxWorldPos, gridScale);
    camera.getWorldPosition(tmpV3);

    const snappedPos = new Vector2();
    const tileSize = new Vector2();
    const base = new Vector2();
    const offset = new Vector2();

    const posX = tmpV3.x / gridScale;
    const posY = tmpV3.z / gridScale;

    const outAABB: AABB[] = [];
    for (let i = 0; i < mipLevels; i++) {
      const aabb = new AABB();
      aabb.beginExtend();
      outAABB.push(aabb);
    }

    snappedPos.setXY(Math.floor(posX), Math.floor(posY));

    // cross
    this.updateAABB(this._crossMeshAABB, null, snappedPos, 1, gridScale, outAABB[0]);

    for (let l = 0; l < mipLevels; l++) {
      const aabb = outAABB[l];
      const scale = 1 << l;
      snappedPos.setXY(Math.floor(posX / scale) * scale, Math.floor(posY / scale) * scale);
      // draw tiles
      tileSize.setXY(this._tileResolution << l, this._tileResolution << l);
      base.setXY(
        snappedPos.x - (this._tileResolution << (l + 1)),
        snappedPos.y - (this._tileResolution << (l + 1))
      );
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          if (l !== 0 && (x === 1 || x === 2) && (y === 1 || y === 2)) {
            continue;
          }
          const fillX = x >= 2 ? scale : 0;
          const fillY = y >= 2 ? scale : 0;
          offset.setXY(base.x + x * tileSize.x + fillX, base.y + y * tileSize.y + fillY);
          this.updateAABB(this._tileMeshBBox, null, offset, scale, gridScale, aabb);
        }
      }
      // draw filler
      this.updateAABB(this._fillerMeshAABB, null, snappedPos, scale, gridScale, aabb);

      const nextScale = scale * 2;
      const nextSnappedPos = new Vector2(
        Math.floor(posX / nextScale) * nextScale,
        Math.floor(posY / nextScale) * nextScale
      );
      // draw trim
      const tileCentre = new Vector2(snappedPos.x + scale * 0.5, snappedPos.y + scale * 0.5);
      const d = new Vector2(posX - nextSnappedPos.x, posY - nextSnappedPos.y);
      let r = 0;
      r |= d.x >= scale ? 0 : 2;
      r |= d.y >= scale ? 0 : 1;
      this.updateAABB(this._trimMeshAABB, rotationValues[r], tileCentre, scale, gridScale, aabb);
      // draw seam
      const nextBase = new Vector2(
        nextSnappedPos.x - (this._tileResolution << (l + 1)),
        nextSnappedPos.y - (this._tileResolution << (l + 1))
      );
      this.updateAABB(this._seamMeshAABB, null, nextBase, scale, gridScale, aabb);
    }
    return outAABB;
  }
  private calcMipLevels(camera: Camera, minMaxWorldPos: Vector4, gridScale: number) {
    camera.getWorldPosition(tmpV3);
    const distX = Math.max(Math.abs(tmpV3.x - minMaxWorldPos.x), Math.abs(tmpV3.x - minMaxWorldPos.z));
    const distY = Math.max(Math.abs(tmpV3.z - minMaxWorldPos.y), Math.abs(tmpV3.z - minMaxWorldPos.w));
    const maxDist = Math.min(Math.max(distX, distY), camera.getFarPlane());
    return Math.min(
      Math.max(Math.ceil(Math.log2(maxDist / (this._tileResolution * gridScale))), 0) + 1,
      this._maxMipLevels
    );
  }
  private addInstance(
    info: PrimitiveInstanceInfo,
    rotation: number,
    offsetX: number,
    offsetY: number,
    scale: number,
    mipLevel: number
  ) {
    info.mipLevels[info.numInstances] = mipLevel;
    info.instanceDatas[info.numInstances * 4 + 0] = rotation;
    info.instanceDatas[info.numInstances * 4 + 1] = scale;
    info.instanceDatas[info.numInstances * 4 + 2] = offsetX;
    info.instanceDatas[info.numInstances * 4 + 3] = offsetY;
    info.maxMiplevel = mipLevel;
    info.numInstances++;
  }

  gather(context: ClipmapGatherContext): PrimitiveInstanceInfo[] {
    this._instanceDataPoolSize = this._instanceDataPool.length;
    this._mipLevelDataPoolSize = this._mipLevelDataPool.length;
    this._nonInstanceDataPoolSize = this._nonInstanceDataPool.length;
    this._nonInstanceMipLevelDataPoolSize = this._nonInstanceMipLevelDataPool.length;
    const renderData: PrimitiveInstanceInfo[] = [];
    const mipLevels = this.calcMipLevels(context.camera, context.minMaxWorldPos, context.gridScale);
    context.camera.getWorldPosition(tmpV3);

    const snappedPos = new Vector2();
    const tileSize = new Vector2();
    const base = new Vector2();
    const offset = new Vector2();

    const posX = tmpV3.x / context.gridScale;
    const posY = tmpV3.z / context.gridScale;

    // draw cross
    snappedPos.setXY(Math.floor(posX), Math.floor(posY));
    if (
      this.visible(context, this._crossMeshAABB, context.camera, null, snappedPos, 1, context.gridScale, 0)
    ) {
      const crossPrimitives: PrimitiveInstanceInfo = {
        primitive: this._wireframe ? this._crossMeshLines : this._crossMesh,
        numInstances: 1,
        instanceDatas: this.allocNonInstanceBuffer(rotationValues[0], 1, snappedPos.x, snappedPos.y),
        mipLevels: this.allocNonInstanceMipLevelBuffer(0),
        maxMiplevel: 0
      };
      renderData.push(crossPrimitives);
    }

    const tilePrimitives: PrimitiveInstanceInfo = {
      primitive: this._wireframe ? this._tileMeshLines : this._tileMesh,
      numInstances: 0,
      instanceDatas: this.allocInstanceBuffer(),
      mipLevels: this.allocMipLevelBuffer(),
      maxMiplevel: 0
    };
    const fillerPrimitives: PrimitiveInstanceInfo = {
      primitive: this._wireframe ? this._fillerMeshLines : this._fillerMesh,
      numInstances: 0,
      instanceDatas: this.allocInstanceBuffer(),
      mipLevels: this.allocMipLevelBuffer(),
      maxMiplevel: 0
    };
    const trimPrimitives: PrimitiveInstanceInfo = {
      primitive: this._wireframe ? this._trimMeshLines : this._trimMesh,
      numInstances: 0,
      instanceDatas: this.allocInstanceBuffer(),
      mipLevels: this.allocMipLevelBuffer(),
      maxMiplevel: 0
    };
    const seamPrimitives: PrimitiveInstanceInfo = {
      primitive: this._wireframe ? this._seamMeshLines : this._seamMesh,
      numInstances: 0,
      instanceDatas: this.allocInstanceBuffer(),
      mipLevels: this.allocMipLevelBuffer(),
      maxMiplevel: 0
    };

    for (let l = 0; l < mipLevels; l++) {
      const scale = 1 << l;
      snappedPos.setXY(Math.floor(posX / scale) * scale, Math.floor(posY / scale) * scale);
      // draw tiles
      tileSize.setXY(this._tileResolution << l, this._tileResolution << l);
      base.setXY(
        snappedPos.x - (this._tileResolution << (l + 1)),
        snappedPos.y - (this._tileResolution << (l + 1))
      );
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          if (l !== 0 && (x === 1 || x === 2) && (y === 1 || y === 2)) {
            continue;
          }
          const fillX = x >= 2 ? scale : 0;
          const fillY = y >= 2 ? scale : 0;
          offset.setXY(base.x + x * tileSize.x + fillX, base.y + y * tileSize.y + fillY);
          if (
            this.intervalsOverlap(
              offset.x * context.gridScale,
              (offset.x + tileSize.x) * context.gridScale,
              context.minMaxWorldPos.x,
              context.minMaxWorldPos.z
            ) &&
            this.intervalsOverlap(
              offset.y * context.gridScale,
              (offset.y + tileSize.y) * context.gridScale,
              context.minMaxWorldPos.y,
              context.minMaxWorldPos.w
            )
          ) {
            if (
              this.visible(
                context,
                this._tileMeshBBox,
                context.camera,
                null,
                offset,
                scale,
                context.gridScale,
                l
              )
            ) {
              this.addInstance(tilePrimitives, rotationValues[0], offset.x, offset.y, scale, l);
            }
          }
        }
      }
      // draw filler
      if (
        this.visible(
          context,
          this._fillerMeshAABB,
          context.camera,
          null,
          snappedPos,
          scale,
          context.gridScale,
          l
        )
      ) {
        this.addInstance(fillerPrimitives, rotationValues[0], snappedPos.x, snappedPos.y, scale, l);
      }

      if (l !== mipLevels - 1) {
        const nextScale = scale * 2;
        const nextSnappedPos = new Vector2(
          Math.floor(posX / nextScale) * nextScale,
          Math.floor(posY / nextScale) * nextScale
        );
        // draw trim
        const tileCentre = new Vector2(snappedPos.x + scale * 0.5, snappedPos.y + scale * 0.5);
        const d = new Vector2(posX - nextSnappedPos.x, posY - nextSnappedPos.y);
        let r = 0;
        r |= d.x >= scale ? 0 : 2;
        r |= d.y >= scale ? 0 : 1;
        if (
          this.visible(
            context,
            this._trimMeshAABB,
            context.camera,
            rotationValues[r],
            tileCentre,
            scale,
            context.gridScale,
            l
          )
        ) {
          this.addInstance(trimPrimitives, rotationValues[r], tileCentre.x, tileCentre.y, scale, l);
        }
        // draw seam
        const nextBase = new Vector2(
          nextSnappedPos.x - (this._tileResolution << (l + 1)),
          nextSnappedPos.y - (this._tileResolution << (l + 1))
        );
        if (
          this.visible(
            context,
            this._seamMeshAABB,
            context.camera,
            null,
            nextBase,
            scale,
            context.gridScale,
            l
          )
        ) {
          this.addInstance(seamPrimitives, rotationValues[0], nextBase.x, nextBase.y, scale, l);
        }
      }
    }
    if (tilePrimitives.numInstances > 0) {
      renderData.push(tilePrimitives);
    }
    if (fillerPrimitives.numInstances > 0) {
      renderData.push(fillerPrimitives);
    }
    if (trimPrimitives.numInstances > 0) {
      renderData.push(trimPrimitives);
    }
    if (seamPrimitives.numInstances > 0) {
      renderData.push(seamPrimitives);
    }
    for (const info of renderData) {
      info.primitive
        .getVertexBuffer('texCoord0')
        .bufferSubData(0, info.instanceDatas, 0, info.numInstances * 4);
    }
    return renderData;
  }
  draw(context: ClipmapDrawContext): number {
    let drawn = 0;
    const mipLevels = this.calcMipLevels(context.camera, context.minMaxWorldPos, context.gridScale);
    context.camera.getWorldPosition(tmpV3);

    const snappedPos = new Vector2();
    const tileSize = new Vector2();
    const base = new Vector2();
    const offset = new Vector2();

    const posX = tmpV3.x / context.gridScale;
    const posY = tmpV3.z / context.gridScale;

    // draw cross
    snappedPos.setXY(Math.floor(posX), Math.floor(posY));
    if (
      this.visible(context, this._crossMeshAABB, context.camera, null, snappedPos, 1, context.gridScale, 0)
    ) {
      context.drawPrimitive(
        this._wireframe ? this._crossMeshLines : this._crossMesh,
        rotationValues[0],
        snappedPos,
        1,
        context.gridScale,
        0
      );
      drawn++;
    }

    for (let l = 0; l < mipLevels; l++) {
      const scale = 1 << l;
      snappedPos.setXY(Math.floor(posX / scale) * scale, Math.floor(posY / scale) * scale);
      // draw tiles
      tileSize.setXY(this._tileResolution << l, this._tileResolution << l);
      base.setXY(
        snappedPos.x - (this._tileResolution << (l + 1)),
        snappedPos.y - (this._tileResolution << (l + 1))
      );
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          if (l !== 0 && (x === 1 || x === 2) && (y === 1 || y === 2)) {
            continue;
          }
          const fillX = x >= 2 ? scale : 0;
          const fillY = y >= 2 ? scale : 0;
          offset.setXY(base.x + x * tileSize.x + fillX, base.y + y * tileSize.y + fillY);
          if (
            this.intervalsOverlap(
              offset.x * context.gridScale,
              (offset.x + tileSize.x) * context.gridScale,
              context.minMaxWorldPos.x,
              context.minMaxWorldPos.z
            ) &&
            this.intervalsOverlap(
              offset.y * context.gridScale,
              (offset.y + tileSize.y) * context.gridScale,
              context.minMaxWorldPos.y,
              context.minMaxWorldPos.w
            )
          ) {
            if (
              this.visible(
                context,
                this._tileMeshBBox,
                context.camera,
                null,
                offset,
                scale,
                context.gridScale,
                l
              )
            ) {
              context.drawPrimitive(
                this._wireframe ? this._tileMeshLines : this._tileMesh,
                rotationValues[0],
                offset,
                scale,
                context.gridScale,
                l
              );
              drawn++;
            }
          }
        }
      }
      // draw filler
      if (
        this.visible(
          context,
          this._fillerMeshAABB,
          context.camera,
          null,
          snappedPos,
          scale,
          context.gridScale,
          l
        )
      ) {
        context.drawPrimitive(
          this._wireframe ? this._fillerMeshLines : this._fillerMesh,
          rotationValues[0],
          snappedPos,
          scale,
          context.gridScale,
          l
        );
        drawn++;
      }

      if (l !== mipLevels - 1) {
        const nextScale = scale * 2;
        const nextSnappedPos = new Vector2(
          Math.floor(posX / nextScale) * nextScale,
          Math.floor(posY / nextScale) * nextScale
        );
        // draw trim
        const tileCentre = new Vector2(snappedPos.x + scale * 0.5, snappedPos.y + scale * 0.5);
        const d = new Vector2(posX - nextSnappedPos.x, posY - nextSnappedPos.y);
        let r = 0;
        r |= d.x >= scale ? 0 : 2;
        r |= d.y >= scale ? 0 : 1;
        if (
          this.visible(
            context,
            this._trimMeshAABB,
            context.camera,
            rotationValues[r],
            tileCentre,
            scale,
            context.gridScale,
            l
          )
        ) {
          context.drawPrimitive(
            this._wireframe ? this._trimMeshLines : this._trimMesh,
            rotationValues[r],
            tileCentre,
            scale,
            context.gridScale,
            l
          );
          drawn++;
        }
        // draw seam
        const nextBase = new Vector2(
          nextSnappedPos.x - (this._tileResolution << (l + 1)),
          nextSnappedPos.y - (this._tileResolution << (l + 1))
        );
        if (
          this.visible(
            context,
            this._seamMeshAABB,
            context.camera,
            null,
            nextBase,
            scale,
            context.gridScale,
            l
          )
        ) {
          context.drawPrimitive(
            this._wireframe ? this._seamMeshLines : this._seamMesh,
            rotationValues[0],
            nextBase,
            scale,
            context.gridScale,
            l
          );
          drawn++;
        }
      }
    }
    return drawn;
  }
  /** Disposes the clipmap and release all meshes */
  protected onDispose() {
    super.onDispose();
    this._crossMesh.dispose();
    this._crossMesh = null;
    this._crossMeshLines.dispose();
    this._crossMeshLines = null;
    this._fillerMesh.dispose();
    this._fillerMesh = null;
    this._fillerMeshLines.dispose();
    this._fillerMeshLines = null;
    this._seamMesh.dispose();
    this._seamMesh = null;
    this._seamMeshLines.dispose();
    this._seamMeshLines = null;
    this._trimMesh.dispose();
    this._trimMesh = null;
    this._trimMeshLines.dispose();
    this._trimMeshLines = null;
    this._tileMesh.dispose();
    this._tileMesh = null;
    this._tileMeshLines.dispose();
    this._tileMeshLines = null;
  }
}
