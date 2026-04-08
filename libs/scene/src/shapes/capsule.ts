import type { AABB, Clonable, Ray } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

/**
 * Creation options for capsule shape
 * @public
 */
export interface CapsuleCreationOptions extends ShapeCreationOptions {
  /** Radius of the capsule hemispheres, default is 1 */
  radius?: number;
  /** Height of the cylindrical body between the two hemispheres, default is 1 */
  height?: number;
  /** Radial detail, default is 20 */
  radialDetail?: number;
  /** Vertical detail for each hemisphere, default is 10 */
  hemisphereDetail?: number;
  /** Vertical detail of the cylindrical body, default is 1 */
  heightDetail?: number;
  /**
   * Anchor point along the capsule total height, default is 0.5.
   * 0 puts the bottom tip at y=0, 0.5 centers the capsule at origin.
   */
  anchor?: number;
}

type CapsuleRing = {
  y: number;
  radius: number;
  normalScale: number;
  normalY: number;
};

/**
 * Capsule shape
 * @public
 */
export class CapsuleShape extends Shape<CapsuleCreationOptions> implements Clonable<CapsuleShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    radius: 1,
    height: 1,
    radialDetail: 20,
    hemisphereDetail: 10,
    heightDetail: 1,
    anchor: 0.5
  };
  /**
   * Creates an instance of capsule shape
   * @param options - The creation options
   */
  constructor(options?: CapsuleCreationOptions) {
    super(options);
  }
  clone() {
    return new CapsuleShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'Capsule' as const;
  }
  /** Capsule radius */
  get radius() {
    return this._options.radius ?? 1;
  }
  /** Capsule body height */
  get height() {
    return this._options.height ?? 1;
  }
  /** Capsule total height */
  get totalHeight() {
    return this.height + this.radius * 2;
  }
  /**
   * {@inheritDoc Primitive.raycast}
   * @override
   *
   * Analytically intersects a ray with a capsule aligned along the Y axis.
   *
   * The capsule consists of:
   *   - A cylindrical body between y = bottomCenterY and y = topCenterY
   *     (both at distance `radius` from the respective hemispheres).
   *   - A bottom hemisphere centred at (0, bottomCenterY, 0).
   *   - A top    hemisphere centred at (0, topCenterY,    0).
   *
   * The offset from the world origin is determined by the `anchor` parameter.
   */
  raycast(ray: Ray) {
    const opt = this._options;
    const radius = Math.abs(opt.radius ?? 1);
    const height = Math.max(0, opt.height ?? 1);
    const anchor = opt.anchor ?? 0.5;
    const totalH = height + radius * 2;
    const minY = -anchor * totalH;
    const botY = minY + radius;
    const topY = botY + height;

    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const dx = ray.direction.x;
    const dy = ray.direction.y;
    const dz = ray.direction.z;
    const r2 = radius * radius;
    const eps = 1e-10;

    let tMin = Infinity;

    // Cylindrical body (only when height > 0)
    if (height > eps) {
      const A = dx * dx + dz * dz;
      const B = 2 * (ox * dx + oz * dz);
      const C = ox * ox + oz * oz - r2;
      if (A > eps) {
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const sqrtDisc = Math.sqrt(disc);
          const inv2A = 1 / (2 * A);
          for (const sign of [-1, 1]) {
            const t = (-B + sign * sqrtDisc) * inv2A;
            if (t >= 0) {
              const hitY = oy + t * dy;
              if (hitY >= botY - eps && hitY <= topY + eps) {
                tMin = Math.min(tMin, t);
              }
            }
          }
        }
      }
    }

    // Hemisphere helper
    const testHemisphere = (cy: number, isTop: boolean) => {
      const ocy = oy - cy;
      const A = dx * dx + dy * dy + dz * dz;
      const B = 2 * (ox * dx + ocy * dy + oz * dz);
      const C = ox * ox + ocy * ocy + oz * oz - r2;
      const disc = B * B - 4 * A * C;
      if (disc < 0) {
        return;
      }
      const sqrtDisc = Math.sqrt(disc);
      const inv2A = 1 / (2 * A);
      for (const sign of [-1, 1]) {
        const t = (-B + sign * sqrtDisc) * inv2A;
        if (t < 0) {
          continue;
        }
        const hitY = oy + t * dy;
        if (isTop ? hitY >= topY - eps : hitY <= botY + eps) {
          tMin = Math.min(tMin, t);
        }
      }
    };

    testHemisphere(botY, false);
    testHemisphere(topY, true);

    return isFinite(tMin) ? tMin : null;
  }
  /**
   * Generates the data for the capsule shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    opt: CapsuleCreationOptions,
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
    const radius = Math.abs(options.radius ?? 1);
    const height = Math.max(0, options.height ?? 1);
    const radialDetail = Math.max(3, Math.floor(options.radialDetail ?? 20));
    const hemisphereDetail = Math.max(2, Math.floor(options.hemisphereDetail ?? 10));
    const heightDetail = height > 0 ? Math.max(1, Math.floor(options.heightDetail ?? 1)) : 0;
    const totalHeight = height + radius * 2;
    const minY = -(options.anchor ?? 0.5) * totalHeight;
    const bottomCenterY = minY + radius;
    const topCenterY = bottomCenterY + height;
    const rings: CapsuleRing[] = [];
    const quarterPiStep = Math.PI / 2 / hemisphereDetail;

    for (let i = 0; i <= hemisphereDetail; i++) {
      const theta = -Math.PI / 2 + i * quarterPiStep;
      rings.push({
        y: bottomCenterY + radius * Math.sin(theta),
        radius: radius * Math.cos(theta),
        normalScale: Math.cos(theta),
        normalY: Math.sin(theta)
      });
    }

    for (let i = 1; i < heightDetail; i++) {
      const t = i / heightDetail;
      rings.push({
        y: bottomCenterY + height * t,
        radius,
        normalScale: 1,
        normalY: 0
      });
    }

    for (let i = height > 0 ? 0 : 1; i <= hemisphereDetail; i++) {
      const theta = i * quarterPiStep;
      rings.push({
        y: topCenterY + radius * Math.sin(theta),
        radius: radius * Math.cos(theta),
        normalScale: Math.cos(theta),
        normalY: Math.sin(theta)
      });
    }

    const pushRing = (ring: CapsuleRing) => {
      const v = totalHeight > 0 ? (ring.y - minY) / totalHeight : 0.5;
      for (let i = 0; i <= radialDetail; i++) {
        const u = i / radialDetail;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        vertices.push(ring.radius * sinTheta, ring.y, ring.radius * cosTheta);
        normals?.push(ring.normalScale * sinTheta, ring.normalY, ring.normalScale * cosTheta);
        tangents?.push(ring.radius > 1e-6 ? cosTheta : 1, 0, ring.radius > 1e-6 ? -sinTheta : 0, 1);
        uvs?.push(u, v);
      }
    };

    for (const ring of rings) {
      pushRing(ring);
    }

    const stride = radialDetail + 1;
    for (let y = 0; y < rings.length - 1; y++) {
      for (let x = 0; x < radialDetail; x++) {
        const bottomLeft = y * stride + x;
        const bottomRight = bottomLeft + 1;
        const topLeft = bottomLeft + stride;
        const topRight = topLeft + 1;
        indices.push(
          topLeft + indexOffset,
          bottomLeft + indexOffset,
          bottomRight + indexOffset,
          topLeft + indexOffset,
          bottomRight + indexOffset,
          topRight + indexOffset
        );
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
