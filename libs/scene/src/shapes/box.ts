import type { AABB } from '@zephyr3d/base';
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
  /** Anchor */
  anchor?: number;
  /** Anchor X */
  anchorX?: number;
  /** Anchor Y */
  anchorY?: number;
  /** Anchor Z */
  anchorZ?: number;
}

/**
 * Box shape
 * @public
 */
export class BoxShape extends Shape<BoxCreationOptions> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1,
    anchor: 0.5
  };
  /**
   * Creates an instance of box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions, poolId?: string | symbol) {
    super(options, poolId);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'Box';
  }
  /**
   * Generates the data for the box shape
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
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = options?.sizeX ?? options?.size ?? 1;
    const sizeY = options?.sizeY ?? options?.size ?? 1;
    const sizeZ = options?.sizeZ ?? options?.size ?? 1;
    const anchorX = options.anchorX ?? options.anchor;
    const anchorY = options.anchorY ?? options.anchor;
    const anchorZ = options.anchorZ ?? options.anchor;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const uv = uvs ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = normals ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const frontFacePos = [minx, maxy, maxz, minx, miny, maxz, maxx, miny, maxz, maxx, maxy, maxz];
    const frontFaceNormal = normals ? [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] : null;
    const rightFacePos = [maxx, maxy, maxz, maxx, miny, maxz, maxx, miny, minz, maxx, maxy, minz];
    const rightFaceNormal = normals ? [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] : null;
    const backFacePos = [maxx, maxy, minz, maxx, miny, minz, minx, miny, minz, minx, maxy, minz];
    const backFaceNormal = normals ? [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1] : null;
    const leftFacePos = [minx, maxy, minz, minx, miny, minz, minx, miny, maxz, minx, maxy, maxz];
    const leftFaceNormal = normals ? [-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = normals ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices?.push(
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
    vertices?.push(
      ...topFacePos,
      ...frontFacePos,
      ...rightFacePos,
      ...backFacePos,
      ...leftFacePos,
      ...bottomFacePos
    );
    normals?.push(
      ...topFacenormal,
      ...frontFaceNormal,
      ...rightFaceNormal,
      ...backFaceNormal,
      ...leftFaceNormal,
      ...bottomFaceNormal
    );
    uvs?.push(...uv, ...uv, ...uv, ...uv, ...uv, ...uv);
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
}

/**
 * Wireframe box shape
 * @public
 */
export class BoxFrameShape extends Shape<BoxCreationOptions> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1,
    anchor: 0.5
  };
  /**
   * Creates an instance of wireframe box shape
   * @param options - The creation options
   */
  constructor(options?: BoxCreationOptions) {
    super(options);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'BoxFrame';
  }
  /**
   * Generates the data for the box shape
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
    bbox?: AABB,
    indexOffset?: number
  ): PrimitiveType {
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = options?.sizeX ?? options?.size ?? 1;
    const sizeY = options?.sizeY ?? options?.size ?? 1;
    const sizeZ = options?.sizeZ ?? options?.size ?? 1;
    const anchorX = options.anchorX ?? options.anchor;
    const anchorY = options.anchorY ?? options.anchor;
    const anchorZ = options.anchorZ ?? options.anchor;
    const minx = -anchorX * sizeX;
    const maxx = minx + sizeX;
    const miny = -anchorY * sizeY;
    const maxy = miny + sizeY;
    const minz = -anchorZ * sizeZ;
    const maxz = minz + sizeZ;
    const uv = uvs ? [0, 0, 0, 1, 1, 1, 1, 0] : null;
    const topFacePos = [minx, maxy, minz, minx, maxy, maxz, maxx, maxy, maxz, maxx, maxy, minz];
    const topFacenormal = normals ? [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0] : null;
    const bottomFacePos = [minx, miny, maxz, minx, miny, minz, maxx, miny, minz, maxx, miny, maxz];
    const bottomFaceNormal = normals ? [0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0] : null;
    indices?.push(0, 1, 1, 2, 2, 3, 3, 0, 0, 5, 1, 4, 2, 7, 3, 6, 6, 5, 5, 4, 4, 7, 7, 6);
    vertices?.push(...topFacePos, ...bottomFacePos);
    normals?.push(...topFacenormal, ...bottomFaceNormal);
    uvs?.push(...uv, ...uv, ...uv, ...uv, ...uv, ...uv);
    Shape._transform(options.transform, vertices, normals, start);
    if (bbox) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
        bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
        bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
        bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
        bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
        bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
      }
    }
    return 'line-list';
  }
}
