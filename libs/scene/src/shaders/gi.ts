import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import {
  GLOBAL_SDF_LEVELS,
  GLOBAL_SDF_PARAMS,
  globalSDFVoxelCurrent,
  sampleGlobalSDFHinted,
  sampleInstanceField,
  sdfSurfaceExpand,
  SDF_LEVEL_BLEND_VOXELS
} from './sdf';

/**
 * Uniform names of the voxelize pass, see {@link declareVoxelizeUniforms}.
 * @internal
 */
export const VOXELIZE_ALBEDO = 'zVoxelizeAlbedo';
/** @internal */
export const VOXELIZE_EMISSIVE = 'zVoxelizeEmissive';
/** @internal */
export const VOXELIZE_PARAMS = 'zVoxelizeParams';

/**
 * Uniform names of the voxel scene (material clipmaps), see
 * {@link declareVoxelSceneUniforms}.
 * @internal
 */
export const VOXEL_SCENE_ALBEDO = 'zVoxelSceneAlbedo';
/** @internal */
export const VOXEL_SCENE_EMISSIVE = 'zVoxelSceneEmissive';
/** @internal */
export const VOXEL_SCENE_RADIANCE = 'zVoxelSceneRadiance';
/** @internal */
export const VOXEL_SCENE_ANISO0 = 'zVoxelSceneAniso0';
/** @internal */
export const VOXEL_SCENE_ANISO1 = 'zVoxelSceneAniso1';

/**
 * Declares the voxelize pass targets of {@link storeVoxelMaterial}; fragment stage only
 * (write-only storage textures).
 *
 * - albedo: rgba8unorm storage, rgb albedo, a = 1 where rasterized (trilinear reads as
 *   premultiplied colour and coverage).
 * - emissive: rgba8unorm storage holding RGBE.
 * - params[0]: (field box min, voxel size), params[1]: (atlas slot offset, 0),
 *   params[2]: (voxels per axis of the slot, 0); all in mesh local space.
 * @internal
 */
export function declareVoxelizeUniforms(scope: PBGlobalScope, group: number) {
  const pb = scope.$builder;
  scope[VOXELIZE_ALBEDO] = pb.texStorage3D.rgba8unorm().storage(group);
  scope[VOXELIZE_EMISSIVE] = pb.texStorage3D.rgba8unorm().storage(group);
  scope[VOXELIZE_PARAMS] = pb.vec4[3]().uniform(group);
}

/**
 * Packs an HDR colour as RGBE into four unorm8 channels: the mantissas scaled
 * so the largest lies in (0.5, 1], the shared exponent biased by 128 in alpha.
 * Zero for black.
 * @internal
 */
export function encodeRGBE(scope: PBInsideFunctionScope, color: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_encodeRGBE';
  pb.func(funcName, [pb.vec3('c')], function () {
    this.$l.m = pb.max(pb.max(this.c.r, this.c.g), this.c.b);
    this.$if(pb.lessThanEqual(this.m, 1e-6), function () {
      this.$return(pb.vec4(0));
    });
    this.$l.e = pb.clamp(pb.ceil(pb.log2(this.m)), -127, 127);
    this.$return(pb.vec4(pb.div(this.c, pb.exp2(this.e)), pb.div(pb.add(this.e, 128), 255)));
  });
  return scope[funcName](color) as PBShaderExp;
}

/**
 * Unpacks what {@link encodeRGBE} packed.
 * @internal
 */
export function decodeRGBE(scope: PBInsideFunctionScope, value: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_decodeRGBE';
  pb.func(funcName, [pb.vec4('v')], function () {
    this.$if(pb.lessThanEqual(this.v.a, 0), function () {
      this.$return(pb.vec3(0));
    });
    this.$return(pb.mul(this.v.rgb, pb.exp2(pb.sub(pb.mul(this.v.a, 255), 128))));
  });
  return scope[funcName](value) as PBShaderExp;
}

/**
 * Stores a fragment's material in the atlas slot voxel holding its mesh-local position
 * (the voxelize pass draws with an identity world matrix); fragments outside the box are dropped.
 * @internal
 */
export function storeVoxelMaterial(
  scope: PBInsideFunctionScope,
  localPos: PBShaderExp,
  albedo: PBShaderExp,
  emissive: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_storeVoxelMaterial';
  pb.func(funcName, [pb.vec3('pos'), pb.vec3('albedo'), pb.vec3('emissive')], function () {
    this.$l.p0 = this[VOXELIZE_PARAMS].at(0);
    this.$l.p1 = this[VOXELIZE_PARAMS].at(1);
    this.$l.p2 = this[VOXELIZE_PARAMS].at(2);
    this.$l.v = pb.floor(pb.div(pb.sub(this.pos, this.p0.xyz), this.p0.w));
    this.$if(
      pb.and(pb.all(pb.greaterThanEqual(this.v, pb.vec3(0))), pb.all(pb.lessThan(this.v, this.p2.xyz))),
      function () {
        this.$l.t = pb.uvec3(pb.add(this.p1.xyz, this.v));
        pb.textureStore(this[VOXELIZE_ALBEDO], this.t, pb.vec4(this.albedo, 1));
        pb.textureStore(this[VOXELIZE_EMISSIVE], this.t, encodeRGBE(this, this.emissive));
      }
    );
  });
  scope[funcName](localPos, albedo, emissive);
}

/**
 * Albedo and emissive of one packed instance at a local point, read from the material
 * atlases after projecting the point onto the surface along the baked field's gradient.
 * No coverage, or no material slot (`matSlot.w <= 0`), gives alpha 0.
 *
 * `footprint`, when given, is the edge in local units of the region the result stands for:
 * where it spans more than two of the instance's material voxels, the albedo is the
 * coverage-weighted mean of a 4x4 grid over that edge in the surface's tangent plane, so
 * a coarse voxel gets the surface's average colour rather than whatever pattern lies under
 * its centre (the box-filtered footprint a mip would give). Emissive stays a point read.
 *
 * Declares locals `outAlbedo` (vec4, a = 1 where valid) and `outEmissive` (vec3).
 * @internal
 */
export function sampleInstanceMaterial(
  scope: PBInsideFunctionScope,
  lp: PBShaderExp,
  bmin: PBShaderExp,
  bmax: PBShaderExp,
  slot: PBShaderExp,
  matSlot: PBShaderExp,
  matRes: PBShaderExp,
  sdfAtlas: PBShaderExp,
  sdfAtlasInvSize: PBShaderExp,
  matAlbedo: PBShaderExp,
  matEmissive: PBShaderExp,
  matAtlasInvSize: PBShaderExp,
  outAlbedo: string,
  outEmissive: string,
  footprint?: PBShaderExp
) {
  const pb = scope.$builder;
  scope.$l[outAlbedo] = pb.vec4(0);
  scope.$l[outEmissive] = pb.vec3(0);
  scope.$if(pb.greaterThan(matSlot.w, 0), function () {
    // Unclamped so the gradient stays valid outside the field box; several steps
    // because in corners the differenced gradient blends faces and one step falls short
    this.$l.gmH = bmin.w;
    this.$l.gmS = lp;
    this.$l.gmN = pb.vec3(0, 1, 0);
    this.$for(pb.int('gmIt'), 0, 3, function () {
      this.$l.gmD = sampleInstanceField(this, this.gmS, bmin, bmax, slot, sdfAtlas, sdfAtlasInvSize);
      this.$l.gmG = pb.vec3(
        pb.sub(
          sampleInstanceField(
            this,
            pb.add(this.gmS, pb.vec3(this.gmH, 0, 0)),
            bmin,
            bmax,
            slot,
            sdfAtlas,
            sdfAtlasInvSize
          ),
          this.gmD
        ),
        pb.sub(
          sampleInstanceField(
            this,
            pb.add(this.gmS, pb.vec3(0, this.gmH, 0)),
            bmin,
            bmax,
            slot,
            sdfAtlas,
            sdfAtlasInvSize
          ),
          this.gmD
        ),
        pb.sub(
          sampleInstanceField(
            this,
            pb.add(this.gmS, pb.vec3(0, 0, this.gmH)),
            bmin,
            bmax,
            slot,
            sdfAtlas,
            sdfAtlasInvSize
          ),
          this.gmD
        )
      );
      this.gmN = pb.div(this.gmG, pb.max(pb.length(this.gmG), 1e-6));
      this.gmS = pb.sub(this.gmS, pb.mul(this.gmN, this.gmD));
    });
    // Material voxels are twice the field's. The surface is a one-voxel shell, so take
    // the best covered of three samples along the normal
    this.$l.gmA = pb.vec4(0);
    this.$l.gmUVW = pb.vec3(0);
    this.$l.gmK = pb.float(0);
    for (const [k, tag] of [
      [0, 'On'],
      [-0.5, 'In'],
      [0.5, 'Out']
    ] as [number, string][]) {
      this.$l[`gmF${tag}`] = pb.clamp(
        pb.div(pb.sub(pb.add(this.gmS, pb.mul(this.gmN, this.gmH, 2 * k)), bmin.xyz), pb.mul(this.gmH, 2)),
        pb.vec3(0.5),
        pb.sub(matRes.xyz, pb.vec3(0.5))
      );
      this.$l[`gmUVW${tag}`] = pb.mul(pb.add(matSlot.xyz, this[`gmF${tag}`]), matAtlasInvSize);
      this.$l[`gmA${tag}`] = pb.textureSampleLevel(matAlbedo, this[`gmUVW${tag}`], 0);
      this.$if(pb.greaterThan(this[`gmA${tag}`].a, this.gmA.a), function () {
        this.gmA = this[`gmA${tag}`];
        this.gmUVW = this[`gmUVW${tag}`];
        this.gmK = pb.float(k);
      });
    }
    if (footprint) {
      // Box filter over the footprint on the chosen shell: rgb is coverage-premultiplied
      // (empty voxels are 0), so the sums' ratio is the coverage-weighted mean
      this.$if(
        pb.and(pb.greaterThan(this.gmA.a, 0.02), pb.greaterThan(footprint, pb.mul(this.gmH, 4))),
        function () {
          this.$l.gmUp = this.$choice(
            pb.lessThan(pb.abs(this.gmN.y), 0.9),
            pb.vec3(0, 1, 0),
            pb.vec3(1, 0, 0)
          );
          this.$l.gmT1 = pb.normalize(pb.cross(this.gmN, this.gmUp));
          this.$l.gmT2 = pb.cross(this.gmN, this.gmT1);
          this.$l.gmC = pb.add(this.gmS, pb.mul(this.gmN, this.gmH, pb.mul(this.gmK, 2)));
          this.$l.gmSum = pb.vec4(0);
          this.$for(pb.int('gmI'), 0, 4, function () {
            this.$for(pb.int('gmJ'), 0, 4, function () {
              this.$l.gmQ = pb.add(
                this.gmC,
                pb.mul(this.gmT1, pb.mul(pb.sub(pb.div(pb.add(pb.float(this.gmI), 0.5), 4), 0.5), footprint)),
                pb.mul(this.gmT2, pb.mul(pb.sub(pb.div(pb.add(pb.float(this.gmJ), 0.5), 4), 0.5), footprint))
              );
              this.$l.gmQF = pb.div(pb.sub(this.gmQ, bmin.xyz), pb.mul(this.gmH, 2));
              // Taps past the instance's box read nothing rather than its clamped border
              this.$if(
                pb.and(
                  pb.all(pb.greaterThanEqual(this.gmQF, pb.vec3(0))),
                  pb.all(pb.lessThanEqual(this.gmQF, matRes.xyz))
                ),
                function () {
                  this.gmSum = pb.add(
                    this.gmSum,
                    pb.textureSampleLevel(
                      matAlbedo,
                      pb.mul(
                        pb.add(
                          matSlot.xyz,
                          pb.clamp(this.gmQF, pb.vec3(0.5), pb.sub(matRes.xyz, pb.vec3(0.5)))
                        ),
                        matAtlasInvSize
                      ),
                      0
                    )
                  );
                }
              );
            });
          });
          this.$if(pb.greaterThan(this.gmSum.a, 0.02), function () {
            this.gmA = pb.vec4(this.gmSum.rgb, this.gmSum.a);
          });
        }
      );
    }
    this.$if(pb.greaterThan(this.gmA.a, 0.02), function () {
      this[outAlbedo] = pb.vec4(pb.div(this.gmA.rgb, this.gmA.a), 1);
      // RGBE cannot be filtered: manual trilinear over decoded texels, weighted by coverage
      this.$l.gmSize = pb.div(pb.vec3(1), matAtlasInvSize);
      this.$l.gmTc = pb.sub(pb.mul(this.gmUVW, this.gmSize), pb.vec3(0.5));
      this.$l.gmBase = pb.ivec3(pb.floor(this.gmTc));
      this.$l.gmFr = pb.sub(this.gmTc, pb.floor(this.gmTc));
      this.$l.gmEsum = pb.vec3(0);
      this.$l.gmWsum = pb.float(0);
      for (let k = 0; k < 8; k++) {
        const off = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
        this.$l[`gmT${k}`] = pb.add(this.gmBase, pb.ivec3(off[0], off[1], off[2]));
        this.$l[`gmW${k}`] = pb.mul(
          off[0] ? this.gmFr.x : pb.sub(1, this.gmFr.x),
          off[1] ? this.gmFr.y : pb.sub(1, this.gmFr.y),
          off[2] ? this.gmFr.z : pb.sub(1, this.gmFr.z),
          pb.textureLoad(matAlbedo, this[`gmT${k}`], 0).a
        );
        this.gmEsum = pb.add(
          this.gmEsum,
          pb.mul(decodeRGBE(this, pb.textureLoad(matEmissive, this[`gmT${k}`], 0)), this[`gmW${k}`])
        );
        this.gmWsum = pb.add(this.gmWsum, this[`gmW${k}`]);
      }
      this[outEmissive] = pb.div(this.gmEsum, pb.max(this.gmWsum, 1e-4));
    });
  });
}

/**
 * Declares the voxel scene clipmaps; same layout as the global SDF (levels stacked along z,
 * toroidal windows, same bricks) at half resolution. Requires {@link declareGlobalSDFUniforms}.
 *
 * - albedo: rgba8unorm, rgb albedo, a = 1 where a surface is.
 * - emissive: rgba16float, emitted radiance.
 * - radiance: rgba16float, outgoing radiance summed over the six axis faces.
 * - aniso0, aniso1: rgba8unorm (aniso1 rg8unorm with texture-formats-tier1), per-face share
 *   of that sum by luminance: (+x, +y, +z, -x) and (-y, -z) in rg.
 * @internal
 */
export function declareVoxelSceneUniforms(scope: PBGlobalScope, group: number) {
  const pb = scope.$builder;
  scope[VOXEL_SCENE_ALBEDO] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_EMISSIVE] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_RADIANCE] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_ANISO0] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_ANISO1] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
}

/**
 * Outgoing radiance at a texel of {@link voxelSceneTexel} toward `normal`, weighted by the
 * per-face anisotropy shares. Zero for level -1.
 * @internal
 */
export function loadVoxelSceneRadiance(
  scope: PBInsideFunctionScope,
  texel: PBShaderExp,
  normal: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_loadVoxelSceneRadiance';
  pb.func(funcName, [pb.ivec4('t'), pb.vec3('n')], function () {
    this.$if(pb.lessThan(this.t.w, 0), function () {
      this.$return(pb.vec3(0));
    });
    this.$l.total = pb.textureLoad(this[VOXEL_SCENE_RADIANCE], this.t.xyz, 0).rgb;
    this.$l.a0 = pb.textureLoad(this[VOXEL_SCENE_ANISO0], this.t.xyz, 0);
    this.$l.a1 = pb.textureLoad(this[VOXEL_SCENE_ANISO1], this.t.xyz, 0);
    this.$l.pos = pb.max(pb.vec3(0), pb.mul(this.n, this.a0.xyz));
    this.$l.neg = pb.max(pb.vec3(0), pb.mul(pb.neg(this.n), pb.vec3(this.a0.w, this.a1.x, this.a1.y)));
    this.$return(pb.mul(this.total, pb.add(pb.dot(this.pos, pb.vec3(1)), pb.dot(this.neg, pb.vec3(1)))));
  });
  return scope[funcName](texel, normal) as PBShaderExp;
}

/**
 * Distant-light visibility by SDF cone tracing through the global field (Wright,
 * "Dynamic Occlusion with Signed Distance Fields", SIGGRAPH 2015).
 *
 * `start` should already be offset off the surface; `tanHalfAngle` sets softness, `minStep`
 * prevents stalling, `maxDistance` ends the march. Levels finer than `minLevel` are skipped.
 * Static geometry only.
 * @internal
 */
export function sdfConeShadow(
  scope: PBInsideFunctionScope,
  start: PBShaderExp,
  dir: PBShaderExp,
  tanHalfAngle: PBShaderExp,
  minStep: PBShaderExp,
  maxDistance: PBShaderExp,
  levels: number,
  steps = 24,
  minLevel?: PBShaderExp
) {
  const pb = scope.$builder;
  const funcName = 'Z_sdfConeShadow';
  pb.func(
    funcName,
    [
      pb.vec3('start'),
      pb.vec3('dir'),
      pb.float('tanHalf'),
      pb.float('minStep'),
      pb.float('maxDist'),
      pb.int('minLevel')
    ],
    function () {
      this.$l.shadow = pb.float(1);
      this.$l.t = this.minStep;
      this.$l.prevD = pb.float(0);
      this.$for(pb.int('i'), 0, steps, function () {
        this.$l.sp = pb.add(this.start, pb.mul(this.dir, this.t));
        this.$l.s = sampleGlobalSDFHinted(this, this.sp, this.prevD, levels, this.minLevel);
        this.$l.d = this.s.x;
        this.prevD = this.d;
        this.$l.expand = sdfSurfaceExpand(this, this.sp, this.s, pb.sub(this.t, this.minStep), levels);
        this.shadow = pb.min(
          this.shadow,
          pb.clamp(pb.div(pb.sub(this.d, this.expand), pb.mul(this.t, this.tanHalf)), 0, 1)
        );
        this.$if(pb.lessThan(this.shadow, 0.01), function () {
          this.$break();
        });
        this.t = pb.add(this.t, pb.clamp(this.d, this.minStep, pb.mul(this.minStep, 16)));
        this.$if(pb.greaterThan(this.t, this.maxDist), function () {
          this.$break();
        });
      });
      this.$return(this.shadow);
    }
  );
  return scope[funcName](
    start,
    dir,
    tanHalfAngle,
    minStep,
    maxDistance,
    minLevel ?? pb.int(0)
  ) as PBShaderExp;
}

/**
 * Texel (x, y, z, level) of the finest material clipmap level holding a world position with a
 * current brick; level -1 when none does.
 * @internal
 */
export function voxelSceneTexel(scope: PBInsideFunctionScope, worldPos: PBShaderExp, levels: number) {
  const pb = scope.$builder;
  const funcName = 'Z_voxelSceneTexel';
  pb.func(funcName, [pb.vec3('p')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.half = pb.div(this.res, 2);
    this.$l.halfV = pb.ivec3(this.half);
    this.$l.result = pb.ivec4(0, 0, 0, -1);
    for (let i = levels - 1; i >= 0; i--) {
      this.$l[`info${i}`] = this[GLOBAL_SDF_LEVELS].at(i);
      this.$l[`vf${i}`] = pb.ivec3(pb.floor(pb.div(this.p, this[`info${i}`].w)));
      this.$l[`o${i}`] = pb.ivec3(this[`info${i}`].xyz);
      this.$l[`in${i}`] = pb.and(
        pb.all(pb.greaterThanEqual(this[`vf${i}`], this[`o${i}`])),
        pb.all(pb.lessThan(this[`vf${i}`], pb.add(this[`o${i}`], pb.ivec3(this.res))))
      );
      this.$if(this[`in${i}`], function () {
        this.$if(globalSDFVoxelCurrent(this, this[`vf${i}`], i), function () {
          this.$l.vc = pb.ivec3(pb.floor(pb.div(pb.vec3(this[`vf${i}`]), 2)));
          this.$l.t = pb.mod(pb.add(pb.mod(this.vc, this.halfV), this.halfV), this.halfV);
          this.result = pb.ivec4(this.t.x, this.t.y, pb.add(this.t.z, pb.mul(this.half, i)), i);
        });
      });
    }
    this.$return(this.result);
  });
  return scope[funcName](worldPos) as PBShaderExp;
}

/**
 * Voxel scene radiance at a world position toward `normal` (see {@link loadVoxelSceneRadiance}),
 * blended across levels like {@link sampleGlobalSDF} within {@link SDF_LEVEL_BLEND_VOXELS} of a
 * window edge. Zero where no level holds the point with a current brick.
 * @internal
 */
export function sampleVoxelSceneRadiance(
  scope: PBInsideFunctionScope,
  worldPos: PBShaderExp,
  normal: PBShaderExp,
  levels: number
) {
  const pb = scope.$builder;
  const funcName = 'Z_sampleVoxelSceneRadiance';
  pb.func(funcName, [pb.vec3('p'), pb.vec3('n')], function () {
    this.$l.res = pb.int(this[GLOBAL_SDF_PARAMS].x);
    this.$l.resF = this[GLOBAL_SDF_PARAMS].x;
    this.$l.half = pb.div(this.res, 2);
    this.$l.halfV = pb.ivec3(this.half);
    this.$l.sum = pb.vec3(0);
    this.$l.remaining = pb.float(1);
    for (let i = 0; i < levels; i++) {
      // Finest first, each level taking the share its finer levels left
      this.$if(pb.greaterThan(this.remaining, 1e-4), function () {
        this.$l.info = this[GLOBAL_SDF_LEVELS].at(i);
        this.$l.vf = pb.ivec3(pb.floor(pb.div(this.p, this.info.w)));
        this.$l.o = pb.ivec3(this.info.xyz);
        this.$l.inside = pb.and(
          pb.all(pb.greaterThanEqual(this.vf, this.o)),
          pb.all(pb.lessThan(this.vf, pb.add(this.o, pb.ivec3(this.res))))
        );
        this.$if(this.inside, function () {
          this.$if(globalSDFVoxelCurrent(this, this.vf, i), function () {
            this.$l.vc = pb.ivec3(pb.floor(pb.div(pb.vec3(this.vf), 2)));
            this.$l.t = pb.mod(pb.add(pb.mod(this.vc, this.halfV), this.halfV), this.halfV);
            this.$l.rad = loadVoxelSceneRadiance(
              this,
              pb.ivec4(this.t.x, this.t.y, pb.add(this.t.z, pb.mul(this.half, i)), i),
              this.n
            );
            if (i === levels - 1) {
              this.$l.w = pb.float(1);
            } else {
              // Field voxels to the window edge, sample centres at integers
              this.$l.f = pb.sub(pb.div(this.p, this.info.w), pb.add(this.info.xyz, pb.vec3(0.5)));
              this.$l.lo = pb.min(pb.min(this.f.x, this.f.y), this.f.z);
              this.$l.hi = pb.sub(pb.sub(this.resF, 1), pb.max(pb.max(this.f.x, this.f.y), this.f.z));
              this.$l.w = pb.smoothStep(1, 1 + SDF_LEVEL_BLEND_VOXELS, pb.min(this.lo, this.hi));
            }
            this.$l.share = pb.mul(this.remaining, this.w);
            this.sum = pb.add(this.sum, pb.mul(this.rad, this.share));
            this.remaining = pb.sub(this.remaining, this.share);
          });
        });
      });
    }
    this.$return(this.sum);
  });
  return scope[funcName](worldPos, normal) as PBShaderExp;
}

/**
 * Albedo (rgb) and presence (a) at a texel of {@link voxelSceneTexel}; zero
 * for level -1.
 * @internal
 */
export function loadVoxelSceneAlbedo(scope: PBInsideFunctionScope, texel: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_loadVoxelSceneAlbedo';
  pb.func(funcName, [pb.ivec4('t')], function () {
    this.$if(pb.lessThan(this.t.w, 0), function () {
      this.$return(pb.vec4(0));
    });
    this.$return(pb.textureLoad(this[VOXEL_SCENE_ALBEDO], this.t.xyz, 0));
  });
  return scope[funcName](texel) as PBShaderExp;
}

/**
 * Emitted radiance at a texel of {@link voxelSceneTexel}; zero for level -1.
 * @internal
 */
export function loadVoxelSceneEmissive(scope: PBInsideFunctionScope, texel: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_loadVoxelSceneEmissive';
  pb.func(funcName, [pb.ivec4('t')], function () {
    this.$if(pb.lessThan(this.t.w, 0), function () {
      this.$return(pb.vec3(0));
    });
    this.$return(pb.textureLoad(this[VOXEL_SCENE_EMISSIVE], this.t.xyz, 0).rgb);
  });
  return scope[funcName](texel) as PBShaderExp;
}
