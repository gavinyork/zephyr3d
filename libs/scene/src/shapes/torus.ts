import type { AABB } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

/**
 * Creation options for torus shape
 * @public
 */
export interface TorusCreationOptions extends ShapeCreationOptions {
  /** Slice count, default is 40 **/
  numSlices?: number;
  /** Segment count, default is 16 */
  numSegments?: number;
  /** Outer radius, default is 10 */
  outerRadius?: number;
  /** Inner radius, default is 3 */
  innerRadius?: number;
  /** Radial detail, default is 20*/
  radialDetail?: number;
}

/*
N slices
M sides
OR outter radius
IR  inner radius
Up (0, 1, 0)

C(n) = (cos((n/N) * TwoPI) * OR, 0, sin((n/N) * twoPI * OR);
Theta = m/M * TwoPI
V(n, m) = C(n) * (1 + IR * cos(Theta) / OR) + Up * IR * sin(Theta)
N(n, m) = normalize(V(n, m) - C(n))
TC(n, m) = (m / M, n / N)

VIndex(n, m) = n * (M + 1) + m
Triangle(n, m) = (VIndex(n, m), VIndex(n+1, m), VIndex(n+1, m+1), VIndex(n, m), VIndex(n+1, m+1), VIndex(n, m+1))*/

/**
 *
 * Torus shape
 *
 * @public
 */
export class TorusShape extends Shape<TorusCreationOptions> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    numSlices: 40,
    numSegments: 16,
    outerRadius: 1,
    innerRadius: 0.3,
    radialDetail: 20
  };
  /**
   * Creates an instance of torus shape
   * @param options - The creation options
   */
  constructor(options?: TorusCreationOptions, poolId?: symbol) {
    super(options, poolId);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'Torus';
  }
  /**
   * Generates the data for the torus shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: TorusCreationOptions,
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
    const N = options.numSlices;
    const M = options.numSegments;
    const OR = options.outerRadius;
    const IR = options.innerRadius;
    for (let n = 0; n <= N; n++) {
      const alpha = ((n % N) / N) * Math.PI * 2;
      const cx = OR * Math.cos(alpha);
      const cy = 0;
      const cz = OR * Math.sin(alpha);
      for (let m = 0; m <= M; m++) {
        const theta = ((m % M) / M) * Math.PI * 2;
        const t = 1 + (IR * Math.cos(theta)) / OR;
        const s = IR * Math.sin(theta);
        const x = cx * t;
        const y = cy * t + s;
        const z = cz * t;
        if (normals) {
          const nx = x - cx;
          const ny = y - cy;
          const nz = z - cz;
          const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
          normals.push(nx / mag, ny / mag, nz / mag);
        }
        vertices.push(x, y, z);
        if (uvs) {
          uvs.push(m / M, n / N);
        }
      }
    }
    for (let n = 0; n < N; n++) {
      for (let m = 0; m < M; m++) {
        indices.push(n * (M + 1) + m + indexOffset);
        indices.push((n + 1) * (M + 1) + m + 1 + indexOffset);
        indices.push((n + 1) * (M + 1) + m + indexOffset);
        indices.push(n * (M + 1) + m + indexOffset);
        indices.push(n * (M + 1) + m + 1 + indexOffset);
        indices.push((n + 1) * (M + 1) + m + 1 + indexOffset);
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
