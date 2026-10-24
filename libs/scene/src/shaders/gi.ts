import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import {
  GLOBAL_SDF_LEVELS,
  GLOBAL_SDF_PARAMS,
  globalSDFVoxelCurrent,
  sampleGlobalSDF,
  sampleInstanceField
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

/**
 * Declares what {@link storeVoxelMaterial} writes to, in the fragment stage of
 * a voxelize pass program:
 *
 * - albedo: the material atlas, rgba8unorm storage; rgb the albedo, a = 1
 *   where a surface was rasterized, so a trilinear sample of it reads as
 *   premultiplied colour and coverage.
 * - emissive: the emissive atlas, rgba8unorm storage holding RGBE.
 * - params[0]: (field box min, voxel size), params[1]: (atlas slot offset, 0),
 *   params[2]: (voxels per axis of the slot, 0); all in the mesh's local space.
 *
 * Write-only storage textures are only valid in the fragment stage, so the
 * caller must declare these there alone.
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
 * Stores a fragment's material in the voxel of the atlas slot holding its
 * position, which is in the mesh's local space (the voxelize pass draws with an
 * identity world matrix). Fragments outside the slot's box are dropped.
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
 * Albedo and emissive of one packed instance at a local point, read from the
 * material atlases at the point's projection onto the mesh surface: the baked
 * field gives the distance and, by differences, the direction to the surface,
 * so a point a voxel or two off it still lands on the voxels the mesh was
 * rasterized into. Trilinear albedo reads as premultiplied colour and coverage
 * and is unpremultiplied; a read with no coverage, or an instance without a
 * material slot (`matSlot.w <= 0`), gives alpha 0.
 *
 * Declares `outAlbedo` (vec4, rgb and a = 1 where valid) and `outEmissive`
 * (vec3) as locals of the scope under the given names.
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
  outEmissive: string
) {
  const pb = scope.$builder;
  scope.$l[outAlbedo] = pb.vec4(0);
  scope.$l[outEmissive] = pb.vec3(0);
  scope.$if(pb.greaterThan(matSlot.w, 0), function () {
    // Unclamped: outside the field box the function adds the distance to
    // the box, so its differences still point at the mesh there; clamping
    // first would zero the gradient along every clamped axis. A few steps:
    // where several faces are equally near (inside a corner) the differenced
    // gradient is their blend and one step stops short of all of them
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
    // Material voxels are twice the field's; clamped to the outer sample centres.
    // The surface voxels are a one-voxel shell, so a landing half a voxel off
    // can read empty: of three samples along the normal, the best covered wins
    this.$l.gmA = pb.vec4(0);
    this.$l.gmUVW = pb.vec3(0);
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
      });
    }
    this.$if(pb.greaterThan(this.gmA.a, 0.02), function () {
      this[outAlbedo] = pb.vec4(pb.div(this.gmA.rgb, this.gmA.a), 1);
      // RGBE cannot be filtered: average the decoded texels the albedo's
      // trilinear filter covered, each by its filter weight and coverage, so
      // an empty neighbour never reads as black
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
 * Declares the voxel scene's clipmaps, which share the layout of the global
 * SDF (levels stacked along z, toroidal windows, the same bricks and tags) at
 * half its resolution:
 *
 * - albedo: rgba8unorm, rgb the albedo and a = 1 where a surface is.
 * - emissive: rgba16float, emitted radiance.
 * - radiance: rgba16float, outgoing radiance (lit albedo plus emissive).
 *
 * Needs the global SDF uniforms declared as well ({@link declareGlobalSDFUniforms}).
 * @internal
 */
export function declareVoxelSceneUniforms(scope: PBGlobalScope, group: number) {
  const pb = scope.$builder;
  scope[VOXEL_SCENE_ALBEDO] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_EMISSIVE] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
  scope[VOXEL_SCENE_RADIANCE] = pb.tex3D().sampleType('unfilterable-float').uniform(group);
}

/**
 * Outgoing radiance at a texel of {@link voxelSceneTexel}; zero for level -1.
 * @internal
 */
export function loadVoxelSceneRadiance(scope: PBInsideFunctionScope, texel: PBShaderExp) {
  const pb = scope.$builder;
  const funcName = 'Z_loadVoxelSceneRadiance';
  pb.func(funcName, [pb.ivec4('t')], function () {
    this.$if(pb.lessThan(this.t.w, 0), function () {
      this.$return(pb.vec3(0));
    });
    this.$return(pb.textureLoad(this[VOXEL_SCENE_RADIANCE], this.t.xyz, 0).rgb);
  });
  return scope[funcName](texel) as PBShaderExp;
}

/**
 * Visibility of a distant light from a point through the global field, by
 * cone tracing along the light direction: at each step the ray's distance to
 * the nearest surface over the cone's width there bounds the unoccluded
 * fraction, and the smallest bound along the ray is the shadow. Wright,
 * "Dynamic Occlusion with Signed Distance Fields", SIGGRAPH 2015 Advances.
 *
 * `start` should already be offset off the surface. `tanHalfAngle` sets the
 * softness, `minStep` keeps the march from stalling in the field's band,
 * `maxDistance` ends it. Static geometry only (the clipmap).
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
  steps = 24
) {
  const pb = scope.$builder;
  const funcName = 'Z_sdfConeShadow';
  pb.func(
    funcName,
    [pb.vec3('start'), pb.vec3('dir'), pb.float('tanHalf'), pb.float('minStep'), pb.float('maxDist')],
    function () {
      this.$l.shadow = pb.float(1);
      this.$l.t = this.minStep;
      this.$for(pb.int('i'), 0, steps, function () {
        this.$l.d = sampleGlobalSDF(this, pb.add(this.start, pb.mul(this.dir, this.t)), levels);
        this.shadow = pb.min(this.shadow, pb.clamp(pb.div(this.d, pb.mul(this.t, this.tanHalf)), 0, 1));
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
  return scope[funcName](start, dir, tanHalfAngle, minStep, maxDistance) as PBShaderExp;
}

/**
 * Texel of the material clipmaps holding a world position: (x, y, z, level),
 * level -1 when no level's window holds it with a current brick. The finest
 * such level answers.
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
