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
  ) {
    const dp1 = new Vector3(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
    const dp2 = new Vector3(v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]);

    const du1 = uv1[0] - uv0[0],
      dv1 = uv1[1] - uv0[1];
    const du2 = uv2[0] - uv0[0],
      dv2 = uv2[1] - uv0[1];

    const denom = du1 * dv2 - dv1 * du2;

    if (Math.abs(denom) <= 1e-8) {
      return { t: new Vector3(1, 0, 0), w: 1 };
    }

    const r = 1.0 / denom;
    let t = new Vector3(
      (dp1.x * dv2 - dp2.x * dv1) * r,
      (dp1.y * dv2 - dp2.y * dv1) * r,
      (dp1.z * dv2 - dp2.z * dv1) * r
    );
    const b = new Vector3(
      (dp2.x * du1 - dp1.x * du2) * r,
      (dp2.y * du1 - dp1.y * du2) * r,
      (dp2.z * du1 - dp1.z * du2) * r
    );

    // Gram-Schmidt
    const dotNT = normal[0] * t.x + normal[1] * t.y + normal[2] * t.z;
    t = new Vector3(t.x - normal[0] * dotNT, t.y - normal[1] * dotNT, t.z - normal[2] * dotNT);
    const lenT = Math.hypot(t.x, t.y, t.z);
    if (lenT > 1e-8) t = new Vector3(t.x / lenT, t.y / lenT, t.z / lenT);
    else t = new Vector3(1, 0, 0);

    // w
    const cx = new Vector3(
      normal[1] * t.z - normal[2] * t.y,
      normal[2] * t.x - normal[0] * t.z,
      normal[0] * t.y - normal[1] * t.x
    );
    const w = cx.x * b.x + cx.y * b.y + cx.z * b.z < 0 ? -1 : 1;

    return { t, w };
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
    const tangents: number[] = this._options.needNormal && this._options.needTangent ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new BoundingBox();
    bbox.beginExtend();
    this.primitiveType = (this.constructor as any).generateData(
      this._options,
      vertices,
      normals,
      uvs,
      indices,
      bbox,
      null,
      null,
      tangents
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
