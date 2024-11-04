import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

/**
 * Creation options for cylinder shape
 * @public
 */
export interface CylinderCreationOptions extends ShapeCreationOptions {
  /** Top radius, default is 1.0 **/
  bottomRadius?: number;
  /** Bottom radius, default is 1.0 */
  topRadius?: number;
  /** Height, default is 1.0 */
  height?: number;
  /** Height detail, default is 1 */
  heightDetail?: number;
  /** Radial detail, default is 20 */
  radialDetail?: number;
  /** Anchor point, default is 0 */
  anchor?: number;
}

/**
 * Box shape
 * @public
 */
export class CylinderShape extends Shape<CylinderCreationOptions> {
  /**
   * Creates an instance of cylinder shape
   * @param options - The creation options
   */
  constructor(options?: CylinderCreationOptions) {
    super(options);
  }
  /** @internal */
  protected createDefaultOptions() {
    const options = super.createDefaultOptions();
    options.bottomRadius = 1;
    options.topRadius = 1;
    options.heightDetail = 1;
    options.radialDetail = 20;
    options.height = 1;
    options.anchor = 0;
    return options;
  }
  /** @internal */
  private addPatch(x: number, y: number, indices: number[]) {
    const stride = this._options.radialDetail + 1;
    const lt = (y + 1) * stride + x;
    const rt = lt + 1;
    const lb = lt - stride;
    const rb = lb + 1;
    indices.push(lt, lb, rb, lt, rb, rt);
  }
  /** @internal */
  protected _createArrays(vertices: number[], normals: number[], uvs: number[], indices: number[]) {
    const slope = (this._options.topRadius - this._options.bottomRadius) / this._options.height;
    for (let y = 0; y <= this._options.heightDetail; y++) {
      const v = y / this._options.heightDetail;
      const radius = (this._options.topRadius - this._options.bottomRadius) * v + this._options.bottomRadius;
      for (let x = 0; x <= this._options.radialDetail; x++) {
        const u = x / this._options.radialDetail;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const m = 1 / Math.sqrt(sinTheta * sinTheta + slope * slope + cosTheta * cosTheta);
        vertices.push(
          radius * sinTheta,
          (v - this._options.anchor) * this._options.height,
          radius * cosTheta
        );
        normals.push(sinTheta * m, slope * m, cosTheta * m);
        uvs.push(u, 1 - v);
        if (y < this._options.heightDetail && x < this._options.radialDetail) {
          this.addPatch(x, y, indices);
        }
      }
    }
    this.primitiveType = 'triangle-list';
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
    const radiusMax = Math.max(this._options.bottomRadius, this._options.topRadius);
    this.setBoundingVolume(
      new BoundingBox(
        new Vector3(-radiusMax, 0, -radiusMax),
        new Vector3(radiusMax, this._options.height, radiusMax)
      )
    );
    this.indexCount = indices.length;
    return true;
  }
}
