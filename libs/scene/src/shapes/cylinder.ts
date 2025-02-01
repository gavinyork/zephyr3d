import type { AABB, Clonable } from '@zephyr3d/base';
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
  /** Generate top cap, default is true */
  topCap?: boolean;
  /** Generate bottom cap, default is true */
  bottomCap?: boolean;
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
export class CylinderShape extends Shape<CylinderCreationOptions> implements Clonable<CylinderShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    topCap: true,
    bottomCap: true,
    bottomRadius: 1,
    topRadius: 1,
    heightDetail: 1,
    radialDetail: 20,
    height: 1,
    anchor: 0
  };
  /**
   * Creates an instance of cylinder shape
   * @param options - The creation options
   */
  constructor(options?: CylinderCreationOptions) {
    super(options);
  }
  clone(): CylinderShape {
    return new CylinderShape(this._options);
  }
  /**
   * {@inheritDoc Shape.type}
   */
  get type(): string {
    return 'Cylinder';
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
    const lt = (y + 1) * stride + x;
    const rt = lt + 1;
    const lb = lt - stride;
    const rb = lb + 1;
    indices?.push(
      lt + indexOffset,
      lb + indexOffset,
      rb + indexOffset,
      lt + indexOffset,
      rb + indexOffset,
      rt + indexOffset
    );
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
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ): PrimitiveType {
    options = Object.assign({}, this._defaultOptions, options ?? {});
    indexOffset = indexOffset ?? 0;
    const start = vertices.length;

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
        vertices?.push(radius * sinTheta, (v - options.anchor) * options.height, radius * cosTheta);
        normals?.push(sinTheta * m, slope * m, cosTheta * m);
        uvs?.push(u, 1 - v);
        if (y < options.heightDetail && x < options.radialDetail) {
          this.addPatch(options.radialDetail, x, y, indices, indexOffset);
        }
      }
    }

    const sideVertexCount = (options.heightDetail + 1) * (options.radialDetail + 1);
    let currentVertexOffset = start + sideVertexCount;
    if (options.bottomCap) {
      vertices?.push(0, -options.anchor * options.height, 0);
      normals?.push(0, -1, 0);
      uvs?.push(0.5, 0.5);

      const bottomCenterIndex = currentVertexOffset - start;
      currentVertexOffset++;

      for (let i = 0; i <= options.radialDetail; i++) {
        const theta = (i / options.radialDetail) * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        vertices?.push(
          options.bottomRadius * sinTheta,
          -options.anchor * options.height,
          options.bottomRadius * cosTheta
        );
        normals?.push(0, -1, 0);
        uvs?.push(0.5 + 0.5 * sinTheta, 0.5 + 0.5 * cosTheta);
        currentVertexOffset++;

        if (i < options.radialDetail) {
          indices?.push(
            bottomCenterIndex + indexOffset,
            bottomCenterIndex + i + 2 + indexOffset,
            bottomCenterIndex + i + 1 + indexOffset
          );
        }
      }
    }

    if (options.topCap) {
      vertices?.push(0, (1 - options.anchor) * options.height, 0);
      normals?.push(0, 1, 0);
      uvs?.push(0.5, 0.5);

      const topCenterIndex = currentVertexOffset - start;
      currentVertexOffset++;

      for (let i = 0; i <= options.radialDetail; i++) {
        const theta = (i / options.radialDetail) * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        vertices?.push(
          options.topRadius * sinTheta,
          (1 - options.anchor) * options.height,
          options.topRadius * cosTheta
        );
        normals?.push(0, 1, 0);
        uvs?.push(0.5 + 0.5 * sinTheta, 0.5 + 0.5 * cosTheta);
        currentVertexOffset++;

        if (i < options.radialDetail) {
          indices?.push(
            topCenterIndex + indexOffset,
            topCenterIndex + i + 1 + indexOffset,
            topCenterIndex + i + 2 + indexOffset
          );
        }
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
