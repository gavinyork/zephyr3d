import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { getDevice } from '../app/api';

/** Uniform names of the global field, see {@link declareGlobalSDFUniforms}. */
export const GLOBAL_SDF_TEXTURE = 'zGlobalSDFTex';
export const GLOBAL_SDF_LEVELS = 'zGlobalSDFLevels';
export const GLOBAL_SDF_PARAMS = 'zGlobalSDFParams';
export const GLOBAL_SDF_TAGS = 'zGlobalSDFTags';
/** Voxels along a brick edge of the global field, the unit it is composited and tagged in. */
export const GLOBAL_SDF_BRICK = 8;
/** Uniform names of the dynamic instances, see {@link declareDynamicSDFUniforms}. */
export const SDF_ATLAS_TEXTURE = 'zSDFAtlasTex';
export const SDF_DYNAMIC_INSTANCES = 'zSDFDynamic';
export const SDF_DYNAMIC_INFO = 'zSDFDynamicInfo';
/** Most dynamic instances a shader merges into the field. */
export const MAX_DYNAMIC_SDF_INSTANCES = 16;
/**
 * vec4s per packed instance: world-to-local rows (3), (field box min, voxel size),
 * (field box max, world scale), (atlas slot offset, thin). `thin` = half thickness in world
 * units of a two-sided field's surface, -1 for one-sided; see `expand` of {@link sampleInstancesSDF}.
 */
export const SDF_INSTANCE_VEC4S = 6;

/**
 * Declares the uniforms {@link sampleGlobalSDF} reads.
 *
 * - texture: levels stacked along z, `resolution + 1` slices each (last repeats the first),
 *   in {@link globalSDFFormat}; see {@link isGlobalSDFFilterable}.
 * - tags: rgba32f, one texel per brick, stacked the same way: (world brick x, y, z, 1) of the
 *   brick last composited there.
 * - levels[i]: (window origin in voxels, voxel size).
 * - params: (resolution, number of levels, band in voxels, current mask); bit i set when
 *   every brick of level i is current (tags need not be read).
 *
 * @param levels - Clipmap levels; a compile-time constant of the program.
 * @internal
 */
export function declareGlobalSDFUniforms(scope: PBGlobalScope, group: number, levels: number) {
  const pb = scope.$builder;
  scope[GLOBAL_SDF_TEXTURE] = isGlobalSDFFilterable()
    ? pb.tex3D().uniform(group)
    : pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[GLOBAL_SDF_TAGS] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[GLOBAL_SDF_LEVELS] = pb.vec4[levels]().uniform(group);
  scope[GLOBAL_SDF_PARAMS] = pb.vec4().uniform(group);
}

/**
 * Texel format of the global field: r16f where compute-writable (WebGPU texture-formats-tier1),
 * else r32f. Half precision suffices since only distances within the band are stored.
 * @internal
 */
export function globalSDFFormat(): 'r16f' | 'r32f' {
  return getDevice().getDeviceCaps().textureCaps.getTextureFormatInfo('r16f')?.writable ? 'r16f' : 'r32f';
}

/**
 * True when the device filters the global field's format (r16f always, r32f with
 * float32-filterable); otherwise trilinear is done by hand from eight loads.
 * @internal
 */
export function isGlobalSDFFilterable() {
  return !!getDevice().getDeviceCaps().textureCaps.getTextureFormatInfo(globalSDFFormat())?.filterable;
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
 * Distance in local units from a local position to one packed instance's field: trilinear
 * atlas lookup inside the box, border value plus box distance outside. `bmin` is (box min,
 * voxel size), `bmax` (box max, world scale), `slot` the atlas slot offset.
 * @internal
 */
export function sampleInstanceField(
  scope: PBInsideFunctionScope,
  lp: PBShaderExp,
  bmin: PBShaderExp,
  bmax: PBShaderExp,
  slot: PBShaderExp,
  atlas: PBShaderExp,
  atlasInvSize: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = `Z_sampleInstanceField_${atlas.$str}`;
  pb.func(
    funcName,
    [pb.vec3('lp'), pb.vec4('bmin'), pb.vec4('bmax'), pb.vec4('slot'), pb.vec3('invSize')],
    function () {
      this.$l.c = pb.clamp(this.lp, this.bmin.xyz, this.bmax.xyz);
      this.$l.outside = pb.length(pb.sub(this.lp, this.c));
      this.$l.res = pb.div(pb.sub(this.bmax.xyz, this.bmin.xyz), this.bmin.w);
      // Clamped to the outer sample centres, so the filter never reads a neighbour's slot
      this.$l.f = pb.clamp(
        pb.div(pb.sub(this.c, this.bmin.xyz), this.bmin.w),
        pb.vec3(0.5),
        pb.sub(this.res, pb.vec3(0.5))
      );
      this.$l.uvw = pb.mul(pb.add(this.slot.xyz, this.f), this.invSize);
      this.$return(pb.add(pb.textureSampleLevel(atlas, this.uvw, 0).r, this.outside));
    }
  );
  return scope[funcName](lp, bmin, bmax, slot, atlasInvSize) as PBShaderExp;
}

/**
 * Signed distance from a world position to the nearest of a set of packed instances
 * (layout at {@link SDF_INSTANCE_VEC4S}), or `maxDist` when none is nearer. `baseOf(k)` gives
 * the first vec4 of the k-th instance, `instance(i)` reads vec4 `i`. If `bestIndex` names an
 * int variable, the nearest k is written to it.
 *
 * `expand` (world units) is the minimum half thickness given to two-sided surfaces so coarser
 * grids don't step over them: half the voxel size of the grid being written, 0 for point samples.
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
  atlasInvSize: PBShaderExp,
  expand: PBShaderExp,
  bestIndex?: string
) {
  const pb = scope.$builder;
  scope.$l.sdfBest = maxDist;
  scope.$l.sdfP4 = pb.vec4(p, 1);
  scope.$l.sdfExpand = expand;
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
    // World length of a unit along each local axis
    this.$l.axisScale = pb.div(
      pb.vec3(1),
      pb.vec3(pb.length(this.r0.xyz), pb.length(this.r1.xyz), pb.length(this.r2.xyz))
    );
    // World distance to the field box, exact under non-uniform scale; only the
    // field's own value takes the smallest axis scale
    this.$l.outside = pb.length(pb.mul(pb.sub(this.lp, this.c), this.axisScale));
    // How far a two-sided surface is pushed out to reach the half thickness asked for
    this.$l.grow = this.$choice(
      pb.greaterThanEqual(this.slot.w, 0),
      pb.max(pb.sub(this.sdfExpand, this.slot.w), 0),
      pb.float(0)
    );
    // A field box farther than the current best cannot improve it
    this.$if(pb.lessThan(pb.sub(this.outside, this.grow), this.sdfBest), function () {
      this.$l.cand = pb.sub(
        pb.add(
          pb.mul(
            sampleInstanceField(this, this.c, this.bmin, this.bmax, this.slot, atlas, atlasInvSize),
            this.bmax.w
          ),
          this.outside
        ),
        this.grow
      );
      this.$if(pb.lessThan(this.cand, this.sdfBest), function () {
        this.sdfBest = this.cand;
        if (bestIndex) {
          this[bestIndex] = pb.int(this.sdfK);
        }
      });
    });
  });
  return scope.sdfBest as PBShaderExp;
}

/**
 * Signed distance to the dynamic instances at their current transforms, or `maxDist`.
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
        this[SDF_DYNAMIC_INFO].yzw,
        pb.float(0)
      )
    );
  });
  return scope[funcName](worldPos, maxDist) as PBShaderExp;
}

/**
 * Signed distance to the whole scene field: global clipmap merged with dynamic instances.
 * Needs {@link declareGlobalSDFUniforms} and {@link declareDynamicSDFUniforms}.
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
 * {@link sampleSceneSDF} returning (distance, voxel size); voxel size 0 where a dynamic
 * instance is nearer.
 * @internal
 */
export function sampleSceneSDFWithVoxel(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleSceneSDFWithVoxel';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.g = sampleGlobalSDFWithVoxel(this, this.p, levels);
    this.$l.d = sampleDynamicSDF(this, this.p, this.g.x);
    this.$return(pb.vec2(this.d, this.$choice(pb.lessThan(this.d, this.g.x), pb.float(0), this.g.y)));
  });
  return scope[funcName](worldPos) as PBShaderExp;
}

/**
 * Surface expand scale in bricks holding two-sided meshes (1 elsewhere)
 * @internal
 */
export const SDF_NOT_COVERED_EXPAND_SCALE = 0.6;

/**
 * Tag alpha of a brick holding two-sided meshes (1 otherwise); see
 * {@link SDF_NOT_COVERED_EXPAND_SCALE}.
 * @internal
 */
export const GLOBAL_SDF_TAG_NOT_COVERED = 2;

/**
 * False where the global field brick holding a position (finest level) was composited with
 * two-sided meshes; true otherwise, including outside every window or for stale bricks.
 * @internal
 */
export function globalSDFCovered(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  const funcName = 'Z_globalSDFCovered';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.nbi = pb.ivec3(pb.div(this.res, GLOBAL_SDF_BRICK));
    for (let i = 0; i < levels; i++) {
      this.$l[`cvInfo${i}`] = this[GLOBAL_SDF_LEVELS].at(i);
      this.$l[`cvV${i}`] = pb.ivec3(pb.floor(pb.div(this.p, this[`cvInfo${i}`].w)));
      this.$l[`cvO${i}`] = pb.ivec3(this[`cvInfo${i}`].xyz);
      this.$if(
        pb.and(
          pb.all(pb.greaterThanEqual(this[`cvV${i}`], this[`cvO${i}`])),
          pb.all(pb.lessThan(this[`cvV${i}`], pb.add(this[`cvO${i}`], pb.ivec3(this.res))))
        ),
        function () {
          this.$l.b = pb.ivec3(pb.floor(pb.div(pb.vec3(this[`cvV${i}`]), GLOBAL_SDF_BRICK)));
          this.$l.w = wrap(this, this.b, this.nbi);
          this.$l.tag = pb.textureLoad(
            this[GLOBAL_SDF_TAGS],
            pb.ivec3(this.w.x, this.w.y, pb.add(this.w.z, pb.mul(this.nbi.z, i))),
            0
          );
          this.$return(
            pb.not(
              pb.and(
                pb.greaterThan(this.tag.w, GLOBAL_SDF_TAG_NOT_COVERED - 0.5),
                pb.equal(pb.ivec3(this.tag.xyz), this.b)
              )
            )
          );
        }
      );
    }
    this.$return(true);
  });
  return scope[funcName](worldPos) as PBShaderExp;
}

/**
 * Lumen surface expand (GlobalDistanceFieldUtils.ush) for a {@link sampleSceneSDFWithVoxel}
 * sample at `p`, `t` along a trace: one voxel of the level read ({@link SDF_NOT_COVERED_EXPAND_SCALE}
 * in two-sided bricks), ramping from 0 over the first two voxels. Zero for dynamic instances.
 * @internal
 */
export function sdfSurfaceExpand(
  scope: PBInsideFunctionScope,
  p: PBShaderExp,
  sample: PBShaderExp,
  t: PBShaderExp,
  levels: number
) {
  const pb = scope.$builder;
  const funcName = 'Z_sdfSurfaceExpand';
  pb.func(funcName, [pb.vec3('p'), pb.vec2('s'), pb.float('t')], function () {
    this.$l.e = pb.mul(this.s.y, pb.clamp(pb.div(this.t, pb.max(pb.mul(this.s.y, 2), 1e-6)), 0, 1));
    this.$if(
      pb.and(
        pb.lessThan(this.s.x, this.e),
        pb.greaterThanEqual(this.s.x, pb.mul(this.e, SDF_NOT_COVERED_EXPAND_SCALE))
      ),
      function () {
        this.$if(pb.not(globalSDFCovered(this, this.p, levels)), function () {
          this.e = pb.mul(this.e, SDF_NOT_COVERED_EXPAND_SCALE);
        });
      }
    );
    this.$return(this.e);
  });
  return scope[funcName](p, sample, t) as PBShaderExp;
}

/**
 * Voxels over which a global field level blends into the next coarser one near its window
 * edge; wider than a brick (the window move step) so the hand-over never jumps.
 * @internal
 */
export const SDF_LEVEL_BLEND_VOXELS = 16;

/**
 * Signed distance (world units, negative inside) from the global clipmap field.
 *
 * The finest level holding the point within its band answers, blending into the next coarser
 * level near window edges and band edges. Past all windows or with every level saturated, the
 * coarsest value is returned as a lower bound, keeping sphere tracing safe. Windows are toroidal;
 * non-filterable formats use manual trilinear. A level answers only where all bricks under the
 * filter are tagged current, so stale bricks after a window move are ignored.
 * @internal
 */
export function sampleGlobalSDF(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  return sampleGlobalSDFWithVoxel(scope, worldPos, levels).x as PBShaderExp;
}

/**
 * First level worth reading after a sphere-trace step read `prevDist`; finer levels saturate.
 * @internal
 */
function sdfStartLevel(scope: PBInsideFunctionScope, prevDist: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  let start: PBShaderExp = pb.int(0);
  for (let i = 0; i < levels - 1; i++) {
    start = pb.add(
      start,
      pb.int(
        pb.greaterThanEqual(
          prevDist,
          pb.mul(scope[GLOBAL_SDF_PARAMS].z, scope[GLOBAL_SDF_LEVELS].at(i).w, 0.95)
        )
      )
    );
  }
  return start;
}

/**
 * {@link sampleGlobalSDFWithVoxel} for sphere tracing: starts at the level `prevDist` needs,
 * rereading from the finest level near a surface. Levels finer than `minLevel` are never .
 * @internal
 */
export function sampleGlobalSDFHinted(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  prevDist: PBShaderExp,
  levels: number,
  minLevel?: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleGlobalSDFHinted';
  pb.func(funcName, [pb.vec3('p'), pb.float('prevDist'), pb.int('minLevel')], function () {
    this.$l.start = pb.max(sdfStartLevel(this, this.prevDist, levels), this.minLevel);
    this.$l.g = sampleGlobalSDFWithVoxel(this, this.p, levels, this.start);
    this.$if(pb.greaterThan(this.start, this.minLevel), function () {
      this.$if(
        pb.lessThan(
          this.g.x,
          pb.mul(this[GLOBAL_SDF_PARAMS].z, this[GLOBAL_SDF_LEVELS].at(pb.sub(this.start, 1)).w)
        ),
        function () {
          this.g = sampleGlobalSDFWithVoxel(this, this.p, levels, this.minLevel);
        }
      );
    });
    this.$return(this.g);
  });
  return scope[funcName](worldPos, prevDist, minLevel ?? pb.int(0)) as PBShaderExp;
}

/**
 * {@link sampleSceneSDFWithVoxel} for sphere tracing, using {@link sampleGlobalSDFHinted}.
 * @internal
 */
export function sampleSceneSDFHinted(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  prevDist: PBShaderExp,
  levels: number,
  minLevel?: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleSceneSDFHinted';
  pb.func(funcName, [pb.vec3('p'), pb.float('prevDist'), pb.int('minLevel')], function () {
    this.$l.g = sampleGlobalSDFHinted(this, this.p, this.prevDist, levels, this.minLevel);
    this.$l.d = sampleDynamicSDF(this, this.p, this.g.x);
    this.$return(pb.vec2(this.d, this.$choice(pb.lessThan(this.d, this.g.x), pb.float(0), this.g.y)));
  });
  return scope[funcName](worldPos, prevDist, minLevel ?? pb.int(0)) as PBShaderExp;
}

/** Steps {@link sdfRefineHit} takes past a hit on the swollen surface. @internal */
export const SDF_REFINE_STEPS = 8;

/**
 * Refines a sphere-trace hit on the surface swollen by {@link sdfSurfaceExpand} to the field's
 * own surface: steps on from `t` (distance `d`, answering `voxel` size, 0 for dynamic) to the zero
 * crossing or minimum, at most {@link SDF_REFINE_STEPS} steps of at least 1/8 voxel. Needed because
 * the swollen surface lies up to a voxel short, notably in concave corners.
 * @internal
 */
export function sdfRefineHit(
  scope: PBInsideFunctionScope,
  origin: PBShaderExp,
  dir: PBShaderExp,
  t: PBShaderExp,
  d: PBShaderExp,
  voxel: PBShaderExp,
  minLevel: PBShaderExp,
  levels: number
) {
  const pb = scope.$builder;
  const funcName = 'Z_sdfRefineHit';
  pb.func(
    funcName,
    [pb.vec3('o'), pb.vec3('dir'), pb.float('t'), pb.float('d'), pb.float('voxel'), pb.int('minLevel')],
    function () {
      // Stopped inside: back out by as much
      this.$if(pb.lessThanEqual(this.d, 0), function () {
        this.$return(pb.max(pb.add(this.t, this.d), 0));
      });
      this.$l.rt = this.t;
      this.$l.rd = this.d;
      this.$l.rStep = pb.mul(pb.max(this.voxel, this[GLOBAL_SDF_LEVELS].at(0).w), 0.125);
      this.$for(pb.int('r'), 0, SDF_REFINE_STEPS, function () {
        this.$l.nt = pb.add(this.rt, pb.max(this.rd, this.rStep));
        this.$l.nd = sampleSceneSDFHinted(
          this,
          pb.add(this.o, pb.mul(this.dir, this.nt)),
          this.rd,
          levels,
          this.minLevel
        ).x;
        this.$if(pb.lessThanEqual(this.nd, 0), function () {
          this.$return(
            pb.add(this.rt, pb.mul(pb.sub(this.nt, this.rt), pb.div(this.rd, pb.sub(this.rd, this.nd))))
          );
        });
        this.$if(pb.greaterThanEqual(this.nd, this.rd), function () {
          this.$break();
        });
        this.rt = this.nt;
        this.rd = this.nd;
      });
      this.$return(this.rt);
    }
  );
  return scope[funcName](origin, dir, t, d, voxel, minLevel) as PBShaderExp;
}

/**
 * {@link sampleGlobalSDF} returning (distance, voxel size) in world units; levels finer than
 * `minLevel` are skipped.
 * @internal
 */
export function sampleGlobalSDFWithVoxel(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  levels: number,
  minLevel?: PBShaderExp
) {
  const pb = scope.$builder;
  const filterable = isGlobalSDFFilterable();
  const funcName = 'Z_sampleGlobalSDFWithVoxel';
  pb.func(funcName, [pb.vec3('p'), pb.int('minLevel')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.resF = this[GLOBAL_SDF_PARAMS].x;
    this.$l.band = this[GLOBAL_SDF_PARAMS].z;
    // Weighted sums of the levels read, and the weight still left to coarser levels
    this.$l.sum = pb.float(0);
    this.$l.sumVoxel = pb.float(0);
    this.$l.remaining = pb.float(1);
    // The coarsest value read: a bound when every level read was saturated
    this.$l.last = pb.mul(this.band, this[GLOBAL_SDF_LEVELS].at(levels - 1).w);
    this.$l.lastVoxel = this[GLOBAL_SDF_LEVELS].at(levels - 1).w;
    this.$l.valid = false;
    this.$l.base = pb.vec3(0);
    this.$l.t = pb.vec3(0);
    this.$l.v0 = pb.ivec3(0);
    for (let i = 0; i < levels; i++) {
      // Finest first, each level taking the share its finer levels left
      const wanted =
        i === levels - 1
          ? pb.greaterThan(this.remaining, 1e-4)
          : pb.and(pb.greaterThan(this.remaining, 1e-4), pb.lessThanEqual(this.minLevel, i));
      this.$if(wanted, function () {
        this.$l.info = this[GLOBAL_SDF_LEVELS].at(i);
        // Position in voxels of the window, sample centres at integers
        this.$l.f = pb.sub(pb.div(this.p, this.info.w), pb.add(this.info.xyz, pb.vec3(0.5)));
        this.$l.inside = pb.and(
          pb.all(pb.greaterThanEqual(this.f, pb.vec3(0))),
          pb.all(pb.lessThanEqual(this.f, pb.vec3(pb.sub(this.resF, 1))))
        );
        this.valid = false;
        this.$if(this.inside, function () {
          this.$if(levelCurrent(this, i), function () {
            this.valid = true;
          }).$else(function () {
            // World voxel index of the filter's lower corner
            this.valid = bricksCurrent(this, pb.add(pb.ivec3(pb.floor(this.f)), pb.ivec3(this.info.xyz)), i);
          });
        });
        this.$if(this.valid, function () {
          if (filterable) {
            // World voxel position, sample centres at integers, wrapped into the window
            this.$l.vw = pb.add(this.f, this.info.xyz);
            this.vw = pb.sub(this.vw, pb.mul(pb.floor(pb.div(this.vw, this.resF)), this.resF));
            this.$l.depth = pb.add(this.resF, 1);
            this.$l.d = pb.textureSampleLevel(
              this[GLOBAL_SDF_TEXTURE],
              pb.vec3(
                pb.div(pb.add(this.vw.xy, pb.vec2(0.5)), this.resF),
                pb.div(pb.add(this.vw.z, pb.add(pb.mul(this.depth, i), 0.5)), pb.mul(this.depth, levels))
              ),
              0
            ).r;
          } else {
            this.base = pb.floor(this.f);
            this.t = pb.sub(this.f, this.base);
            // World voxel index of the lower corner, then toroidal texel
            this.v0 = pb.add(pb.ivec3(this.base), pb.ivec3(this.info.xyz));
            this.$l.c000 = loadWrapped(this, this.v0, 0, 0, 0, i);
            this.$l.c100 = loadWrapped(this, this.v0, 1, 0, 0, i);
            this.$l.c010 = loadWrapped(this, this.v0, 0, 1, 0, i);
            this.$l.c110 = loadWrapped(this, this.v0, 1, 1, 0, i);
            this.$l.c001 = loadWrapped(this, this.v0, 0, 0, 1, i);
            this.$l.c101 = loadWrapped(this, this.v0, 1, 0, 1, i);
            this.$l.c011 = loadWrapped(this, this.v0, 0, 1, 1, i);
            this.$l.c111 = loadWrapped(this, this.v0, 1, 1, 1, i);
            this.$l.d = pb.mix(
              pb.mix(
                pb.mix(this.c000, this.c100, this.t.x),
                pb.mix(this.c010, this.c110, this.t.x),
                this.t.y
              ),
              pb.mix(
                pb.mix(this.c001, this.c101, this.t.x),
                pb.mix(this.c011, this.c111, this.t.x),
                this.t.y
              ),
              this.t.z
            );
          }
          this.last = this.d;
          this.lastVoxel = this.info.w;
          if (i === levels - 1) {
            this.$l.w = pb.float(1);
          } else {
            // Hand over near the window edge and near the band edge (beyond which values are lower bounds)
            this.$l.lo = pb.min(pb.min(this.f.x, this.f.y), this.f.z);
            this.$l.hi = pb.sub(pb.sub(this.resF, 1), pb.max(pb.max(this.f.x, this.f.y), this.f.z));
            this.$l.edge = pb.min(this.lo, this.hi);
            this.$l.bandW = pb.mul(this.band, this.info.w);
            this.$l.w = pb.mul(
              pb.smoothStep(1, 1 + SDF_LEVEL_BLEND_VOXELS, this.edge),
              pb.sub(1, pb.smoothStep(pb.mul(this.bandW, 0.75), pb.mul(this.bandW, 0.95), pb.abs(this.d)))
            );
          }
          this.$l.share = pb.mul(this.remaining, this.w);
          this.sum = pb.add(this.sum, pb.mul(this.share, this.d));
          this.sumVoxel = pb.add(this.sumVoxel, pb.mul(this.share, this.info.w));
          this.remaining = pb.sub(this.remaining, this.share);
        });
      });
    }
    // What no level answered for: past the coarsest window, or every level saturated
    this.$l.result = pb.add(this.sum, pb.mul(this.remaining, this.last));
    this.$l.resultVoxel = pb.add(this.sumVoxel, pb.mul(this.remaining, this.lastVoxel));
    this.$return(pb.vec2(this.result, this.resultVoxel));
  });
  return scope[funcName](worldPos, minLevel ?? pb.int(0)) as PBShaderExp;
}

/**
 * Signed distance from one global clipmap level chosen at run time, with no blending or brick
 * currency check; for hit normals, as UE GlobalDistanceFieldPageCentralDiff.
 * @internal
 */
export function sampleGlobalSDFLevel(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  level: PBShaderExp,
  levels: number
) {
  const pb = scope.$builder;
  const filterable = isGlobalSDFFilterable();
  const funcName = 'Z_sampleGlobalSDFLevel';
  pb.func(funcName, [pb.vec3('p'), pb.int('level')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.resF = this[GLOBAL_SDF_PARAMS].x;
    this.$l.info = this[GLOBAL_SDF_LEVELS].at(this.level);
    // Position in voxels of the window, sample centres at integers
    this.$l.f = pb.sub(pb.div(this.p, this.info.w), pb.add(this.info.xyz, pb.vec3(0.5)));
    // Slice of the level's first z, `resolution + 1` slices a level
    this.$l.z0 = pb.mul(pb.add(this.res, 1), this.level);
    if (filterable) {
      this.$l.vw = pb.add(this.f, this.info.xyz);
      this.vw = pb.sub(this.vw, pb.mul(pb.floor(pb.div(this.vw, this.resF)), this.resF));
      this.$l.depth = pb.add(this.resF, 1);
      this.$return(
        pb.textureSampleLevel(
          this[GLOBAL_SDF_TEXTURE],
          pb.vec3(
            pb.div(pb.add(this.vw.xy, pb.vec2(0.5)), this.resF),
            pb.div(pb.add(this.vw.z, pb.add(pb.float(this.z0), 0.5)), pb.mul(this.depth, levels))
          ),
          0
        ).r
      );
    } else {
      this.$l.base = pb.floor(this.f);
      this.$l.t = pb.sub(this.f, this.base);
      this.$l.v0 = pb.add(pb.ivec3(this.base), pb.ivec3(this.info.xyz));
      const load = (dx: number, dy: number, dz: number) => {
        const v = pb.add(this.v0, pb.ivec3(dx, dy, dz));
        const w = wrap(this, v, pb.ivec3(this.res));
        return pb.textureLoad(this[GLOBAL_SDF_TEXTURE], pb.ivec3(w.x, w.y, pb.add(w.z, this.z0)), 0).r;
      };
      this.$return(
        pb.mix(
          pb.mix(
            pb.mix(load(0, 0, 0), load(1, 0, 0), this.t.x),
            pb.mix(load(0, 1, 0), load(1, 1, 0), this.t.x),
            this.t.y
          ),
          pb.mix(
            pb.mix(load(0, 0, 1), load(1, 0, 1), this.t.x),
            pb.mix(load(0, 1, 1), load(1, 1, 1), this.t.x),
            this.t.y
          ),
          this.t.z
        )
      );
    }
  });
  return scope[funcName](worldPos, level) as PBShaderExp;
}

/** ((v % n) + n) % n, the remainder of a negative index being negative */
function wrap(scope: PBInsideFunctionScope, v: PBShaderExp, n: PBShaderExp) {
  const pb = scope.$builder;
  return pb.mod(pb.add(pb.mod(v, n), n), n);
}

/**
 * True when the brick of a level holding world voxel `v` is tagged with its own
 * world brick coordinates, i.e. composited for the current window.
 * @internal
 */
export function globalSDFVoxelCurrent(scope: PBInsideFunctionScope, v: PBShaderExp, level: number) {
  const pb = scope.$builder;
  const funcName = `Z_globalSDFVoxelCurrent${level}`;
  pb.func(funcName, [pb.ivec3('v')], function () {
    this.$if(levelCurrent(this, level), function () {
      this.$return(true);
    });
    this.$l.nbi = pb.ivec3(pb.int(pb.div(this[GLOBAL_SDF_PARAMS].x, GLOBAL_SDF_BRICK)));
    this.$l.b = pb.ivec3(pb.floor(pb.div(pb.vec3(this.v), GLOBAL_SDF_BRICK)));
    this.$l.w = wrap(this, this.b, this.nbi);
    this.$l.tag = pb.textureLoad(
      this[GLOBAL_SDF_TAGS],
      pb.ivec3(this.w.x, this.w.y, pb.add(this.w.z, pb.mul(this.nbi.z, level))),
      0
    );
    this.$return(pb.and(pb.greaterThan(this.tag.w, 0.5), pb.equal(pb.ivec3(this.tag.xyz), this.b)));
  });
  return scope[funcName](v) as PBShaderExp;
}

/** True when every brick of a level is current, by the mask in the params' w. */
function levelCurrent(scope: PBInsideFunctionScope, level: number) {
  const pb = scope.$builder;
  return pb.notEqual(pb.compAnd(pb.uint(scope[GLOBAL_SDF_PARAMS].w), pb.uint(1 << level)), pb.uint(0));
}

/**
 * True when every brick covering voxels v0..v0+1 of a level is tagged current (one to eight bricks).
 */
function bricksCurrent(scope: PBInsideFunctionScope, v0: PBShaderExp, level: number) {
  const pb = scope.$builder;
  const funcName = `Z_globalSDFBricksCurrent${level}`;
  pb.func(funcName, [pb.ivec3('v0')], function () {
    this.$l.nb = pb.div(this[GLOBAL_SDF_PARAMS].x, GLOBAL_SDF_BRICK);
    this.$l.nbi = pb.ivec3(pb.int(this.nb));
    // Floor division of possibly negative voxel indices
    this.$l.lo = pb.ivec3(pb.floor(pb.div(pb.vec3(this.v0), GLOBAL_SDF_BRICK)));
    this.$l.hi = pb.ivec3(pb.floor(pb.div(pb.vec3(pb.add(this.v0, pb.ivec3(1))), GLOBAL_SDF_BRICK)));
    this.$l.ok = true;
    for (let c = 0; c < 8; c++) {
      const bits = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
      // A corner using the upper brick on an axis matters only where the footprint crosses into it
      const needs = ['x', 'y', 'z'].filter((_, a) => bits[a]).map((a) => pb.notEqual(this.lo[a], this.hi[a]));
      const body = function (this: PBInsideFunctionScope) {
        this.$l.b = pb.ivec3(
          bits[0] ? this.hi.x : this.lo.x,
          bits[1] ? this.hi.y : this.lo.y,
          bits[2] ? this.hi.z : this.lo.z
        );
        this.$l.w = wrap(this, this.b, this.nbi);
        this.$l.tag = pb.textureLoad(
          this[GLOBAL_SDF_TAGS],
          pb.ivec3(this.w.x, this.w.y, pb.add(this.w.z, pb.mul(this.nbi.z, level))),
          0
        );
        this.ok = pb.and(
          this.ok,
          pb.and(pb.greaterThan(this.tag.w, 0.5), pb.equal(pb.ivec3(this.tag.xyz), this.b))
        );
      };
      if (needs.length === 0) {
        body.call(this);
      } else {
        this.$if(
          needs.reduce((x, y) => pb.and(x, y)),
          body
        );
      }
    }
    this.$return(this.ok);
  });
  return scope[funcName](v0) as PBShaderExp;
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
    pb.ivec3(t.x, t.y, pb.add(t.z, pb.mul(pb.add(scope.res, 1), level))),
    0
  ).r;
}
