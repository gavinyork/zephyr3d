import { Vector3, type Matrix4x4 } from '@zephyr3d/base';
import { Primitive } from '../render/primitive';
import { BoundingBox } from '../utility';

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
}

/**
 * Abstract base class for any kind of shapes
 * @public
 */
export abstract class Shape<T extends ShapeCreationOptions = ShapeCreationOptions> extends Primitive {
  static _defaultOptions = {
    needNormal: true,
    needUV: true
  };
  protected _options: T;
  /**
   * Creates an instance of shape
   * @param options - The creation options
   */
  constructor(options?: T) {
    super();
    this._create(options);
  }
  /**
   * Normalize options
   * @param options - creation options
   * @returns Normalized creation options
   */
  normalizeOptions(options?: T): T {
    const defaultOptions = (this.constructor as any)._defaultOptions as T;
    return Object.assign({}, defaultOptions, options ?? {});
  }
  /** @internal */
  protected _create(options?: T): boolean {
    this._options = this.normalizeOptions(options);
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = this._options.needNormal ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new BoundingBox();
    bbox.beginExtend();
    this._primitiveType = (this.constructor as any).generateData(
      this._options,
      vertices,
      normals,
      uvs,
      indices,
      bbox
    );
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(bbox);
    this.indexCount = indices.length;
    return true;
  }
  /** @internal */
  protected static _transform(matrix: Matrix4x4, vertices: number[], normals: number[], offset: number) {
    if (matrix) {
      const tmpVec = new Vector3();
      for (let i = offset; i < vertices.length - 2; i += 3) {
        tmpVec.setXYZ(vertices[i], vertices[i + 1], vertices[i + 2]);
        matrix.transformPointAffine(tmpVec, tmpVec);
        vertices[i] = tmpVec.x;
        vertices[i + 1] = tmpVec.y;
        vertices[i + 2] = tmpVec.z;
        if (normals) {
          tmpVec.setXYZ(normals[i], normals[i + 1], normals[i + 2]);
          matrix.transformVectorAffine(tmpVec, tmpVec);
          tmpVec.inplaceNormalize();
          normals[i] = tmpVec.x;
          normals[i + 1] = tmpVec.y;
          normals[i + 2] = tmpVec.z;
        }
      }
    }
  }
}
