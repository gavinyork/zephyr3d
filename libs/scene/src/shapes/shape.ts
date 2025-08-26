import type { Clonable } from '@zephyr3d/base';
import { Vector3, type Matrix4x4 } from '@zephyr3d/base';
import { Primitive } from '../render/primitive';
import { BoundingBox } from '../utility/bounding_volume';

/**
 * Base class for creation options of any kind of shapes
 * @public
 */
export interface ShapeCreationOptions {
  /** true if we need to calculate normals for the shape */
  needNormal?: boolean;
  /** true if we need to calculate tangents for the shape */
  needTangent?: boolean;
  /** true if we need to calculate texture coordinates for the shape */
  needUV?: boolean;
  /** Transform matrix for the shape */
  transform?: Matrix4x4;
}

/**
 * Abstract base class for any kind of shapes
 * @public
 */
export abstract class Shape<T extends ShapeCreationOptions = ShapeCreationOptions>
  extends Primitive
  implements Clonable<Shape<T>>
{
  static _defaultOptions = {
    needNormal: true,
    needTangent: true,
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
  protected static computeTangent(
    v0: number[],
    v1: number[],
    v2: number[],
    uv0: number[],
    uv1: number[],
    uv2: number[],
    normal: number[]
  ): number[] {
    const dp1 = new Vector3(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
    const dp2 = new Vector3(v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]);

    const du1 = uv1[0] - uv0[0],
      dv1 = uv1[1] - uv0[1];
    const du2 = uv2[0] - uv0[0],
      dv2 = uv2[1] - uv0[1];

    const denom = du1 * dv2 - dv1 * du2;

    if (Math.abs(denom) <= 1e-8) {
      return [1, 0, 0, 1];
    }

    const r = 1.0 / denom;
    let t0 = (dp1.x * dv2 - dp2.x * dv1) * r;
    let t1 = (dp1.y * dv2 - dp2.y * dv1) * r;
    let t2 = (dp1.z * dv2 - dp2.z * dv1) * r;
    const b0 = (dp2.x * du1 - dp1.x * du2) * r;
    const b1 = (dp2.y * du1 - dp1.y * du2) * r;
    const b2 = (dp2.z * du1 - dp1.z * du2) * r;

    // Gram-Schmidt
    const dotNT = normal[0] * t0 + normal[1] * t1 + normal[2] * t2;
    t0 -= normal[0] * dotNT;
    t1 -= normal[1] * dotNT;
    t2 -= normal[2] * dotNT;
    const lenT = Math.hypot(t0, t1, t2);
    if (lenT > 1e-8) {
      t0 /= lenT;
      t1 /= lenT;
      t2 /= lenT;
    } else {
      t0 = 1;
      t1 = 0;
      t2 = 0;
    }

    // w
    const c0 = normal[1] * t2 - normal[2] * t1;
    const c1 = normal[2] * t0 - normal[0] * t2;
    const c2 = normal[0] * t1 - normal[1] * t0;
    const w = c0 * b0 + c1 * b1 + c2 * b2 < 0 ? -1 : 1;

    return [t0, t1, t2, w];
  }

  abstract clone(): Shape<T>;
  /** Get shape creation options */
  get options(): T {
    return this._options;
  }
  set options(options: T) {
    this._create(options);
  }
  /** Get shape type */
  abstract get type(): string;
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
    const tangents: number[] = this._options.needTangent ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new BoundingBox();
    bbox.beginExtend();
    this.primitiveType = (this.constructor as any).generateData(
      this._options,
      vertices,
      normals,
      tangents,
      uvs,
      indices,
      bbox,
      null,
      null
    );
    for (const s of ['position', 'normal', 'tangent', 'texCoord0'] as const) {
      this.removeVertexBuffer(s);
    }
    this.setIndexBuffer(null);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    if (normals) {
      this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    }
    if (tangents) {
      this.createAndSetVertexBuffer('tangent_f32x4', new Float32Array(tangents));
    }
    if (uvs) {
      this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    }
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
