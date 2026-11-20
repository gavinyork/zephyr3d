import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Curl noise of the particle simulation, the same on the CPU and the GPU: the curl of three
 * gradient noises (Perlin's improved noise, periodic every 256 cells), so the field swirls without
 * sources or sinks and does not bunch particles up (Bridson et al., "Curl-Noise for Procedural
 * Fluid Flow", SIGGRAPH 2007).
 */

/** Lattice period of the noise in cells; offsets wrap at it */
export const PARTICLE_NOISE_PERIOD = 256;
/** Scale bringing the average length of the curl to 1 (measured: 1.60 over random points) */
const CURL_NORMALIZE = 1 / 1.6;
/**
 * Longest the normalized curl gets: the measured maximum is 2.98 and one point in a thousand
 * exceeds 2.34, so the clamp is never seen. It bounds how far noise can move a particle.
 */
export const PARTICLE_NOISE_MAX = 3;

/** Lattice hash of wind.ts, of coordinates already wrapped into the period */
function latticeHash(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const grad3 = new Float64Array(9);

/**
 * Gradient of the noise at a point
 * @param out - Receives the gradient at offset o
 */
function noiseGradient(x: number, y: number, z: number, out: Float64Array, o: number) {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const dx = x - fx;
  const dy = y - fy;
  const dz = z - fz;
  // Quintic fade and its derivative
  const ux = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
  const uy = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
  const uz = dz * dz * dz * (dz * (dz * 6 - 15) + 10);
  const vx = 30 * dx * dx * (dx - 1) * (dx - 1);
  const vy = 30 * dy * dy * (dy - 1) * (dy - 1);
  const vz = 30 * dz * dz * (dz - 1) * (dz - 1);
  const mask = PARTICLE_NOISE_PERIOD - 1;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let c = 0; c < 8; c++) {
    const i = c & 1;
    const j = (c >> 1) & 1;
    const k = c >> 2;
    const h = latticeHash((fx + i) & mask, (fy + j) & mask, (fz + k) & mask) & 15;
    // Gradient of the corner as grad() in wind.ts picks it: ±u ± v
    const su = h & 1 ? -1 : 1;
    const sv = h & 2 ? -1 : 1;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    if (h < 8) {
      cx = su;
    } else {
      cy = su;
    }
    if (h < 4) {
      cy += sv;
    } else if (h === 12 || h === 14) {
      cx += sv;
    } else {
      cz += sv;
    }
    const n = cx * (dx - i) + cy * (dy - j) + cz * (dz - k);
    const wx = i ? ux : 1 - ux;
    const wy = j ? uy : 1 - uy;
    const wz = k ? uz : 1 - uz;
    const w = wx * wy * wz;
    gx += (i ? vx : -vx) * wy * wz * n + w * cx;
    gy += wx * (j ? vy : -vy) * wz * n + w * cy;
    gz += wx * wy * (k ? vz : -vz) * n + w * cz;
  }
  out[o] = gx;
  out[o + 1] = gy;
  out[o + 2] = gz;
}

/**
 * Curl noise at a point, about 1 long on average and at most PARTICLE_NOISE_MAX
 * @param x - Position in noise cells
 * @param offsets - Offsets of the three potentials in cells: a xyz, b xyz, c xyz
 * @param out - Receives the vector at index 0..2
 */
export function particleCurlNoise(x: number, y: number, z: number, offsets: Float64Array, out: Float64Array) {
  const g = grad3;
  noiseGradient(x + offsets[0], y + offsets[1], z + offsets[2], g, 0);
  noiseGradient(x + offsets[3], y + offsets[4], z + offsets[5], g, 3);
  noiseGradient(x + offsets[6], y + offsets[7], z + offsets[8], g, 6);
  // curl (a, b, c) = (dc/dy - db/dz, da/dz - dc/dx, db/dx - da/dy)
  let cx = (g[7] - g[5]) * CURL_NORMALIZE;
  let cy = (g[2] - g[6]) * CURL_NORMALIZE;
  let cz = (g[3] - g[1]) * CURL_NORMALIZE;
  const len = Math.hypot(cx, cy, cz);
  if (len > PARTICLE_NOISE_MAX) {
    const k = PARTICLE_NOISE_MAX / len;
    cx *= k;
    cy *= k;
    cz *= k;
  }
  out[0] = cx;
  out[1] = cy;
  out[2] = cz;
}

/**
 * Declares the shader functions of the curl noise and returns the curl at a point, the same as
 * {@link particleCurlNoise}
 * @param p - Position in noise cells (vec3)
 * @param oa - Offset of the first potential (vec3), ob and oc of the others
 * @returns The curl (vec3)
 */
export function particleCurlNoiseShader(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  oa: PBShaderExp,
  ob: PBShaderExp,
  oc: PBShaderExp
): PBShaderExp {
  const pb = scope.$builder;
  const funcHash = 'Z_pNoiseHash';
  const funcGrad = 'Z_pNoiseGrad';
  const funcCurl = 'Z_pCurlNoise';
  pb.func(funcHash, [pb.uvec3('c')], function () {
    this.$l.h = pb.compXor(
      pb.compXor(pb.mul(this.c.x, pb.uint(0x27d4eb2d)), pb.mul(this.c.y, pb.uint(0x165667b1))),
      pb.mul(this.c.z, pb.uint(0x9e3779b9))
    );
    this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 15)), pb.uint(0x85ebca6b));
    this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 13)), pb.uint(0xc2b2ae35));
    this.h = pb.compXor(this.h, pb.sar(this.h, 16));
    this.$return(this.h);
  });
  pb.func(funcGrad, [pb.vec3('q')], function () {
    this.$l.fl = pb.floor(this.q);
    this.$l.d = pb.sub(this.q, this.fl);
    this.$l.cell = pb.ivec3(this.fl);
    this.$l.u = pb.mul(
      this.d,
      this.d,
      this.d,
      pb.add(pb.mul(this.d, pb.sub(pb.mul(this.d, 6), pb.vec3(15))), pb.vec3(10))
    );
    this.$l.du = pb.mul(this.d, this.d, pb.sub(this.d, pb.vec3(1)), pb.sub(this.d, pb.vec3(1)), 30);
    this.$l.gsum = pb.vec3(0);
    for (let c = 0; c < 8; c++) {
      const i = c & 1;
      const j = (c >> 1) & 1;
      const k = c >> 2;
      const corner = pb.uvec3(
        pb.compAnd(pb.add(this.cell, pb.ivec3(i, j, k)), pb.ivec3(PARTICLE_NOISE_PERIOD - 1))
      );
      this.$l[`h${c}`] = pb.compAnd(this[funcHash](corner), pb.uint(15));
      const h = this[`h${c}`];
      const su = pb.sub(1, pb.mul(pb.float(pb.compAnd(h, pb.uint(1))), 2));
      const sv = pb.sub(1, pb.float(pb.compAnd(h, pb.uint(2))));
      // ±u ± v as grad() in wind.ts picks them
      const cu = this.$choice(pb.lessThan(h, pb.uint(8)), pb.vec3(1, 0, 0), pb.vec3(0, 1, 0));
      const cv = this.$choice(
        pb.lessThan(h, pb.uint(4)),
        pb.vec3(0, 1, 0),
        this.$choice(
          pb.or(pb.equal(h, pb.uint(12)), pb.equal(h, pb.uint(14))),
          pb.vec3(1, 0, 0),
          pb.vec3(0, 0, 1)
        )
      );
      this.$l[`g${c}`] = pb.add(pb.mul(cu, su), pb.mul(cv, sv));
      const g = this[`g${c}`];
      const n = pb.dot(g, pb.sub(this.d, pb.vec3(i, j, k)));
      const wx = i ? this.u.x : pb.sub(1, this.u.x);
      const wy = j ? this.u.y : pb.sub(1, this.u.y);
      const wz = k ? this.u.z : pb.sub(1, this.u.z);
      const vx = i ? this.du.x : pb.neg(this.du.x);
      const vy = j ? this.du.y : pb.neg(this.du.y);
      const vz = k ? this.du.z : pb.neg(this.du.z);
      this.$l[`n${c}`] = n;
      const nc = this[`n${c}`];
      this.gsum = pb.add(
        this.gsum,
        pb.vec3(pb.mul(vx, wy, wz, nc), pb.mul(wx, vy, wz, nc), pb.mul(wx, wy, vz, nc)),
        pb.mul(g, pb.mul(wx, wy, wz))
      );
    }
    this.$return(this.gsum);
  });
  pb.func(funcCurl, [pb.vec3('q'), pb.vec3('oa'), pb.vec3('ob'), pb.vec3('oc')], function () {
    this.$l.ga = this[funcGrad](pb.add(this.q, this.oa));
    this.$l.gb = this[funcGrad](pb.add(this.q, this.ob));
    this.$l.gc = this[funcGrad](pb.add(this.q, this.oc));
    this.$l.curl = pb.mul(
      pb.vec3(pb.sub(this.gc.y, this.gb.z), pb.sub(this.ga.z, this.gc.x), pb.sub(this.gb.x, this.ga.y)),
      CURL_NORMALIZE
    );
    this.$l.len = pb.length(this.curl);
    this.$return(pb.mul(this.curl, pb.min(pb.div(PARTICLE_NOISE_MAX, pb.max(this.len, 1e-6)), 1)));
  });
  return pb.getGlobalScope()[funcCurl](p, oa, ob, oc) as PBShaderExp;
}
