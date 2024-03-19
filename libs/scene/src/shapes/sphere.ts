import type { Ray } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

/**
 * Creation options for sphere shape
 * @public
 */
export interface SphereCreationOptions extends ShapeCreationOptions {
  /** Radius of the sphere, default 1 */
  radius?: number;
  /** The vertical detail level, default 20 */
  verticalDetail?: number;
  /** The horizonal detail level, default 20 */
  horizonalDetail?: number;
}

/**
 * Sphere shape
 * @public
 */
export class SphereShape extends Shape<SphereCreationOptions> {
  /**
   * Creates an instance of sphere shape
   * @param options - The creation options
   */
  constructor(options?: SphereCreationOptions) {
    super(options);
  }
  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   */
  raycast(ray: Ray) {
    const rSquared = this._options.radius * this._options.radius;
    const eSquared = Vector3.dot(ray.origin, ray.origin);
    if (eSquared < rSquared) {
      return null;
    }
    const a = -Vector3.dot(ray.origin, ray.direction);
    const bSquared = eSquared - a * a;
    if (rSquared < bSquared) {
      return null;
    }
    return a - Math.sqrt(rSquared - bSquared);
  }
  /** Sphere radius */
  get radius(): number {
    return this._options.radius ?? 1;
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.radius = 1;
    options.verticalDetail = 20;
    options.horizonalDetail = 20;
    return options;
  }
  /** @internal */
  protected _create(): boolean {
    function getVertex(v: number, h: number, r: number) {
      const y = r * Math.cos(v);
      const hRadius = r * Math.sin(v);
      const x = hRadius * Math.sin(h);
      const z = hRadius * Math.cos(h);
      return [x, y, z];
    }
    const radius = this._options.radius ?? 1;
    const verticalDetail = this._options.verticalDetail ?? 20;
    const horizonalDetail = this._options.horizonalDetail ?? 20;
    const vTheta = Math.PI / verticalDetail;
    const hTheta = (Math.PI * 2) / horizonalDetail;
    const vertices: number[] = [];
    const normals: number[] = [];
    const uv: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= verticalDetail; i++) {
      for (let j = 0; j <= horizonalDetail; j++) {
        const v = getVertex(i * vTheta, j * hTheta, radius);
        vertices.push(...v);
        if (this._options.needUV) {
          uv.push(j / horizonalDetail, i / verticalDetail);
        }
        if (this._options.needNormal) {
          normals.push(v[0] / radius, v[1] / radius, v[2] / radius);
        }
      }
    }
    for (let i = 0; i < verticalDetail; i++) {
      for (let j = 0; j <= horizonalDetail; j++) {
        const startIndex = i * (horizonalDetail + 1);
        indices.push(startIndex + j, startIndex + j + horizonalDetail + 1);
      }
      indices.push(indices[indices.length - 1]);
      indices.push((i + 1) * (horizonalDetail + 1));
    }
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals?.length > 0 && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uv?.length > 0 && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uv));

    this.createAndSetIndexBuffer(new Uint32Array(indices));
    this.setBoundingVolume(
      new BoundingBox(new Vector3(-radius, -radius, -radius), new Vector3(radius, radius, radius))
    );
    this.primitiveType = 'triangle-strip';
    this.indexCount = indices.length;
    return true;
  }
}
