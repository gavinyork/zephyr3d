import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

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
  /** @internal */
  protected _createArrays(
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    sizeX: number,
    sizeY: number
  ) {
    uvs?.push(0, 1, 0, 0, 1, 0, 1, 1);
    vertices?.push(0, 0, sizeY, sizeX, 0, sizeY, sizeX, 0, 0, 0, 0, 0);
    indices?.push(0, 1, 2, 0, 2, 3);
    normals?.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    this.primitiveType = 'triangle-list';
  }
  /** @internal */
  protected _create(): boolean {
    const needNormal = this._options.needNormal;
    const needUV = this._options.needUV;
    const sizeX = Math.abs(this._options.sizeX || this._options.size) || 1;
    const sizeY = Math.abs(this._options.sizeY || this._options.size) || 1;
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = needNormal ? [] : null;
    const uvs: number[] = needUV ? [] : null;
    this._createArrays(vertices, normals, uvs, indices, sizeX, sizeY);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(new Vector3(0, 0, 0), new Vector3(sizeX, 0, sizeY)));
    this.indexCount = indices.length;
    return true;
  }
}
