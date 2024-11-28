import { AABB } from '@zephyr3d/base';
import type { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
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
  /**
   * Creates an instance of plane shape
   * @param options - The creation options
   */
  constructor(options?: PlaneCreationOptions) {
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
    options: PlaneCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    positionOffset?: Vector3,
    indicesOffset?: number,
    bbox?: AABB
  ): PrimitiveType {
    const offsetX = positionOffset ? positionOffset.x : 0;
    const offsetY = positionOffset ? positionOffset.y : 0;
    const offsetZ = positionOffset ? positionOffset.z : 0;
    const indexOffset = indicesOffset ?? 0;
    const sizeX = Math.abs(options.sizeX || options.size) || 1;
    const sizeY = Math.abs(options.sizeY || options.size) || 1;
    uvs?.push(0, 1, 0, 0, 1, 0, 1, 1);
    vertices?.push(
      0 + offsetX,
      0 + offsetY,
      sizeY + offsetZ,
      sizeX + offsetX,
      0 + offsetY,
      sizeY + offsetZ,
      sizeX + offsetX,
      0 + offsetY,
      0 + offsetZ,
      0 + offsetX,
      0 + offsetY,
      0 + offsetZ
    );
    indices?.push(
      0 + indexOffset,
      1 + indexOffset,
      2 + indexOffset,
      0 + indexOffset,
      2 + indexOffset,
      3 + indexOffset
    );
    normals?.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
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
  /** @internal */
  protected _create(): boolean {
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = this._options.needNormal ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new AABB();
    PlaneShape.generateData(this._options, vertices, normals, uvs, indices, null, null, bbox);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(bbox.minPoint, bbox.maxPoint));
    this.indexCount = indices.length;
    return true;
  }
}
