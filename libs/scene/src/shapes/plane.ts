import type { AABB } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

/**
 * Creation options for plane shapes
 * @public
 */
export interface PlaneCreationOptions extends ShapeCreationOptions {
  /** Default size of axis x and axis y */
  size?: number;
  /** Size of axis x */
  sizeX?: number;
  /** Size of axis y */
  sizeY?: number;
}

/**
 * The plane shape
 * @public
 */
export class PlaneShape extends Shape<PlaneCreationOptions> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1
  };
  /**
   * Creates an instance of plane shape
   * @param options - The creation options
   */
  constructor(options?: PlaneCreationOptions) {
    super(options);
  }
  /**
   * Generates the data for the cylinder shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: PlaneCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = Math.abs(options.sizeX || options.size) || 1;
    const sizeY = Math.abs(options.sizeY || options.size) || 1;
    uvs?.push(0, 1, 0, 0, 1, 0, 1, 1);
    vertices?.push(0, 0, sizeY, sizeX, 0, sizeY, sizeX, 0, 0, 0, 0, 0);
    indices?.push(
      0 + indexOffset,
      1 + indexOffset,
      2 + indexOffset,
      0 + indexOffset,
      2 + indexOffset,
      3 + indexOffset
    );
    normals?.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
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
    return 'triangle-list';
  }
}
