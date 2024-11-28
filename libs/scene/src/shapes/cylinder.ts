import type { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { BoundingBox } from '../utility/bounding_volume';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';
import type { PrimitiveType } from '@zephyr3d/device';

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
  private static addPatch(
    radialDetail: number,
    x: number,
    y: number,
    indices: number[],
    indexOffset: number
  ) {
    const stride = radialDetail + 1;
    const lt = (y + 1) * stride + x + indexOffset;
    const rt = lt + 1 + indexOffset;
    const lb = lt - stride + indexOffset;
    const rb = lb + 1 + indexOffset;
    indices.push(lt, lb, rb, lt, rb, rt);
  }
  /**
   * Generates the data for the cylinder shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    options: CylinderCreationOptions,
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
    const slope = (options.topRadius - options.bottomRadius) / options.height;
    for (let y = 0; y <= options.heightDetail; y++) {
      const v = y / options.heightDetail;
      const radius = (options.topRadius - options.bottomRadius) * v + options.bottomRadius;
      for (let x = 0; x <= options.radialDetail; x++) {
        const u = x / options.radialDetail;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const m = 1 / Math.sqrt(sinTheta * sinTheta + slope * slope + cosTheta * cosTheta);
        vertices.push(
          radius * sinTheta + offsetX,
          (v - options.anchor) * options.height + offsetY,
          radius * cosTheta + offsetZ
        );
        normals && normals.push(sinTheta * m, slope * m, cosTheta * m);
        uvs && uvs.push(u, 1 - v);
        if (y < options.heightDetail && x < options.radialDetail) {
          this.addPatch(options.radialDetail, x, y, indices, indexOffset);
        }
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
    this._primitiveType = CylinderShape.generateData(this._options, vertices, normals, uvs, indices);
    this.createAndSetVertexBuffer('position_f32x3', new Float32Array(vertices));
    normals && this.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
    uvs && this.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
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
