import type { TypedArray, Matrix4x4, Ray, Nullable } from '@zephyr3d/base';
import { AABB, Vector3 } from '@zephyr3d/base';
import type { PrimitiveType } from '@zephyr3d/device';

interface PrimitivesInfo {
  vertices: Vector3[];
  indices: Nullable<number[]>;
  primitiveType: PrimitiveType;
}

interface AABBTreeNode {
  box: AABB;
  triangles: number[];
  axis: number;
  left: number;
  right: number;
}

const tmpTriangle: [number, number, number] = [0, 0, 0];

/**
 * Axis-Aligned Bounding Box Tree
 * @public
 */
export class AABBTree {
  /** @internal */
  private _primitivesInfo: Nullable<PrimitivesInfo>;
  /** @internal */
  private _nodes: Nullable<AABBTreeNode[]>;
  /** Creates an empty AABB tree */
  constructor();
  /** Creates an AABB tree by copying from another AABB tree */
  constructor(rhs: AABBTree);
  constructor(other?: AABBTree) {
    this._primitivesInfo = null;
    this._nodes = null;
    if (other) {
      this._primitivesInfo = other._primitivesInfo
        ? {
            vertices: other._primitivesInfo.vertices?.map((value) => new Vector3(value)),
            indices: other._primitivesInfo.indices?.map((value) => value) ?? null,
            primitiveType: other._primitivesInfo.primitiveType
          }
        : null;
      this._nodes = other._nodes
        ? other._nodes.map((value) => {
            return {
              box: new AABB(value.box),
              triangles: value.triangles?.map((val) => val),
              axis: value.axis,
              left: value.left,
              right: value.right
            };
          })
        : null;
    }
  }
  /**
   * Build the AABB tree from a polygon soup
   * @param vertices - Vertices of the polygon soup
   * @param indices - indices of the polygon soup
   * @param primitiveType - Prmitive type of the polygon soup
   */
  buildFromPrimitives(
    vertices: number[] | TypedArray,
    indices: number[] | TypedArray,
    primitiveType: PrimitiveType
  ): void {
    this._primitivesInfo = {
      vertices: [],
      indices: null,
      primitiveType: primitiveType
    };
    for (let i = 0; i < vertices.length; i += 3) {
      this._primitivesInfo.vertices.push(
        new Vector3(vertices[i] as number, vertices[i + 1] as number, vertices[i + 2] as number)
      );
    }
    if (indices) {
      this._primitivesInfo.indices = [];
      for (const index of indices) {
        this._primitivesInfo.indices.push(index as number);
      }
    }
    this._buildSubNodes();
  }
  /**
   * Checks for intersection between a ray and the AABB tree without calculating the intersection point
   * @param ray - The ray being traced
   * @returns true if the ray hits the AABB tree, false otherwise
   */
  rayIntersectionTest(ray: Ray): boolean {
    return this._nodes!.length > 0 ? this._rayIntersectionTest(0, ray) : false;
  }
  /**
   * Checks for intersection between a ray and the AABB tree
   * @param ray - The ray being traced
   * @returns The distance between the ray origin and the hit point if the ray hits the AABB tree, null otherwise
   */
  rayIntersectionDistance(ray: Ray): Nullable<number> {
    return this._nodes!.length > 0 ? this._rayIntersectionDistance(0, ray) : null;
  }
  /**
   * Gets the top level bounding box of the tree
   * @returns The top level bounding box
   */
  getTopLevelAABB(): Nullable<AABB> {
    return this._nodes!.length > 0 ? this._nodes![0].box : null;
  }
  /**
   * Transform the tree by a matrix
   * @param matrix - The transform matrix
   */
  transform(matrix: Matrix4x4): void {
    if (matrix && this._primitivesInfo && this._primitivesInfo.vertices) {
      for (const vert of this._primitivesInfo.vertices) {
        matrix.transformPointAffine(vert, vert);
      }
      this._buildSubNodes();
    }
  }
  /** @internal */
  verify() {
    const numTris = this._verifyNode(0);
    const n = this._getNumTriangles();
    if (numTris !== n) {
      throw new Error(`AABB tree verification failed: triangle count mismatch, got ${numTris}, expect ${n}`);
    }
  }
  /** @internal */
  private _verifyNode(nodeIndex: number): number {
    const node = this._nodes![nodeIndex];
    if (!node) {
      throw new Error(`AABB tree verification failed: invalid node index: ${nodeIndex}`);
    }
    let numTris = 0;
    const extents = node.box.extents[node.axis];
    const tmpTri: [number, number, number] = [0, 0, 0];
    for (const tri of node.triangles) {
      this._getTriangle(tri, tmpTri);
      let max = Number.MIN_VALUE;
      let min = Number.MAX_VALUE;
      for (const v of tmpTri) {
        const p = this._primitivesInfo!.vertices[v];
        if (!node.box.containsPoint(p)) {
          throw new Error(`AABB tree verification failed: triangle not inside AABB`);
        }
        const t = p[node.axis];
        if (t < min) {
          min = t;
        }
        if (t > max) {
          max = t;
        }
        if (max - min <= extents) {
          throw new Error(`AABB tree verification failed: extents test failed`);
        }
      }
    }
    numTris += node.triangles.length;
    if (node.left >= 0) {
      numTris += this._verifyNode(node.left);
    }
    if (node.right >= 0) {
      numTris += this._verifyNode(node.right);
    }
    return numTris;
  }
  /** @internal */
  private _buildNode(
    nodeIndex: number,
    triangles: number[],
    triangleMin: [number, number, number][],
    triangleMax: [number, number, number][]
  ) {
    const node = this._nodes![nodeIndex];
    if (triangles.length === 1) {
      node.triangles.push(triangles[0]);
    } else {
      const splitAxis = (node.axis = this._selectBestSplitAxis(
        node.box.extents,
        triangles,
        triangleMin,
        triangleMax
      ));
      const sizeMax = node.box.extents[splitAxis];
      const sizeCenter = node.box.center[splitAxis];
      const sizeLeft = sizeCenter - node.box.extents[splitAxis] * 0.5;
      const leftTriangles: number[] = [];
      const rightTriangles: number[] = [];
      const leftbox = new AABB();
      leftbox.beginExtend();
      const rightbox = new AABB();
      rightbox.beginExtend();
      for (const tri of triangles) {
        const min = triangleMin[tri];
        const max = triangleMax[tri];
        const size = max[splitAxis] - min[splitAxis];
        if (size >= sizeMax) {
          node.triangles.push(tri);
        } else if (max[splitAxis] <= sizeCenter || min[splitAxis] <= sizeLeft) {
          leftTriangles.push(tri);
          leftbox.extend3(min[0], min[1], min[2]);
          leftbox.extend3(max[0], max[1], max[2]);
        } else {
          rightTriangles.push(tri);
          rightbox.extend3(min[0], min[1], min[2]);
          rightbox.extend3(max[0], max[1], max[2]);
        }
      }
      if (leftTriangles.length) {
        this._nodes!.push({
          box: leftbox,
          triangles: [],
          axis: -1,
          left: -1,
          right: -1
        });
        node.left = this._nodes!.length - 1;
        this._buildNode(this._nodes!.length - 1, leftTriangles, triangleMin, triangleMax);
      }
      if (rightTriangles.length) {
        this._nodes!.push({
          box: rightbox,
          triangles: [],
          axis: -1,
          left: -1,
          right: -1
        });
        node.right = this._nodes!.length - 1;
        this._buildNode(this._nodes!.length - 1, rightTriangles, triangleMin, triangleMax);
      }
    }
  }
  /** @internal */
  private _selectBestSplitAxis(
    extents: Vector3,
    triangles: number[],
    triangleMin: [number, number, number][],
    triangleMax: [number, number, number][]
  ): number {
    const dx = extents.x,
      dy = extents.y,
      dz = extents.z;
    let nx = 0,
      ny = 0,
      nz = 0;
    for (const tri of triangles) {
      const max = triangleMax[tri];
      const min = triangleMin[tri];
      if (max[0] - min[0] >= dx) {
        nx++;
      }
      if (max[1] - min[1] >= dy) {
        ny++;
      }
      if (max[2] - min[2] >= dz) {
        nz++;
      }
    }
    if (nx < ny) {
      if (nx < nz) {
        return 0;
      } else {
        return nx === nz ? (dx > dz ? 0 : 2) : 2;
      }
    } else if (nx == ny) {
      if (nz < nx) {
        return 2;
      } else if (nz > nx) {
        return dx > dy ? 0 : 1;
      } else {
        if (dx < dy) {
          return dy > dz ? 1 : 2;
        } else {
          return dx > dz ? 0 : 2;
        }
      }
    } else {
      if (ny < nz) {
        return 1;
      } else {
        return ny === nz ? (dy > dz ? 1 : 2) : 2;
      }
    }
  }
  /** @internal */
  private _getNumTriangles() {
    const numIndices = this._primitivesInfo!.indices
      ? this._primitivesInfo!.indices.length
      : this._primitivesInfo!.vertices.length;
    switch (this._primitivesInfo!.primitiveType) {
      case 'triangle-list':
        return Math.floor(numIndices / 3);
      case 'triangle-strip':
        return numIndices - 2;
      case 'triangle-fan':
        return numIndices - 2;
      default:
        return 0;
    }
  }
  /** @internal */
  private _rayIntersectionDistance(nodeIndex: number, ray: Ray): Nullable<number> {
    const node = this._nodes![nodeIndex];
    if (!ray.bboxIntersectionTest(node.box)) {
      return null;
    }
    let minDist = Number.MAX_VALUE;
    for (const tri of node.triangles) {
      this._getTriangle(tri, tmpTriangle);
      const v0 = this._primitivesInfo!.vertices[tmpTriangle[0]];
      const v1 = this._primitivesInfo!.vertices[tmpTriangle[1]];
      const v2 = this._primitivesInfo!.vertices[tmpTriangle[2]];
      const dist = ray.intersectionTestTriangle(v0, v1, v2, false);
      if (dist !== null && dist >= 0 && dist < minDist) {
        minDist = dist;
      }
    }
    let a: number, b: number;
    if (node.axis >= 0) {
      if (ray.direction[node.axis] < 0) {
        a = node.right;
        b = node.left;
      } else {
        a = node.left;
        b = node.right;
      }
      if (a >= 0) {
        const dist = this._rayIntersectionDistance(a, ray);
        if (dist !== null && dist >= 0 && dist < minDist) {
          minDist = dist;
        }
      }
      if (b >= 0) {
        const dist = this._rayIntersectionDistance(b, ray);
        if (dist !== null && dist >= 0 && dist < minDist) {
          minDist = dist;
        }
      }
    }
    return minDist === Number.MAX_VALUE ? null : minDist;
  }
  /** @internal */
  private _rayIntersectionTest(nodeIndex: number, ray: Ray): boolean {
    const node = this._nodes![nodeIndex];
    if (!ray.bboxIntersectionTest(node.box)) {
      return false;
    }
    for (const tri of node.triangles) {
      this._getTriangle(tri, tmpTriangle);
      const v0 = this._primitivesInfo!.vertices[tmpTriangle[0]];
      const v1 = this._primitivesInfo!.vertices[tmpTriangle[1]];
      const v2 = this._primitivesInfo!.vertices[tmpTriangle[2]];
      const dist = ray.intersectionTestTriangle(v0, v1, v2, false);
      if (dist !== null && dist > 0) {
        return true;
      }
    }
    let a: number, b: number;
    if (node.axis >= 0) {
      if (ray.direction[node.axis] < 0) {
        a = node.right;
        b = node.left;
      } else {
        a = node.left;
        b = node.right;
      }
      if (a >= 0 && this._rayIntersectionTest(a, ray)) {
        return true;
      }
      if (b >= 0 && this._rayIntersectionTest(b, ray)) {
        return true;
      }
    }
    return false;
  }
  /** @internal */
  private _getTriangle(n: number, out: [number, number, number]): Nullable<[number, number, number]> {
    const indices = this._primitivesInfo!.indices;
    let v0: number, v1: number, v2: number;
    out = out || [0, 0, 0];
    switch (this._primitivesInfo!.primitiveType) {
      case 'triangle-list':
        v0 = n * 3;
        v1 = v0 + 1;
        v2 = v0 + 2;
        break;
      case 'triangle-strip': {
        const r = n % 2;
        v0 = n + r;
        v1 = n - r + 1;
        v2 = n + 2;
        break;
      }
      case 'triangle-fan':
        v0 = 0;
        v1 = n + 1;
        v2 = n + 2;
        break;
      default:
        return null;
    }
    out[0] = indices ? indices[v0] : v0;
    out[1] = indices ? indices[v1] : v1;
    out[2] = indices ? indices[v2] : v2;
    return out;
  }
  /** @internal */
  _buildSubNodes() {
    const triangleMin: [number, number, number][] = [];
    const triangleMax: [number, number, number][] = [];
    const triangles: number[] = [];
    const numTriangles = this._getNumTriangles();
    const rootNode = {
      box: new AABB(),
      triangles: [],
      axis: -1,
      left: -1,
      right: -1
    };
    rootNode.box.beginExtend();
    for (let i = 0; i < numTriangles; i++) {
      triangles.push(i);
      this._getTriangle(i, tmpTriangle);
      const v0 = this._primitivesInfo!.vertices[tmpTriangle[0]];
      const v1 = this._primitivesInfo!.vertices[tmpTriangle[1]];
      const v2 = this._primitivesInfo!.vertices[tmpTriangle[2]];
      const min: [number, number, number] = [
        Math.min(Math.min(v0.x, v1.x), v2.x),
        Math.min(Math.min(v0.y, v1.y), v2.y),
        Math.min(Math.min(v0.z, v1.z), v2.z)
      ];
      rootNode.box.extend3(min[0], min[1], min[2]);
      triangleMin.push(min);
      const max: [number, number, number] = [
        Math.max(Math.max(v0.x, v1.x), v2.x),
        Math.max(Math.max(v0.y, v1.y), v2.y),
        Math.max(Math.max(v0.z, v1.z), v2.z)
      ];
      rootNode.box.extend3(max[0], max[1], max[2]);
      triangleMax.push(max);
    }
    if (rootNode.box.isValid()) {
      this._nodes = [rootNode];
      this._buildNode(0, triangles, triangleMin, triangleMax);
    } else {
      this._nodes = [];
    }
  }
}
