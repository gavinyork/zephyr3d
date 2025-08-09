import { Vector3, type AABB, type Clonable } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

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

  clone(): TetrahedronShape {
    return new TetrahedronShape(this._options);
  }

  get type(): string {
    return 'Tetrahedron';
  }

  private static calculateTriangleNormal(v0: Vector3, v1: Vector3, v2: Vector3): Vector3 {
    const edge1 = Vector3.sub(v1, v0);
    const edge2 = Vector3.sub(v2, v0);
    // 使用右手定则：edge1 × edge2，确保逆时针顶点顺序产生向外法线
    return Vector3.normalize(Vector3.cross(edge1, edge2));
  }

  private static addTriangle(
    v0: Vector3,
    v1: Vector3,
    v2: Vector3,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    indexOffset: number,
    currentVertexIndex: number
  ): number {
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
    uvs?.push(0.5, 0); // 顶点
    uvs?.push(0, 1); // 左下
    uvs?.push(1, 1); // 右下

    // Add index (CCW)
    indices.push(indexOffset + currentVertexIndex);
    indices.push(indexOffset + currentVertexIndex + 1);
    indices.push(indexOffset + currentVertexIndex + 2);

    return currentVertexIndex + 3;
  }

  static generateData(
    options: TetrahedronCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
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

    return 'triangle-list';
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

  clone(): TetrahedronShape {
    return new TetrahedronShape(this._options);
  }

  get type(): string {
    return 'Tetrahedron';
  }

  private static calculateTriangleNormal(v0: Vector3, v1: Vector3, v2: Vector3): Vector3 {
    const edge1 = Vector3.sub(v1, v0);
    const edge2 = Vector3.sub(v2, v0);
    // 使用右手定则：edge1 × edge2，确保逆时针顶点顺序产生向外法线
    return Vector3.normalize(Vector3.cross(edge1, edge2));
  }

  private static addLines(
    v0: Vector3,
    v1: Vector3,
    v2: Vector3,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    indexOffset: number,
    currentVertexIndex: number
  ): number {
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
    uvs?.push(0.5, 0); // 顶点
    uvs?.push(0, 1); // 左下
    uvs?.push(1, 1); // 右下

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
    options: TetrahedronCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
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

    return 'line-list';
  }
}
