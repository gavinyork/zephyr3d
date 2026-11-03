import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { getSamplerOptions } from '../utility/misc';

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
 * Declares the probe volume uniforms.
 *
 * - irradiance: rgba16f atlas of octahedral tiles, `irrTexels`² each with a one-texel border;
 *   rgb E/π at the fixed cache exposure (getGICacheExposure), a = cosine-weighted sky visibility.
 * - visibility: rgba16f atlas of `visTexels`² tiles, (mean distance, mean squared distance).
 * - data: storage buffer, one vec4 per probe (relocation offset, state); writable when `writable`.
 * - params[0]: (levels, tiles per atlas row, irrTexels, visTexels),
 *   params[1]: (irradiance atlas size, visibility atlas size),
 *   params[2]: (read scale = GI intensity, normal bias, view bias, max ray distance),
 *   params[3 + 2l]: (world index of level l's first probe, spacing),
 *   params[4 + 2l]: (probes per axis of level l, first tile).
 *
 * Levels are camera-centred clipmap windows addressed toroidally by world index; tile index
 * (also indexing `data`) = first tile + `x + nx (y + ny z)` of the texel.
 * @internal
 */
export function declareProbeUniforms(scope: PBGlobalScope, group: number, writable = false) {
  const pb = scope.$builder;
  // Static sampler so both share one sampler binding on WebGPU (texture-heavy materials
  // such as water are near the 16-sampler limit)
  scope[PROBE_IRRADIANCE] = pb.tex2D().uniform(group).withSampler(getSamplerOptions('clamp_linear_nomip'));
  scope[PROBE_VISIBILITY] = pb.tex2D().uniform(group).withSampler(getSamplerOptions('clamp_linear_nomip'));
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

/** World index of the probe at a toroidal texel of a level. @internal */
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

/** World position of a probe: world index times level spacing plus relocation offset. @internal */
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
 * Bilinear sample of a probe's tile in a direction; border texels make the filter wrap.
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
 * Probe state in data.w: 0 = no data (never updated or just reactivated), 1 = updated,
 * {@link PROBE_STATE_INACTIVE} = buried in geometry.
 * @internal
 */
export const PROBE_STATE_INACTIVE = 2;

/** True for a probe whose maps a surface may read. @internal */
export function probeActive(scope: PBInsideFunctionScope, data: PBShaderExp) {
  const pb = scope.$builder;
  return pb.and(pb.greaterThan(data.w, 0.5), pb.lessThan(data.w, PROBE_STATE_INACTIVE - 0.5)) as PBShaderExp;
}

/**
 * Irradiance from one volume level: the eight surrounding probes weighted by trilinear,
 * wrap-facing and Chebyshev visibility (DDGI). Returns (irradiance, weight sum); sum 0 when
 * outside the window or no probe is active.
 * @internal
 */
function sampleProbeLevel(
  scope: PBInsideFunctionScope,
  level: PBShaderExp,
  p: PBShaderExp,
  biased: PBShaderExp,
  n: PBShaderExp,
  sky: boolean
) {
  const pb = scope.$builder;
  const funcName = sky ? 'Z_sampleProbeLevelSky' : 'Z_sampleProbeLevel';
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
        // Skip inactive (buried) probes (Majercik et al. 2021, probe classification)
        this.$if(probeActive(this, this[`d${i}`]), function () {
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
          // Chebyshev visibility of the point as the probe sees the surface
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
          this.sum = pb.add(this.sum, pb.mul(sky ? pb.vec3(this.irr.a) : this.irr.rgb, this.w));
          this.wsum = pb.add(this.wsum, this.w);
        });
      }
    });
    this.$return(pb.vec4(pb.div(this.sum, pb.max(this.wsum, 1e-5)), this.wsum));
  });
  return scope[funcName](level, p, biased, n) as PBShaderExp;
}

/**
 * Probe volume irradiance (E/π, rgb) at a surface; `a` = 1 if any probe answered. The finest
 * level holding the point answers, fading to the next over the outer 0.5-2.5 probe spacings of
 * its window. DDGI (Majercik et al., JCGT 2019, §4);
 *
 * Normal/view biases of params[2] are in probe spacings, scaled per level; the view bias fades
 * out within one spacing of the viewer. `toViewer` runs from point to viewer; feedback mode
 * applies the full view bias.
 *
 * Modes: `surface` applies the read scale; `feedback` returns the stored value for the next
 * voxel bounce; `sky` interpolates sky visibility (0..1) with the same weights.
 * @internal
 */
export function sampleProbeIrradiance(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  normal: PBShaderExp,
  toViewer: PBShaderExp,
  mode: 'surface' | 'feedback' | 'sky' = 'surface'
) {
  const pb = scope.$builder;
  const funcName =
    mode === 'surface'
      ? 'Z_sampleProbeIrradiance'
      : mode === 'feedback'
        ? 'Z_sampleProbeIrradianceFeedback'
        : 'Z_sampleProbeSkyVisibility';
  pb.func(funcName, [pb.vec3('p'), pb.vec3('n'), pb.vec3('toViewer')], function () {
    this.$l.p0 = this[PROBE_PARAMS].at(0);
    this.$l.p2 = this[PROBE_PARAMS].at(2);
    this.$l.levels = pb.int(this.p0.x);
    this.$l.viewDist = pb.length(this.toViewer);
    this.$l.v = pb.div(this.toViewer, pb.max(this.viewDist, 1e-6));
    this.$l.acc = pb.vec3(0);
    this.$l.accW = pb.float(0);
    this.$for(pb.int('l'), 0, PROBE_MAX_LEVELS, function () {
      this.$if(
        pb.or(pb.greaterThanEqual(this.l, this.levels), pb.greaterThanEqual(this.accW, 0.999)),
        function () {
          this.$break();
        }
      );
      this.$l.lo = probeLevelOrigin(this, this.l);
      this.$l.viewFade = mode === 'feedback' ? pb.float(1) : pb.clamp(pb.div(this.viewDist, this.lo.w), 0, 1);
      this.$l.biased = pb.add(
        this.p,
        pb.mul(pb.add(pb.mul(this.n, this.p2.y), pb.mul(this.v, this.p2.z, this.viewFade)), this.lo.w)
      );
      this.$l.s = sampleProbeLevel(this, this.l, this.p, this.biased, this.n, mode === 'sky');
      this.$if(pb.greaterThan(this.s.a, 1e-5), function () {
        // Distance in probes to the window edge
        this.$l.lg = probeLevelGrid(this, this.l);
        this.$l.g = pb.sub(pb.div(this.biased, this.lo.w), this.lo.xyz);
        this.$l.edge = pb.min(this.g, pb.sub(pb.sub(this.lg.xyz, pb.vec3(1)), this.g));
        this.$l.t = pb.smoothStep(0.5, 2.5, pb.min(pb.min(this.edge.x, this.edge.y), this.edge.z));
        this.$l.share = pb.mul(this.t, pb.sub(1, this.accW));
        this.acc = pb.add(this.acc, pb.mul(this.s.rgb, this.share));
        this.accW = pb.add(this.accW, this.share);
      });
    });
    this.$l.valid = this.$choice(pb.greaterThan(this.accW, 1e-4), pb.float(1), pb.float(0));
    this.$l.e = pb.div(this.acc, pb.max(this.accW, 1e-4));
    this.$return(pb.vec4(mode === 'surface' ? pb.mul(this.e, this.p2.x) : this.e, this.valid));
  });
  return scope[funcName](worldPos, normal, toViewer) as PBShaderExp;
}
