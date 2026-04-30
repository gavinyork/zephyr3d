import type { AABB, Clonable, Ray } from '@zephyr3d/base';
import type { ShapeCreationOptions } from './shape';
import { Shape } from './shape';

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
export class TorusShape extends Shape<TorusCreationOptions> implements Clonable<TorusShape> {
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
  constructor(options?: TorusCreationOptions) {
    super(options);
  }
  clone() {
    return new TorusShape(this._options) as this;
  }
  /** type of the shape */
  get type() {
    return 'Torus' as const;
  }
  /**
   * Analytically intersects a ray with a torus lying in the XZ plane.
   * The torus has major radius R (outerRadius) and minor radius r (innerRadius).
   *
   * Equation of torus: (x²+y²+z²+R²-r²)² = 4R²(x²+z²)
   * Substituting ray P(t) = O + t*D leads to a quartic in t which is solved
   * with Ferrari's method.
   */
  raycast(ray: Ray) {
    const R = this._options.outerRadius ?? 1; // major radius
    const r = this._options.innerRadius ?? 0.3; // minor radius

    const ox = ray.origin.x,
      oy = ray.origin.y,
      oz = ray.origin.z;
    const dx = ray.direction.x,
      dy = ray.direction.y,
      dz = ray.direction.z;

    // Let  f = |O|^2 + R^2 - r^2
    //      g = dot(O, D)
    //      h = |D|^2 (normally 1 for a normalized direction, kept general here)
    // Quartic: (h*t^2 + 2g*t + f)^2 = 4R^2*((dx*t+ox)^2 + (dz*t+oz)^2)
    // Expand into  c4*t^4 + c3*t^3 + c2*t^2 + c1*t + c0 = 0

    const OO = ox * ox + oy * oy + oz * oz;
    const OD = ox * dx + oy * dy + oz * dz;
    const DD = dx * dx + dy * dy + dz * dz;

    const f = OO + R * R - r * r;
    const g = OD;
    const h = DD;

    // XZ components only (for the 4R²(x²+z²) term)
    const oxz2 = ox * ox + oz * oz; // ox² + oz²
    const odxz = ox * dx + oz * dz; // ox*dx + oz*dz
    const dxz2 = dx * dx + dz * dz; // dx² + dz²

    // Quartic coefficients (from expanding both sides)
    const R2 = 4 * R * R;
    const c4 = h * h;
    const c3 = 4 * h * g;
    const c2 = 2 * h * f + 4 * g * g - R2 * dxz2;
    const c1 = 4 * g * f - 2 * R2 * odxz;
    const c0 = f * f - R2 * oxz2;

    // Solve quartic c4*t^4 + c3*t^3 + c2*t^2 + c1*t + c0 = 0
    const roots = TorusShape._solveQuartic(c4, c3, c2, c1, c0);
    let tMin = Infinity;
    for (const t of roots) {
      if (t >= 0 && t < tMin) {
        tMin = t;
      }
    }
    return isFinite(tMin) ? tMin : null;
  }

  /** @internal Solve quartic a*t^4+b*t^3+c*t^2+d*t+e=0, returns real roots */
  private static _solveQuartic(a: number, b: number, c: number, d: number, e: number): number[] {
    const eps = 1e-8;
    if (Math.abs(a) < eps) {
      return TorusShape._solveCubic(b, c, d, e);
    }
    // Depress quartic: divide by a and substitute t = u - b/(4a)
    const inv_a = 1 / a;
    const B = b * inv_a;
    const C = c * inv_a;
    const D = d * inv_a;
    const E = e * inv_a;
    const p = C - (3 / 8) * B * B;
    const q = (B * B * B) / 8 - (B * C) / 2 + D;
    const r2 = -(3 / 256) * B * B * B * B + (B * B * C) / 16 - (B * D) / 4 + E;

    let roots: number[];
    if (Math.abs(q) < eps) {
      // Biquadratic: u^4 + p*u^2 + r2 = 0
      const disc = p * p - 4 * r2;
      if (disc < 0) {
        return [];
      }
      const sqrtDisc = Math.sqrt(disc);
      roots = [];
      for (const sign of [-1, 1]) {
        const w2 = (-p + sign * sqrtDisc) / 2;
        if (w2 >= 0) {
          const w = Math.sqrt(w2);
          roots.push(w, -w);
        }
      }
    } else {
      // Ferrari: find a real root of the resolvent cubic
      //   8m^3 + 8p*m^2 + (2p^2-8r2)*m - q^2 = 0
      const cubicRoots = TorusShape._solveCubic(8, 8 * p, 2 * p * p - 8 * r2, -q * q);
      // Pick the largest real root
      let m = -Infinity;
      for (const cr of cubicRoots) {
        if (cr > m) {
          m = cr;
        }
      }
      if (!isFinite(m)) {
        return [];
      }

      const sqrtM = m >= 0 ? Math.sqrt(m) : 0;
      const disc1 = -(p + 2 * m) + q / (sqrtM + eps);
      const disc2 = -(p + 2 * m) - q / (sqrtM + eps);
      roots = [];
      if (disc1 >= 0) {
        const s = Math.sqrt(disc1);
        roots.push(sqrtM + s, sqrtM - s);
      }
      if (disc2 >= 0) {
        const s = Math.sqrt(disc2);
        roots.push(-sqrtM + s, -sqrtM - s);
      }
    }
    // Un-depress: t = u - B/4
    const shift = B / 4;
    return roots.map((u) => u - shift);
  }

  /** @internal Solve cubic a*t^3+b*t^2+c*t+d=0, returns real roots (Cardano) */
  private static _solveCubic(a: number, b: number, c: number, d: number): number[] {
    const eps = 1e-8;
    if (Math.abs(a) < eps) {
      return TorusShape._solveQuadratic(b, c, d);
    }
    const inv_a = 1 / a;
    const B = b * inv_a;
    const C = c * inv_a;
    const D = d * inv_a;
    const p = C - (B * B) / 3;
    const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
    const disc = (q * q) / 4 + (p * p * p) / 27;
    const shift = -B / 3;
    if (disc > eps) {
      const sqrtDisc = Math.sqrt(disc);
      const u = Math.cbrt(-q / 2 + sqrtDisc);
      const v = Math.cbrt(-q / 2 - sqrtDisc);
      return [u + v + shift];
    } else if (disc < -eps) {
      const r = Math.sqrt((-p * p * p) / 27);
      const theta = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
      const rCbrt = Math.cbrt(r);
      return [
        2 * rCbrt * Math.cos(theta / 3) + shift,
        2 * rCbrt * Math.cos((theta + 2 * Math.PI) / 3) + shift,
        2 * rCbrt * Math.cos((theta + 4 * Math.PI) / 3) + shift
      ];
    } else {
      const u = Math.cbrt(-q / 2);
      return [2 * u + shift, -u + shift];
    }
  }

  /** @internal Solve quadratic a*t^2+b*t+c=0 */
  private static _solveQuadratic(a: number, b: number, c: number): number[] {
    const eps = 1e-8;
    if (Math.abs(a) < eps) {
      if (Math.abs(b) < eps) {
        return [];
      }
      return [-c / b];
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      return [];
    }
    if (disc < eps) {
      return [-b / (2 * a)];
    }
    const s = Math.sqrt(disc);
    return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
  }
  /**
   * Generates the data for the torus shape
   * @param vertices - vertex positions
   * @param normals - vertex normals
   * @param uvs - vertex uvs
   * @param indices - vertex indices
   */
  static generateData(
    opt: TorusCreationOptions,
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
    const N = options.numSlices;
    const M = options.numSegments;
    const OR = options.outerRadius;
    const IR = options.innerRadius;
    for (let n = 0; n <= N; n++) {
      const alpha = ((n % N) / N) * Math.PI * 2;
      const cosA = Math.cos(alpha);
      const sinA = Math.sin(alpha);
      const cx = OR * cosA;
      const cy = 0;
      const cz = OR * sinA;
      for (let m = 0; m <= M; m++) {
        const theta = ((m % M) / M) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const t = 1 + (IR * cosT) / OR;
        const s = IR * sinT;
        const x = cx * t;
        const y = cy * t + s;
        const z = cz * t;
        vertices.push(x, y, z);
        if (normals) {
          const nx = x - cx;
          const ny = y - cy;
          const nz = z - cz;
          const mag = Math.hypot(nx, ny, nz);
          normals.push(nx / mag, ny / mag, nz / mag);
        }
        if (uvs) {
          uvs.push(m / M, n / N);
        }
        if (tangents) {
          const tx = -sinT * cosA;
          const ty = cosT;
          const tz = -sinT * sinA;
          tangents.push(tx, ty, tz, 1.0);
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
    return 'triangle-list' as const;
  }
}
