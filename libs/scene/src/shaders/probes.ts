import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/**
 * Uniform names of the probe volume, see {@link declareProbeUniforms}.
 * @internal
 */
export const PROBE_IRRADIANCE = 'zProbeIrradiance';
/** @internal */
export const PROBE_VISIBILITY = 'zProbeVisibility';
/** @internal */
export const PROBE_DATA = 'zProbeData';
/** @internal */
export const PROBE_PARAMS = 'zProbeParams';
/** Most clipmap levels of a probe volume. @internal */
export const PROBE_MAX_LEVELS = 4;
/** vec4s of {@link PROBE_PARAMS}. @internal */
export const PROBE_PARAM_VEC4S = 3 + 2 * PROBE_MAX_LEVELS;

/**
 * Declares the probe volume as a program reads it:
 *
 * - irradiance: rgba16f 2D atlas of octahedral tiles, one per probe, each
 *   `irrTexels`² with a one texel border; E/π in the engine's irradiance units.
 * - visibility: rgba16f atlas of `visTexels`² tiles holding (mean distance,
 *   mean squared distance) per direction.
 * - data: one vec4 per probe, (relocation offset, state), state 0 while the
 *   probe has never been updated; a storage buffer, writable when `writable`.
 * - params[0]: (levels, tiles per atlas row, irrTexels, visTexels),
 *   params[1]: (irradiance atlas size, visibility atlas size),
 *   params[2]: (intensity, normal bias, view bias, max ray distance),
 *   params[3 + 2l]: (world index of level l's first probe, its spacing),
 *   params[4 + 2l]: (probes per axis of level l, its first tile).
 *
 * The levels are clipmap windows around the camera, each a multiple of the
 * spacing of the one inside it. Probes are addressed toroidally by world
 * index like the field's voxels; a probe's tile index, which also indexes
 * `data`, is its level's first tile plus `x + nx (y + ny z)` of its texel.
 * @internal
 */
export function declareProbeUniforms(scope: PBGlobalScope, group: number, writable = false) {
  const pb = scope.$builder;
  scope[PROBE_IRRADIANCE] = pb.tex2D().uniform(group);
  scope[PROBE_VISIBILITY] = pb.tex2D().uniform(group);
  scope[PROBE_DATA] = writable
    ? pb.vec4[0]().storageBuffer(group)
    : pb.vec4[0]().storageBufferReadonly(group);
  scope[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(group);
}

/** (world index of the level's first probe, spacing). @internal */
export function probeLevelOrigin(scope: PBInsideFunctionScope, level: PBShaderExp | number) {
  const pb = scope.$builder;
  return scope[PROBE_PARAMS].at(pb.add(pb.mul(pb.int(level), 2), 3)) as PBShaderExp;
}

/** (probes per axis, first tile) of a level. @internal */
export function probeLevelGrid(scope: PBInsideFunctionScope, level: PBShaderExp | number) {
  const pb = scope.$builder;
  return scope[PROBE_PARAMS].at(pb.add(pb.mul(pb.int(level), 2), 4)) as PBShaderExp;
}

/** Octahedral encoding of a unit vector to [-1, 1]² (Cigolle et al. 2014). @internal */
export function octEncode(scope: PBInsideFunctionScope, v: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_octEncode';
  pb.func(funcName, [pb.vec3('v')], function () {
    this.$l.l1 = pb.add(pb.abs(this.v.x), pb.abs(this.v.y), pb.abs(this.v.z));
    this.$l.p = pb.div(this.v.xy, pb.max(this.l1, 1e-6));
    this.$l.sgn = pb.vec2(
      this.$choice(pb.greaterThanEqual(this.p.x, 0), pb.float(1), pb.float(-1)),
      this.$choice(pb.greaterThanEqual(this.p.y, 0), pb.float(1), pb.float(-1))
    );
    this.$return(
      this.$choice(pb.lessThan(this.v.z, 0), pb.mul(pb.sub(pb.vec2(1), pb.abs(this.p.yx)), this.sgn), this.p)
    );
  });
  return scope[funcName](v) as PBShaderExp;
}

/** Inverse of {@link octEncode}. @internal */
export function octDecode(scope: PBInsideFunctionScope, uv: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_octDecode';
  pb.func(funcName, [pb.vec2('uv')], function () {
    this.$l.v = pb.vec3(this.uv.x, this.uv.y, pb.sub(pb.sub(1, pb.abs(this.uv.x)), pb.abs(this.uv.y)));
    this.$l.sgn = pb.vec2(
      this.$choice(pb.greaterThanEqual(this.v.x, 0), pb.float(1), pb.float(-1)),
      this.$choice(pb.greaterThanEqual(this.v.y, 0), pb.float(1), pb.float(-1))
    );
    this.$if(pb.lessThan(this.v.z, 0), function () {
      this.v = pb.vec3(pb.mul(pb.sub(pb.vec2(1), pb.abs(this.v.yx)), this.sgn), this.v.z);
    });
    this.$return(pb.normalize(this.v));
  });
  return scope[funcName](uv) as PBShaderExp;
}

/** The i-th of n directions of a spherical Fibonacci set. @internal */
export function sphericalFibonacci(scope: PBInsideFunctionScope, i: PBShaderExp, n: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_sphericalFibonacci';
  pb.func(funcName, [pb.float('i'), pb.float('n')], function () {
    this.$l.phi = pb.mul(pb.fract(pb.mul(this.i, 0.6180339887498949)), 2 * Math.PI);
    this.$l.z = pb.sub(1, pb.div(pb.add(pb.mul(this.i, 2), 1), this.n));
    this.$l.r = pb.sqrt(pb.max(pb.sub(1, pb.mul(this.z, this.z)), 0));
    this.$return(pb.vec3(pb.mul(pb.cos(this.phi), this.r), pb.mul(pb.sin(this.phi), this.r), this.z));
  });
  return scope[funcName](i, n) as PBShaderExp;
}

/** Rotates a vector by a unit quaternion (xyz, w). @internal */
export function quatRotate(scope: PBInsideFunctionScope, q: PBShaderExp, v: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_quatRotate';
  pb.func(funcName, [pb.vec4('q'), pb.vec3('v')], function () {
    this.$l.t = pb.mul(pb.cross(this.q.xyz, this.v), 2);
    this.$return(pb.add(this.v, pb.mul(this.t, this.q.w), pb.cross(this.q.xyz, this.t)));
  });
  return scope[funcName](q, v) as PBShaderExp;
}

/** Tile index of a probe from its level and texel. @internal */
export function probeTileIndex(
  scope: PBInsideFunctionScope,
  level: PBShaderExp | number,
  texel: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_probeTileIndex';
  pb.func(funcName, [pb.int('level'), pb.ivec3('t')], function () {
    this.$l.g = probeLevelGrid(this, this.level);
    this.$return(
      pb.add(
        pb.int(this.g.w),
        this.t.x,
        pb.mul(pb.int(this.g.x), pb.add(this.t.y, pb.mul(pb.int(this.g.y), this.t.z)))
      )
    );
  });
  return scope[funcName](level, texel) as PBShaderExp;
}

/** Texel of a probe from its level and tile index. @internal */
export function probeTexelFromIndex(scope: PBInsideFunctionScope, level: PBShaderExp, index: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_probeTexelFromIndex';
  pb.func(funcName, [pb.int('level'), pb.int('i')], function () {
    this.$l.g = probeLevelGrid(this, this.level);
    this.$l.nx = pb.int(this.g.x);
    this.$l.ny = pb.int(this.g.y);
    this.$l.local = pb.sub(this.i, pb.int(this.g.w));
    this.$l.x = pb.mod(this.local, this.nx);
    this.$l.yz = pb.div(this.local, this.nx);
    this.$return(pb.ivec3(this.x, pb.mod(this.yz, this.ny), pb.div(this.yz, this.ny)));
  });
  return scope[funcName](level, index) as PBShaderExp;
}

/** World index of the probe at a texel of a level: the one of the window with that toroidal address. @internal */
export function probeWorldFromTexel(scope: PBInsideFunctionScope, level: PBShaderExp, texel: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_probeWorldFromTexel';
  pb.func(funcName, [pb.int('level'), pb.ivec3('t')], function () {
    this.$l.o = pb.ivec3(probeLevelOrigin(this, this.level).xyz);
    this.$l.n = pb.ivec3(probeLevelGrid(this, this.level).xyz);
    this.$return(pb.add(this.o, pb.mod(pb.add(pb.mod(pb.sub(this.t, this.o), this.n), this.n), this.n)));
  });
  return scope[funcName](level, texel) as PBShaderExp;
}

/** Texel of the probe of a level at a world index. @internal */
export function probeTexelFromWorld(
  scope: PBInsideFunctionScope,
  level: PBShaderExp | number,
  world: PBShaderExp
) {
  const pb = scope.$builder;
  const n = pb.ivec3(probeLevelGrid(scope, level).xyz);
  return pb.mod(pb.add(pb.mod(world, n), n), n) as PBShaderExp;
}

/** World position of a probe: its world index times its level's spacing, plus its relocation offset. @internal */
export function probePosition(
  scope: PBInsideFunctionScope,
  level: PBShaderExp | number,
  world: PBShaderExp,
  data: PBShaderExp
) {
  const pb = scope.$builder;
  return pb.add(pb.mul(pb.vec3(world), probeLevelOrigin(scope, level).w), data.xyz) as PBShaderExp;
}

/** Texel origin of a probe's tile in an atlas of `texels`² tiles. @internal */
export function probeTileOrigin(scope: PBInsideFunctionScope, index: PBShaderExp, texels: PBShaderExp) {
  const pb = scope.$builder;
  const cols = pb.int(scope[PROBE_PARAMS].at(0).y);
  return pb.mul(pb.ivec2(pb.mod(index, cols), pb.div(index, cols)), pb.int(texels)) as PBShaderExp;
}

/**
 * Bilinear sample of a probe's tile in a direction: the octahedral coordinate
 * mapped into the tile's interior, the border texels making the filter wrap.
 * @internal
 */
export function sampleProbeTile(
  scope: PBInsideFunctionScope,
  tex: PBShaderExp,
  index: PBShaderExp,
  texels: PBShaderExp,
  texSize: PBShaderExp,
  dir: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = `Z_sampleProbeTile_${tex.$str}`;
  pb.func(funcName, [pb.int('index'), pb.float('texels'), pb.vec2('texSize'), pb.vec3('dir')], function () {
    this.$l.origin = pb.vec2(probeTileOrigin(this, this.index, this.texels));
    this.$l.oct = pb.add(pb.mul(octEncode(this, this.dir), 0.5), pb.vec2(0.5));
    this.$l.uv = pb.div(
      pb.add(this.origin, pb.vec2(1), pb.mul(this.oct, pb.sub(this.texels, 2))),
      this.texSize
    );
    this.$return(pb.textureSampleLevel(tex, this.uv, 0));
  });
  return scope[funcName](index, texels, texSize, dir) as PBShaderExp;
}

/**
 * Irradiance from one level of the volume at a biased surface point: the
 * eight probes around it weighted by trilinear position, by how much each
 * faces the point and by Chebyshev visibility. Returns (irradiance, weight
 * sum), the sum 0 outside the level's window or among probes never updated.
 * @internal
 */
function sampleProbeLevel(
  scope: PBInsideFunctionScope,
  level: PBShaderExp,
  p: PBShaderExp,
  biased: PBShaderExp,
  n: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleProbeLevel';
  pb.func(funcName, [pb.int('level'), pb.vec3('p'), pb.vec3('biased'), pb.vec3('n')], function () {
    this.$l.p0 = this[PROBE_PARAMS].at(0);
    this.$l.p1 = this[PROBE_PARAMS].at(1);
    this.$l.lo = probeLevelOrigin(this, this.level);
    this.$l.lg = probeLevelGrid(this, this.level);
    this.$l.spacing = this.lo.w;
    this.$l.origin = pb.ivec3(this.lo.xyz);
    this.$l.n3 = pb.ivec3(this.lg.xyz);
    this.$l.g = pb.sub(pb.div(this.biased, this.spacing), pb.vec3(this.origin));
    this.$l.sum = pb.vec3(0);
    this.$l.wsum = pb.float(0);
    this.$l.inside = pb.and(
      pb.all(pb.greaterThanEqual(this.g, pb.vec3(0))),
      pb.all(pb.lessThanEqual(this.g, pb.sub(pb.vec3(this.n3), pb.vec3(1))))
    );
    this.$if(this.inside, function () {
      this.$l.base = pb.ivec3(pb.clamp(pb.floor(this.g), pb.vec3(0), pb.sub(pb.vec3(this.n3), pb.vec3(2))));
      this.$l.alpha = pb.clamp(pb.sub(this.g, pb.vec3(this.base)), pb.vec3(0), pb.vec3(1));
      for (let i = 0; i < 8; i++) {
        const off = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
        this.$l[`w${i}`] = pb.add(this.origin, this.base, pb.ivec3(off[0], off[1], off[2]));
        this.$l[`t${i}`] = probeTexelFromWorld(this, this.level, this[`w${i}`]);
        this.$l[`i${i}`] = probeTileIndex(this, this.level, this[`t${i}`]);
        this.$l[`d${i}`] = this[PROBE_DATA].at(this[`i${i}`]);
        this.$if(pb.greaterThan(this[`d${i}`].w, 0.5), function () {
          this.$l.pp = probePosition(this, this.level, this[`w${i}`], this[`d${i}`]);
          this.$l.tri = pb.mul(
            off[0] ? this.alpha.x : pb.sub(1, this.alpha.x),
            off[1] ? this.alpha.y : pb.sub(1, this.alpha.y),
            off[2] ? this.alpha.z : pb.sub(1, this.alpha.z)
          );
          this.$l.dirToProbe = pb.normalize(pb.sub(this.pp, this.p));
          // Wrap shading: a probe behind the surface still contributes a little
          this.$l.wrap = pb.mul(pb.add(pb.dot(this.dirToProbe, this.n), 1), 0.5);
          this.$l.w = pb.add(pb.mul(this.wrap, this.wrap), 0.2);
          // Chebyshev visibility from the biased point
          this.$l.toBiased = pb.sub(this.biased, this.pp);
          this.$l.dist = pb.length(this.toBiased);
          this.$l.vis = sampleProbeTile(
            this,
            this[PROBE_VISIBILITY],
            this[`i${i}`],
            this.p0.w,
            this.p1.zw,
            pb.div(this.toBiased, pb.max(this.dist, 1e-6))
          );
          this.$l.mean = this.vis.x;
          this.$l.variance = pb.abs(pb.sub(pb.mul(this.mean, this.mean), this.vis.y));
          this.$if(pb.greaterThan(this.dist, this.mean), function () {
            this.$l.dd = pb.sub(this.dist, this.mean);
            this.$l.cheb = pb.div(this.variance, pb.add(this.variance, pb.mul(this.dd, this.dd)));
            this.w = pb.mul(this.w, pb.max(pb.mul(this.cheb, this.cheb, this.cheb), 0.05));
          });
          // Crush tiny weights to avoid noise from a nearly-blocked probe
          this.$if(pb.lessThan(this.w, 0.2), function () {
            this.w = pb.mul(this.w, pb.div(pb.mul(this.w, this.w), 0.04));
          });
          this.w = pb.mul(this.w, this.tri);
          this.$l.irr = sampleProbeTile(
            this,
            this[PROBE_IRRADIANCE],
            this[`i${i}`],
            this.p0.z,
            this.p1.xy,
            this.n
          );
          this.sum = pb.add(this.sum, pb.mul(this.irr.rgb, this.w));
          this.wsum = pb.add(this.wsum, this.w);
        });
      }
    });
    this.$return(pb.vec4(pb.div(this.sum, pb.max(this.wsum, 1e-5)), this.wsum));
  });
  return scope[funcName](level, p, biased, n) as PBShaderExp;
}

/**
 * Irradiance (E/π, rgb) at a surface from the probe volume, and in `a` whether
 * any probe answered (0 outside every level or among probes not yet updated).
 * The finest level holding the point answers, fading into the next over the
 * last probe spacing of its window so nothing pops as the windows move; a
 * level whose probes are not ready yet hands over to the next as well.
 * Majercik et al., "Dynamic Diffuse Global Illumination with Ray-Traced
 * Irradiance Fields", JCGT 2019, §4; the level selection follows Lumen's
 * radiance cache clipmaps.
 * @internal
 */
export function sampleProbeIrradiance(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  normal: PBShaderExp,
  viewDir: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleProbeIrradiance';
  pb.func(funcName, [pb.vec3('p'), pb.vec3('n'), pb.vec3('v')], function () {
    this.$l.p0 = this[PROBE_PARAMS].at(0);
    this.$l.p2 = this[PROBE_PARAMS].at(2);
    this.$l.levels = pb.int(this.p0.x);
    this.$l.biased = pb.add(this.p, pb.mul(this.n, this.p2.y), pb.mul(this.v, this.p2.z));
    this.$l.acc = pb.vec3(0);
    this.$l.accW = pb.float(0);
    this.$for(pb.int('l'), 0, PROBE_MAX_LEVELS, function () {
      this.$if(
        pb.or(pb.greaterThanEqual(this.l, this.levels), pb.greaterThanEqual(this.accW, 0.999)),
        function () {
          this.$break();
        }
      );
      this.$l.s = sampleProbeLevel(this, this.l, this.p, this.biased, this.n);
      this.$if(pb.greaterThan(this.s.a, 1e-5), function () {
        // Fade over the last spacing of the window, in probes
        this.$l.lo = probeLevelOrigin(this, this.l);
        this.$l.lg = probeLevelGrid(this, this.l);
        this.$l.g = pb.sub(pb.div(this.biased, this.lo.w), this.lo.xyz);
        this.$l.edge = pb.min(this.g, pb.sub(pb.sub(this.lg.xyz, pb.vec3(1)), this.g));
        this.$l.t = pb.clamp(pb.min(pb.min(this.edge.x, this.edge.y), this.edge.z), 0, 1);
        this.$l.share = pb.mul(this.t, pb.sub(1, this.accW));
        this.acc = pb.add(this.acc, pb.mul(this.s.rgb, this.share));
        this.accW = pb.add(this.accW, this.share);
      });
    });
    this.$l.valid = this.$choice(pb.greaterThan(this.accW, 1e-4), pb.float(1), pb.float(0));
    this.$return(pb.vec4(pb.mul(pb.div(this.acc, pb.max(this.accW, 1e-4)), this.p2.x), this.valid));
  });
  return scope[funcName](worldPos, normal, viewDir) as PBShaderExp;
}
