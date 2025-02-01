import type { AABB, Clonable } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

/**
 * Creation options for plane shapes
 * @public
 */
export interface PlaneCreationOptions extends ShapeCreationOptions {
  /** Default size of axis x and axis y, default is 1 */
  size?: number;
  /** Size of axis x, default value equals to size */
  sizeX?: number;
  /** Size of axis y, default value equals to size */
  sizeY?: number;
  /** Resolution, default is 1 */
  resolution?: number;
  /** Resolution X, default value equals to resolution */
  resolutionX?: number;
  /** Resolution Y, default value equals to resolution */
  resolutionY?: number;
  /** Whether this plane have front side, default is true */
  twoSided?: boolean;
  /** Anchor, default is 0.5 */
  anchor?: number;
  /** Anchor X, default value equals to anchor */
  anchorX?: number;
  /** Anchor Z, default value equals to anchor */
  anchorY?: number;
}

/**
 * The plane shape
 * @public
 */
export class PlaneShape extends Shape<PlaneCreationOptions> implements Clonable<PlaneShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    size: 1,
    resolution: 1,
    twoSided: false,
    anchor: 0.5
  };
  /**
   * Creates an instance of plane shape
   * @param options - The creation options
   */
  constructor(options?: PlaneCreationOptions) {
    super(options);
  }
  clone(): PlaneShape {
    return new PlaneShape(this._options);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'Plane';
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
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const sizeX = Math.abs(options.sizeX || options.size) || 1;
    const sizeY = Math.abs(options.sizeY || options.size) || 1;
    const anchorX = options.anchorX ?? options.anchor;
    const anchorY = options.anchorY ?? options.anchor;
    const minX = -anchorX * sizeX;
    const maxX = minX + sizeX;
    const minY = -anchorY * sizeY;
    const maxY = minY + sizeY;
    const resolutionX = Math.max(options.resolutionX ?? options.resolution, 1);
    const resolutionY = Math.max(options.resolutionY ?? options.resolution, 1);
    const dx = (maxX - minX) / resolutionX;
    const dy = (maxY - minY) / resolutionY;
    for (let i = 0; i <= resolutionX; i++) {
      for (let j = 0; j <= resolutionY; j++) {
        uvs?.push(i / resolutionX, j / resolutionY);
        vertices?.push(minX + dx * i, 0, minY + dy * j);
        normals?.push(0, 1, 0);
      }
    }
    if (indices) {
      for (let i = 0; i < resolutionX; i++) {
        for (let j = 0; j < resolutionY; j++) {
          const tl = j * (resolutionY + 1) + i;
          const tr = (j + 1) * (resolutionY + 1) + i;
          const bl = tl + 1;
          const br = tr + 1;
          indices.push(
            tl + indexOffset,
            bl + indexOffset,
            br + indexOffset,
            tl + indexOffset,
            br + indexOffset,
            tr + indexOffset
          );
          if (options.twoSided) {
            indices.push(
              tl + indexOffset,
              br + indexOffset,
              bl + indexOffset,
              tl + indexOffset,
              tr + indexOffset,
              br + indexOffset
            );
          }
        }
      }
    }
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
