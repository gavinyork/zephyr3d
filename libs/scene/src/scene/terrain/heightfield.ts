import type { Ray} from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { BoundingBox } from '../../utility/bounding_volume';

/** @internal */
export interface HeightfieldBBoxTreeNode {
  bbox: BoundingBox;
  h: number[];
  rc: { x: number; y: number; w: number; h: number };
  left: HeightfieldBBoxTreeNode;
  right: HeightfieldBBoxTreeNode;
}

/** @internal */
export class HeightfieldBBoxTree {
  private _resX: number;
  private _resY: number;
  private _spacingX: number;
  private _spacingZ: number;
  private _heights: Float32Array;
  private _rootNode: HeightfieldBBoxTreeNode;
  constructor(res_x: number, res_y: number, spacing_x: number, spacing_z: number, vertices: Vector4[]) {
    this._rootNode = null;
    this._heights = null;
    this._spacingX = spacing_x;
    this._spacingZ = spacing_z;
    this.create(res_x, res_y, vertices);
  }
  create(res_x: number, res_y: number, vertices: Vector4[]): boolean {
    this._resX = res_x;
    this._resY = res_y;
    this._rootNode = this.allocNode();
    this._heights = new Float32Array(res_x * res_y);
    for (let i = 0; i < this._heights.length; i++) {
      this._heights[i] = vertices[i].y;
    }
    this.createChildNode(this._rootNode, 0, 0, res_x, res_y, vertices);
    return true;
  }
  getHeight(x: number, y: number): number {
    return this._heights[(this._resY - 1 - y) * this._resX + x];
  }
  getNormal(x: number, y: number, normal?: Vector3): Vector3 {
    normal = normal ?? new Vector3();
    x = Math.max(0, Math.min(x, this._resX - 2));
    y = Math.max(0, Math.min(y, this._resY - 2));
    const h00 = this._heights[x + y * this._resX];
    const h01 = this._heights[x + (y + 1) * this._resX];
    const h11 = this._heights[x + 1 + (y + 1) * this._resX];
    const h10 = this._heights[x + 1 + y * this._resX];
    const sx = (h00 + h01 - h11 - h10) * 0.5;
    const sy = (h00 + h10 - h01 - h11) * 0.5;
    const tileSizeX = (this._rootNode.bbox.maxPoint.x - this._rootNode.bbox.minPoint.x) / (this._resX - 1);
    const tileSizeY = (this._rootNode.bbox.maxPoint.z - this._rootNode.bbox.minPoint.z) / (this._resY - 1);
    normal.setXYZ(sx * tileSizeY, 2 * tileSizeX * tileSizeY, -sy * tileSizeX).inplaceNormalize();
    return normal
  }
  getRealNormal(x: number, y: number, normal?: Vector3): Vector3 {
    normal = normal ?? new Vector3();
    x -= this._rootNode.bbox.minPoint.x;
    y -= this._rootNode.bbox.minPoint.z;
    const tileSizeX = (this._rootNode.bbox.maxPoint.x - this._rootNode.bbox.minPoint.x) / (this._resX - 1);
    const tileSizeY = (this._rootNode.bbox.maxPoint.z - this._rootNode.bbox.minPoint.z) / (this._resY - 1);
    const x_unscale = x / tileSizeX;
    const y_unscale = y / tileSizeY;
    let l = Math.floor(x_unscale);
    let t = Math.floor(y_unscale);
    let r = l + 1;
    let b = t + 1;
    if (l < 0) {
      l = 0;
    }
    if (t < 0) {
      t = 0;
    }
    if (r >= this._resX) {
      r = this._resX - 1;
    }
    if (b >= this._resY) {
      b = this._resY - 1;
    }
    const ltNormal = this.getNormal(l, t);
    const lbNormal = this.getNormal(l, b);
    const rtNormal = this.getNormal(r, t);
    const rbNormal = this.getNormal(r, b);
    ltNormal.addBy(lbNormal).addBy(rtNormal).addBy(rbNormal).scaleBy(0.25).inplaceNormalize();
    normal.set(ltNormal);
    return normal;
  }
  getRealHeight(x: number, y: number): number {
    x -= this._rootNode.bbox.minPoint.x;
    y -= this._rootNode.bbox.minPoint.z;
    const tileSizeX = (this._rootNode.bbox.maxPoint.x - this._rootNode.bbox.minPoint.x) / (this._resX - 1);
    const tileSizeY = (this._rootNode.bbox.maxPoint.z - this._rootNode.bbox.minPoint.z) / (this._resY - 1);
    const x_unscale = x / tileSizeX;
    const y_unscale = y / tileSizeY;
    const l = Math.floor(x_unscale);
    const t = Math.floor(y_unscale);
    const r = l + 1;
    const b = t + 1;
    if (l < 0 || t < 0 || r >= this._resX || b >= this._resY) {
      return 0;
    }
    if (l === r) {
      if (t === b) {
        return this.getHeight(l, t);
      } else {
        const ht = this.getHeight(l, t);
        const hb = this.getHeight(l, b);
        return ht + (hb - ht) * (y_unscale - t);
      }
    } else {
      const hlt = this.getHeight(l, t);
      const hrt = this.getHeight(r, t);
      const ht = hlt + (hrt - hlt) * (x_unscale - l);
      if (t === b) {
        return ht;
      } else {
        const hlb = this.getHeight(l, b);
        const hrb = this.getHeight(r, b);
        const hb = hlb + (hrb - hlb) * (x_unscale - l);
        return ht + (hb - ht) * (y_unscale - t);
      }
    }
  }
  getRootNode(): HeightfieldBBoxTreeNode {
    return this._rootNode;
  }
  getHeights(): Float32Array {
    return this._heights;
  }
  allocNode(): HeightfieldBBoxTreeNode {
    return {
      bbox: new BoundingBox(),
      h: [0, 0, 0, 0],
      rc: { x: 0, y: 0, w: 0, h: 0 },
      left: null,
      right: null
    };
  }
  computeNodeBoundingBox(node: HeightfieldBBoxTreeNode, bbox: BoundingBox, vertices: Vector4[]) {
    bbox.beginExtend();
    for (let i = 0; i < node.rc.w; i++) {
      for (let j = 0; j < node.rc.h; j++) {
        const index = node.rc.x + i + (node.rc.y + j) * this._resX;
        const vert = vertices[index];
        bbox.extend3(vert.x, vert.y, vert.z);
      }
    }
  }
  createChildNode(
    node: HeightfieldBBoxTreeNode,
    x: number,
    y: number,
    w: number,
    h: number,
    vertices: Vector4[]
  ): boolean {
    node.rc.x = x;
    node.rc.y = y;
    node.rc.w = w;
    node.rc.h = h;
    if (w <= 2 && h <= 2) {
      node.left = null;
      node.right = null;
      node.h[0] = this.getHeight (x, y);
      node.h[1] = this.getHeight (x+1, y);
      node.h[2] = this.getHeight (x+1, y+1);
      node.h[3] = this.getHeight (x, y+1);
      const hMin = Math.min (...node.h);
      const hMax = Math.max (...node.h);
      node.bbox = new BoundingBox (new Vector3(x*this._spacingX, hMin, y*this._spacingZ), new Vector3((x+1)*this._spacingX, hMax, (y+1)*this._spacingZ));
    } else {
      if (w >= h) {
        const w1 = (w + 1) >> 1;
        const w2 = w - w1 + 1;
        node.left = this.allocNode();
        this.createChildNode(node.left, x, y, w1, h, vertices);
        node.right = this.allocNode();
        this.createChildNode(node.right, x + w1 - 1, y, w2, h, vertices);
      } else {
        const h1 = (h + 1) >> 1;
        const h2 = h - h1 + 1;
        node.left = this.allocNode();
        this.createChildNode(node.left, x, y, w, h1, vertices);
        node.right = this.allocNode();
        this.createChildNode(node.right, x, y + h1 - 1, w, h2, vertices);
      }
      node.bbox.beginExtend();
      node.bbox.extend(node.left.bbox.minPoint);
      node.bbox.extend(node.left.bbox.maxPoint);
      node.bbox.extend(node.right.bbox.minPoint);
      node.bbox.extend(node.right.bbox.maxPoint);
    }
    return true;
  }
  rayIntersect(ray: Ray): number|null {
    return this.rayIntersectR(ray, this._rootNode);
  }
  rayIntersectR(ray: Ray, node: HeightfieldBBoxTreeNode): number|null {
    const d = ray.bboxIntersectionTestEx (node.bbox);
    if (d === null) {
      return null;
    }
    if (node.left && node.right) {
      const l = this.rayIntersectR (ray, node.left);
      const r = this.rayIntersectR (ray, node.right);
      if (l !== null && r !== null) {
        return l < r ? l : r;
      } else {
        return l === null ? r : l;
      }
    } else {
      const v00 = new Vector3(node.bbox.minPoint.x, node.h[0]/*this.dvHeights.getFloat32(24 + node.v[0] * 4)*/, node.bbox.minPoint.z);
      const v01 = new Vector3(node.bbox.maxPoint.x, node.h[1]/*this.dvHeights.getFloat32(24 + node.v[1] * 4)*/, node.bbox.minPoint.z);
      const v11 = new Vector3(node.bbox.maxPoint.x, node.h[2]/*this.dvHeights.getFloat32(24 + node.v[2] * 4)*/, node.bbox.maxPoint.z);
      const v10 = new Vector3(node.bbox.minPoint.x, node.h[3]/*this.dvHeights.getFloat32(24 + node.v[3] * 4)*/, node.bbox.maxPoint.z);
      let intersected = false;
      let dist1 = ray.intersectionTestTriangle (v00, v01, v10, false);
      if (dist1 !== null && dist1 > 0) {
        intersected = true;
      } else {
        dist1 = Number.MAX_VALUE;
      }
      let dist2 = ray.intersectionTestTriangle (v10, v01, v11, false);
      if (dist2 !== null && dist2 > 0) {
        intersected = true;
      } else {
        dist2 = Number.MAX_VALUE;
      }
      if (!intersected) {
        return null;
      } else {
        return dist1 < dist2 ? dist1 : dist2;
      }
    }
  }
}

/** @internal */
export class HeightField {
  private m_v4Range: Vector4;
  private m_scale: Vector3;
  private m_sizeX: number;
  private m_sizeZ: number;
  private m_bboxTree: HeightfieldBBoxTree;
  private m_normals: Vector3[];
  constructor() {
    this.m_v4Range = Vector4.zero();
    this.m_bboxTree = null;
    this.m_scale = Vector3.one();
    this.m_sizeX = 0;
    this.m_sizeZ = 0;
    this.m_normals = null;
  }
  init(
    sizeX: number,
    sizeZ: number,
    offsetX: number,
    offsetZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    heights: Float32Array
  ): boolean {
    const v: Vector4[] = [];
    for (let i = 0; i < sizeZ; ++i) {
      const srcOffset = i * sizeX;
      const dstOffset = (sizeZ - i - 1) * sizeX;
      for (let j = 0; j < sizeX; ++j) {
        v[dstOffset + j] = new Vector4(
          offsetX + j * scaleX,
          heights[srcOffset + j] * scaleY,
          offsetZ + i * scaleZ,
          1
        );
      }
    }
    this.m_bboxTree = new HeightfieldBBoxTree(sizeX, sizeZ, scaleX, scaleZ, v);
    this.m_v4Range.setXYZW(
      this.m_bboxTree.getRootNode().bbox.minPoint.x,
      this.m_bboxTree.getRootNode().bbox.minPoint.z,
      this.m_bboxTree.getRootNode().bbox.extents.x * 2,
      this.m_bboxTree.getRootNode().bbox.extents.z * 2
    );
    this.m_scale.setXYZ(scaleX, scaleY, scaleZ);
    this.m_sizeX = sizeX;
    this.m_sizeZ = sizeZ;
    this.m_normals = this.computeNormalVectors();
    return true;
  }
  get normals(): Vector3[] {
    return this.m_normals;
  }
  clear(): void {
    this.m_bboxTree = null;
    this.m_v4Range.setXYZW(0, 0, 0, 0);
    this.m_scale.setXYZ(1, 1, 1);
    this.m_sizeX = 0;
    this.m_sizeZ = 0;
  }
  rayIntersect (ray: Ray): number|null {
    return this.m_bboxTree.rayIntersect(ray);
  }
  computeNormals(): Uint8Array {
    const scaleX = this.m_scale.x;
    const scaleZ = this.m_scale.z;
    const heights = this.getHeights();
    const v = new Vector3();
    const normals = new Uint8Array((this.m_sizeZ - 1) * (this.m_sizeX - 1) * 4);
    for (let y = 0; y < this.m_sizeZ - 1; ++y) {
      for (let x = 0; x < this.m_sizeX - 1; ++x) {
        const h00 = heights[x + y * this.m_sizeX];
        const h01 = heights[x + (y + 1) * this.m_sizeX];
        const h11 = heights[x + 1 + (y + 1) * this.m_sizeX];
        const h10 = heights[x + 1 + y * this.m_sizeX];
        const sx = (h00 + h01 - h11 - h10) * 0.5;
        const sy = (h00 + h10 - h01 - h11) * 0.5;
        const index = x + (this.m_sizeZ - 2 - y) * (this.m_sizeX - 1);
        v.setXYZ(sx * scaleZ, 2 * scaleX * scaleZ, -sy * scaleX).inplaceNormalize();
        normals[index * 4 + 0] = Math.floor((v.x * 0.5 + 0.5) * 255);
        normals[index * 4 + 1] = Math.floor((v.y * 0.5 + 0.5) * 255);
        normals[index * 4 + 2] = Math.floor((v.z * 0.5 + 0.5) * 255);
        normals[index * 4 + 3] = 255;
      }
    }
    return normals;
  }
  computeNormalVectors(): Vector3[] {
    const scaleX = this.m_scale.x;
    const scaleZ = this.m_scale.z;
    const heights = this.getHeights();
    const normals = [] as Vector3[];
    for (let y = 0; y < this.m_sizeZ; ++y) {
      for (let x = 0; x < this.m_sizeX; ++x) {
        const h = heights[x + y * this.m_sizeX];
        const h00 = x > 0 && y > 0 ? heights[x - 1 + (y - 1) * this.m_sizeX] : h;
        const h01 = y > 0 && y < this.m_sizeZ - 1 ? heights[x - 1 + (y + 1) * this.m_sizeX] : h;
        const h11 =
          x < this.m_sizeX - 1 && y < this.m_sizeZ - 1 ? heights[x + 1 + (y + 1) * this.m_sizeX] : h;
        const h10 = x < this.m_sizeX - 1 && y > 0 ? heights[x + 1 + (y - 1) * this.m_sizeX] : h;
        const sx = (h00 + h01 - h11 - h10) * 0.5;
        const sy = (h00 + h10 - h01 - h11) * 0.5;
        const index = x + (this.m_sizeZ - 1 - y) * this.m_sizeX;
        normals[index] = new Vector3(sx * scaleZ, 2 * scaleX * scaleZ, -sy * scaleX).inplaceNormalize();
      }
    }
    return normals;
  }
  getBBoxTree(): HeightfieldBBoxTree {
    return this.m_bboxTree;
  }
  getSpacingX(): number {
    return this.m_scale.x;
  }
  getSpacingZ(): number {
    return this.m_scale.z;
  }
  getVerticalScale(): number {
    return this.m_scale.y;
  }
  getSizeX(): number {
    return this.m_sizeX;
  }
  getSizeZ(): number {
    return this.m_sizeZ;
  }
  getOffsetX(): number {
    return this.m_v4Range.x;
  }
  getOffsetZ(): number {
    return this.m_v4Range.y;
  }
  getBoundingbox(): BoundingBox {
    return this.m_bboxTree?.getRootNode()?.bbox || null;
  }
  getHeights(): Float32Array {
    return this.m_bboxTree?.getHeights() || null;
  }
  getHeight(x: number, z: number): number {
    return this.m_bboxTree ? this.m_bboxTree.getHeight(x, z) : 0;
  }
  getRealHeight(x: number, z: number): number {
    return this.m_bboxTree ? this.m_bboxTree.getRealHeight(x, z) : 0;
  }
  getRealNormal(x: number, z: number, normal?: Vector3): Vector3 {
    normal = normal ?? new Vector3();
    const bboxRootNode = this.m_bboxTree.getRootNode();
    x -= bboxRootNode.bbox.minPoint.x;
    z -= bboxRootNode.bbox.minPoint.z;
    const tileSizeX = (bboxRootNode.bbox.maxPoint.x - bboxRootNode.bbox.minPoint.x) / (this.m_sizeX - 1);
    const tileSizeY = (bboxRootNode.bbox.maxPoint.z - bboxRootNode.bbox.minPoint.z) / (this.m_sizeZ - 1);
    const x_unscale = x / tileSizeX;
    const y_unscale = z / tileSizeY;
    let l = Math.floor(x_unscale);
    let t = Math.floor(y_unscale);
    let r = l + 1;
    let b = t + 1;
    if (l < 0) {
      l = 0;
    }
    if (t < 0) {
      t = 0;
    }
    if (r >= this.m_sizeX) {
      r = this.m_sizeX - 1;
    }
    if (b >= this.m_sizeZ) {
      b = this.m_sizeZ - 1;
    }
    normal.set(this.m_normals[l + t * this.m_sizeX]);
    normal.addBy(this.m_normals[r + t * this.m_sizeX]);
    normal.addBy(this.m_normals[r + b * this.m_sizeX]);
    normal.addBy(this.m_normals[l + b * this.m_sizeX]);
    normal.scaleBy(0.4).inplaceNormalize();
    return normal;
  }
}
