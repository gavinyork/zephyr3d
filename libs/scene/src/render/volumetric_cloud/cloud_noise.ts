import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/*
 * Tileable noise for the volumetric cloud volumes.
 *
 * Follows piyushslayer's "Tileable Perlin-Worley 3D" (https://www.shadertoy.com/view/3dVXDc),
 * which builds the volumes of Schneider, "The Real-time Volumetric Cloudscapes of Horizon Zero
 * Dawn" (SIGGRAPH 2015) after Hillaire's TileableVolumeNoise
 * (https://github.com/sebh/TileableVolumeNoise): gradient noise by Inigo Quilez and Worley noise,
 * both made periodic by wrapping the lattice cell modulo the frequency.
 *
 * Every function takes the frequency in lattice cells per period, so a coordinate in [0, 1)
 * scaled by `freq` repeats exactly over the unit cube.
 */

/**
 * Lattice cell wrapped into [0, freq). Floored, unlike pb.mod, which is WGSL's truncated `%` on
 * WebGPU: that maps the neighbour cell -1 to -1 instead of freq - 1 and breaks the tiling.
 */
function wrapCell(scope: PBInsideFunctionScope, cell: PBShaderExp, freq: PBShaderExp) {
  const pb = scope.$builder;
  return pb.sub(cell, pb.mul(pb.vec3(freq), pb.floor(pb.div(cell, pb.vec3(freq)))));
}

/**
 * Integer hash of a lattice cell to [-1, 1]^3 (Dave Hoskins' uint hash, as in 3dVXDc).
 *
 * `seed` shifts the cell by whole cells after the periodic wrap, so a seeded volume still tiles.
 * @internal
 */
export function cloudHash33(scope: PBInsideFunctionScope, p: PBShaderExp, seed: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudHash33';
  pb.func(funcName, [pb.vec3('p'), pb.vec3('seed')], function () {
    this.$l.UI3 = pb.uvec3(pb.uint(1597334673), pb.uint(3812015801), pb.uint(2798796415));
    this.$l.q = pb.mul(pb.uvec3(pb.ivec3(pb.add(this.p, this.seed))), this.UI3);
    this.$l.h = pb.compXor(pb.compXor(this.q.x, this.q.y), this.q.z);
    this.q = pb.mul(this.UI3, this.h);
    this.$return(pb.sub(pb.mul(pb.vec3(this.q), 2 / 0xffffffff), pb.vec3(1)));
  });
  return pb.getGlobalScope()[funcName](p, seed) as PBShaderExp;
}

/**
 * Periodic gradient noise (Inigo Quilez) with quintic interpolation, roughly in [-1, 1].
 * @internal
 */
export function cloudGradientNoise(
  scope: PBInsideFunctionScope,
  x: PBShaderExp,
  freq: PBShaderExp | number,
  seed: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudGradientNoise';
  pb.func(funcName, [pb.vec3('x'), pb.float('freq'), pb.vec3('seed')], function () {
    this.$l.p = pb.floor(this.x);
    this.$l.w = pb.fract(this.x);
    // w^3 (w (6 w - 15) + 10)
    this.$l.u = pb.mul(
      this.w,
      this.w,
      this.w,
      pb.add(pb.mul(this.w, pb.sub(pb.mul(this.w, 6), pb.vec3(15))), pb.vec3(10))
    );
    const corner = (scope: PBInsideFunctionScope, o: number[]) =>
      cloudHash33(scope, wrapCell(scope, pb.add(scope.p, pb.vec3(o[0], o[1], o[2])), scope.freq), scope.seed);
    this.$l.va = pb.dot(corner(this, [0, 0, 0]), this.w);
    this.$l.vb = pb.dot(corner(this, [1, 0, 0]), pb.sub(this.w, pb.vec3(1, 0, 0)));
    this.$l.vc = pb.dot(corner(this, [0, 1, 0]), pb.sub(this.w, pb.vec3(0, 1, 0)));
    this.$l.vd = pb.dot(corner(this, [1, 1, 0]), pb.sub(this.w, pb.vec3(1, 1, 0)));
    this.$l.ve = pb.dot(corner(this, [0, 0, 1]), pb.sub(this.w, pb.vec3(0, 0, 1)));
    this.$l.vf = pb.dot(corner(this, [1, 0, 1]), pb.sub(this.w, pb.vec3(1, 0, 1)));
    this.$l.vg = pb.dot(corner(this, [0, 1, 1]), pb.sub(this.w, pb.vec3(0, 1, 1)));
    this.$l.vh = pb.dot(corner(this, [1, 1, 1]), pb.sub(this.w, pb.vec3(1, 1, 1)));
    this.$return(
      pb.add(
        this.va,
        pb.mul(this.u.x, pb.sub(this.vb, this.va)),
        pb.mul(this.u.y, pb.sub(this.vc, this.va)),
        pb.mul(this.u.z, pb.sub(this.ve, this.va)),
        pb.mul(this.u.x, this.u.y, pb.sub(pb.add(this.va, this.vd), pb.add(this.vb, this.vc))),
        pb.mul(this.u.y, this.u.z, pb.sub(pb.add(this.va, this.vg), pb.add(this.vc, this.ve))),
        pb.mul(this.u.z, this.u.x, pb.sub(pb.add(this.va, this.vf), pb.add(this.vb, this.ve))),
        pb.mul(
          this.u.x,
          this.u.y,
          this.u.z,
          pb.sub(pb.add(this.vb, this.vc, this.ve, this.vh), pb.add(this.va, this.vd, this.vf, this.vg))
        )
      )
    );
  });
  return pb.getGlobalScope()[funcName](x, freq, seed) as PBShaderExp;
}

/**
 * Periodic Worley noise: one minus the squared distance to the nearest feature point.
 * @internal
 */
export function cloudWorleyNoise(
  scope: PBInsideFunctionScope,
  uv: PBShaderExp,
  freq: PBShaderExp | number,
  seed: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudWorleyNoise';
  pb.func(funcName, [pb.vec3('uv'), pb.float('freq'), pb.vec3('seed')], function () {
    this.$l.id = pb.floor(this.uv);
    this.$l.p = pb.fract(this.uv);
    this.$l.minDist = pb.float(10000);
    this.$for(pb.int('x'), -1, 2, function () {
      this.$for(pb.int('y'), -1, 2, function () {
        this.$for(pb.int('z'), -1, 2, function () {
          this.$l.offset = pb.vec3(pb.float(this.x), pb.float(this.y), pb.float(this.z));
          this.$l.h = pb.add(
            pb.mul(
              cloudHash33(this, wrapCell(this, pb.add(this.id, this.offset), this.freq), this.seed),
              0.5
            ),
            pb.vec3(0.5),
            this.offset
          );
          this.$l.d = pb.sub(this.p, this.h);
          this.minDist = pb.min(this.minDist, pb.dot(this.d, this.d));
        });
      });
    });
    this.$return(pb.sub(1, this.minDist));
  });
  return pb.getGlobalScope()[funcName](uv, freq, seed) as PBShaderExp;
}

/**
 * Periodic gradient-noise fbm: `octaves` octaves, frequency doubling, gain 2^-0.85.
 * @internal
 */
export function cloudPerlinFbm(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  freq: PBShaderExp | number,
  octaves: number,
  seed: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = `Z_cloudPerlinFbm${octaves}`;
  pb.func(funcName, [pb.vec3('p'), pb.float('freq'), pb.vec3('seed')], function () {
    this.$l.f = this.freq;
    this.$l.amp = pb.float(1);
    this.$l.noise = pb.float(0);
    this.$for(pb.int('i'), 0, octaves, function () {
      this.noise = pb.add(
        this.noise,
        pb.mul(this.amp, cloudGradientNoise(this, pb.mul(this.p, this.f), this.f, this.seed))
      );
      this.f = pb.mul(this.f, 2);
      this.amp = pb.mul(this.amp, Math.pow(2, -0.85));
    });
    this.$return(this.noise);
  });
  return pb.getGlobalScope()[funcName](p, freq, seed) as PBShaderExp;
}

/**
 * Periodic Worley fbm: three octaves at freq, 2 freq and 4 freq weighted 0.625 / 0.25 / 0.125.
 * @internal
 */
export function cloudWorleyFbm(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  freq: PBShaderExp | number,
  seed: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudWorleyFbm';
  pb.func(funcName, [pb.vec3('p'), pb.float('freq'), pb.vec3('seed')], function () {
    this.$return(
      pb.add(
        pb.mul(cloudWorleyNoise(this, pb.mul(this.p, this.freq), this.freq, this.seed), 0.625),
        pb.mul(cloudWorleyNoise(this, pb.mul(this.p, this.freq, 2), pb.mul(this.freq, 2), this.seed), 0.25),
        pb.mul(cloudWorleyNoise(this, pb.mul(this.p, this.freq, 4), pb.mul(this.freq, 4), this.seed), 0.125)
      )
    );
  });
  return pb.getGlobalScope()[funcName](p, freq, seed) as PBShaderExp;
}

/**
 * Perlin-Worley of Nubis (Schneider, "Nubis: Authoring Real-Time Volumetric Cloudscapes with the
 * Decima Engine", SIGGRAPH 2017, slide 34): `remap(perlin, 1 - worley, 1, 0, 1)`, the web of the
 * Worley noise subtracted from the low density regions of a billowy Perlin fbm, which puts round
 * shapes there. `worley` is the Worley fbm at the same frequency.
 * @internal
 */
export function cloudPerlinWorley(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  freq: PBShaderExp | number,
  worley: PBShaderExp,
  seed: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_cloudPerlinWorley';
  pb.func(funcName, [pb.vec3('p'), pb.float('freq'), pb.float('worley'), pb.vec3('seed')], function () {
    this.$l.pfbm = pb.mix(1, cloudPerlinFbm(this, this.p, this.freq, 7, this.seed), 0.5);
    // Billowy: fold the fbm around its midpoint
    this.pfbm = pb.abs(pb.sub(pb.mul(this.pfbm, 2), 1));
    this.$return(
      pb.clamp(pb.div(pb.sub(this.pfbm, pb.sub(1, this.worley)), pb.max(this.worley, 1e-6)), 0, 1)
    );
  });
  return pb.getGlobalScope()[funcName](p, freq, worley, seed) as PBShaderExp;
}
