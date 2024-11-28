import type { Ray } from '@zephyr3d/base';
import { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

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
  /**
   * Generates the data for the sphere shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: SphereCreationOptions,
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
    positionOffset?: Vector3,
    indicesOffset?: number,
    bbox?: AABB
  ): PrimitiveType {
    function getVertex(v: number, h: number, r: number) {
      const y = r * Math.cos(v);
      const hRadius = r * Math.sin(v);
      const x = hRadius * Math.sin(h);
      const z = hRadius * Math.cos(h);
      return [x, y, z];
    }
    const offsetX = positionOffset ? positionOffset.x : 0;
    const offsetY = positionOffset ? positionOffset.y : 0;
    const offsetZ = positionOffset ? positionOffset.z : 0;
    const indexOffset = indicesOffset ?? 0;
    const stripIndices: number[] = [];
    const radius = options.radius ?? 1;
    const verticalDetail = options.verticalDetail ?? 20;
    const horizonalDetail = options.horizonalDetail ?? 20;
    const vTheta = Math.PI / verticalDetail;
    const hTheta = (Math.PI * 2) / horizonalDetail;
    for (let i = 0; i <= verticalDetail; i++) {
      for (let j = 0; j <= horizonalDetail; j++) {
        const v = getVertex(i * vTheta, j * hTheta, radius);
        vertices.push(v[0] + offsetX, v[1] + offsetY, v[2] + offsetZ);
        uvs && uvs.push(j / horizonalDetail, i / verticalDetail);
        normals && normals.push(v[0] / radius, v[1] / radius, v[2] / radius);
      }
    }
    for (let i = 0; i < verticalDetail; i++) {
      for (let j = 0; j <= horizonalDetail; j++) {
        const startIndex = i * (horizonalDetail + 1);
        stripIndices.push(startIndex + j + indexOffset, startIndex + j + horizonalDetail + 1 + indexOffset);
      }
      stripIndices.push(stripIndices[stripIndices.length - 1]);
      stripIndices.push((i + 1) * (horizonalDetail + 1) + indexOffset);
    }
    for (let i = 0; i < stripIndices.length - 2; i++) {
      if (i % 2 === 0) {
        indices.push(stripIndices[i], stripIndices[i + 1], stripIndices[i + 2]);
      } else {
        indices.push(stripIndices[i], stripIndices[i + 2], stripIndices[i + 1]);
      }
    }
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
    const normals: number[] = this._options.needNormal ? [] : null;
    const uv: number[] = this._options.needUV ? [] : null;
    const indices: number[] = [];
    const bbox = new AABB();
    this._primitiveType = SphereShape.generateData(
      this._options,
      vertices,
      normals,
      uv,
      indices,
      null,
      null,
      bbox
    );
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uv && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uv));
    this.createAndSetIndexBuffer(new Uint32Array(indices));
    this.setBoundingVolume(new BoundingBox(bbox.minPoint, bbox.maxPoint));
    this.indexCount = indices.length;
    return true;
  }
}
