import { AABB } from '@zephyr3d/base';
import type { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
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
  /**
   * Creates an instance of torus shape
   * @param options - The creation options
   */
  constructor(options?: TorusCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.numSlices = 40;
    options.numSegments = 16;
    options.outerRadius = 10;
    options.innerRadius = 3;
    options.radialDetail = 20;
    return options;
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
    positionOffset?: Vector3,
    indicesOffset?: number,
    bbox?: AABB
  ): PrimitiveType {
    const offsetX = positionOffset ? positionOffset.x : 0;
    const offsetY = positionOffset ? positionOffset.y : 0;
    const offsetZ = positionOffset ? positionOffset.z : 0;
    const indexOffset = indicesOffset ?? 0;
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
        const idx = n * (M + 1) + m;
        const t = 1 + (IR * Math.cos(theta)) / OR;
        const s = IR * Math.sin(theta);
        vertices[idx * 3 + 0] = cx * t;
        vertices[idx * 3 + 1] = cy * t + s;
        vertices[idx * 3 + 2] = cz * t;
        if (normals) {
          const nx = vertices[idx * 3 + 0] - cx;
          const ny = vertices[idx * 3 + 1] - cy;
          const nz = vertices[idx * 3 + 2] - cz;
          const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
          normals[idx * 3 + 0] = nx / mag;
          normals[idx * 3 + 1] = ny / mag;
          normals[idx * 3 + 2] = nz / mag;
        }
        if (uvs) {
          uvs[idx * 2 + 0] = m / M;
          uvs[idx * 2 + 1] = n / N;
        }
        vertices[idx * 3 + 0] += offsetX;
        vertices[idx * 3 + 1] += offsetY;
        vertices[idx * 3 + 2] += offsetZ;
      }
    }
    for (let n = 0; n < N; n++) {
      for (let m = 0; m < M; m++) {
        indices.push(n * (M + 1) + m + indexOffset);
        indices.push((n + 1) * (M + 1) + m + 1 + indexOffset);
        indices.push((n + 1) * (M + 1) + m + indexOffset);
        indices.push(n * (M + 1) + m) + indexOffset;
        indices.push(n * (M + 1) + m + 1 + indexOffset);
        indices.push((n + 1) * (M + 1) + m + 1 + indexOffset);
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
    const indices: number[] = [];
    const normals: number[] = this._options.needNormal ? [] : null;
    const uvs: number[] = this._options.needUV ? [] : null;
    const bbox = new AABB();
    this._primitiveType = TorusShape.generateData(
      this._options,
      vertices,
      normals,
      uvs,
      indices,
      null,
      null,
      bbox
    );
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    this.setBoundingVolume(new BoundingBox(bbox.minPoint, bbox.maxPoint));
    this.indexCount = indices.length;
    return true;
  }
}
