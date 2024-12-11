import type { Ray } from '@zephyr3d/base';
import type { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
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
  static _defaultOptions = {
    ...Shape._defaultOptions,
    radius: 1,
    verticalDetail: 20,
    horizonalDetail: 20
  };
  /**
   * Creates an instance of sphere shape
   * @param options - The creation options
   */
  constructor(options?: SphereCreationOptions) {
    super(options);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'Sphere';
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
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    function getVertex(v: number, h: number, r: number) {
      const y = r * Math.cos(v);
      const hRadius = r * Math.sin(v);
      const x = hRadius * Math.sin(h);
      const z = hRadius * Math.cos(h);
      return [x, y, z];
    }
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;
    const stripIndices: number[] = [];
    const radius = options.radius ?? 1;
    const verticalDetail = options.verticalDetail ?? 20;
    const horizonalDetail = options.horizonalDetail ?? 20;
    const vTheta = Math.PI / verticalDetail;
    const hTheta = (Math.PI * 2) / horizonalDetail;
    for (let i = 0; i <= verticalDetail; i++) {
      for (let j = 0; j <= horizonalDetail; j++) {
        const v = getVertex(i * vTheta, j * hTheta, radius);
        vertices.push(v[0], v[1], v[2]);
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
    Shape._transform(options.transform, vertices, normals, start);
    if (bbox) {
      for (let i = start; i < vertices.length - 2; i += 3) {
        if (bbox) {
          bbox.minPoint.x = Math.min(bbox.minPoint.x, vertices[i]);
          bbox.minPoint.y = Math.min(bbox.minPoint.y, vertices[i + 1]);
          bbox.minPoint.z = Math.min(bbox.minPoint.z, vertices[i + 2]);
          bbox.maxPoint.x = Math.max(bbox.maxPoint.x, vertices[i]);
          bbox.maxPoint.y = Math.max(bbox.maxPoint.y, vertices[i + 1]);
          bbox.maxPoint.z = Math.max(bbox.maxPoint.z, vertices[i + 2]);
        }
        vertexCallback && vertexCallback((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }
    return 'triangle-list';
  }
}
