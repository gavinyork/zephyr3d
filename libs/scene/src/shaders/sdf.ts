import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/** Uniform names of the global field, see {@link declareGlobalSDFUniforms}. */
export const GLOBAL_SDF_TEXTURE = 'zGlobalSDFTex';
export const GLOBAL_SDF_LEVELS = 'zGlobalSDFLevels';
export const GLOBAL_SDF_PARAMS = 'zGlobalSDFParams';
/** Uniform names of the dynamic instances, see {@link declareDynamicSDFUniforms}. */
export const SDF_ATLAS_TEXTURE = 'zSDFAtlasTex';
export const SDF_DYNAMIC_INSTANCES = 'zSDFDynamic';
export const SDF_DYNAMIC_INFO = 'zSDFDynamicInfo';
/** Most dynamic instances a shader merges into the field. */
export const MAX_DYNAMIC_SDF_INSTANCES = 16;
/**
 * vec4s per packed instance: world-to-local rows (3), (field box min, voxel
 * size), (field box max, world scale), (atlas slot offset, 0).
 */
export const SDF_INSTANCE_VEC4S = 6;

/**
 * Declares the uniforms {@link sampleGlobalSDF} reads, in a bind group.
 *
 * - texture: all levels stacked along z, `resolution` texels each, r32f.
 * - levels[i]: (window origin in voxels of the level, voxel size).
 * - params: (resolution, number of levels, band in voxels, 0).
 *
 * @param levels - Clipmap levels; a compile-time constant of the program.
 * @internal
 */
export function declareGlobalSDFUniforms(scope: PBGlobalScope, group: number, levels: number) {
  const pb = scope.$builder;
  scope[GLOBAL_SDF_TEXTURE] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[GLOBAL_SDF_LEVELS] = pb.vec4[levels]().uniform(group);
  scope[GLOBAL_SDF_PARAMS] = pb.vec4().uniform(group);
}

/**
 * Declares the uniforms {@link sampleDynamicSDF} reads: the mesh field atlas,
 * up to {@link MAX_DYNAMIC_SDF_INSTANCES} packed instances and
 * (instance count, 1 / atlas size).
 * @internal
 */
export function declareDynamicSDFUniforms(scope: PBGlobalScope, group: number) {
  const pb = scope.$builder;
  scope[SDF_ATLAS_TEXTURE] = pb.tex3D().uniform(group);
  scope[SDF_DYNAMIC_INSTANCES] = pb.vec4[MAX_DYNAMIC_SDF_INSTANCES * SDF_INSTANCE_VEC4S]().uniform(group);
  scope[SDF_DYNAMIC_INFO] = pb.vec4().uniform(group);
}

/**
 * Signed distance from a world position to the nearest of a set of packed
 * instances, each its baked field sampled from the atlas: inside the field box
 * by trilinear lookup, outside it by the border value plus the distance to the
 * box. `maxDist` is returned when no instance comes nearer.
 *
 * Instance packing is described at {@link SDF_INSTANCE_VEC4S}: `baseOf(k)`
 * gives the first vec4 of the k-th instance visited, `instance(i)` reads vec4
 * `i` of the packed array.
 *
 * @internal
 */
export function sampleInstancesSDF(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  count: PBShaderExp,
  maxDist: PBShaderExp,
  baseOf: (scope: PBInsideFunctionScope, k: PBShaderExp) => PBShaderExp,
  instance: (scope: PBInsideFunctionScope, index: PBShaderExp) => PBShaderExp,
  atlas: PBShaderExp,
  atlasInvSize: PBShaderExp
) {
  const pb = scope.$builder;
  scope.$l.sdfBest = maxDist;
  scope.$l.sdfP4 = pb.vec4(p, 1);
  scope.$for(pb.uint('sdfK'), 0, count, function () {
    this.$l.base = baseOf(this, this.sdfK);
    this.$l.r0 = instance(this, this.base);
    this.$l.r1 = instance(this, pb.add(this.base, 1));
    this.$l.r2 = instance(this, pb.add(this.base, 2));
    this.$l.bmin = instance(this, pb.add(this.base, 3));
    this.$l.bmax = instance(this, pb.add(this.base, 4));
    this.$l.slot = instance(this, pb.add(this.base, 5));
    this.$l.lp = pb.vec3(
      pb.dot(this.r0, this.sdfP4),
      pb.dot(this.r1, this.sdfP4),
      pb.dot(this.r2, this.sdfP4)
    );
    this.$l.c = pb.clamp(this.lp, this.bmin.xyz, this.bmax.xyz);
    this.$l.outside = pb.length(pb.sub(this.lp, this.c));
    // A field box farther than the current best cannot improve it
    this.$if(pb.lessThan(pb.mul(this.outside, this.bmax.w), this.sdfBest), function () {
      this.$l.res = pb.div(pb.sub(this.bmax.xyz, this.bmin.xyz), this.bmin.w);
      // Clamped to the outer sample centres, so the filter never reads a neighbour's slot
      this.$l.f = pb.clamp(
        pb.div(pb.sub(this.c, this.bmin.xyz), this.bmin.w),
        pb.vec3(0.5),
        pb.sub(this.res, pb.vec3(0.5))
      );
      this.$l.uvw = pb.mul(pb.add(this.slot.xyz, this.f), atlasInvSize);
      this.$l.ld = pb.textureSampleLevel(atlas, this.uvw, 0).r;
      this.sdfBest = pb.min(this.sdfBest, pb.mul(pb.add(this.ld, this.outside), this.bmax.w));
    });
  });
  return scope.sdfBest as PBShaderExp;
}

/**
 * Signed distance at a world position to the dynamic instances, at their
 * current transforms, or `maxDist` when none comes nearer.
 * @internal
 */
export function sampleDynamicSDF(scope: PBInsideFunctionScope, worldPos: PBShaderExp, maxDist: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleDynamicSDF';
  pb.func(funcName, [pb.vec3('p'), pb.float('maxDist')], function () {
    this.$return(
      sampleInstancesSDF(
        this,
        this.p,
        pb.uint(this[SDF_DYNAMIC_INFO].x),
        this.maxDist,
        (s, k) => pb.mul(k, SDF_INSTANCE_VEC4S),
        (s, i) => s[SDF_DYNAMIC_INSTANCES].at(i),
        this[SDF_ATLAS_TEXTURE],
        this[SDF_DYNAMIC_INFO].yzw
      )
    );
  });
  return scope[funcName](worldPos, maxDist) as PBShaderExp;
}

/**
 * Signed distance at a world position to everything in the scene field: the
 * global clipmap (static meshes and terrain) merged with the dynamic
 * instances. Needs both {@link declareGlobalSDFUniforms} and
 * {@link declareDynamicSDFUniforms}.
 * @internal
 */
export function sampleSceneSDF(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleSceneSDF';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.g = sampleGlobalSDF(this, this.p, levels);
    this.$return(sampleDynamicSDF(this, this.p, this.g));
  });
  return scope[funcName](worldPos) as PBShaderExp;
}

/**
 * Signed distance at a world position from the global clipmap field, in world
 * units, negative inside geometry.
 *
 * The finest level whose window holds the point and whose value lies inside
 * its band answers; a value at the band edge only says "at least this far", so
 * the next coarser level is asked. Past the coarsest window, or with every
 * level saturated, the coarsest band is returned, a lower bound on the true
 * distance that keeps sphere tracing safe.
 *
 * Trilinear by hand from `textureLoad`: r32f is not filterable everywhere, and
 * the windows are toroidal, so neighbouring texels can wrap around the level.
 *
 * @internal
 */
export function sampleGlobalSDF(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleGlobalSDF';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.resF = this[GLOBAL_SDF_PARAMS].x;
    this.$l.band = this[GLOBAL_SDF_PARAMS].z;
    this.$l.result = pb.float(0);
    this.$l.found = false;
    for (let i = levels - 1; i >= 0; i--) {
      // Coarsest first, each finer level overriding where it is valid; unrolled
      // since `levels` is small and constant
      this.$l[`info${i}`] = this[GLOBAL_SDF_LEVELS].at(i);
      // Position in voxels of the window, sample centres at integers
      this.$l[`f${i}`] = pb.sub(
        pb.div(this.p, this[`info${i}`].w),
        pb.add(this[`info${i}`].xyz, pb.vec3(0.5))
      );
      this.$l[`in${i}`] = pb.and(
        pb.all(pb.greaterThanEqual(this[`f${i}`], pb.vec3(0))),
        pb.all(pb.lessThanEqual(this[`f${i}`], pb.vec3(pb.sub(this.resF, 1))))
      );
      this.$if(this[`in${i}`], function () {
        this.$l.base = pb.floor(this[`f${i}`]);
        this.$l.t = pb.sub(this[`f${i}`], this.base);
        // World voxel index of the lower corner, then toroidal texel
        this.$l.v0 = pb.add(pb.ivec3(this.base), pb.ivec3(this[`info${i}`].xyz));
        this.$l.c000 = loadWrapped(this, this.v0, 0, 0, 0, i);
        this.$l.c100 = loadWrapped(this, this.v0, 1, 0, 0, i);
        this.$l.c010 = loadWrapped(this, this.v0, 0, 1, 0, i);
        this.$l.c110 = loadWrapped(this, this.v0, 1, 1, 0, i);
        this.$l.c001 = loadWrapped(this, this.v0, 0, 0, 1, i);
        this.$l.c101 = loadWrapped(this, this.v0, 1, 0, 1, i);
        this.$l.c011 = loadWrapped(this, this.v0, 0, 1, 1, i);
        this.$l.c111 = loadWrapped(this, this.v0, 1, 1, 1, i);
        this.$l.d = pb.mix(
          pb.mix(pb.mix(this.c000, this.c100, this.t.x), pb.mix(this.c010, this.c110, this.t.x), this.t.y),
          pb.mix(pb.mix(this.c001, this.c101, this.t.x), pb.mix(this.c011, this.c111, this.t.x), this.t.y),
          this.t.z
        );
        // A saturated value is only a bound; a coarser level already wrote its answer
        this.$if(
          pb.or(pb.not(this.found), pb.lessThan(pb.abs(this.d), pb.mul(this.band, this[`info${i}`].w, 0.95))),
          function () {
            this.result = this.d;
            this.found = true;
          }
        );
      });
    }
    this.$if(pb.not(this.found), function () {
      this.result = pb.mul(this.band, this[GLOBAL_SDF_LEVELS].at(levels - 1).w);
    });
    this.$return(this.result);
  });
  return scope[funcName](worldPos) as PBShaderExp;
}

function loadWrapped(
  scope: PBInsideFunctionScope,
  v0: PBShaderExp,
  dx: number,
  dy: number,
  dz: number,
  level: number
) {
  const pb = scope.$builder;
  const v = pb.add(v0, pb.ivec3(dx, dy, dz));
  // ((v % n) + n) % n, the remainder of a negative index being negative
  const t = pb.mod(pb.add(pb.mod(v, pb.ivec3(scope.res)), pb.ivec3(scope.res)), pb.ivec3(scope.res));
  return pb.textureLoad(
    scope[GLOBAL_SDF_TEXTURE],
    pb.ivec3(t.x, t.y, pb.add(t.z, pb.mul(scope.res, level))),
    0
  ).r;
}
