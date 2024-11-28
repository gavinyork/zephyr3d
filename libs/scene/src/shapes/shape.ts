import { Vector3, type Matrix4x4 } from '@zephyr3d/base';
import { Primitive } from '../render/primitive';

/**
 * Base class for creation options of any kind of shapes
 * @public
 */
export interface ShapeCreationOptions {
  /** true if we need to calculate normals for the shape */
  needNormal?: boolean;
  /** true if we need to calculate texture coordinates for the shape */
  needUV?: boolean;
  /** Transform matrix for the shape */
  transform?: Matrix4x4;
  /** Index offset for the shape */
  indexOffset?: number;
}

/**
 * Abstract base class for any kind of shapes
 * @public
 */
export abstract class Shape<T extends ShapeCreationOptions = ShapeCreationOptions> extends Primitive {
  /** @internal */
  protected _options: T;
  /**
   * Creates an instance of shape
   * @param options - The creation options
   */
  constructor(options?: T) {
    super();
    this._options = this.createDefaultOptions();
    this.create(options);
  }
  /**
   * Creation options
   */
  get options() {
    return this._options;
  }
  /** @internal */
  create(options?: T): boolean {
    if (options) {
      this._options = this.createDefaultOptions();
      Object.assign(this._options, options);
    }
    return this._create();
  }
  /** @internal */
  protected createDefaultOptions(): T {
    return {
      needNormal: true,
      needUV: true
    } as T;
  }
  /** @internal */
  protected abstract _create(): boolean;
  /** @internal */
  protected static _transform(matrix: Matrix4x4, vertices: number[], normals: number[]) {
    if (matrix) {
      const tmpVec = new Vector3();
      for (let i = 0; i < vertices.length / 3; i++) {
        tmpVec.setXYZ(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
        matrix.transformPointAffine(tmpVec, tmpVec);
        vertices[i * 3] = tmpVec.x;
        vertices[i * 3 + 1] = tmpVec.y;
        vertices[i * 3 + 2] = tmpVec.z;
        if (normals) {
          tmpVec.setXYZ(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
          matrix.transformVectorAffine(tmpVec, tmpVec);
          tmpVec.inplaceNormalize();
          normals[i * 3] = tmpVec.x;
          normals[i * 3 + 1] = tmpVec.y;
          normals[i * 3 + 2] = tmpVec.z;
        }
      }
    }
  }
}
