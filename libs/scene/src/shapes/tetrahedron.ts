import { Vector3, type AABB, type Clonable, type Ray } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

/**
 * Creation options for tetrahedron shape
 * @public
 */
export interface TetrahedronCreationOptions extends ShapeCreationOptions {
  height?: number;
  sizeX?: number;
  sizeZ?: number;
}

/**
 * Tetrahedron shape
 * @public
 */
export class TetrahedronShape
  extends Shape<TetrahedronCreationOptions>
  implements Clonable<TetrahedronShape>
{
  static _defaultOptions = {
    ...Shape._defaultOptions,
    height: 1,
    sizeX: 1,
    sizeZ: 1
  };

  constructor(options?: TetrahedronCreationOptions) {
    super(options);
  }

  clone() {
    return new TetrahedronShape(this._options) as this;
  }

  get type() {
    return 'Tetrahedron';
  }

  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   *
   * Tests each triangular face of the tetrahedron with the Möller–Trumbore
   * algorithm and returns the smallest non-negative t.
   */
  raycast(ray: Ray) {
    const opt = this._options;
    const height = opt.height ?? 1;
    const sizeX = opt.sizeX ?? 1;
    const sizeZ = opt.sizeZ ?? 1;

    const top = [0, height, 0] as const;
    const p0 = [sizeX, 0, sizeZ] as const; // pxpz
    const p1 = [sizeX, 0, -sizeZ] as const; // pxnz
    const p2 = [-sizeX, 0, -sizeZ] as const; // nxnz
    const p3 = [-sizeX, 0, sizeZ] as const; // nxpz

    // All six faces (4 side triangles + 2 bottom triangles)
    const faces: [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number]
    ][] = [
      [top, p0, p1], // right
      [top, p1, p2], // back
      [top, p2, p3], // left
      [top, p3, p0], // front
      [p0, p3, p1], // bottom tri 1: pxpz -> nxpz -> pxnz
      [p1, p3, p2] // bottom tri 2: pxnz -> nxpz -> nxnz
    ];

    let tMin = Infinity;
    for (const [v0, v1, v2] of faces) {
      const t = TetrahedronShape._rayTriangle(ray, v0, v1, v2);
      if (t !== null && t < tMin) {
        tMin = t;
      }
    }
    return isFinite(tMin) ? tMin : null;
  }

  /**
   * @internal Möller–Trumbore ray-triangle intersection.
   * Returns t >= 0 on hit, null otherwise.
   */
  private static _rayTriangle(
    ray: Ray,
    v0: readonly [number, number, number],
    v1: readonly [number, number, number],
    v2: readonly [number, number, number]
  ): number | null {
    const eps = 1e-8;
    const e1x = v1[0] - v0[0],
      e1y = v1[1] - v0[1],
      e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0],
      e2y = v2[1] - v0[1],
      e2z = v2[2] - v0[2];
    const dx = ray.direction.x,
      dy = ray.direction.y,
      dz = ray.direction.z;
    // h = D × e2
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < eps) {
      return null;
    }
    const invDet = 1 / det;
    const sx = ray.origin.x - v0[0];
    const sy = ray.origin.y - v0[1];
    const sz = ray.origin.z - v0[2];
    const u = (sx * hx + sy * hy + sz * hz) * invDet;
    if (u < 0 || u > 1) {
      return null;
    }
    // q = s × e1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) {
      return null;
    }
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return t >= 0 ? t : null;
  }

  private static calculateTriangleNormal(v0: Vector3, v1: Vector3, v2: Vector3) {
    const edge1 = Vector3.sub(v1, v0);
    const edge2 = Vector3.sub(v2, v0);
    return Vector3.normalize(Vector3.cross(edge1, edge2));
  }

  private static addTriangle(
    v0: Vector3,
    v1: Vector3,
    v2: Vector3,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    indexOffset: number,
    currentVertexIndex: number
  ) {
    // Calculate normal
    const normal = this.calculateTriangleNormal(v0, v1, v2);

    // Add vertex
    vertices.push(v0.x, v0.y, v0.z);
    vertices.push(v1.x, v1.y, v1.z);
    vertices.push(v2.x, v2.y, v2.z);

    // Add normal
    normals?.push(normal.x, normal.y, normal.z);
    normals?.push(normal.x, normal.y, normal.z);
    normals?.push(normal.x, normal.y, normal.z);

    const uv0 = [0.5, 0];
    const uv1 = [0, 1];
    const uv2 = [1, 1];
    // Add UV
    uvs?.push(...uv0); // 顶点
    uvs?.push(...uv1); // 左下
    uvs?.push(...uv2); // 右下

    if (tangents) {
      const t = this.computeTangent(
        [v0.x, v0.y, v0.z],
        [v1.x, v1.y, v1.z],
        [v2.x, v2.y, v2.z],
        uv0,
        uv1,
        uv2,
        [normal.x, normal.y, normal.z]
      );
      tangents.push(...t);
      tangents.push(...t);
      tangents.push(...t);
    }

    // Add index (CCW)
    indices.push(indexOffset + currentVertexIndex);
    indices.push(indexOffset + currentVertexIndex + 1);
    indices.push(indexOffset + currentVertexIndex + 2);

    return currentVertexIndex + 3;
  }

  static generateData(
    opt: TetrahedronCreationOptions,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ) {
    const options = Object.assign({}, this._defaultOptions, opt ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;

    const height = options.height;
    const sizeX = options.sizeX;
    const sizeZ = options.sizeZ;

    // Five vertices for the tetrahedron
    const topVertex = new Vector3(0, height, 0);
    const bottomVertices = [
      new Vector3(sizeX, 0, sizeZ), // pxpz
      new Vector3(sizeX, 0, -sizeZ), // pxnz
      new Vector3(-sizeX, 0, -sizeZ), // nxnz
      new Vector3(-sizeX, 0, sizeZ) // nxpz
    ];

    let _currentVertexIndex = 0;

    // Right plane (top -> pxpz -> pxnz)
    _currentVertexIndex = this.addTriangle(
      topVertex,
      bottomVertices[0], // pxpz
      bottomVertices[1], // pxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Back plane (top -> pxnz -> nxnz)
    _currentVertexIndex = this.addTriangle(
      topVertex,
      bottomVertices[1], // pxnz
      bottomVertices[2], // nxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Left plane (top -> nxnz -> nxpz)
    _currentVertexIndex = this.addTriangle(
      topVertex,
      bottomVertices[2], // nxnz
      bottomVertices[3], // nxpz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Front plane (top -> nxpz -> pxpz)
    _currentVertexIndex = this.addTriangle(
      topVertex,
      bottomVertices[3], // nxpz
      bottomVertices[0], // pxpz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Bottom: split into two triangles
    // triangle 1: pxpz -> nxpz -> pxnz
    _currentVertexIndex = this.addTriangle(
      bottomVertices[0], // pxpz
      bottomVertices[3], // nxpz
      bottomVertices[1], // pxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // triangle 2: pxnz -> nxpz -> nxnz
    _currentVertexIndex = this.addTriangle(
      bottomVertices[1], // pxnz
      bottomVertices[3], // nxpz
      bottomVertices[2], // nxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    Shape._transform(options.transform, vertices, normals, start);
    if (bbox || vertexCallback) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        if (bbox) {
          bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
          bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
          bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
          bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
          bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
          bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
        }
        vertexCallback?.((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }

    return 'triangle-list' as const;
  }
}

/**
 * Tetrahedron shape
 * @public
 */
export class TetrahedronFrameShape
  extends Shape<TetrahedronCreationOptions>
  implements Clonable<TetrahedronShape>
{
  static _defaultOptions = {
    ...Shape._defaultOptions,
    height: 1,
    sizeX: 1,
    sizeZ: 1
  };

  constructor(options?: TetrahedronCreationOptions) {
    super(options);
  }

  clone() {
    return new TetrahedronShape(this._options) as this;
  }

  get type() {
    return 'TetrahedronFrame' as const;
  }

  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   *
   * Tests each triangular face of the tetrahedron with the Möller–Trumbore
   * algorithm and returns the smallest non-negative t.
   * The wireframe has the same overall geometry as the solid version.
   */
  raycast(ray: Ray) {
    const opt = this._options;
    const height = opt.height ?? 1;
    const sizeX = opt.sizeX ?? 1;
    const sizeZ = opt.sizeZ ?? 1;

    const top = [0, height, 0] as const;
    const p0 = [sizeX, 0, sizeZ] as const;
    const p1 = [sizeX, 0, -sizeZ] as const;
    const p2 = [-sizeX, 0, -sizeZ] as const;
    const p3 = [-sizeX, 0, sizeZ] as const;

    const faces: [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number]
    ][] = [
      [top, p0, p1],
      [top, p1, p2],
      [top, p2, p3],
      [top, p3, p0]
    ];

    let tMin = Infinity;
    for (const [v0, v1, v2] of faces) {
      const t = TetrahedronFrameShape._rayTriangle(ray, v0, v1, v2);
      if (t !== null && t < tMin) {
        tMin = t;
      }
    }
    return isFinite(tMin) ? tMin : null;
  }

  /** @internal Möller–Trumbore ray-triangle intersection */
  private static _rayTriangle(
    ray: Ray,
    v0: readonly [number, number, number],
    v1: readonly [number, number, number],
    v2: readonly [number, number, number]
  ): number | null {
    const eps = 1e-8;
    const e1x = v1[0] - v0[0],
      e1y = v1[1] - v0[1],
      e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0],
      e2y = v2[1] - v0[1],
      e2z = v2[2] - v0[2];
    const dx = ray.direction.x,
      dy = ray.direction.y,
      dz = ray.direction.z;
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < eps) {
      return null;
    }
    const invDet = 1 / det;
    const sx = ray.origin.x - v0[0];
    const sy = ray.origin.y - v0[1];
    const sz = ray.origin.z - v0[2];
    const u = (sx * hx + sy * hy + sz * hz) * invDet;
    if (u < 0 || u > 1) {
      return null;
    }
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < 0 || u + v > 1) {
      return null;
    }
    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    return t >= 0 ? t : null;
  }

  private static calculateTriangleNormal(v0: Vector3, v1: Vector3, v2: Vector3) {
    const edge1 = Vector3.sub(v1, v0);
    const edge2 = Vector3.sub(v2, v0);
    return Vector3.normalize(Vector3.cross(edge1, edge2));
  }

  private static addLines(
    v0: Vector3,
    v1: Vector3,
    v2: Vector3,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    indexOffset: number,
    currentVertexIndex: number
  ) {
    // Calculate normal
    const normal = this.calculateTriangleNormal(v0, v1, v2);

    // Add vertex
    vertices.push(v0.x, v0.y, v0.z);
    vertices.push(v1.x, v1.y, v1.z);
    vertices.push(v2.x, v2.y, v2.z);

    // Add normal
    normals?.push(normal.x, normal.y, normal.z);
    normals?.push(normal.x, normal.y, normal.z);
    normals?.push(normal.x, normal.y, normal.z);

    // Add UV
    const uv0 = [0.5, 0];
    const uv1 = [0, 1];
    const uv2 = [1, 1];
    uvs?.push(...uv0);
    uvs?.push(...uv1);
    uvs?.push(...uv2);

    // Add tangents
    if (tangents) {
      const t = this.computeTangent(
        [v0.x, v0.y, v0.z],
        [v1.x, v1.y, v1.z],
        [v2.x, v2.y, v2.z],
        uv0,
        uv1,
        uv2,
        [normal.x, normal.y, normal.z]
      );
      tangents.push(...t);
      tangents.push(...t);
      tangents.push(...t);
    }

    // Add index
    indices.push(indexOffset + currentVertexIndex);
    indices.push(indexOffset + currentVertexIndex + 1);
    indices.push(indexOffset + currentVertexIndex + 1);
    indices.push(indexOffset + currentVertexIndex + 2);
    indices.push(indexOffset + currentVertexIndex + 2);
    indices.push(indexOffset + currentVertexIndex);

    return currentVertexIndex + 3;
  }

  static generateData(
    opt: TetrahedronCreationOptions,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ) {
    const options = Object.assign({}, this._defaultOptions, opt ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;

    const height = options.height;
    const sizeX = options.sizeX;
    const sizeZ = options.sizeZ;

    // Five vertices for the tetrahedron
    const topVertex = new Vector3(0, height, 0);
    const bottomVertices = [
      new Vector3(sizeX, 0, sizeZ), // pxpz
      new Vector3(sizeX, 0, -sizeZ), // pxnz
      new Vector3(-sizeX, 0, -sizeZ), // nxnz
      new Vector3(-sizeX, 0, sizeZ) // nxpz
    ];

    let _currentVertexIndex = 0;

    // Right plane (top -> pxpz -> pxnz)
    _currentVertexIndex = this.addLines(
      topVertex,
      bottomVertices[0], // pxpz
      bottomVertices[1], // pxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Back plane (top -> pxnz -> nxnz)
    _currentVertexIndex = this.addLines(
      topVertex,
      bottomVertices[1], // pxnz
      bottomVertices[2], // nxnz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Left plane (top -> nxnz -> nxpz)
    _currentVertexIndex = this.addLines(
      topVertex,
      bottomVertices[2], // nxnz
      bottomVertices[3], // nxpz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    // Front plane (top -> nxpz -> pxpz)
    _currentVertexIndex = this.addLines(
      topVertex,
      bottomVertices[3], // nxpz
      bottomVertices[0], // pxpz
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      indexOffset,
      _currentVertexIndex
    );

    Shape._transform(options.transform, vertices, normals, start);
    if (bbox || vertexCallback) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        if (bbox) {
          bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
          bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
          bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
          bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
          bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
          bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
        }
        vertexCallback?.((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }

    return 'line-list' as const;
  }
}
