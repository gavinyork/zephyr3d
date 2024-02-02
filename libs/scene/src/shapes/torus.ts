import { Vector3 } from "@zephyr3d/base";
import { BoundingBox } from "../utility/bounding_volume";
import { ShapeCreationOptions, Shape } from "./shape";

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
  /** @internal */
  protected _createArrays(
    vertices: number[],
    normals: number[],
    uvs: number[],
    indices: number[],
  ) {
    this.primitiveType = 'triangle-list';
    const N = this._options.numSlices;
    const M = this._options.numSegments;
    const OR = this._options.outerRadius;
    const IR = this._options.innerRadius;
    for (let n = 0; n <= N; n++) {
      const alpha = ((n % N) / N) * Math.PI * 2;
      const cx = OR * Math.cos(alpha);
      const cy = 0;
      const cz = OR * Math.sin(alpha);
      for (let m = 0; m <= M; m++) {
        const theta = ((m % M) / M) * Math.PI * 2;
        const idx = n * (M + 1) + m;
        const t = 1 + IR * Math.cos(theta) / OR;
        const s = IR * Math.sin(theta);
        vertices[idx * 3 + 0] = cx * t;
        vertices[idx * 3 + 1] = cy * t + s;
        vertices[idx * 3 + 2] = cz * t;
        const nx = vertices[idx * 3 + 0] - cx;
        const ny = vertices[idx * 3 + 1] - cy;
        const nz = vertices[idx * 3 + 2] - cz;
        const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
        normals[idx * 3 + 0] = nx / mag;
        normals[idx * 3 + 1] = ny / mag;
        normals[idx * 3 + 2] = nz / mag;
        uvs[idx * 2 + 0] = m / M;
        uvs[idx * 2 + 1] = n / N;
      }
    }
    for (let n = 0; n < N; n++) {
      for (let m = 0; m < M; m++) {
        indices.push(n * (M + 1) + m);
        indices.push((n + 1) * (M + 1) + m + 1);
        indices.push((n + 1) * (M + 1) + m);
        indices.push(n * (M + 1) + m);
        indices.push(n * (M + 1) + m + 1);
        indices.push((n + 1) * (M + 1) + m + 1);
      }
    }
  }
  /** @internal */
  protected _create(): boolean {
    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    this._createArrays(vertices, normals, uvs, indices);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
    this.createAndSetIndexBuffer(new Uint16Array(indices));
    const radiusX = this._options.outerRadius + this._options.innerRadius;
    const radiusY = this._options.innerRadius;
    this.setBoundingVolume(new BoundingBox(new Vector3(-radiusX, -radiusY, -radiusX), new Vector3(radiusX, radiusY, radiusX)));
    this.indexCount = indices.length;
    return true;
  }
}

