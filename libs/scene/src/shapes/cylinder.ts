import type { AABB, Clonable, Ray } from '@zephyr3d/base';
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
  clone() {
    return new CylinderShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'Cylinder' as const;
  }
  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   *
   * Analytically intersects a ray with a cone frustum (or cylinder when
   * topRadius === bottomRadius) including the optional top and bottom caps.
   *
   * The frustum axis is the Y axis.  At y=0 the cross-section radius equals
   * `bottomRadius`; at y=height it equals `topRadius`.
   * Both ends are offset by `anchor`: the bottom cap sits at y = -anchor*height
   * and the top cap at y = (1-anchor)*height.
   */
  raycast(ray: Ray) {
    const opt = this._options;
    const R0 = opt.bottomRadius ?? 1;
    const R1 = opt.topRadius ?? 1;
    const H = opt.height ?? 1;
    const anchor = opt.anchor ?? 0;
    const yBot = -anchor * H;
    const yTop = yBot + H;

    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dy = ray.direction.y;
    const dz = ray.direction.z;

    // radius varies linearly with y: r(y) = R0 + k*(y - yBot)
    const k = (R1 - R0) / H;
    const ry = oy - yBot;

    // Side surface: (ox+t*dx)^2+(oz+t*dz)^2 = (R0+k*(ry+t*dy))^2
    // => A*t^2 + B*t + C = 0
    const rO = R0 + k * ry;
    const A = dx * dx + dz * dz - k * k * dy * dy;
    const B = 2 * (ox * dx + oz * dz - rO * k * dy);
    const C = ox * ox + oz * oz - rO * rO;

    let tMin = Infinity;

    const eps = 1e-10;
    if (Math.abs(A) > eps) {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const invA2 = 1 / (2 * A);
        for (const sign of [-1, 1]) {
          const t = (-B + sign * sqrtDisc) * invA2;
          if (t >= 0) {
            const hitY = oy + t * dy;
            if (hitY >= yBot - eps && hitY <= yTop + eps) {
              tMin = Math.min(tMin, t);
            }
          }
        }
      }
    } else if (Math.abs(B) > eps) {
      const t = -C / B;
      if (t >= 0) {
        const hitY = oy + t * dy;
        if (hitY >= yBot - eps && hitY <= yTop + eps) {
          tMin = Math.min(tMin, t);
        }
      }
    }

    // Bottom cap
    if (opt.bottomCap !== false && R0 > eps) {
      if (Math.abs(dy) > eps) {
        const t = (yBot - oy) / dy;
        if (t >= 0) {
          const hx = ox + t * dx;
          const hz = oz + t * dz;
          if (hx * hx + hz * hz <= R0 * R0) {
            tMin = Math.min(tMin, t);
          }
        }
      }
    }

    // Top cap
    if (opt.topCap !== false && R1 > eps) {
      if (Math.abs(dy) > eps) {
        const t = (yTop - oy) / dy;
        if (t >= 0) {
          const hx = ox + t * dx;
          const hz = oz + t * dz;
          if (hx * hx + hz * hz <= R1 * R1) {
            tMin = Math.min(tMin, t);
          }
        }
      }
    }

    return isFinite(tMin) ? tMin : null;
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
    opt: CylinderCreationOptions,
    vertices: number[],
    normals: number[],
    tangents: number[],
    uvs: number[],
    indices: number[],
    bbox?: AABB,
    indexOffset?: number,
    vertexCallback?: (index: number, x: number, y: number, z: number) => void
  ) {
    const options = Object.assign({}, this._defaultOptions, opt ?? {});
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
        const m = 1 / Math.hypot(sinTheta, slope, cosTheta);
        vertices?.push(radius * sinTheta, (v - options.anchor) * options.height, radius * cosTheta);
        normals?.push(sinTheta * m, slope * m, cosTheta * m);
        uvs?.push(u, 1 - v);
        tangents?.push(cosTheta, 0.0, -sinTheta, 1.0);
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
      tangents?.push(1, 0, 0, 1);

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
        tangents?.push(1, 0, 0, 1);
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
      tangents?.push(1, 0, 0, 1);
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
        tangents?.push(1, 0, 0, 1);
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
    return 'triangle-list' as const;
  }
}
