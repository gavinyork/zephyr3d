import type { Ray } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { BoundingBox } from '../../utility/bounding_volume';

/** @internal */
export interface HeightfieldBBoxTreeNode {
  bbox: BoundingBox;
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
    this.createChildNode(this._rootNode, 0, 0, res_x - 1, res_y - 1, vertices);
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
    return normal;
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
    if (w <= 16 && h <= 16) {
      node.left = null;
      node.right = null;
      let hMin = Infinity;
      let hMax = -Infinity;
      for (let i = x; i <= x + w; i++) {
        for (let j = y; j <= y + h; j++) {
          const h = this.getHeight(i, j);
          if (h > hMax) {
            hMax = h;
          }
          if (h < hMin) {
            hMin = h;
          }
        }
      }
      node.bbox = new BoundingBox(
        new Vector3(x * this._spacingX, hMin, y * this._spacingZ),
        new Vector3((x + w) * this._spacingX, hMax, (y + h) * this._spacingZ)
      );
    } else {
      if (w >= h) {
        const w1 = w >> 1;
        const w2 = w - w1;
        node.left = this.allocNode();
        this.createChildNode(node.left, x, y, w1, h, vertices);
        node.right = this.allocNode();
        this.createChildNode(node.right, x + w1, y, w2, h, vertices);
      } else {
        const h1 = h >> 1;
        const h2 = h - h1;
        node.left = this.allocNode();
        this.createChildNode(node.left, x, y, w, h1, vertices);
        node.right = this.allocNode();
        this.createChildNode(node.right, x, y + h1, w, h2, vertices);
      }
      node.bbox.beginExtend();
      node.bbox.extend(node.left.bbox.minPoint);
      node.bbox.extend(node.left.bbox.maxPoint);
      node.bbox.extend(node.right.bbox.minPoint);
      node.bbox.extend(node.right.bbox.maxPoint);
    }
    return true;
  }
  rayIntersect(ray: Ray): number | null {
    return this.rayIntersectRecursive(ray);
  }
  rayIntersectLeaf(ray: Ray, node: HeightfieldBBoxTreeNode): number | null {
    let x0 = ray.origin.x;
    let y0 = ray.origin.z;
    let dx = ray.direction.x;
    let dy = ray.direction.z;
    const gridSizeX = this._spacingX;
    const gridSizeY = this._spacingZ;
    const x = node.rc.x;
    const y = node.rc.y;
    const w = node.rc.w;
    const h = node.rc.h;
    const epsl = 0.001;
    let tx = 0;
    let ty = 0;
    const xmin = x * gridSizeX;
    const xmax = xmin + w * gridSizeX;
    const ymin = y * gridSizeY;
    const ymax = ymin + h * gridSizeY;
    const xcenter = (xmin + xmax) / 2;
    const ycenter = (ymin + ymax) / 2;
    let mirrorx = false;
    let mirrory = false;
    if (dx < 0) {
      dx = -dx;
      x0 += 2 * (xcenter - x0);
      mirrorx = true;
    }
    if (dy < 0) {
      dy = -dy;
      y0 += 2 * (ycenter - y0);
      mirrory = true;
    }
    if (x0 < xmin) {
      tx = (xmin - x0) / dx;
    } else if (x0 > xmax) {
      return;
    }
    if (y0 < ymin) {
      ty = (ymin - y0) / dy;
    } else if (y0 > ymax) {
      return;
    }
    const t = tx > ty ? tx : ty;
    x0 += t * dx;
    y0 += t * dy;
    let u = Math.floor((x0 - xmin + epsl) / gridSizeX);
    let v = Math.floor((y0 - ymin + epsl) / gridSizeY);
    while (u >= 0 && u <= w && v >= 0 && v <= h) {
      if (u < w && v < h) {
        const m = x + (mirrorx ? w - u - 1 : u);
        const n = y + (mirrory ? h - v - 1 : v);
        const v00 = new Vector3(m * this._spacingX, this.getHeight(m, n), n * this._spacingZ);
        const v01 = new Vector3((m + 1) * this._spacingX, this.getHeight(m + 1, n), n * this._spacingZ);
        const v11 = new Vector3(
          (m + 1) * this._spacingX,
          this.getHeight(m + 1, n + 1),
          (n + 1) * this._spacingZ
        );
        const v10 = new Vector3(m * this._spacingX, this.getHeight(m, n + 1), (n + 1) * this._spacingZ);
        let intersected = false;
        let dist1 = ray.intersectionTestTriangle(v00, v01, v10, false);
        if (dist1 !== null && dist1 > 0) {
          intersected = true;
        } else {
          dist1 = Number.MAX_VALUE;
        }
        let dist2 = ray.intersectionTestTriangle(v10, v01, v11, false);
        if (dist2 !== null && dist2 > 0) {
          intersected = true;
        } else {
          dist2 = Number.MAX_VALUE;
        }
        if (intersected) {
          return dist1 < dist2 ? dist1 : dist2;
        }
      }
      let d = Infinity;
      if (dx > 0) {
        const x1 = (u + x + 1) * gridSizeX;
        d = Math.min(d, (x1 - x0) / dx);
      }
      if (dy !== 0) {
        const y1 = (v + y + 1) * gridSizeY;
        d = Math.min(d, (y1 - y0) / dy);
      }
      x0 += d * dx;
      y0 += d * dy;
      u = Math.floor((x0 - xmin + epsl) / gridSizeX);
      v = Math.floor((y0 - ymin + epsl) / gridSizeY);
    }
    return null;
  }
  rayIntersectRecursive(ray: Ray): number | null {
    const q: HeightfieldBBoxTreeNode[] = [this._rootNode];
    while (q.length > 0) {
      const node = q.shift();
      if (!node.left) {
        const d = this.rayIntersectLeaf(ray, node);
        if (d !== null) {
          return d;
        }
      } else {
        const dl = ray.bboxIntersectionTestEx(node.left.bbox);
        const dr = ray.bboxIntersectionTestEx(node.right.bbox);
        if (dl !== null && dr !== null) {
          if (dl < dr) {
            q.unshift(node.right);
            q.unshift(node.left);
          } else {
            q.unshift(node.left);
            q.unshift(node.right);
          }
        } else if (dl !== null) {
          q.unshift(node.left);
        } else if (dr !== null) {
          q.unshift(node.right);
        }
      }
    }
    return null;
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
  rayIntersect(ray: Ray): number | null {
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
