import { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

/**
 * Creation options for box shape
 * @public
 */
export interface BoxCreationOptions extends ShapeCreationOptions {
  /** Size of all axises, default 1 */
  size?: number;
  /** Size of axis x, default 1 */
  sizeX?: number;
  /** Size of axis y, default 1 */
  sizeY?: number;
  /** Size of axis z, default 1 */
  sizeZ?: number;
}

/**
 * Box shape
 * @public
 */
export class BoxShape extends Shape<BoxCreationOptions> {
  /**
   * Creates an instance of box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.size = 1;
    return options;
  }
  /**
   * Generates the data for the cylinder shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: BoxCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB
  ): PrimitiveType {
    const indexOffset = options.indexOffset ?? 0;
    const sizeX = options?.sizeX ?? options?.size ?? 1;
    const sizeY = options?.sizeY ?? options?.size ?? 1;
    const sizeZ = options?.sizeZ ?? options?.size ?? 1;
    const anchorX = 0.5;
    const anchorY = 0.5;
    const anchorZ = 0.5;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const needNormal = !!normals;
    const needUV = !!uvs;
    const uv = needUV ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = needNormal ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const frontFacePos = [minx, maxy, maxz, minx, miny, maxz, maxx, miny, maxz, maxx, maxy, maxz];
    const frontFaceNormal = needNormal ? [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] : null;
    const rightFacePos = [maxx, maxy, maxz, maxx, miny, maxz, maxx, miny, minz, maxx, maxy, minz];
    const rightFaceNormal = needNormal ? [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] : null;
    const backFacePos = [maxx, maxy, minz, maxx, miny, minz, minx, miny, minz, minx, maxy, minz];
    const backFaceNormal = needNormal ? [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1] : null;
    const leftFacePos = [minx, maxy, minz, minx, miny, minz, minx, miny, maxz, minx, maxy, maxz];
    const leftFaceNormal = needNormal ? [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = needNormal ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices &&
      indices.push(
        0 + indexOffset,
        1 + indexOffset,
        2 + indexOffset,
        0 + indexOffset,
        2 + indexOffset,
        3 + indexOffset,
        4 + indexOffset,
        5 + indexOffset,
        6 + indexOffset,
        4 + indexOffset,
        6 + indexOffset,
        7 + indexOffset,
        8 + indexOffset,
        9 + indexOffset,
        10 + indexOffset,
        8 + indexOffset,
        10 + indexOffset,
        11 + indexOffset,
        12 + indexOffset,
        13 + indexOffset,
        14 + indexOffset,
        12 + indexOffset,
        14 + indexOffset,
        15 + indexOffset,
        16 + indexOffset,
        17 + indexOffset,
        18 + indexOffset,
        16 + indexOffset,
        18 + indexOffset,
        19 + indexOffset,
        20 + indexOffset,
        21 + indexOffset,
        22 + indexOffset,
        20 + indexOffset,
        22 + indexOffset,
        23 + indexOffset
      );
    vertices &&
      vertices.push(
        ...topFacePos,
        ...frontFacePos,
        ...rightFacePos,
        ...backFacePos,
        ...leftFacePos,
        ...bottomFacePos
      );
    normals &&
      normals.push(
        ...topFacenormal,
        ...frontFaceNormal,
        ...rightFaceNormal,
        ...backFaceNormal,
        ...leftFaceNormal,
        ...bottomFaceNormal
      );
    uvs.push(...uv, ...uv, ...uv, ...uv, ...uv, ...uv);
    Shape._transform(options.transform, vertices, normals);
    if (bbox) {
      bbox.beginExtend();
      for (let i = 0; i < vertices.length / 3; i++) {
        bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i * 3]);
        bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i * 3 + 1]);
        bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i * 3 + 2]);
        bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i * 3]);
        bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i * 3 + 1]);
        bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i * 3 + 2]);
      }
    }
    return 'triangle-list';
  }
  /** Box width */
  get width(): number {
    return this._options.sizeX ?? this._options.size ?? 1;
  }
  /** Box height */
  get height(): number {
    return this._options.sizeY ?? this._options.size ?? 1;
  }
  /** Box depth */
  get depth(): number {
    return this._options.sizeZ ?? this._options.size ?? 1;
  }
  /** @internal */
  protected _create(): boolean {
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = this._options.needNormal ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new AABB();
    this._primitiveType = BoxShape.generateData(this._options, vertices, normals, uvs, indices, bbox);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(bbox.minPoint, bbox.maxPoint));
    this.indexCount = indices.length;
    return true;
  }
}

/**
 * Wireframe box shape
 * @public
 */
export class BoxFrameShape extends Shape<BoxCreationOptions> {
  /**
   * Creates an instance of wireframe box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.size = 1;
    options.needNormal = false;
    options.needUV = false;
    return options;
  }
  /** @internal */
  protected _createArrays(
    vertices: number[],
    indices: number[],
    minx: number,
    miny: number,
    minz: number,
    maxx: number,
    maxy: number,
    maxz: number
  ) {
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    indices && indices.push(0, 1, 1, 2, 2, 3, 3, 0, 0, 5, 1, 4, 2, 7, 3, 6, 6, 5, 5, 4, 4, 7, 7, 6);
    vertices && vertices.push(...topFacePos, ...bottomFacePos);
    this.primitiveType = 'line-list';
  }
  /** @internal */
  protected _create(): boolean {
    const sizeX = this._options.sizeX ?? this._options.size ?? 1;
    const sizeY = this._options.sizeY ?? this._options.size ?? 1;
    const sizeZ = this._options.sizeZ ?? this._options.size ?? 1;
    const anchorX = 0.5;
    const anchorY = 0.5;
    const anchorZ = 0.5;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const vertices: number[] = [];
    const indices: number[] = [];
    this._createArrays(vertices, indices, minx, miny, minz, maxx, maxy, maxz);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(new Vector3(minx, miny, minz), new Vector3(maxx, maxy, maxz)));
    this.indexCount = indices.length;
    return true;
  }
}
