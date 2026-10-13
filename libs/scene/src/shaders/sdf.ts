import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';

/** Uniform names of the global field, see {@link declareGlobalSDFUniforms}. */
export const GLOBAL_SDF_TEXTURE = 'zGlobalSDFTex';
export const GLOBAL_SDF_LEVELS = 'zGlobalSDFLevels';
export const GLOBAL_SDF_PARAMS = 'zGlobalSDFParams';

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
