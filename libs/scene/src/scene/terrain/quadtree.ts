import { ClipState, Frustum, Matrix4x4, Vector3, isPowerOf2, nextPowerOf2 } from '@zephyr3d/base';
import type { IndexBuffer, PrimitiveType, Texture2D } from '@zephyr3d/device';
import { BoundingBox } from '../../utility/bounding_volume';
import { TerrainPatch } from './patch';
import { HeightField } from './heightfield';
import { Application, Ref } from '../../app';
import type { CullVisitor } from '../../render/cull_visitor';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../../values';
import type { Terrain } from './terrain';
import { GrassCluster } from './grass';

/** @internal */
export class QuadtreeNode {
  private _patch: TerrainPatch;
  private _grassClusters: GrassCluster[];
  private _parent: QuadtreeNode;
  private _children: QuadtreeNode[];
  constructor() {
    this._patch = null;
    this._grassClusters = [];
    this._parent = null;
    this._children = null;
  }
  get grassClusters(): GrassCluster[] {
    return this._grassClusters;
  }
  addGrassCluster(grassCluster: GrassCluster) {
    this._grassClusters.push(grassCluster);
  }
  initialize(
    quadtree: Quadtree,
    parent: QuadtreeNode,
    rowIndex: number,
    colIndex: number,
    baseVertices: Float32Array,
    normals: Vector3[],
    heightScale: number,
    elevations: Float32Array
  ): boolean {
    this._parent = parent;
    this._children = [];
    this._patch = new TerrainPatch(quadtree.terrain);
    //const rowIndex = position === PatchPosition.LeftBottom || position === PatchPosition.LeftTop ? 0 : 1;
    //const colIndex = position === PatchPosition.LeftTop || position === PatchPosition.RightTop ? 0 : 1;
    if (
      !this._patch.initialize(
        quadtree,
        this._parent?._patch || null,
        rowIndex,
        colIndex,
        baseVertices,
        normals,
        heightScale,
        elevations
      )
    ) {
      return false;
    }
    if (this._patch.getStep() > 1) {
      let bbox: BoundingBox = null;
      const size = (quadtree.getPatchSize() - 1) * (this._patch.getStep() >> 1);
      const offsetX = this._patch.getOffsetX();
      const offsetZ = this._patch.getOffsetZ();
      const offsets = [
        [offsetX, offsetZ],
        [offsetX + size, offsetZ],
        [offsetX, offsetZ + size],
        [offsetX + size, offsetZ + size]
      ];
      const rootSizeX = quadtree.getRootSizeX() - 1;
      const rootSizeZ = quadtree.getRootSizeZ() - 1;
      for (let i = 0; i < 4; ++i) {
        if (offsets[i][0] >= rootSizeX || offsets[i][1] >= rootSizeZ) {
          this._children[i] = null;
        } else {
          this._children[i] = new QuadtreeNode();
          if (
            !this._children[i].initialize(
              quadtree,
              this,
              i & 1,
              i >> 1,
              baseVertices,
              normals,
              heightScale,
              elevations
            )
          ) {
            return false;
          }
          const childBBox = this._children[i]._patch.getBoundingBox();
          if (childBBox) {
            if (!bbox) {
              bbox = new BoundingBox();
              bbox.beginExtend();
            }
            bbox.extend(childBBox.minPoint);
            bbox.extend(childBBox.maxPoint);
          }
        }
      }
      this._patch.setBoundingBox(bbox);
    }
    return true;
  }
  setupCamera(viewportH: number, tanHalfFovy: number, maxPixelError: number): void {
    if (this._patch && !this._patch.isDummy()) {
      this._patch.setupCamera(viewportH, tanHalfFovy, maxPixelError);
    }
    for (let i = 0; i < 4; ++i) {
      if (this._children[i]) {
        this._children[i].setupCamera(viewportH, tanHalfFovy, maxPixelError);
      }
    }
  }
  getBoundingbox(): BoundingBox {
    return this._patch.getBoundingBox();
  }
  getPatch(): TerrainPatch {
    return this._patch;
  }
  getParent(): QuadtreeNode {
    return this._parent;
  }
  getChild(index: number): QuadtreeNode {
    return this._children[index];
  }
  dispose() {
    this._patch?.dispose();
  }
}

/** @internal */
export class Quadtree {
  private _baseVertices: Float32Array;
  private _indices: Ref<IndexBuffer>;
  private _indicesWireframe: Ref<IndexBuffer>;
  private _normalMap: Ref<Texture2D>;
  private _scaleX: number;
  private _scaleZ: number;
  private _patchSize: number;
  private _rootSizeX: number;
  private _rootSizeZ: number;
  private _rootSize: number;
  private _primitiveCount: number;
  private _primitiveType: PrimitiveType;
  private _rootNode: QuadtreeNode;
  private _terrain: Terrain;
  private _heightField: HeightField;
  constructor(terrain: Terrain) {
    this._terrain = terrain;
    this._baseVertices = null;
    this._indices = new Ref<IndexBuffer>();
    this._indicesWireframe = new Ref<IndexBuffer>();
    this._normalMap = new Ref<Texture2D>();
    this._scaleX = 1;
    this._scaleZ = 1;
    this._patchSize = 0;
    this._rootSizeX = 0;
    this._rootSizeZ = 0;
    this._rootSize = 0;
    this._heightField = null;
    this._rootNode = null;
    this._primitiveCount = 0;
    this._primitiveType = 'triangle-strip';
  }
  get normalMap(): Texture2D {
    return this._normalMap.get();
  }
  get rootNode(): QuadtreeNode {
    return this._rootNode;
  }
  get terrain(): Terrain {
    return this._terrain;
  }
  dispose() {
    if (this._rootNode) {
      const nodes: QuadtreeNode[] = [this._rootNode];
      while (nodes.length > 0) {
        const node = nodes.shift();
        if (node) {
          for (let i = 0; i < 4; i++) {
            const child = node.getChild(i);
            if (child) {
              nodes.push(child);
            }
          }
          node.dispose();
        }
      }
    }
    this._indices.dispose();
    this._indicesWireframe.dispose();
    this._normalMap.dispose();
  }
  build(
    patchSize: number,
    rootSizeX: number,
    rootSizeZ: number,
    elevations: Float32Array,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    vertexCacheSize: number
  ): boolean {
    if (
      !isPowerOf2(patchSize - 1) ||
      !!((rootSizeX - 1) % (patchSize - 1)) ||
      !!((rootSizeZ - 1) % (patchSize - 1)) ||
      !elevations
    ) {
      return false;
    }
    this._heightField = new HeightField();
    if (!this._heightField.init(rootSizeX, rootSizeZ, 0, 0, scaleX, scaleY, scaleZ, elevations)) {
      this._heightField = null;
      return false;
    }
    const device = Application.instance.device;
    this._patchSize = patchSize;
    this._rootSizeX = rootSizeX;
    this._rootSizeZ = rootSizeZ;
    this._rootSize = nextPowerOf2(Math.max(rootSizeX - 1, rootSizeZ - 1)) + 1;
    this._scaleX = scaleX;
    this._scaleZ = scaleZ;
    // Create base vertex buffer
    const dimension = patchSize + 2; // with "skirts"
    const vertices = new Float32Array(dimension * dimension * 3);
    let offset = 0;
    // top skirt
    vertices[0] = 0;
    vertices[1] = 0;
    vertices[2] = 0;
    for (let i = 1; i < dimension - 1; ++i) {
      vertices[3 * i + 0] = i - 1;
      vertices[3 * i + 1] = 0;
      vertices[3 * i + 2] = 0;
    }
    vertices[3 * (dimension - 1) + 0] = dimension - 3;
    vertices[3 * (dimension - 1) + 1] = 0;
    vertices[3 * (dimension - 1) + 2] = 0;
    offset += dimension * 3;
    for (let i = 1; i < dimension - 1; ++i, offset += dimension * 3) {
      // left skirt
      vertices[offset + 0] = 0;
      vertices[offset + 1] = 0;
      vertices[offset + 2] = i - 1;
      // height
      for (let j = 1; j < dimension - 1; ++j) {
        vertices[offset + 3 * j + 0] = j - 1;
        vertices[offset + 3 * j + 1] = 0;
        vertices[offset + 3 * j + 2] = i - 1;
      }
      // right skirt
      vertices[offset + (dimension - 1) * 3 + 0] = dimension - 3;
      vertices[offset + (dimension - 1) * 3 + 1] = 0;
      vertices[offset + (dimension - 1) * 3 + 2] = i - 1;
    }
    // bottom skirt
    vertices[offset + 0] = 0;
    vertices[offset + 1] = 0;
    vertices[offset + 2] = dimension - 3;
    for (let i = 1; i < dimension - 1; ++i) {
      vertices[offset + 3 * i + 0] = i - 1;
      vertices[offset + 3 * i + 1] = 0;
      vertices[offset + 3 * i + 2] = dimension - 3;
    }
    vertices[offset + (dimension - 1) * 3 + 0] = dimension - 3;
    vertices[offset + (dimension - 1) * 3 + 1] = 0;
    vertices[offset + (dimension - 1) * 3 + 2] = dimension - 3;
    this._baseVertices = vertices;
    // Create base index buffer
    const indices = this.strip(vertexCacheSize);
    this._indices.set(device.createIndexBuffer(indices, { managed: true }));
    const lineIndices = this.line(indices);
    this._indicesWireframe.set(device.createIndexBuffer(lineIndices, { managed: true }));
    this._primitiveCount = indices.length - 2;
    this._primitiveType = 'triangle-strip';
    this._rootNode = new QuadtreeNode();
    const normals = this._heightField.normals;
    const normalMapBytes = new Uint8Array(normals.length * 4);
    for (let i = 0; i < normals.length; i++) {
      const normal = normals[i];
      normalMapBytes[i * 4 + 0] = Math.floor((normal.x * 0.5 + 0.5) * 255);
      normalMapBytes[i * 4 + 1] = Math.floor((normal.y * 0.5 + 0.5) * 255);
      normalMapBytes[i * 4 + 2] = Math.floor((normal.z * 0.5 + 0.5) * 255);
      normalMapBytes[i * 4 + 3] = 255;
    }
    this._normalMap.set(
      device.createTexture2D('rgba8unorm', rootSizeX, rootSizeZ, {
        samplerOptions: { mipFilter: 'none' }
      })
    );
    this._normalMap.get().name = `TerrainNormalMap-${this._normalMap.get().uid}`;
    this._normalMap
      .get()
      .update(normalMapBytes, 0, 0, this._normalMap.get().width, this._normalMap.get().height);
    return this._rootNode.initialize(this, null, 0, 0, this._baseVertices, normals, scaleY, elevations);
  }
  strip(vertexCacheSize: number): Uint16Array {
    const dimension = this._patchSize + 2;
    const step = (vertexCacheSize >> 1) - 1;
    const indices: number[] = [];
    for (let i = 0; i < dimension - 1; i += step) {
      const start = i;
      const end = i + step > dimension - 1 ? dimension - 1 : i + step;
      for (let j = 0; j < dimension - 1; ++j) {
        for (let k = start; k <= end; ++k) {
          indices.push((dimension - 1 - k) * dimension + j);
          indices.push((dimension - 1 - k) * dimension + j + 1);
        }
        indices.push((dimension - 1 - end) * dimension + j + 1);
        indices.push(
          j == dimension - 2 ? (dimension - 1 - end) * dimension : (dimension - 1 - start) * dimension + j + 1
        );
      }
    }
    indices.length = indices.length - 2;
    return new Uint16Array(indices);
  }
  line(strip: Uint16Array): Uint16Array {
    const numTris = strip.length - 2;
    const lineIndices: number[] = [];
    let lastSkipped = true;
    let a: number, b: number, c: number;
    for (let i = 0; i < numTris; i++) {
      if (i % 2 === 0) {
        a = strip[i];
        b = strip[i + 1];
        c = strip[i + 2];
      } else {
        a = strip[i + 1];
        b = strip[i];
        c = strip[i + 2];
      }
      const thisSkipped = a === b || a === c || b === c;
      if (!thisSkipped) {
        if (lastSkipped) {
          lineIndices.push(a, b);
        }
        lineIndices.push(b, c, c, a);
      }
      lastSkipped = thisSkipped;
    }
    return new Uint16Array(lineIndices);
  }
  setupCamera(viewportH: number, tanHalfFovy: number, maxPixelError: number): void {
    this._rootNode?.setupCamera(viewportH, tanHalfFovy, maxPixelError);
  }
  getBoundingBox(bbox: BoundingBox): void {
    if (this._heightField) {
      bbox.minPoint = this._heightField.getBoundingbox().minPoint;
      bbox.maxPoint = this._heightField.getBoundingbox().maxPoint;
    } else {
      bbox.minPoint = Vector3.zero();
      bbox.maxPoint = Vector3.zero();
    }
  }
  getPatchSize(): number {
    return this._patchSize;
  }
  getRootSize(): number {
    return this._rootSize;
  }
  getRootSizeX(): number {
    return this._rootSizeX;
  }
  getRootSizeZ(): number {
    return this._rootSizeZ;
  }
  getTerrain(): Terrain {
    return this._terrain;
  }
  getElevations(): Float32Array {
    return this._heightField?.getHeights() || null;
  }
  getScaleX(): number {
    return this._scaleX;
  }
  getScaleZ(): number {
    return this._scaleZ;
  }
  getIndices(): IndexBuffer {
    return this._indices.get();
  }
  getIndicesWireframe(): IndexBuffer {
    return this._indicesWireframe.get();
  }
  getPrimitiveCount(): number {
    return this._primitiveCount;
  }
  getPrimitiveType(): PrimitiveType {
    return this._primitiveType;
  }
  getHeightField(): HeightField {
    return this._heightField;
  }
  /** @internal */
  cull(visitor: CullVisitor, viewPoint: Vector3, worldMatrix: Matrix4x4): number {
    if (this._rootNode && this._terrain) {
      const frustum = new Frustum(Matrix4x4.multiply(visitor.camera.viewProjectionMatrix, worldMatrix));
      return this.cull_r(
        visitor,
        this._rootNode,
        viewPoint,
        worldMatrix,
        frustum,
        visitor.frustumCulling,
        false
      );
    }
    return 0;
  }
  /** @internal */
  cull_r(
    visitor: CullVisitor,
    node: QuadtreeNode,
    viewPoint: Vector3,
    worldMatrix: Matrix4x4,
    frustum: Frustum,
    cliptest: boolean,
    ignorePatch: boolean
  ): number {
    const camera = visitor.camera;
    const bbox = node.getBoundingbox();
    let ret = 0;
    let clipState: ClipState;
    if (cliptest) {
      clipState = camera.clipMask
        ? bbox.getClipStateWithFrustumMask(frustum, camera.clipMask)
        : bbox.getClipStateWithFrustum(frustum);
      if (clipState === ClipState.NOT_CLIPPED) {
        return ret;
      } else if (clipState === ClipState.A_INSIDE_B) {
        cliptest = false;
      }
    } else {
      clipState = ClipState.A_INSIDE_B;
    }
    if (!ignorePatch) {
      const ld = node.getPatch().isDummy() ? -1 : node.getPatch().getLODDistance();
      const lodDistance = ld >= 0 ? ld * ld : Number.MAX_VALUE;
      const eyeDistSq = ld >= 0 ? node.getPatch().sqrDistanceToPoint(viewPoint) : 0;
      if (eyeDistSq >= lodDistance || !node.getChild(0)) {
        if (!node.getPatch().isDummy()) {
          visitor.push(camera, node.getPatch());
          ignorePatch = true;
          ret = 1;
        }
      }
    }
    if (node.grassClusters.length > 0 && visitor.renderPass.type !== RENDER_PASS_TYPE_SHADOWMAP) {
      for (const grass of node.grassClusters) {
        visitor.push(camera, grass);
      }
    }
    for (let i = 0; i < 4; i++) {
      const child = node.getChild(i);
      if (child) {
        ret += this.cull_r(visitor, child, viewPoint, worldMatrix, frustum, cliptest, ignorePatch);
      }
    }
    /*
    if (eyeDistSq < lodDistance && node.getChild(0)) {
      for (let i = 0; i < 4; i++) {
        const child = node.getChild(i);
        if (child) {
          ret += this.cull_r(visitor, child, viewPoint, worldMatrix, frustum, cliptest, ignorePatch);
        }
      }
    } else if (!node.getPatch().isDummy()) {
      visitor.push(camera, node.getPatch(), this._terrain.renderOrder, this._terrain.castShadow, clipState, bbox);
      return 1;
    }
    */
    /*
    if ((!node.getChild(0) || eyeDistSq >= lodDistance) && !node.getPatch().isDummy()) {
      visitor.push(camera, node.getPatch(), this._terrain.renderOrder, this._terrain.castShadow, clipState, bbox);
      ret = 1;
      ignorePatch = true;
    }
    if (node.grassCluster) {
      visitor.push(camera, node.grassCluster, this._terrain.renderOrder, this._terrain.castShadow, clipState, bbox);
    } else if (!ignorePatch) {
      for (let i = 0; i < 4; i++) {
        const child = node.getChild(i);
        if (child) {
          ret += this.cull_r(visitor, child, viewPoint, worldMatrix, frustum, cliptest, ignorePatch);
        }
      }
    }
    */
    /*
    const drawPatch = !(eyeDistSq < lodDistance && node.getChild(0))
    if (
      eyeDistSq < lodDistance
      && node.getChild(0)
      && (lodLevel === 0 || node.getPatch().getMipLevel() < lodLevel)
    ) {
      for (let i = 0; i < 4; i++) {
        const child = node.getChild(i);
        if (child) {
          ret += this.cull_r(visitor, child, viewPoint, worldMatrix, frustum, cliptest);
        }
      }
    } else if (!node.getPatch().isDummy()) {
      visitor.push(camera, node.getPatch(), this._terrain.renderOrder, this._terrain.castShadow, clipState, bbox);
      return 1;
    }
    */
    return ret;
  }
}
