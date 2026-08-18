import type { Clonable, Ray } from '@zephyr3d/base';
import type { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

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
  /**
   * Generate UVs and tangents for {@link EyeMaterial}.
   *
   * When enabled, the sphere's polar axis follows Z and the front hemisphere
   * uses a planar projection along +Z, with its centre at (0.5, 0.5). The rear
   * hemisphere is unwrapped outside that front disc so it cannot produce a
   * second iris at -Z. The tangent follows +U. The sphere topology is otherwise
   * unchanged, so this option remains compatible with the analytical raycast
   * and with existing sphere consumers. The material must still opt into the
   * tangent frame with `EyeMaterial.vertexTangent = true`.
   *
   * @defaultValue `false`
   */
  eyeCompatible?: boolean;
}

/**
 * Sphere shape
 * @public
 */
export class SphereShape extends Shape<SphereCreationOptions> implements Clonable<SphereShape> {
  static _defaultOptions = {
    ...Shape._defaultOptions,
    radius: 1,
    verticalDetail: 20,
    horizonalDetail: 20,
    eyeCompatible: false
  };
  /**
   * Creates an instance of sphere shape
   * @param options - The creation options
   */
  constructor(options?: SphereCreationOptions) {
    super(options);
  }
  clone() {
    return new SphereShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'Sphere' as const;
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
  get radius() {
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
    opt: SphereCreationOptions,
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
    const stripIndices: number[] = [];
    const radius = options.radius ?? 1;
    const verticalDetail = options.verticalDetail ?? 20;
    const horizonalDetail = options.horizonalDetail ?? 20;
    const eyeCompatible = options.eyeCompatible ?? false;
    const vTheta = Math.PI / verticalDetail;
    const hTheta = (Math.PI * 2) / horizonalDetail;
    const invR = 1 / radius;
    for (let i = 0; i <= verticalDetail; i++) {
      const v = i * vTheta;
      const sinV = Math.sin(v);
      const cosV = Math.cos(v);
      for (let j = 0; j <= horizonalDetail; j++) {
        const h = j * hTheta;
        const sinH = Math.sin(h);
        const cosH = Math.cos(h);

        // Eye UVs are centred on +Z, so put the mesh poles on the gaze axis as
        // well. Besides giving the rear projection a proper seam at -Z, this
        // keeps the vertex rings concentric with the iris instead of placing
        // its centre on the legacy longitude seam.
        const x = radius * sinV * (eyeCompatible ? cosH : sinH);
        const y = eyeCompatible ? radius * sinV * sinH : radius * cosV;
        const z = eyeCompatible ? radius * cosV : radius * sinV * cosH;
        vertices.push(x, y, z);
        if (eyeCompatible) {
          // Preserve the planar projection over the visible hemisphere. On
          // the rear hemisphere, continue from the equator into an outer
          // annulus rather than folding back to (0.5, 0.5); the old fold was
          // what produced a second iris and pupil at -Z.
          const uvRadius = cosV >= 0 ? sinV * 0.5 : 1 - sinV * 0.5;
          uvs?.push(0.5 + cosH * uvRadius, 0.5 + sinH * uvRadius);
        } else {
          uvs?.push(j / horizonalDetail, i / verticalDetail);
        }
        if (normals) {
          normals.push(x * invR, y * invR, z * invR);
        }
        if (tangents) {
          let w = 1;
          let tx: number, ty: number, tz: number;
          if (eyeCompatible) {
            // Project +X onto the local tangent plane. This is the +U
            // direction of the planar eye projection; an azimuth tangent
            // would rotate the refraction frame around the iris.
            const nx = x * invR;
            const ny = y * invR;
            const nz = z * invR;
            tx = 1 - nx * nx;
            ty = -ny * nx;
            tz = -nz * nx;
            const len = Math.hypot(tx, ty, tz);
            if (len > 1e-8) {
              tx /= len;
              ty /= len;
              tz /= len;
            } else {
              // At +/-X the projected +X direction degenerates. Use its
              // limiting direction from the front hemisphere instead of a
              // vector parallel to the normal.
              tx = 0;
              ty = 0;
              tz = nx >= 0 ? -1 : 1;
            }
            // The rear annulus reverses its radial direction, so its tangent
            // frame has the opposite handedness.
            w = cosV >= 0 ? 1 : -1;
          } else if (sinV > 1e-6) {
            tx = cosH;
            ty = 0.0;
            tz = -sinH;
          } else {
            tx = 1.0;
            ty = 0.0;
            tz = 0.0;
          }
          tangents.push(tx, ty, tz, w);
        }
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
    Shape._transform(options.transform, vertices, normals, start, tangents);
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
        vertexCallback?.((i - start) / 3, vertices[i], vertices[i + 1], vertices[i + 2]);
      }
    }
    return 'triangle-list' as const;
  }
}
