import {
  DEPTH_FARTHEST,
  DEPTH_REDUCE_CLOSER,
  DEPTH_REDUCE_FARTHER,
  REVERSE_Z,
  Vector2,
  Vector3,
  Vector4
} from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import type { DrawContext } from '../../render/drawable';
import {
  MaterialVaryingFlags,
  MAX_SKIN_EXTRA_INFLUENCE_PAIRS,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_POSITION,
  MORPH_TARGET_TANGENT,
  MORPH_WEIGHTS_VECTOR_COUNT,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP,
  LIGHT_TYPE_DIRECTIONAL
} from '../../values';
import type {
  AbstractDevice,
  BindGroup,
  PBShaderExp,
  PBInsideFunctionScope,
  StructuredBuffer,
  Texture2D,
  Texture2DArray,
  PBGlobalScope,
  BindGroupLayout
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { PunctualLight } from '../../scene/light';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../../shaders/misc';
import { fetchSampler, getSamplerOptions } from '../../utility/misc';
import { PHYSICAL_BAKE_EXPOSURE } from '../../utility/physical';
import type { AtmosphereParams } from '../../shaders';
import { getAtmosphereParamsStruct, getDefaultAtmosphereParams } from '../../shaders';
import type { HeightFogParams } from '../../shaders/fog';
import { calculateFog, getDefaultHeightFogParams, getHeightFogParamsStruct } from '../../shaders/fog';
import { getDevice } from '../../app/api';
import type { Camera } from '../../camera';
import type { ShadowMapPass } from '../../render/shadowmap_pass';
import { getShadowReceiverBiasFactor, getShadowReceiverNoL } from '../../shadow/receiver_bias';

const UNIFORM_NAME_LIGHT_BUFFER = 'Z_UniformLightBuffer';
const UNIFORM_NAME_LIGHT_INDEX_TEXTURE = 'Z_UniformLightIndexTex';
const UNIFORM_NAME_BAKED_SKY_MAP = 'Z_UniformBakedSky';
const UNIFORM_NAME_AERIALPERSPECTIVE_LUT = 'Z_UniformAerialPerspectiveLUT';
const UNIFORM_NAME_SKYDISTANTLIGHT_LUT = 'Z_UniformSkyDistantLightLUT';
const UNIFORM_NAME_SHADOW_MAP = 'Z_UniformShadowMap';
const UNIFORM_NAME_SHADOW_MASK = 'Z_UniformShadowMask';
const UNIFORM_NAME_SHADOW_MASK_MODE = 'Z_UniformShadowMaskMode';
const UNIFORM_NAME_LINEAR_DEPTH_MAP = 'Z_UniformLinearDepth';
const UNIFORM_NAME_LINEAR_DEPTH_MAP_SIZE = 'Z_UniformLinearDepthSize';
const UNIFORM_NAME_SCENE_COLOR_MAP = 'Z_UniformSceneColor';
const UNIFORM_NAME_SCENE_COLOR_MAP_SIZE = 'Z_UniformSceneColorSize';
const UNIFORM_NAME_HIZ_DEPTH_MAP = 'Z_UniformHiZDepth';
const UNIFORM_NAME_HIZ_DEPTH_MAP_INFO = 'Z_UniformHiZDepthInfo';
const UNIFORM_NAME_OBJECT_COLOR = 'Z_ObjectColor';
const UNIFORM_NAME_WORLD_MATRIX = 'Z_UniformWorldMatrix';
const UNIFORM_NAME_PREV_WORLD_MATRIX = 'Z_UniformPrevWorldMatrix';
const UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME = 'Z_UniformPrevWorldMatrixFrame';
const UNIFORM_NAME_INSTANCE_DATA_STRIDE = 'Z_UniformInstanceDataStride';
const UNIFORM_NAME_INSTANCE_DATA = 'Z_UniformInstanceData';
const UNIFORM_NAME_INSTANCE_DATA_OFFSET = 'Z_UniformInstanceDataOffset';
const UNIFORM_NAME_BONE_MATRICES = 'Z_UniformBoneMatrices';
const UNIFORM_NAME_BONE_TEXTURE_SIZE = 'Z_UniformBoneTexSize';
const UNIFORM_NAME_BONE_INV_BIND_MATRIX = 'Z_UniformBoneInvBindMatrix';
const UNIFORM_NAME_SKIN_INFLUENCE_DATA = 'Z_UniformSkinInfluenceData';
const UNIFORM_NAME_SKIN_INFLUENCE_INFO = 'Z_UniformSkinInfluenceInfo';
const UNIFORM_NAME_MORPH_DATA = 'Z_UniformMorphData';
const UNIFORM_NAME_MORPH_INFO = 'Z_UniformMorphInfo';

/**
 * Helper shader functions for the builtin material system
 * @public
 */
export class ShaderHelper {
  static readonly BILLBOARD_SPHERICAL = 1;
  static readonly BILLBOARD_SYLINDRAL = 2;
  static readonly MATERIAL_INSTANCE_DATA_OFFSET = 9;
  /** @internal */
  static defaultSunDir = Vector3.one().inplaceNormalize();
  /** @internal 1x1x1 fallback bound to the shadow-mask uniform when no mask exists this frame. */
  private static _dummyShadowMask: Nullable<Texture2DArray> = null;
  /** @internal */
  private static readonly SKIN_MATRIX_NAME = 'Z_SkinMatrix';
  private static readonly SKIN_PREV_MATRIX_NAME = 'Z_PrevSkinMatrix';
  private static readonly SKIN_BONE_OFFSET = 'Z_boneOffset';
  private static readonly RESOLVED_VERTEX_NORMAL_NAME = 'Z_ResolvedVertexNormal';
  /** @internal */
  private static _drawableBindGroupLayouts: Record<string, BindGroupLayout> = {};
  /** @internal */
  private static readonly _lightUniformShadow = {
    sunDir: new Vector3(),
    shadowCascades: 1,
    positionAndRange: new Vector4(),
    directionAndCutoff: new Vector4(),
    diffuseAndIntensity: new Vector4(),
    extraParams: new Vector4(),
    cascadeDistances: new Vector4(),
    depthBiasValues: new Vector4(),
    shadowCameraParams: new Vector4(),
    depthBiasScales: new Vector4(),
    implParams: new Vector4(),
    shadowMatrices: new Float32Array(16 * 4),
    shadowStrength: 1,
    envLightStrength: 1,
    envLightSpecularStrength: 1
  };
  /** @internal */
  private static readonly _fogUniforms = {
    withAerialPerspective: 0,
    fogType: 0,
    additive: 0,
    atmosphereParams: getDefaultAtmosphereParams(),
    heightFogParams: getDefaultHeightFogParams()
  };
  static getObjectColorUniformName() {
    return UNIFORM_NAME_OBJECT_COLOR;
  }
  static getWorldMatrixUniformName() {
    return UNIFORM_NAME_WORLD_MATRIX;
  }
  static getPrevWorldMatrixUniformName() {
    return UNIFORM_NAME_PREV_WORLD_MATRIX;
  }
  static getPrevWorldMatrixFrameUniformName() {
    return UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME;
  }
  static getInstanceDataUniformName() {
    return UNIFORM_NAME_INSTANCE_DATA;
  }
  static getInstanceDataOffsetUniformName() {
    return UNIFORM_NAME_INSTANCE_DATA_OFFSET;
  }
  static getInstanceDataStrideUniformName() {
    return UNIFORM_NAME_INSTANCE_DATA_STRIDE;
  }
  static getBoneMatricesUniformName() {
    return UNIFORM_NAME_BONE_MATRICES;
  }
  static getBoneTextureSizeUniformName() {
    return UNIFORM_NAME_BONE_TEXTURE_SIZE;
  }
  static getBoneInvBindMatrixUniformName() {
    return UNIFORM_NAME_BONE_INV_BIND_MATRIX;
  }
  static getSkinInfluenceDataUniformName() {
    return UNIFORM_NAME_SKIN_INFLUENCE_DATA;
  }
  static getSkinInfluenceInfoUniformName() {
    return UNIFORM_NAME_SKIN_INFLUENCE_INFO;
  }
  static getMorphDataUniformName() {
    return UNIFORM_NAME_MORPH_DATA;
  }
  static getMorphInfoUniformName() {
    return UNIFORM_NAME_MORPH_INFO;
  }
  static getLightBufferUniformName() {
    return UNIFORM_NAME_LIGHT_BUFFER;
  }
  static getDrawableBindGroupLayout(skinning: boolean, morphing: boolean, instancing: boolean) {
    const hash = `${skinning ? 1 : 0}${morphing ? 1 : 0}${instancing ? 1 : 0}`;
    let bindGroupLayout = this._drawableBindGroupLayouts[hash];
    if (!bindGroupLayout) {
      const device = getDevice();
      const buildInfo = new ProgramBuilder(device).buildRender({
        vertex(pb) {
          ShaderHelper.vertexShaderDrawableStuff(this, skinning, morphing, instancing);
          pb.main(function () {});
        },
        fragment(pb) {
          pb.main(function () {});
        }
      });
      bindGroupLayout = buildInfo[2][1];
      this._drawableBindGroupLayouts[hash] = bindGroupLayout;
    }
    return bindGroupLayout;
  }
  /**
   * Prepares the fragment shader which is going to be used in our material system
   *
   * @remarks
   * This function will setup all nessesary uniforms acoording to the drawing context
   *
   * @param pb - The program builder
   * @param ctx - The drawing context
   */
  static prepareFragmentShader(pb: ProgramBuilder, ctx: DrawContext) {
    this.setupGlobalUniforms(pb, ctx);
  }
  /**
   * Prepares the vertex shader which is going to be used in our material system
   *
   * @remarks
   * This function will setup all nessesary uniforms according to the drawing context
   *
   * @param pb - The program builder
   * @param ctx - The drawing context
   */
  static prepareVertexShader(pb: ProgramBuilder, ctx: DrawContext) {
    this.setupGlobalUniforms(pb, ctx);
    this.prepareVertexShaderCommon(pb, ctx);
  }
  /** @internal */
  private static setupGlobalUniforms(pb: ProgramBuilder, ctx: DrawContext) {
    const scope = pb.getGlobalScope();
    const cameraStruct = pb.defineStruct([
      pb.vec4('position'),
      pb.mat4('viewProjectionMatrix'),
      pb.mat4('invViewProjectionMatrix'),
      pb.mat4('unjitteredVPMatrix'),
      pb.mat4('jitteredInvVPMatrix'),
      pb.mat4('viewMatrix'),
      pb.mat4('worldMatrix'),
      pb.mat4('projectionMatrix'),
      pb.mat4('invProjectionMatrix'),
      pb.vec4('params'),
      ...(ctx.motionVectors && ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH
        ? [pb.mat4('prevUnjitteredVPMatrix')]
        : []),
      pb.vec2('renderSize'),
      pb.vec2('jitterValue'),
      pb.float('roughnessFactor'),
      pb.float('shadowDebugCascades'),
      pb.float('frameDeltaTime'),
      pb.float('elapsedTime'),
      pb.float('preExposure'),
      pb.int('framestamp')
    ]);
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const lightStruct = pb.defineStruct([
        pb.vec4('positionAndRange'),
        pb.vec4('directionCutoff'),
        pb.mat4('viewMatrix'),
        pb.vec4('depthBias'),
        // Same slot the lighting pass exposes through getShadowImplParams. A
        // caster normally has no use for it, but one that encodes something
        // beyond depth - deep opacity map layers - needs the same parameters the
        // receiver will decode with.
        pb.vec4('implParams'),
        pb.int('lightType')
      ]);
      scope.camera = cameraStruct().uniform(0);
      scope.light = lightStruct().uniform(0);
      // Lets the shadow implementation add its own caster inputs. Only deep
      // opacity maps use this, to read the frontmost depth its first pass wrote.
      const shadowLight = (ctx.renderPass as ShadowMapPass).light;
      const casterParams = shadowLight ? ctx.shadowMapInfo?.get(shadowLight) : null;
      if (casterParams) {
        casterParams.impl?.declareCasterUniforms(scope, casterParams);
      }
    } else if (
      ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH ||
      ctx.renderPass!.type === RENDER_PASS_TYPE_OBJECT_COLOR
    ) {
      scope.camera = cameraStruct().uniform(0);
    } else if (ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      const useClusteredLighting = !ctx.currentShadowLight;
      if (ctx.materialFlags & MaterialVaryingFlags.APPLY_FOG) {
        const fogStructMembers: PBShaderExp[] = [
          pb.int('withAerialPerspective'),
          pb.int('fogType'),
          pb.int('additive'),
          getAtmosphereParamsStruct(pb)('atmosphereParams'),
          getHeightFogParamsStruct(pb)('heightFogParams')
        ];
        const fogStruct = pb.defineStruct(fogStructMembers);
        scope.fog = fogStruct().uniform(0);
        // Static samplers: LUTs are rgba16f without mipmaps
        scope[UNIFORM_NAME_AERIALPERSPECTIVE_LUT] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear_nomip'));
        scope[UNIFORM_NAME_SKYDISTANTLIGHT_LUT] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear_nomip'));
      }
      const lightStruct = ctx.currentShadowLight
        ? pb.defineStruct([
            pb.vec3('sunDir'),
            pb.int('shadowCascades'),
            pb.vec4('positionAndRange'),
            pb.vec4('directionAndCutoff'),
            pb.vec4('diffuseAndIntensity'),
            pb.vec4('extraParams'),
            pb.vec4('cascadeDistances'),
            pb.vec4('depthBiasValues'),
            pb.vec4('shadowCameraParams'),
            pb.vec4('depthBiasScales'),
            pb.vec4('implParams'),
            pb.vec4[16]('shadowMatrices'),
            pb.float('shadowStrength'),
            pb.float('envLightStrength'),
            pb.float('envLightSpecularStrength')
          ])
        : pb.defineStruct([
            pb.vec3('sunDir'),
            pb.float('envLightStrength'),
            pb.float('envLightSpecularStrength'),
            pb.vec4('clusterParams'),
            pb.ivec4('countParams'),
            pb.ivec2('lightIndexTexSize'),
            // Number of shadow-casting lights at the head of the clustered light
            // buffer (indices 1..N). Only present on the screen-space shadow mask
            // path (part of the global bind group hash), so the declared and bound
            // layouts always agree.
            ...(ctx.screenSpaceShadowMask ? [pb.int('numShadowLights')] : [])
          ]);
      scope.camera = cameraStruct().uniform(0);
      scope.light = lightStruct().uniform(0);
      if (useClusteredLighting) {
        scope[UNIFORM_NAME_LIGHT_BUFFER] = pb.vec4[(this.getMaxClusterLights() + 1) * 4]().uniformBuffer(0);
        // Non-WebGL1 devices fetch the light index texture with textureLoad
        scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE] = (
          pb.getDevice().type === 'webgl' ? pb.tex2D() : pb.utex2D().noSampler()
        ).uniform(0);
        // Screen-space shadow mask array (rgba8unorm, 4 shadow lights per layer).
        // Sampled by clustered lights whose buffer index is <= numShadowLights.
        // Presence is keyed into the global bind group hash, so declared and bound
        // layouts always agree.
        if (ctx.screenSpaceShadowMask) {
          scope[UNIFORM_NAME_SHADOW_MASK] = pb.tex2DArray().uniform(0);
          // Cluster shadow-light handling for the current queue: 1 = sample the
          // opaque shadow mask (opaque queue); 0 = skip shadow lights, which are
          // instead lit inline by the per-light additive passes (transparent queue,
          // e.g. OIT hair, where the opaque-depth mask would be incorrect).
          scope[UNIFORM_NAME_SHADOW_MASK_MODE] = pb.int().uniform(0);
        }
      }
      // Baked sky cube: rgba16f without mipmaps
      scope[UNIFORM_NAME_BAKED_SKY_MAP] = pb
        .texCube()
        .uniform(0)
        .withSampler(getSamplerOptions('clamp_linear_nomip'));
      if (ctx.currentShadowLight) {
        const scope = pb.getGlobalScope();
        const shadowMapParams = ctx.shadowMapInfo!.get(ctx.currentShadowLight)!;
        const tex = shadowMapParams.shadowMap!.isTextureCube()
          ? shadowMapParams.shadowMap.isDepth()
            ? scope.$builder.texCubeShadow()
            : scope.$builder.texCube()
          : shadowMapParams.shadowMap!.isTexture2D()
            ? shadowMapParams.shadowMap.isDepth()
              ? scope.$builder.tex2DShadow()
              : scope.$builder.tex2D()
            : shadowMapParams.shadowMap!.isDepth()
              ? scope.$builder.tex2DArrayShadow()
              : scope.$builder.tex2DArray();
        if (
          !shadowMapParams.shadowMap!.isDepth() &&
          !ctx.device.getDeviceCaps().textureCaps.getTextureFormatInfo(shadowMapParams.shadowMap!.format)
            .filterable
        ) {
          tex.sampleType('unfilterable-float');
        }
        if (shadowMapParams.shadowMap!.isDepth()) {
          // Depth-format shadow maps are sampled exclusively through the
          // comparison sampler (textureSampleCompareLevel); skip the regular
          // auto-bound sampler.
          tex.noSampler();
        }
        scope[UNIFORM_NAME_SHADOW_MAP] = tex.uniform(0);
      }
      if (ctx.drawEnvLight) {
        ctx.env!.light.envLight.initShaderBindings(pb, ctx);
      }
      if (ctx.linearDepthTexture) {
        // Depth values must never be filtered across geometry edges; nearest
        // matches the default sampler for unfilterable float formats.
        scope[UNIFORM_NAME_LINEAR_DEPTH_MAP] = pb
          .tex2D()
          .sampleType('unfilterable-float')
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_nearest_nomip'));
        scope[UNIFORM_NAME_LINEAR_DEPTH_MAP_SIZE] = pb.vec2().uniform(0);
      }
      if (ctx.sceneColorTexture) {
        // Scene color copy: single mip level
        scope[UNIFORM_NAME_SCENE_COLOR_MAP] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear_nomip'));
        scope[UNIFORM_NAME_SCENE_COLOR_MAP_SIZE] = pb.vec2().uniform(0);
      }
      if (ctx.HiZTexture) {
        // Matches the fetchSampler('clamp_nearest') previously passed at runtime
        scope[UNIFORM_NAME_HIZ_DEPTH_MAP] = pb
          .tex2D()
          .sampleType('unfilterable-float')
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_nearest'));
        scope[UNIFORM_NAME_HIZ_DEPTH_MAP_INFO] = pb.vec4().uniform(0);
      }
    }
  }
  /**
   * This function checks if the shader needs to process skeletal animation.
   *
   * @param scope - Current shader scope
   *
   * @returns true if the shader needs to process skeletal animation, otherwise false.
   */
  static hasSkinning(scope: PBInsideFunctionScope) {
    return !!scope[UNIFORM_NAME_BONE_MATRICES];
  }
  /**
   * This function checks if the shader needs to process morph target animation.
   *
   * @param scope - Current shader scope
   *
   * @returns true if the shader needs to process morph target animation, otherwise false.
   */
  static hasMorphing(scope: PBInsideFunctionScope) {
    return !!scope[UNIFORM_NAME_MORPH_DATA];
  }
  /**
   * Calculate skinning matrix for current vertex
   *
   * @param scope - Current shader scope
   *
   * @returns Skinning matrix for current vertex, or null if there is not skeletal animation
   */
  static calculateSkinMatrix(scope: PBInsideFunctionScope) {
    if (!this.hasSkinning(scope)) {
      return null;
    }
    const pb = scope.$builder;
    const isWebGL = pb.getDevice().type === 'webgl';
    const supportsTextureLoad = !isWebGL;
    const funcNameGetBoneMatrixFromTexture = 'Z_getBoneMatrixFromTexture';
    pb.func(funcNameGetBoneMatrixFromTexture, [pb.int('boneIndex')], function () {
      const boneTexture = this[UNIFORM_NAME_BONE_MATRICES];
      this.$l.uvOffsets = pb.textureSampleLevel(
        boneTexture,
        pb.div(pb.vec2(0.5), this[UNIFORM_NAME_BONE_TEXTURE_SIZE]),
        0
      );
      this.$l.currentOffset = pb.int(this.uvOffsets.x);
      this.$l.w = this[UNIFORM_NAME_BONE_TEXTURE_SIZE].x;
      this.$l.pixelIndex = pb.float(pb.mul(pb.add(this.boneIndex, this.currentOffset), 4));
      this.$l.xIndex = pb.mod(this.pixelIndex, this.w);
      this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.w));
      this.$l.u1 = pb.div(pb.add(this.xIndex, 0.5), this.w);
      this.$l.u2 = pb.div(pb.add(this.xIndex, 1.5), this.w);
      this.$l.u3 = pb.div(pb.add(this.xIndex, 2.5), this.w);
      this.$l.u4 = pb.div(pb.add(this.xIndex, 3.5), this.w);
      this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.w);
      this.$l.row1 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u1, this.v), 0);
      this.$l.row2 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u2, this.v), 0);
      this.$l.row3 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u3, this.v), 0);
      this.$l.row4 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u4, this.v), 0);
      this.$return(pb.mat4(this.row1, this.row2, this.row3, this.row4));
    });
    const funcNameGetSkinningMatrix = 'Z_getSkinningMatrix';
    pb.func(funcNameGetSkinningMatrix, [], function () {
      const invBindMatrix = this[UNIFORM_NAME_BONE_INV_BIND_MATRIX];
      const blendIndices = scope.$getVertexAttrib('blendIndices')!;
      const blendWeights = scope.$getVertexAttrib('blendWeights')!;
      this.$l.m0 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[0]));
      this.$l.m1 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[1]));
      this.$l.m2 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[2]));
      this.$l.m3 = scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[3]));
      this.$l.m = pb.add(
        pb.mul(this.m0, blendWeights.x),
        pb.mul(this.m1, blendWeights.y),
        pb.mul(this.m2, blendWeights.z),
        pb.mul(this.m3, blendWeights.w)
      );
      this.$l.skinInfo = this[UNIFORM_NAME_SKIN_INFLUENCE_INFO];
      this.$if(pb.greaterThan(this.skinInfo.z, 4), function () {
        this.$l.vertexIndex = isWebGL
          ? pb.int(scope.$inputs.zFakeVertexID)
          : pb.int(scope.$builtins.vertexIndex);
        this.$l.texWidth = pb.int(this.skinInfo.x);
        this.$l.pairCount = pb.int(this.skinInfo.w);
        this.$for(pb.int('pairIndex'), 0, MAX_SKIN_EXTRA_INFLUENCE_PAIRS, function () {
          this.$if(pb.greaterThanEqual(this.pairIndex, this.pairCount), function () {
            this.$break();
          });
          this.$l.pixelIndex = pb.add(pb.mul(this.vertexIndex, this.pairCount), this.pairIndex);
          this.$l.xIndex = pb.mod(this.pixelIndex, this.texWidth);
          this.$l.yIndex = pb.div(this.pixelIndex, this.texWidth);
          if (supportsTextureLoad) {
            this.$l.extra = pb.textureLoad(
              this[UNIFORM_NAME_SKIN_INFLUENCE_DATA],
              pb.ivec2(this.xIndex, this.yIndex),
              0
            );
          } else {
            this.$l.u = pb.div(pb.add(pb.float(this.xIndex), 0.5), this.skinInfo.x);
            this.$l.v = pb.div(pb.add(pb.float(this.yIndex), 0.5), this.skinInfo.y);
            this.$l.extra = pb.textureSampleLevel(
              this[UNIFORM_NAME_SKIN_INFLUENCE_DATA],
              pb.vec2(this.u, this.v),
              0
            );
          }
          this.$if(pb.greaterThan(this.extra.y, 0), function () {
            this.m = pb.add(
              this.m,
              pb.mul(scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(this.extra.x)), this.extra.y)
            );
          });
          this.$if(pb.greaterThan(this.extra.w, 0), function () {
            this.m = pb.add(
              this.m,
              pb.mul(scope.$g[funcNameGetBoneMatrixFromTexture](pb.int(this.extra.z)), this.extra.w)
            );
          });
        });
      });
      this.$return(pb.mul(invBindMatrix, this.m));
    });
    return scope.$g[funcNameGetSkinningMatrix]() as PBShaderExp;
  }
  static calculateMorphDelta(scope: PBInsideFunctionScope, attrib: number) {
    const pb = scope.$builder;
    const isWebGL1 = pb.getDevice().type === 'webgl';
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.calculateMorphDelta(): must be called at vertex stage`);
    }
    const funcName = 'Z_calculateMorph';
    const that = this;
    pb.func(funcName, [pb.int('offset')], function () {
      this.$if(pb.lessThan(this.offset, 0), function () {
        this.$return(pb.vec4(0));
      });
      this.$l.vertexIndex = isWebGL1
        ? pb.int(scope.$inputs.zFakeVertexID)
        : pb.int(scope.$builtins.vertexIndex);
      const morphInfo = scope[that.getMorphInfoUniformName()];
      this.$l.metaData = pb.ivec4(morphInfo[0]);
      this.$l.texWidth = pb.float(this.metaData.x);
      this.$l.texHeight = pb.float(this.metaData.y);
      this.$l.numVertices = this.metaData.z;
      this.$l.numTargets = this.metaData.w;
      this.$l.value = pb.vec4(0);
      if (isWebGL1) {
        this.$for(pb.int('i'), 0, MORPH_WEIGHTS_VECTOR_COUNT, function () {
          this.$for(pb.int('j'), 0, 4, function () {
            this.$l.index = pb.add(pb.mul(this.i, 4), this.j);
            this.$if(pb.greaterThanEqual(this.index, this.numTargets), function () {
              this.$return(this.value);
            });
            this.$l.weight = morphInfo.at(pb.add(1, this.i)).at(this.j);
            this.$if(pb.notEqual(this.weight, 0), function () {
              this.$l.targetIndex = pb.int(
                morphInfo.at(pb.add(1 + MORPH_WEIGHTS_VECTOR_COUNT, this.i)).at(this.j)
              );
              this.$l.pixelIndex = pb.float(
                pb.add(this.offset, pb.mul(this.targetIndex, this.numVertices), this.vertexIndex)
              );
              this.$l.xIndex = pb.mod(this.pixelIndex, this.texWidth);
              this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.texWidth));
              this.$l.u = pb.div(pb.add(this.xIndex, 0.5), this.texWidth);
              this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.texHeight);
              this.$l.morphValue = pb.textureSampleLevel(
                this[that.getMorphDataUniformName()],
                pb.vec2(this.u, this.v),
                0
              );
              this.value = pb.add(this.value, pb.mul(this.morphValue, this.weight));
            });
          });
        });
      } else {
        this.$for(pb.int('t'), 0, this.numTargets, function () {
          this.$l.i = pb.sar(this.t, 2);
          this.$l.j = pb.compAnd(this.t, 3);
          this.$l.weight = morphInfo.at(pb.add(1, this.i)).at(this.j);
          this.$if(pb.notEqual(this.weight, 0), function () {
            this.$l.targetIndex = pb.int(
              morphInfo.at(pb.add(1 + MORPH_WEIGHTS_VECTOR_COUNT, this.i)).at(this.j)
            );
            this.$l.pixelIndex = pb.float(
              pb.add(this.offset, pb.mul(this.targetIndex, this.numVertices), this.vertexIndex)
            );
            this.$l.xIndex = pb.mod(this.pixelIndex, this.texWidth);
            this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.texWidth));
            this.$l.u = pb.div(pb.add(this.xIndex, 0.5), this.texWidth);
            this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.texHeight);
            this.$l.morphValue = pb.textureSampleLevel(
              this[that.getMorphDataUniformName()],
              pb.vec2(this.u, this.v),
              0
            );
            this.value = pb.add(this.value, pb.mul(this.morphValue, this.weight));
          });
        });
      }
      this.$return(this.value);
    });
    const pos = 1 + MORPH_WEIGHTS_VECTOR_COUNT * 2 + (attrib >> 2);
    const comp = attrib & 3;
    const offset = scope[this.getMorphInfoUniformName()][pos][comp];
    return scope[funcName](pb.int(offset)) as PBShaderExp;
  }
  /**
   * Normalize a morphed direction without allowing cancellation between
   * multiple morph targets to turn a valid base direction into NaN/noise.
   *
   * Morph normal/tangent data is additive. When two targets cancel the base
   * direction, the zero-length result is not a meaningful direction, so the
   * authored vertex direction is the least surprising fallback.
   * @internal
   */
  private static defineNormalizeMorphedDirection(scope: PBInsideFunctionScope): string {
    const pb = scope.$builder;
    const funcName = 'Z_normalizeMorphedDirection';
    pb.func(funcName, [pb.vec3('base'), pb.vec3('delta')], function () {
      this.$l.morphed = pb.add(this.base, this.delta);
      this.$l.lengthSquared = pb.dot(this.morphed, this.morphed);
      this.$if(pb.greaterThan(this.lengthSquared, 1e-6), function () {
        this.$return(pb.mul(this.morphed, pb.inverseSqrt(this.lengthSquared)));
      });
      this.$l.baseLengthSquared = pb.dot(this.base, this.base);
      this.$if(pb.greaterThan(this.baseLengthSquared, 1e-6), function () {
        this.$return(pb.mul(this.base, pb.inverseSqrt(this.baseLengthSquared)));
      });
      this.$return(pb.vec3(0, 0, 1));
    });
    return funcName;
  }
  /**
   * Mixes morph directions according to the amount of positional deformation
   * contributed by each active target. This avoids letting a target with a
   * large authored normal delta dominate a target that actually moves the
   * surface much farther at the current vertex.
   *
   * The additive result remains the fallback for assets without position
   * morph data, and for vertices whose position deltas are all zero.
   * @internal
   */
  private static calculateMorphDirectionByDisplacement(
    scope: PBInsideFunctionScope,
    base: PBShaderExp,
    attrib: number
  ): PBShaderExp {
    const pb = scope.$builder;
    const isWebGL1 = pb.getDevice().type === 'webgl';
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.calculateMorphDirectionByDisplacement(): must be called at vertex stage`);
    }
    const that = this;
    const funcName = 'Z_calculateMorphDirectionByDisplacement';
    const normalizeName = this.defineNormalizeMorphedDirection(scope);
    pb.func(funcName, [pb.vec3('base'), pb.int('directionOffset'), pb.int('positionOffset')], function () {
      this.$l.vertexIndex = isWebGL1
        ? pb.int(scope.$inputs.zFakeVertexID)
        : pb.int(scope.$builtins.vertexIndex);
      const morphInfo = scope[that.getMorphInfoUniformName()];
      this.$l.metaData = pb.ivec4(morphInfo[0]);
      this.$l.texWidth = pb.float(this.metaData.x);
      this.$l.texHeight = pb.float(this.metaData.y);
      this.$l.numVertices = this.metaData.z;
      this.$l.numTargets = this.metaData.w;
      this.$l.directionDelta = pb.vec3(0);
      this.$l.weightedDirection = pb.vec3(0);
      this.$l.weightSum = pb.float(0);

      const accumulateTarget = (targetScope: PBInsideFunctionScope) => {
        targetScope.$if(pb.notEqual(targetScope.weight, 0), function () {
          this.$l.targetIndex = pb.int(targetScope['targetIndex']);
          this.$l.positionValue = pb.vec3(0);
          this.$l.directionValue = pb.vec3(0);
          this.$if(pb.greaterThanEqual(targetScope['directionOffset'], 0), function () {
            this.$l.pixelIndex = pb.float(
              pb.add(
                targetScope['directionOffset'],
                pb.mul(this.targetIndex, targetScope['numVertices']),
                targetScope['vertexIndex']
              )
            );
            this.$l.xIndex = pb.mod(this.pixelIndex, targetScope['texWidth']);
            this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, targetScope['texWidth']));
            this.$l.u = pb.div(pb.add(this.xIndex, 0.5), targetScope['texWidth']);
            this.$l.v = pb.div(pb.add(this.yIndex, 0.5), targetScope['texHeight']);
            this.directionValue = pb.textureSampleLevel(
              scope[that.getMorphDataUniformName()],
              pb.vec2(this.u, this.v),
              0
            ).xyz;
          });
          this.$if(pb.greaterThanEqual(targetScope['positionOffset'], 0), function () {
            this.$l.pixelIndex = pb.float(
              pb.add(
                targetScope['positionOffset'],
                pb.mul(this.targetIndex, targetScope['numVertices']),
                targetScope['vertexIndex']
              )
            );
            this.$l.xIndex = pb.mod(this.pixelIndex, targetScope['texWidth']);
            this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, targetScope['texWidth']));
            this.$l.u = pb.div(pb.add(this.xIndex, 0.5), targetScope['texWidth']);
            this.$l.v = pb.div(pb.add(this.yIndex, 0.5), targetScope['texHeight']);
            this.positionValue = pb.textureSampleLevel(
              scope[that.getMorphDataUniformName()],
              pb.vec2(this.u, this.v),
              0
            ).xyz;
          });
          this.directionDelta = pb.add(this.directionDelta, pb.mul(this.directionValue, targetScope.weight));
          this.$l.targetDirection = scope.$g[normalizeName](
            this.base,
            pb.mul(this.directionValue, targetScope.weight)
          );
          this.$l.displacementWeight = pb.mul(
            pb.abs(targetScope.weight),
            pb.sqrt(pb.dot(this.positionValue, this.positionValue))
          );
          this.weightedDirection = pb.add(
            this.weightedDirection,
            pb.mul(this.targetDirection, this.displacementWeight)
          );
          this.weightSum = pb.add(this.weightSum, this.displacementWeight);
        });
      };

      if (isWebGL1) {
        this.$for(pb.int('i'), 0, MORPH_WEIGHTS_VECTOR_COUNT, function () {
          this.$for(pb.int('j'), 0, 4, function () {
            this.$l.index = pb.add(pb.mul(this.i, 4), this.j);
            this.$if(pb.greaterThanEqual(this.index, this.numTargets), function () {
              this.$break();
            });
            this.$l.weight = morphInfo.at(pb.add(1, this.i)).at(this.j);
            this.$l.targetIndex = pb.int(
              morphInfo.at(pb.add(1 + MORPH_WEIGHTS_VECTOR_COUNT, this.i)).at(this.j)
            );
            accumulateTarget(this);
          });
        });
      } else {
        this.$for(pb.int('t'), 0, this.numTargets, function () {
          this.$l.i = pb.sar(this.t, 2);
          this.$l.j = pb.compAnd(this.t, 3);
          this.$l.weight = morphInfo.at(pb.add(1, this.i)).at(this.j);
          this.$l.targetIndex = pb.int(
            morphInfo.at(pb.add(1 + MORPH_WEIGHTS_VECTOR_COUNT, this.i)).at(this.j)
          );
          accumulateTarget(this);
        });
      }

      this.$l.fallback = scope.$g[normalizeName](this.base, this.directionDelta);
      this.$if(pb.lessThan(this.weightSum, 1e-6), function () {
        this.$return(this.fallback);
      });
      this.$l.weightedLengthSquared = pb.dot(this.weightedDirection, this.weightedDirection);
      this.$if(pb.greaterThan(this.weightedLengthSquared, 1e-6), function () {
        this.$return(pb.mul(this.weightedDirection, pb.inverseSqrt(this.weightedLengthSquared)));
      });
      this.$return(this.fallback);
    });
    const directionPos = 1 + MORPH_WEIGHTS_VECTOR_COUNT * 2 + (attrib >> 2);
    const directionComp = attrib & 3;
    const positionPos = 1 + MORPH_WEIGHTS_VECTOR_COUNT * 2 + (MORPH_TARGET_POSITION >> 2);
    const positionComp = MORPH_TARGET_POSITION & 3;
    const morphInfo = scope[this.getMorphInfoUniformName()];
    return scope.$g[funcName](
      base.xyz,
      pb.int(morphInfo[directionPos][directionComp]),
      pb.int(morphInfo[positionPos][positionComp])
    ) as PBShaderExp;
  }
  /** @internal */
  private static orthogonalizeMorphedTangent(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    tangent: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'Z_orthogonalizeMorphedTangent';
    pb.func(funcName, [pb.vec3('normal'), pb.vec3('tangent')], function () {
      this.$l.normalLengthSquared = pb.dot(this.normal, this.normal);
      this.$if(pb.greaterThan(this.normalLengthSquared, 1e-6), function () {
        this.$l.n = pb.mul(this.normal, pb.inverseSqrt(this.normalLengthSquared));
        this.$l.projected = pb.sub(this.tangent, pb.mul(this.n, pb.dot(this.n, this.tangent)));
        this.$l.tangentLengthSquared = pb.dot(this.projected, this.projected);
        this.$if(pb.greaterThan(this.tangentLengthSquared, 1e-6), function () {
          this.$return(pb.mul(this.projected, pb.inverseSqrt(this.tangentLengthSquared)));
        });
      });
      this.$return(this.tangent);
    });
    return scope.$g[funcName](normal.xyz, tangent.xyz) as PBShaderExp;
  }
  /** @internal */
  static prepareSkinAnimation(scope: PBInsideFunctionScope) {
    if (!this.hasSkinning(scope)) {
      return;
    }
    const that = this;
    const pb = scope.$builder;
    const isWebGL = pb.getDevice().type === 'webgl';
    const supportsTextureLoad = !isWebGL;
    const funcNameGetBoneMatrixFromTexture = 'Z_getBoneMatrixFromTexture';
    pb.func(funcNameGetBoneMatrixFromTexture, [pb.float('boneIndex'), pb.float('boneOffset')], function () {
      const boneTexture = this[UNIFORM_NAME_BONE_MATRICES];
      this.$l.w = this[UNIFORM_NAME_BONE_TEXTURE_SIZE].x;
      this.$l.pixelIndex = pb.mul(pb.add(this.boneIndex, this.boneOffset), 4);
      this.$l.xIndex = pb.mod(this.pixelIndex, this.w);
      this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.w));
      this.$l.u1 = pb.div(pb.add(this.xIndex, 0.5), this.w);
      this.$l.u2 = pb.div(pb.add(this.xIndex, 1.5), this.w);
      this.$l.u3 = pb.div(pb.add(this.xIndex, 2.5), this.w);
      this.$l.u4 = pb.div(pb.add(this.xIndex, 3.5), this.w);
      this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.w);
      this.$l.row1 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u1, this.v), 0);
      this.$l.row2 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u2, this.v), 0);
      this.$l.row3 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u3, this.v), 0);
      this.$l.row4 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u4, this.v), 0);
      this.$return(pb.mat4(this.row1, this.row2, this.row3, this.row4));
    });
    const funcNameGetSkinningMatrix = 'Z_getSkinningMatrix';
    pb.func(funcNameGetSkinningMatrix, [pb.float('boneOffset')], function () {
      const invBindMatrix = this[UNIFORM_NAME_BONE_INV_BIND_MATRIX];
      const blendIndices = scope.$getVertexAttrib('blendIndices')!;
      const blendWeights = scope.$getVertexAttrib('blendWeights')!;
      this.$l.m0 = scope.$g[funcNameGetBoneMatrixFromTexture](blendIndices[0], this.boneOffset);
      this.$l.m1 = scope.$g[funcNameGetBoneMatrixFromTexture](blendIndices[1], this.boneOffset);
      this.$l.m2 = scope.$g[funcNameGetBoneMatrixFromTexture](blendIndices[2], this.boneOffset);
      this.$l.m3 = scope.$g[funcNameGetBoneMatrixFromTexture](blendIndices[3], this.boneOffset);
      this.$l.m = pb.add(
        pb.mul(this.m0, blendWeights.x),
        pb.mul(this.m1, blendWeights.y),
        pb.mul(this.m2, blendWeights.z),
        pb.mul(this.m3, blendWeights.w)
      );
      this.$l.skinInfo = this[UNIFORM_NAME_SKIN_INFLUENCE_INFO];
      this.$if(pb.greaterThan(this.skinInfo.z, 4), function () {
        this.$l.vertexIndex = isWebGL
          ? pb.int(scope.$inputs.zFakeVertexID)
          : pb.int(scope.$builtins.vertexIndex);
        this.$l.texWidth = pb.int(this.skinInfo.x);
        this.$l.pairCount = pb.int(this.skinInfo.w);
        this.$for(pb.int('pairIndex'), 0, MAX_SKIN_EXTRA_INFLUENCE_PAIRS, function () {
          this.$if(pb.greaterThanEqual(this.pairIndex, this.pairCount), function () {
            this.$break();
          });
          this.$l.pixelIndex = pb.add(pb.mul(this.vertexIndex, this.pairCount), this.pairIndex);
          this.$l.xIndex = pb.mod(this.pixelIndex, this.texWidth);
          this.$l.yIndex = pb.div(this.pixelIndex, this.texWidth);
          if (supportsTextureLoad) {
            this.$l.extra = pb.textureLoad(
              this[UNIFORM_NAME_SKIN_INFLUENCE_DATA],
              pb.ivec2(this.xIndex, this.yIndex),
              0
            );
          } else {
            this.$l.u = pb.div(pb.add(pb.float(this.xIndex), 0.5), this.skinInfo.x);
            this.$l.v = pb.div(pb.add(pb.float(this.yIndex), 0.5), this.skinInfo.y);
            this.$l.extra = pb.textureSampleLevel(
              this[UNIFORM_NAME_SKIN_INFLUENCE_DATA],
              pb.vec2(this.u, this.v),
              0
            );
          }
          this.$if(pb.greaterThan(this.extra.y, 0), function () {
            this.m = pb.add(
              this.m,
              pb.mul(scope.$g[funcNameGetBoneMatrixFromTexture](this.extra.x, this.boneOffset), this.extra.y)
            );
          });
          this.$if(pb.greaterThan(this.extra.w, 0), function () {
            this.m = pb.add(
              this.m,
              pb.mul(scope.$g[funcNameGetBoneMatrixFromTexture](this.extra.z, this.boneOffset), this.extra.w)
            );
          });
        });
      });
      this.$return(pb.mul(invBindMatrix, this.m));
    });
    const motionVector = !!this.getUnjitteredViewProjectionMatrix(scope);
    const boneTexture = scope[UNIFORM_NAME_BONE_MATRICES];
    scope.$l[that.SKIN_BONE_OFFSET] = pb.textureSampleLevel(
      boneTexture,
      pb.div(pb.vec2(0.5), scope[UNIFORM_NAME_BONE_TEXTURE_SIZE]),
      0
    ).xy;
    scope.$l[that.SKIN_MATRIX_NAME] = scope[funcNameGetSkinningMatrix](scope[that.SKIN_BONE_OFFSET].x);
    if (motionVector) {
      scope.$l[that.SKIN_PREV_MATRIX_NAME] = scope[funcNameGetSkinningMatrix](scope[that.SKIN_BONE_OFFSET].y);
    }
  }
  /**
   * Calculates the vertex position of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated vertex position in object space, or null if pos is null
   */
  static resolveVertexPosition(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.resolveVertexPosition(): must be called at vertex stage`);
    }
    if (!pb.getGlobalScope().$getVertexAttrib('position')) {
      pb.getGlobalScope().$inputs.Z_pos = pb.vec3().attrib('position');
    }
    const that = this;
    const params =
      scope[that.SKIN_MATRIX_NAME] && scope[that.SKIN_PREV_MATRIX_NAME]
        ? [pb.mat4('skinMatrix'), pb.mat4('prevSkinMatrix')]
        : scope[that.SKIN_MATRIX_NAME]
          ? [pb.mat4('skinMatrix')]
          : [];
    pb.func('Z_resolveVertexPosition', params, function () {
      this.$l.opos = this.$getVertexAttrib('position')!.xyz;
      if (that.hasMorphing(scope)) {
        this.opos = pb.add(this.opos, that.calculateMorphDelta(this, MORPH_TARGET_POSITION).xyz);
      }
      if (this.skinMatrix) {
        this.$l.pos = pb.mul(this.skinMatrix, pb.vec4(this.opos, 1)).xyz;
      } else {
        this.$l.pos = this.opos;
      }
      const prevUnjitteredVPMatrix = that.getPrevUnjitteredViewProjectionMatrix(this);
      if (prevUnjitteredVPMatrix) {
        this.$l.unjitteredVPMatrix = that.getUnjitteredViewProjectionMatrix(this);
        this.$l.worldPos = pb.mul(that.getWorldMatrix(this), pb.vec4(this.pos, 1));
        if (this.prevSkinMatrix) {
          this.$l.prevWorldPos = pb.mul(
            that.getPrevWorldMatrix(this),
            pb.mul(this.prevSkinMatrix, pb.vec4(this.opos, 1))
          );
        } else {
          this.$l.prevWorldPos = pb.mul(that.getPrevWorldMatrix(this), pb.vec4(this.pos, 1));
        }
        this.$outputs.zMotionVectorPosCurrent = pb.mul(this.unjitteredVPMatrix, this.worldPos);
        this.$outputs.zMotionVectorPosPrev = pb.mul(prevUnjitteredVPMatrix, this.prevWorldPos);
      }
      this.$return(this.pos);
    });
    return (
      scope[that.SKIN_MATRIX_NAME] && scope[that.SKIN_PREV_MATRIX_NAME]
        ? scope.Z_resolveVertexPosition(scope[that.SKIN_MATRIX_NAME], scope[that.SKIN_PREV_MATRIX_NAME])
        : scope[that.SKIN_MATRIX_NAME]
          ? scope.Z_resolveVertexPosition(scope[that.SKIN_MATRIX_NAME])
          : scope.Z_resolveVertexPosition()
    ) as PBShaderExp;
  }
  /**
   * Resolve motion vector
   *
   * @param scope - Current shader scope
   * @param worldPos - Current object position in world space
   * @param prevWorldPos - Previous object position in world space
   */
  static resolveMotionVector(scope: PBInsideFunctionScope, worldPos: PBShaderExp, prevWorldPos: PBShaderExp) {
    const that = this;
    const pb = scope.$builder;
    const prevUnjitteredVPMatrix = that.getPrevUnjitteredViewProjectionMatrix(scope);
    if (prevUnjitteredVPMatrix) {
      const unjitteredVPMatrix = that.getUnjitteredViewProjectionMatrix(scope);
      scope.$outputs.zMotionVectorPosCurrent = pb.mul(unjitteredVPMatrix, pb.vec4(worldPos.xyz, 1));
      scope.$outputs.zMotionVectorPosPrev = pb.mul(prevUnjitteredVPMatrix, pb.vec4(prevWorldPos.xyz, 1));
    }
  }
  /**
   * Gets the skinning matrix in the vertex shader, if the mesh being drawn is skinned.
   *
   * @remarks
   * Lets a material apply the same skinning transform to its own uniform-supplied
   * object-space vectors that {@link ShaderHelper.resolveVertexNormal} applies to
   * the normal attribute, so such vectors stay attached to the deforming mesh.
   *
   * @param scope - Current shader scope, must be vertex stage
   * @returns The skinning matrix of type mat4, or null when the mesh is not skinned
   */
  static getSkinMatrix(scope: PBInsideFunctionScope): PBShaderExp | null {
    return (scope[this.SKIN_MATRIX_NAME] as PBShaderExp) ?? null;
  }
  /**
   * Calculates the normal vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param normal - Vertex normal input, must be type of vec3, null if no vertex normal input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated normal vector in object space, or null if normal is null
   */
  static resolveVertexNormal(scope: PBInsideFunctionScope, normal?: PBShaderExp) {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.resolveVertexNormal(): must be called in vertex stage`);
    }
    const funcScope = pb.getCurrentFunctionScope();
    if (!funcScope || !funcScope.$isMain()) {
      throw new Error(`ShaderHelper.resolveVertexNormal(): must be called at entry function`);
    }
    const useVertexAttrib = !normal;
    if (useVertexAttrib && scope[this.RESOLVED_VERTEX_NORMAL_NAME]) {
      return scope[this.RESOLVED_VERTEX_NORMAL_NAME] as PBShaderExp;
    }
    if (!normal) {
      if (!scope.$getVertexAttrib('normal')) {
        scope.$inputs.Z_normal = pb.vec3().attrib('normal');
      }
      normal = scope.$getVertexAttrib('normal')!;
    }
    if (this.hasMorphing(scope)) {
      normal = this.calculateMorphDirectionByDisplacement(scope, normal, MORPH_TARGET_NORMAL);
    }
    let resolvedNormal = normal;
    if (scope[this.SKIN_MATRIX_NAME]) {
      resolvedNormal = pb.mul(scope[this.SKIN_MATRIX_NAME], pb.vec4(normal, 0)).xyz as PBShaderExp;
    }
    if (useVertexAttrib) {
      scope.$l[this.RESOLVED_VERTEX_NORMAL_NAME] = resolvedNormal;
      resolvedNormal = scope[this.RESOLVED_VERTEX_NORMAL_NAME];
    }
    return resolvedNormal;
  }
  /**
   * Calculates the tangent vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param tangent - Vertex tangent input, must be type of vec4, null if no vertex tangent input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated tangent vector of type vec4 in object space, or null if tangent is null
   */
  static resolveVertexTangent(scope: PBInsideFunctionScope, tangent?: PBShaderExp) {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.resolveVertexTangent(): must be called in vertex stage`);
    }
    const funcScope = pb.getCurrentFunctionScope();
    if (!funcScope || !funcScope.$isMain()) {
      throw new Error(`ShaderHelper.resolveVertexTangent(): must be called at entry function`);
    }
    if (!tangent) {
      if (!scope.$getVertexAttrib('tangent')) {
        scope.$inputs.Z_tangent = pb.vec4().attrib('tangent');
      }
      tangent = scope.$getVertexAttrib('tangent')!;
    }
    if (this.hasMorphing(scope)) {
      tangent = pb.vec4(
        this.calculateMorphDirectionByDisplacement(scope, tangent.xyz, MORPH_TARGET_TANGENT),
        tangent.w
      );
    }
    if (scope[this.SKIN_MATRIX_NAME]) {
      tangent = pb.vec4(
        pb.mul(scope[this.SKIN_MATRIX_NAME], pb.vec4(tangent.xyz, 0)).xyz,
        tangent.w
      ) as PBShaderExp;
    }
    if (this.hasMorphing(scope) && scope.$getVertexAttrib('normal')) {
      const resolvedNormal = scope[this.RESOLVED_VERTEX_NORMAL_NAME] ?? this.resolveVertexNormal(scope);
      tangent = pb.vec4(this.orthogonalizeMorphedTangent(scope, resolvedNormal, tangent.xyz), tangent.w);
    }
    return tangent;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the world matrix of current object to be drawn
   * @param scope - Current shader scope
   * @returns The world matrix of current object to be drawn
   */
  static getWorldMatrix(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    return (scope[UNIFORM_NAME_WORLD_MATRIX] ??
      pb.mat4(
        this.getInstancedUniform(scope, 0),
        this.getInstancedUniform(scope, 1),
        this.getInstancedUniform(scope, 2),
        this.getInstancedUniform(scope, 3)
      )) as PBShaderExp;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the world matrix at previous frame of current object to be drawn
   * @param scope - Current shader scope
   * @returns The world matrix at previous frame of current object to be drawn
   */
  static getPrevWorldMatrix(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    const that = this;
    const framestamp = this.getFramestamp(scope);
    if (scope[UNIFORM_NAME_WORLD_MATRIX]) {
      if (pb.getDevice().type === 'webgpu') {
        pb.func('Z_getPrevWorldMatrix', [pb.int('framestamp')], function () {
          this.$if(pb.equal(this.framestamp, this[UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME]), function () {
            this.$return(this[UNIFORM_NAME_PREV_WORLD_MATRIX]);
          }).$else(function () {
            this.$return(this[UNIFORM_NAME_WORLD_MATRIX]);
          });
        });
        return scope.Z_getPrevWorldMatrix(framestamp);
      } else {
        return scope.$choice(
          pb.equal(framestamp, scope[UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME]),
          scope[UNIFORM_NAME_PREV_WORLD_MATRIX],
          scope[UNIFORM_NAME_WORLD_MATRIX]
        );
      }
    } else {
      pb.func('Z_getPrevWorldMatrix', [pb.int('framestamp')], function () {
        this.$l.prevFrame = pb.floatBitsToInt(that.getInstancedUniform(this, 4).x);
        this.$l.index = this.$choice(pb.equal(this.framestamp, this.prevFrame), pb.int(5), pb.int(0));
        this.$return(
          pb.mat4(
            that.getInstancedUniform(scope, this.index),
            that.getInstancedUniform(scope, pb.add(this.index, 1)),
            that.getInstancedUniform(scope, pb.add(this.index, 2)),
            that.getInstancedUniform(scope, pb.add(this.index, 3))
          )
        );
      });
      return scope.Z_getPrevWorldMatrix(framestamp) as PBShaderExp;
    }
  }
  /**
   * Gets the instance uniform value of type vec4 by uniform index
   * @param scope - Current shader scope
   * @returns instance uniform value
   */
  static getInstancedUniform(scope: PBInsideFunctionScope, uniformIndex: number | PBShaderExp) {
    const pb = scope.$builder;
    return scope[UNIFORM_NAME_INSTANCE_DATA].at(
      pb.add(
        pb.mul(scope[UNIFORM_NAME_INSTANCE_DATA_STRIDE], pb.uint(scope.$builtins.instanceIndex)),
        scope[UNIFORM_NAME_INSTANCE_DATA_OFFSET],
        pb.uint(uniformIndex)
      )
    ) as PBShaderExp;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the normal matrix of current object to be drawn
   *
   * @param scope - Current shader scope
   * @returns The normal matrix of current object to be drawn
   */
  static getNormalMatrix(scope: PBInsideFunctionScope) {
    return this.getWorldMatrix(scope);
  }
  /**
   * Vertex shader drawable stuff
   *
   * @param scope - Current shader scope
   * @param skinning - true if skinning is used, otherwise false.
   * @param instanced - true if instancing is used, otherwise false.
   */
  static vertexShaderDrawableStuff(
    scope: PBGlobalScope,
    skinning: boolean,
    morphing: boolean,
    instanced: boolean
  ): void {
    const pb = scope.$builder;
    if (instanced) {
      scope[UNIFORM_NAME_INSTANCE_DATA_STRIDE] = pb.uint().uniform(1);
      scope[UNIFORM_NAME_INSTANCE_DATA_OFFSET] = pb.uint().uniform(1);
      scope[UNIFORM_NAME_INSTANCE_DATA] = pb.vec4[65536 >> 4]().uniformBuffer(3);
    } else {
      scope[UNIFORM_NAME_WORLD_MATRIX] = pb.mat4().uniform(1);
      scope[UNIFORM_NAME_PREV_WORLD_MATRIX] = pb.mat4().uniform(1);
      scope[UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME] = pb.int().uniform(1);
      scope[UNIFORM_NAME_OBJECT_COLOR] = pb.vec4().uniform(1);
    }
    if (skinning) {
      scope[UNIFORM_NAME_BONE_MATRICES] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_BONE_INV_BIND_MATRIX] = pb.mat4().uniform(1);
      scope[UNIFORM_NAME_BONE_TEXTURE_SIZE] = pb.vec2().uniform(1);
      scope[UNIFORM_NAME_SKIN_INFLUENCE_DATA] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_SKIN_INFLUENCE_INFO] = pb.vec4().uniform(1);
    }
    if (morphing) {
      scope[UNIFORM_NAME_MORPH_DATA] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_MORPH_INFO] =
        pb.vec4[1 + MORPH_WEIGHTS_VECTOR_COUNT * 2 + MORPH_ATTRIBUTE_VECTOR_COUNT]().uniformBuffer(1);
    }
  }
  /** @internal */
  static prepareVertexShaderCommon(pb: ProgramBuilder, ctx: DrawContext) {
    this.vertexShaderDrawableStuff(
      pb.getGlobalScope(),
      !!(ctx.materialFlags & MaterialVaryingFlags.SKIN_ANIMATION),
      !!(ctx.materialFlags & MaterialVaryingFlags.MORPH_ANIMATION),
      !!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)
    );
  }
  /** @internal */
  static setCameraUniforms(bindGroup: BindGroup, ctx: DrawContext, camera: Camera, linear: boolean) {
    const pos = camera.getWorldPosition();
    const useJitter =
      ctx.motionVectors &&
      ctx.renderPass!.type !== RENDER_PASS_TYPE_SHADOWMAP &&
      ctx.renderPass!.type !== RENDER_PASS_TYPE_OBJECT_COLOR;
    const cameraStruct = {
      position: new Vector4(pos.x, pos.y, pos.z, 0),
      renderSize: new Vector2(ctx.renderWidth, ctx.renderHeight),
      viewProjectionMatrix: useJitter ? camera.jitteredVPMatrix : camera.viewProjectionMatrix,
      unjitteredVPMatrix: camera.viewProjectionMatrix,
      jitteredInvVPMatrix: useJitter ? camera.jitteredInvVPMatrix : camera.invViewProjectionMatrix,
      jitterValue: camera.jitterValue,
      invViewProjectionMatrix: camera.invViewProjectionMatrix,
      projectionMatrix: camera.getProjectionMatrix(),
      invProjectionMatrix: camera.getInvProjectionMatrix(),
      viewMatrix: camera.viewMatrix,
      worldMatrix: camera.worldMatrix,
      params: new Vector4(camera.getNearPlane(), camera.getFarPlane(), ctx.flip ? -1 : 1, linear ? 0 : 1),
      roughnessFactor: camera.SSR ? camera.ssrRoughnessFactor : 1,
      shadowDebugCascades: camera.shadowDebugCascades ? 1 : 0,
      frameDeltaTime: ctx.device.frameInfo.elapsedFrame * 0.001,
      elapsedTime: ctx.device.frameInfo.elapsedOverall * 0.001,
      preExposure: this.getPreExposure(ctx),
      framestamp: ctx.device.frameInfo.frameCounter
    } as any;
    if (ctx.motionVectors && ctx.renderPass!.type === RENDER_PASS_TYPE_DEPTH) {
      cameraStruct.prevUnjitteredVPMatrix = camera.prevVPMatrix;
    }
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
      if (ctx.linearDepthTexture) {
        bindGroup.setTexture(UNIFORM_NAME_LINEAR_DEPTH_MAP, ctx.linearDepthTexture);
        bindGroup.setValue(
          UNIFORM_NAME_LINEAR_DEPTH_MAP_SIZE,
          new Vector2(ctx.linearDepthTexture.width, ctx.linearDepthTexture.height)
        );
      }
      if (ctx.sceneColorTexture) {
        bindGroup.setTexture(UNIFORM_NAME_SCENE_COLOR_MAP, ctx.sceneColorTexture);
        bindGroup.setValue(
          UNIFORM_NAME_SCENE_COLOR_MAP_SIZE,
          new Vector2(ctx.sceneColorTexture.width, ctx.sceneColorTexture.height)
        );
      }
      if (ctx.HiZTexture) {
        bindGroup.setTexture(UNIFORM_NAME_HIZ_DEPTH_MAP, ctx.HiZTexture, fetchSampler('clamp_nearest'));
        bindGroup.setValue(
          UNIFORM_NAME_HIZ_DEPTH_MAP_INFO,
          new Vector4(ctx.HiZTexture.width, ctx.HiZTexture.height, ctx.HiZTexture.mipLevelCount, 0)
        );
      }
    }
    bindGroup.setValue('camera', cameraStruct);
  }
  /** @internal */
  static setLightUniformsShadowMap(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    if (light) {
      const shadowMapParams = ctx.shadowMapInfo!.get(light)!;
      bindGroup.setValue('light', {
        positionAndRange: light.positionAndRange,
        directionCutoff: light.directionAndCutoff,
        viewMatrix: light.viewMatrix,
        depthBias: shadowMapParams.depthBiasValues[0],
        implParams: shadowMapParams.impl!.getParams(this._lightUniformShadow.implParams),
        lightType: light.lightType
      });
      shadowMapParams.impl?.applyCasterUniforms(bindGroup, shadowMapParams);
    }
  }
  /** @internal */
  static setFogUniforms(
    bindGroup: BindGroup,
    withAerialPerspective: number,
    fogType: number,
    additive: number,
    atmosphereParams: AtmosphereParams,
    heightFogParams: HeightFogParams,
    aerialPerspectiveLUT: Texture2D,
    skyDistantLightLUT: Texture2D
  ) {
    this._fogUniforms.withAerialPerspective = withAerialPerspective;
    this._fogUniforms.fogType = fogType;
    this._fogUniforms.additive = additive;
    this._fogUniforms.atmosphereParams = atmosphereParams;
    this._fogUniforms.heightFogParams = heightFogParams;
    bindGroup.setValue('fog', this._fogUniforms);
    bindGroup.setTexture(UNIFORM_NAME_AERIALPERSPECTIVE_LUT, aerialPerspectiveLUT);
    bindGroup.setTexture(UNIFORM_NAME_SKYDISTANTLIGHT_LUT, skyDistantLightLUT);
  }
  /**
   * @internal
   *
   * Camera pre-exposure factor for scene-linear lighting quantities.
   *
   * @remarks
   * Physical lighting authors light intensities in photometric units (lux, candela, cd/m²), whose
   * magnitudes (~1e5 for daylight) neither fit an rgba16f render target nor leave usable headroom
   * for specular highlights. Following Filament, the camera exposure is folded into every light
   * quantity on the CPU so the HDR target stays near 1.0 and downstream passes need no unit
   * awareness. Legacy returns 1 so its uploads stay byte-identical.
   */
  static getPreExposure(ctx: DrawContext) {
    return ctx.scene.lightingMode === 'physical' ? ctx.camera.exposure : 1;
  }
  /**
   * @internal
   *
   * Light color/intensity vector with the camera pre-exposure folded into the intensity component.
   *
   * @remarks
   * Only the intensity (`w`) is scaled; the color stays untouched, matching Filament's
   * `FScene::prepareDynamicLights`. The light's own cached vector is never mutated because it is
   * shared across every camera rendering the scene.
   */
  static getPreExposedColorIntensity(light: PunctualLight, ctx: DrawContext, out?: Vector4) {
    const src = light.diffuseAndIntensity;
    const result = out ?? new Vector4();
    result.setXYZW(src.x, src.y, src.z, src.w * this.getPreExposure(ctx));
    return result;
  }
  /**
   * @internal
   *
   * Environment lighting scale uploaded as `light.envLightStrength`.
   *
   * @remarks
   * Legacy uses the unitless {@link EnvLightWrapper.strength}.
   *
   * Physical returns the ratio that converts the cached sky bake from its fixed storage exposure
   * (`SkyRenderer.PHYSICAL_BAKE_EXPOSURE`) to the live camera exposure. Every environment source is
   * normalized into that one space before it reaches the IBL -- the scattering atmosphere emits
   * photometric luminance, authored 0..1 skyboxes/panoramas are lifted by
   * {@link EnvLightWrapper.intensity} -- so no pass consuming `envLightStrength` has to know the
   * sky type.
   *
   * The bake cannot simply hold raw cd/m²: the environment cubemap is `rg11b10uf`/`rgba16f` and a
   * daylight sun overflows it to Inf, which `prefilterCubemap` then spreads across the whole IBL.
   *
   * {@link EnvLightWrapper.strength} multiplies the result in both modes. It is the only per-frame
   * dimmer for environment lighting: the photometric `intensity` reaches the image solely through
   * the cached bake, and a `scatter` sky does not even consult it (its brightness comes from the
   * sun), so without this factor there would be no way to turn the IBL down without re-baking.
   */
  static getEnvLightLuminance(ctx: DrawContext) {
    const env = ctx.env;
    if (!env) {
      return 0;
    }
    const strength = env.light.strength ?? 0;
    return ctx.scene.lightingMode === 'physical'
      ? (this.getPreExposure(ctx) / PHYSICAL_BAKE_EXPOSURE) * strength
      : strength;
  }
  /** @internal */
  static setLightUniforms(
    bindGroup: BindGroup,
    ctx: DrawContext,
    clusterParams: Float32Array<ArrayBuffer>,
    countParams: Int32Array<ArrayBuffer>,
    lightBuffer: StructuredBuffer,
    lightIndexTexture: Texture2D
  ) {
    const envLightStrength = this.getEnvLightLuminance(ctx);
    bindGroup.setValue('light', {
      sunDir: ctx.sunLight ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1) : this.defaultSunDir,
      clusterParams: clusterParams,
      countParams: countParams,
      envLightStrength,
      envLightSpecularStrength: ctx.env!.light.specularStrength ?? 1,
      lightIndexTexSize: new Int32Array([lightIndexTexture.width, lightIndexTexture.height]),
      ...(ctx.screenSpaceShadowMask ? { numShadowLights: ctx.clusteredLight?.numShadowLights ?? 0 } : {})
    });
    bindGroup.setBuffer(UNIFORM_NAME_LIGHT_BUFFER, lightBuffer);
    bindGroup.setTexture(UNIFORM_NAME_LIGHT_INDEX_TEXTURE, lightIndexTexture);
    if (ctx.screenSpaceShadowMask) {
      // The mask array is declared for the clustered light pass whenever the flag is
      // on (keyed into the global bind group hash). When there are no shadow lights
      // this frame the mask is never sampled, but a valid array texture must still
      // be bound: fall back to a 1x1 dummy.
      bindGroup.setTexture(
        UNIFORM_NAME_SHADOW_MASK,
        ctx.shadowMaskTexture ?? this.getDummyShadowMask(ctx.device),
        fetchSampler('clamp_nearest')
      );
    }
    bindGroup.setTexture(UNIFORM_NAME_BAKED_SKY_MAP, ctx.scene.env.sky.getBakedSkyTexture(ctx));
    if (ctx.drawEnvLight) {
      ctx.env!.light.envLight.updateBindGroup(bindGroup, ctx);
    }
  }
  /** @internal */
  static setLightUniformsShadow(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    const shadowMapParams = ctx.shadowMapInfo!.get(light)!;
    this._lightUniformShadow.sunDir = ctx.sunLight
      ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1)
      : this.defaultSunDir;
    this._lightUniformShadow.shadowCascades = shadowMapParams.numShadowCascades;
    this._lightUniformShadow.positionAndRange.set(light.positionAndRange);
    this._lightUniformShadow.directionAndCutoff.set(light.directionAndCutoff);
    this.getPreExposedColorIntensity(light, ctx, this._lightUniformShadow.diffuseAndIntensity);
    this._lightUniformShadow.extraParams.set(light.extraParams);
    this._lightUniformShadow.cascadeDistances.set(shadowMapParams.cascadeDistances);
    this._lightUniformShadow.depthBiasValues.set(shadowMapParams.depthBiasValues[0]);
    this._lightUniformShadow.shadowCameraParams.set(shadowMapParams.cameraParams);
    this._lightUniformShadow.depthBiasScales.set(shadowMapParams.depthBiasScales);
    shadowMapParams.impl!.getParams(this._lightUniformShadow.implParams);
    this._lightUniformShadow.shadowMatrices.set(shadowMapParams.shadowMatrices);
    this._lightUniformShadow.shadowStrength = light.shadow.shadowStrength;
    this._lightUniformShadow.envLightStrength = this.getEnvLightLuminance(ctx);
    this._lightUniformShadow.envLightSpecularStrength = ctx.env?.light.specularStrength ?? 1;
    bindGroup.setValue('light', this._lightUniformShadow);
    bindGroup.setTexture(
      UNIFORM_NAME_SHADOW_MAP,
      shadowMapParams.shadowMap!,
      shadowMapParams.shadowMapSampler
    );
    bindGroup.setTexture(UNIFORM_NAME_BAKED_SKY_MAP, ctx.scene.env.sky.getBakedSkyTexture(ctx));
    if (ctx.drawEnvLight) {
      ctx.env!.light.envLight.updateBindGroup(bindGroup, ctx);
    }
  }
  /**
   * Gets the uniform variable of type float which holds the strength of the environment light
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The uniform variable of which presents the strength of the environment light
   */
  static getEnvLightStrength(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.envLightStrength;
  }
  /**
   * Gets the uniform variable of type float which holds the specular strength of the environment light
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The uniform variable which presents the specular strength of the environment light
   */
  static getEnvLightSpecularStrength(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.envLightSpecularStrength ?? scope.$builder.float(1);
  }
  /**
   * Gets current scene color texture
   * @param scope - Current shader scope
   * @returns current scene color texture
   */
  static getSceneColorTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_SCENE_COLOR_MAP];
  }
  /**
   * Gets the size of current scene color texture
   * @param scope - Current shader scope
   * @returns The size of current scene color texture
   */
  static getSceneColorTextureSize(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_SCENE_COLOR_MAP_SIZE];
  }
  /**
   * Gets current linear depth texture
   * @param scope - Current shader scope
   * @returns current linear depth texture
   */
  static getLinearDepthTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_LINEAR_DEPTH_MAP];
  }
  /**
   * Gets the size of current linear depth texture
   * @param scope - Current shader scope
   * @returns The size of current linear depth texture
   */
  static getLinearDepthTextureSize(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_LINEAR_DEPTH_MAP_SIZE];
  }
  /**
   * Gets current HiZ depth texture
   * @param scope - Current shader scope
   * @returns current HiZ depth texture
   */
  static getHiZDepthTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_HIZ_DEPTH_MAP];
  }
  /**
   * Gets the size of current HiZ depth texture
   * @param scope - Current shader scope
   * @returns The size of current HiZ depth texture
   */
  static getHiZDepthTextureSize(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_HIZ_DEPTH_MAP_INFO].xy;
  }
  /**
   * Gets the mipmap levels count of current HiZ depth texture
   * @param scope - Current shader scope
   * @returns The mipmap levels count of current HiZ depth texture
   */
  static getHiZDepthTextureMipLevelCount(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_HIZ_DEPTH_MAP_INFO].z;
  }
  /**
   * Gets current baked skybox texture
   * @param scope - Current shader scope
   * @returns current baked skybox texture
   */
  static getBakedSkyTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_BAKED_SKY_MAP];
  }
  /**
   * Samples the baked sky cubemap in the same pre-exposed space as the scene color buffer.
   *
   * @remarks
   * The bake is cached and therefore exposure-independent, stored at the fixed
   * `PHYSICAL_BAKE_EXPOSURE`. Anything that blends it against already-pre-exposed lit color (water
   * reflection, blueprint sky lookups) must first convert it to the live exposure.
   * `envLightStrength` carries exactly that ratio in physical mode, and the legacy environment
   * strength (its established meaning) otherwise.
   *
   * @param scope - Current shader scope
   * @param direction - Sampling direction
   * @returns Pre-exposed sky radiance
   */
  static sampleBakedSkyPreExposed(scope: PBInsideFunctionScope, direction: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return pb.mul(
      pb.textureSampleLevel(this.getBakedSkyTexture(scope), direction, 0).rgb,
      this.getEnvLightStrength(scope)
    ) as PBShaderExp;
  }
  /**
   * Gets the camera pre-exposure factor.
   *
   * @remarks
   * The multiplier every photometric quantity is scaled by before it reaches the HDR target. 1 in
   * legacy. Use it for material-authored emitters (emissive), which are not covered by the CPU-side
   * light pre-exposure.
   *
   * @param scope - Current shader scope
   * @returns The pre-exposure factor
   */
  static getPreExposureUniform(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.preExposure;
  }
  /**
   * Gets the elapsed time in seconds
   * @param scope - Current shader scope
   * @returns The elapsed time in seconds
   */
  static getElapsedTime(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.elapsedTime;
  }
  /**
   * Gets the elapsed time since last frame in seconds
   * @param scope - Current shader scope
   * @returns The elapsed time since last frame in seconds
   */
  static getElapsedTimeFrame(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.frameDeltaTime;
  }
  /**
   * Gets the uniform variable of type vec3 which holds the camera position
   * @param scope - Current shader scope
   * @returns The camera position
   */
  static getCameraPosition(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.position.xyz;
  }
  /**
   * Gets the uniform variable of type float which holds the roughness factor
   * @param scope - Current shader scope
   * @returns The roughness factor
   */
  static getCameraRoughnessFactor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.roughnessFactor;
  }
  /**
   * Gets framebuffer size for rendering
   * @param scope - Current shader scope
   * @returns The roughness factor
   */
  static getRenderSize(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.renderSize;
  }
  /**
   * Gets the uniform variable of type uint which holds the framestamp
   * @param scope - Current shader scope
   * @returns The framestamp
   */
  static getFramestamp(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.framestamp;
  }
  /**
   * Gets the clip plane flag
   * @param scope - Current shader scope
   * @returns A float value of 1 indices the clip plane presents, otherwise 0
   */
  static getCameraClipPlaneFlag(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.position.w;
  }
  /**
   * Gets the clip plane
   * @param scope - Current shader scope
   * @returns A vec4 presents the clip plane
   */
  static getCameraClipPlane(scope: PBInsideFunctionScope) {
    return scope.camera.clipPlane;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the camera parameters
   * @param scope - Current shader scope
   * @returns The camera parameters
   */
  static getCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.params;
  }
  /** @internal */
  static getClusterParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.clusterParams;
  }
  /** @internal */
  static getCountParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.countParams;
  }
  /**
   * Number of shadow-casting lights at the head of the clustered light buffer.
   * Only defined on the screen-space shadow mask path (ctx.screenSpaceShadowMask);
   * a clustered light whose buffer index is `<= N` samples the shadow mask.
   * @internal
   */
  static getNumShadowLights(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.numShadowLights;
  }
  /**
   * Cluster shadow-mask mode for the current queue: 1 = sample the opaque shadow
   * mask for shadow lights; 0 = skip shadow lights (they are lit inline by the
   * additive passes, used for the transparent queue). Only defined on the
   * screen-space shadow mask path.
   * @internal
   */
  static getShadowMaskMode(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_SHADOW_MASK_MODE];
  }
  /**
   * Bind the per-queue cluster shadow-mask mode. Call in the clustered light pass
   * only when the screen-space shadow mask path is active.
   * @internal
   */
  static setShadowMaskMode(bindGroup: BindGroup, sampleMask: boolean) {
    bindGroup.setValue(UNIFORM_NAME_SHADOW_MASK_MODE, sampleMask ? 1 : 0);
  }
  /**
   * Lazily-created 1x1x1 rgba8unorm array texture used as the shadow-mask binding
   * fallback when the screen-space shadow mask path is enabled but no mask was
   * produced this frame (no shadow-casting lights). It is never sampled in that
   * case, but the declared uniform still requires a valid binding.
   * @internal
   */
  static getDummyShadowMask(device: AbstractDevice): Texture2DArray {
    let tex = this._dummyShadowMask;
    if (!tex || tex.disposed) {
      tex = device.createTexture2DArray('rgba8unorm', 1, 1, 1, {
        mipmapping: false
      })!;
      tex.name = 'DummyShadowMask';
      this._dummyShadowMask = tex;
    }
    return tex;
  }
  /** @internal */
  static getClusteredLightIndexTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE];
  }
  /**
   * Clustered shadow factor for a light, in `[0,1]` (1 = fully lit).
   *
   * - Lights whose clustered buffer index is greater than `numShadowLights` are not
   *   shadow-casters and return 1.0.
   * - Shadow-casting lights on the opaque queue (shadow mask mode 1) return the
   *   screen-space mask value. Layer/channel are derived from the zero-based light
   *   ordinal `s = index-1`: `layer = s >> 2`, `channel = s & 3`, matching the
   *   ShadowMaskPass packing.
   * - Shadow-casting lights on a transparent queue (mode 0) return 0: their clustered
   *   contribution is suppressed because they are lit inline by the additive passes,
   *   where shadows are sampled at the true (transparent) surface depth rather than
   *   from the opaque-depth mask.
   *
   * Only valid on the screen-space shadow mask path (ctx.screenSpaceShadowMask).
   * @internal
   */
  static sampleShadowMask(scope: PBInsideFunctionScope, lightIndex: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_sampleShadowMask';
    pb.func(funcName, [pb.int('lightIndex')], function () {
      this.$if(pb.greaterThan(this.lightIndex, that.getNumShadowLights(this)), function () {
        this.$return(pb.float(1));
      });
      // Shadow light on a transparent queue: suppressed here, lit inline by additive.
      this.$if(pb.equal(that.getShadowMaskMode(this), 0), function () {
        this.$return(pb.float(0));
      });
      this.$l.ordinal = pb.sub(this.lightIndex, 1);
      this.$l.layer = pb.div(this.ordinal, 4);
      this.$l.channel = pb.sub(this.ordinal, pb.mul(this.layer, 4));
      this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), that.getRenderSize(this));
      this.$l.texel = pb.textureArraySampleLevel(this[UNIFORM_NAME_SHADOW_MASK], this.uv, this.layer, 0);
      // Select the light's channel via a dot with a one-hot mask (dynamic vector
      // component indexing is not portable across GLSL ES / WGSL).
      this.$l.selector = pb.vec4(
        pb.float(pb.equal(this.channel, 0)),
        pb.float(pb.equal(this.channel, 1)),
        pb.float(pb.equal(this.channel, 2)),
        pb.float(pb.equal(this.channel, 3))
      );
      this.$return(pb.dot(this.texel, this.selector));
    });
    return pb.getGlobalScope()[funcName](lightIndex);
  }
  /**
   * Gets the uniform variable that contains atmosphere parameters
   * @param scope - Current shader scope
   * @returns The atmosphere parameters
   */
  static getAtmosphereParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.fog.atmosphereParams;
  }
  /**
   * Gets the aerial perspective LUT
   * @param scope - Current shader scope
   * @returns The aerial perspective LUT texture
   */
  static getAerialPerspectiveLUT(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_AERIALPERSPECTIVE_LUT];
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The view projection matrix of current camera
   */
  static getViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.viewProjectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the inversed view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The inversed view projection matrix of current camera
   */
  static getInvViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.invViewProjectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The projection matrix of current camera
   */
  static getProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.projectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the inversed projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The inversed projection matrix of current camera
   */
  static getInvProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.invProjectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the unjittered view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The unjittered view projection matrix of current camera
   */
  static getUnjitteredViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.unjitteredVPMatrix;
  }
  /**
   * Gets the uniform variable of type vec2 which holds the jitter value of the projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The jitter value of projection matrix of current camera
   */
  static getProjectionMatrixJitterValue(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.jitterValue;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the jittered inversed view-projection matrix
   * @param scope - Current shader scope
   * @returns The jittered inversed view-projection matrix
   */
  static getJitteredInvVPMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.jitteredInvVPMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the unjittered view projection at previous frame matrix of current camera
   * @param scope - Current shader scope
   * @returns The unjittered view projection matrix at previous frame of current camera
   */
  static getPrevUnjitteredViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.prevUnjitteredVPMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view matrix of current camera (world space to camera space)
   * @param scope - Current shader scope
   * @returns The view matrix of current camera
   */
  static getViewMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.viewMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the inv-view matrix of current camera (camera space to world space)
   * @param scope - Current shader scope
   * @returns The inv-view matrix of current camera
   */
  static getInvViewMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.camera.worldMatrix;
  }
  /** @internal */
  static getCascadeDistances(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.cascadeDistances;
  }
  /** @internal */
  static getShadowImplParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.implParams;
  }
  /** @internal */
  static getDepthBiasValues(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.depthBiasValues;
  }
  /** @internal */
  static getShadowCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.shadowCameraParams;
  }
  /** @internal */
  static getDepthBiasScales(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.depthBiasScales;
  }
  /** @internal */
  static getNumLights(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.numLights;
  }
  /** @internal */
  static getSunLightDir(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.sunDir;
  }
  /** @internal */
  static getLightTypeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.lightType;
  }
  /** @internal */
  static getLightPositionAndRangeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.positionAndRange;
  }
  /** @internal */
  static getLightViewMatrixForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.light.viewMatrix;
  }
  /** @internal */
  static calculateShadowSpaceVertex(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    cascade: PBShaderExp | number = 0
  ): PBShaderExp {
    const pb = scope.$builder;
    if (typeof cascade === 'number') {
      return pb.vec4(
        pb.dot(scope.light.shadowMatrices.at(cascade * 4 + 0), worldPos),
        pb.dot(scope.light.shadowMatrices.at(cascade * 4 + 1), worldPos),
        pb.dot(scope.light.shadowMatrices.at(cascade * 4 + 2), worldPos),
        pb.dot(scope.light.shadowMatrices.at(cascade * 4 + 3), worldPos)
      );
    } else {
      return pb.vec4(
        pb.dot(scope.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 0)), worldPos),
        pb.dot(scope.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 1)), worldPos),
        pb.dot(scope.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 2)), worldPos),
        pb.dot(scope.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 3)), worldPos)
      );
    }
  }
  /** @internal */
  static getLightPositionAndRange(
    scope: PBInsideFunctionScope,
    lightIndex: PBShaderExp | number
  ): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.mul(lightIndex, 4));
  }
  /** @internal */
  static getLightDirectionAndCutoff(
    scope: PBInsideFunctionScope,
    lightIndex: PBShaderExp | number
  ): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.add(scope.$builder.mul(lightIndex, 4), 1));
  }
  /** @internal */
  static getLightColorAndIntensity(
    scope: PBInsideFunctionScope,
    lightIndex: PBShaderExp | number
  ): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.add(scope.$builder.mul(lightIndex, 4), 2));
  }
  /** @internal */
  static getLightExtra(scope: PBInsideFunctionScope, lightIndex: PBShaderExp | number): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.add(scope.$builder.mul(lightIndex, 4), 3));
  }
  /**
   * Sets the clip space position in vertex shader
   *
   * @remarks
   * Use this function instead of using
   * <pre>
   * // Do not use this
   * this.$builtins.position = some_value;
   * // Use this
   * ShaderFramework.setClipSpacePosition(some_value);
   * </pre>,
   *
   * @param scope - Current shader scope
   * @param pos - The clip space position to be set
   */
  static setClipSpacePosition(scope: PBInsideFunctionScope, pos: PBShaderExp): void {
    const pb = scope.$builder;
    const cameraParams = this.getCameraParams(scope);
    if (cameraParams) {
      scope.$builtins.position = pb.mul(pos, pb.vec4(1, cameraParams.z, 1, 1));
    } else {
      scope.$builtins.position = pos;
    }
  }
  /**
   * Get shadow map uniform value
   *
   * @param scope - Shader scope
   * @returns The shadow map texture uniform
   */
  static getShadowMap(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_SHADOW_MAP];
  }
  /**
   * Per-cascade scale for both bias terms.
   *
   * @remarks
   * Only `depthBiasValues[0]` is uploaded; every cascade's value is recovered by
   * multiplying with this ratio. It is derived from the `.x` components, but
   * since `.x` and the normal offset `.y` are both proportional to the cascade's
   * texel world size, the same ratio applies to either.
   * @internal
   */
  static getShadowCascadeBiasScale(scope: PBInsideFunctionScope, split: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const splitFlags = pb.vec4(
      pb.float(pb.equal(split, 0)),
      pb.float(pb.equal(split, 1)),
      pb.float(pb.equal(split, 2)),
      pb.float(pb.equal(split, 3))
    );
    return pb.dot(this.getDepthBiasScales(scope), splitFlags) as PBShaderExp;
  }
  /**
   * Moves the receiver along its normal before the shadow lookup.
   *
   * @remarks
   * Grazing-angle self-shadowing cannot be fixed with a depth bias: the depth
   * spanned by one shadow texel is `texelWorldSize * tan(theta)`, which diverges
   * as NdotL approaches zero. Offsetting the sample position sideways moves it
   * out of the offending texel instead, and the required distance is bounded.
   *
   * `depthBiasValues.y` carries the world-space distance of one `normalBias`
   * unit (see `ShadowMapper.calcDepthBiasParams`).
   * @internal
   */
  static applyShadowNormalOffset(
    lightType: number,
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    NdotL: PBShaderExp,
    cascadeScale?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const depthBiasParam = this.getDepthBiasValues(scope);
    const receiverNoL = getShadowReceiverNoL(scope, NdotL, lightType);
    // sin(theta): 0 when facing the light, 1 at grazing incidence.
    const sinTheta = pb.sqrt(pb.clamp(pb.sub(1, pb.mul(receiverNoL, receiverNoL)), 0, 1));
    let offset = pb.mul(depthBiasParam.y, getShadowReceiverBiasFactor(scope), sinTheta) as PBShaderExp;
    if (cascadeScale) {
      offset = pb.mul(offset, cascadeScale) as PBShaderExp;
    }
    if (lightType !== LIGHT_TYPE_DIRECTIONAL) {
      // Perspective shadow cameras: one texel covers more world space further
      // from the light. depthBiasValues.w is the far/near footprint ratio.
      const posRange = this.getLightPositionAndRangeForShadow(scope);
      const linearDepth = pb.clamp(
        pb.div(pb.distance(worldPos, posRange.xyz), pb.max(posRange.w, 1e-6)),
        0,
        1
      );
      offset = pb.mul(offset, pb.mix(1, depthBiasParam.w, linearDepth)) as PBShaderExp;
    }
    // Guard against a degenerate interpolated normal rather than normalize()ing
    // a possibly-zero vector into NaN.
    const unitNormal = pb.mul(worldNormal, pb.div(1, pb.max(pb.length(worldNormal), 1e-6)));
    return pb.add(worldPos, pb.mul(unitNormal, offset)) as PBShaderExp;
  }
  /**
   * Calculates shadow of current fragment
   *
   * @param scope - Shader scope
   * @param NoL - NdotL vector
   * @returns Shadow of current fragment, 1 means no shadow and 0 means full shadowed.
   */
  static calculateShadow(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    NoL: PBShaderExp,
    ctx: DrawContext
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const shadowMapParams = ctx.shadowMapInfo!.get(ctx.currentShadowLight!)!;
    const funcName = 'Z_calculateShadow';
    pb.func(funcName, [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('NoL')], function () {
      if (shadowMapParams.numShadowCascades > 1) {
        this.$l.shadowCascades = this.light.shadowCascades;
        this.$l.shadowBound = pb.vec4(0, 0, 1, 1);
        this.$l.linearDepth = that.nonLinearDepthToLinear(this, this.$builtins.fragCoord.z);
        this.$l.splitDistances = that.getCascadeDistances(this);
        this.$l.comparison = pb.vec4(pb.greaterThan(pb.vec4(this.linearDepth), this.splitDistances));
        this.$l.cascadeFlags = pb.vec4(
          pb.float(pb.greaterThan(this.shadowCascades, 0)),
          pb.float(pb.greaterThan(this.shadowCascades, 1)),
          pb.float(pb.greaterThan(this.shadowCascades, 2)),
          pb.float(pb.greaterThan(this.shadowCascades, 3))
        );
        this.$l.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
        // Normal offset bias: move the receiver out of the shadow texel that
        // would self-occlude it before projecting into shadow space. Scaled per
        // cascade, because each cascade has its own texel world size.
        this.$l.biasedPos = that.applyShadowNormalOffset(
          shadowMapParams.lightType,
          this,
          this.worldPos,
          this.worldNormal,
          this.NoL,
          that.getShadowCascadeBiasScale(this, this.split)
        );
        if (ctx.device.type === 'webgl') {
          this.$l.shadowVertex = pb.vec4();
          this.$for(pb.int('cascade'), 0, 4, function () {
            this.$if(pb.equal(this.cascade, this.split), function () {
              this.shadowVertex = that.calculateShadowSpaceVertex(
                this,
                pb.vec4(this.biasedPos, 1),
                this.cascade
              );
              this.$break();
            });
          });
        } else {
          this.$l.shadowVertex = that.calculateShadowSpaceVertex(
            this,
            pb.vec4(this.biasedPos, 1),
            this.split
          );
        }
        this.$l.shadow = shadowMapParams.impl!.computeShadowCSM(
          shadowMapParams,
          this,
          this.shadowVertex,
          this.NoL,
          this.split
        );
        this.shadow = pb.clamp(this.shadow, 0, 1);
        this.$l.shadowDistance = that.getShadowCameraParams(scope).w;
        this.shadow = pb.mix(
          this.shadow,
          1,
          pb.smoothStep(
            pb.mul(this.shadowDistance, 0.8),
            this.shadowDistance,
            pb.distance(that.getCameraPosition(this), this.worldPos)
          )
        );
        this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
        this.shadow = pb.clamp(this.shadow, 0, 1);
        this.$if(pb.greaterThan(this.camera.shadowDebugCascades, 0.5), function () {
          this.shadow = pb.add(pb.mul(pb.float(this.split), 0.2), 0.2);
        });
        this.$return(this.shadow);
      } else {
        // Normal offset bias - see the cascaded branch above.
        this.$l.biasedPos = that.applyShadowNormalOffset(
          shadowMapParams.lightType,
          this,
          this.worldPos,
          this.worldNormal,
          this.NoL
        );
        this.$l.shadowVertex = that.calculateShadowSpaceVertex(this, pb.vec4(this.biasedPos, 1));
        this.$l.shadow = shadowMapParams.impl!.computeShadow(
          shadowMapParams,
          this,
          this.shadowVertex,
          this.NoL
        );
        this.shadow = pb.clamp(this.shadow, 0, 1);
        this.$l.shadowDistance = that.getShadowCameraParams(scope).w;
        this.shadow = pb.mix(
          this.shadow,
          1,
          pb.smoothStep(
            pb.mul(this.shadowDistance, 0.8),
            this.shadowDistance,
            pb.distance(that.getCameraPosition(this), this.worldPos)
          )
        );
        this.shadow = pb.mix(1, this.shadow, this.light.shadowStrength);
        this.shadow = pb.clamp(this.shadow, 0, 1);
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcName](worldPos, worldNormal, NoL);
  }
  static applyFog(scope: PBInsideFunctionScope, worldPos: PBShaderExp, color: PBShaderExp, ctx: DrawContext) {
    const pb = scope.$builder;
    const that = this;
    if (ctx.materialFlags & MaterialVaryingFlags.APPLY_FOG) {
      const funcName = 'Z_applyFog';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('color').inout()], function () {
        this.$if(pb.notEqual(this.fog.additive, 0), function () {
          this.$return();
        });
        this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), that.getRenderSize(this));
        this.$l.fogging = calculateFog(
          this,
          this.fog.withAerialPerspective,
          this.fog.fogType,
          this.fog.atmosphereParams,
          this.fog.heightFogParams,
          this.uv,
          false,
          that.getCameraPosition(this).xyz,
          this.worldPos,
          this.fog.additive,
          this[UNIFORM_NAME_AERIALPERSPECTIVE_LUT],
          this[UNIFORM_NAME_SKYDISTANTLIGHT_LUT]
        );
        this.$l.foggingAlpha = pb.sub(1, pb.mul(pb.sub(1, this.fogging.a), this.color.a));
        this.$l.foggingRGB = pb.mul(this.fogging.rgb, this.color.a);
        this.color = pb.vec4(
          pb.add(pb.mul(this.color.rgb, this.foggingAlpha), this.foggingRGB),
          this.color.a
        );
        //this.color = pb.vec4(pb.vec3(pb.mix(this.u0, this.u1, this.factor)), this.color.a);
      });
      scope[funcName](worldPos, color);
    }
  }
  /**
   * Calculates the non-linear depth from linear depth
   *
   * @param scope - Current shader scope
   * @param depth - The linear depth
   * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
   * @returns The calculated non-linear depth
   */
  static linearDepthToNonLinear(
    scope: PBInsideFunctionScope,
    depth: PBShaderExp,
    nearFar?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    nearFar = nearFar ?? this.getCameraParams(scope);
    if (REVERSE_Z) {
      return pb.div(
        pb.sub(pb.div(pb.mul(nearFar.x, nearFar.y), depth), nearFar.x),
        pb.sub(nearFar.y, nearFar.x)
      );
    }
    return pb.div(
      pb.sub(nearFar.y, pb.div(pb.mul(nearFar.x, nearFar.y), depth)),
      pb.sub(nearFar.y, nearFar.x)
    );
  }
  /**
   * Calculates the linear depth from non-linear depth
   *
   * @param scope - Current shader scope
   * @param depth - The non-linear depth
   * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
   * @returns The calculated linear depth
   */
  static nonLinearDepthToLinear(
    scope: PBInsideFunctionScope,
    depth: PBShaderExp,
    nearFar?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    nearFar = nearFar ?? this.getCameraParams(scope);
    if (REVERSE_Z) {
      return pb.div(pb.mul(nearFar.x, nearFar.y), pb.mix(nearFar.x, nearFar.y, depth));
    }
    return pb.div(pb.mul(nearFar.x, nearFar.y), pb.mix(nearFar.y, nearFar.x, depth));
  }
  /**
   * Calculates the normalized linear depth from non-linear depth
   *
   * @param scope - Current shader scope
   * @param depth - The non-linear depth
   * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
   * @returns The calculated normalized linear depth
   */
  static nonLinearDepthToLinearNormalized(
    scope: PBInsideFunctionScope,
    depth: PBShaderExp,
    nearFar?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    nearFar = nearFar ?? this.getCameraParams(scope);
    if (REVERSE_Z) {
      return pb.div(nearFar.x, pb.mix(nearFar.x, nearFar.y, depth));
    }
    return pb.div(nearFar.x, pb.mix(nearFar.y, nearFar.x, depth));
  }
  /**
   * Converts normalized linear depth back to device non-linear depth.
   *
   * @remarks
   * The normalized linear depth convention (range [near/far, 1] with 1 at
   * the far plane, as produced by {@link ShaderHelper.nonLinearDepthToLinearNormalized})
   * is independent of the engine depth convention; only the mapping to
   * device depth flips under reverse-Z.
   *
   * @param scope - Current shader scope
   * @param depth - The normalized linear depth
   * @param nearFar - A vector that contains the near clip plane in x component and the far clip plane in y component
   * @returns The device non-linear depth
   */
  static linearNormalizedToNonLinearDepth(
    scope: PBInsideFunctionScope,
    depth: PBShaderExp,
    nearFar?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    nearFar = nearFar ?? this.getCameraParams(scope);
    if (REVERSE_Z) {
      return pb.div(pb.sub(pb.div(nearFar.x, depth), nearFar.x), pb.sub(nearFar.y, nearFar.x));
    }
    return pb.div(pb.sub(pb.div(nearFar.x, depth), nearFar.y), pb.sub(nearFar.x, nearFar.y));
  }
  /**
   * Maps a device depth value to the canonical clip-space z coordinate
   * (GL [-1,1] under standard-Z, zero-to-one under reverse-Z), suitable for
   * unprojection with the engine's inverse projection matrices.
   *
   * @param scope - Current shader scope
   * @param depth - The device depth value
   * @returns The canonical clip-space z
   */
  static deviceDepthToClipZ(scope: PBInsideFunctionScope, depth: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return REVERSE_Z ? depth : pb.sub(pb.mul(depth, 2), 1);
  }
  /**
   * Clip-space z that places a vertex exactly on the far plane (sky domes,
   * background geometry).
   *
   * @param scope - Current shader scope
   * @param w - The clip-space w coordinate of the vertex
   * @returns The clip-space z value for the far plane
   */
  static farthestClipZ(scope: PBInsideFunctionScope, w: PBShaderExp): PBShaderExp | number {
    return REVERSE_Z ? 0 : w;
  }
  /**
   * Tests whether a device depth value equals the cleared (farthest) depth,
   * i.e. no geometry was rendered at this position.
   *
   * @param scope - Current shader scope
   * @param depth - The device depth value
   * @returns Boolean expression, true for background pixels
   */
  static isFarthestDepth(scope: PBInsideFunctionScope, depth: PBShaderExp): PBShaderExp {
    return scope.$builder.equal(depth, DEPTH_FARTHEST);
  }
  /**
   * Selects the closer of two device depth values.
   *
   * @param scope - Current shader scope
   * @param a - First device depth value
   * @param b - Second device depth value
   * @returns The value closer to the camera
   */
  static closerDepth(scope: PBInsideFunctionScope, a: PBShaderExp, b: PBShaderExp): PBShaderExp {
    return scope.$builder[DEPTH_REDUCE_CLOSER](a, b);
  }
  /**
   * Selects the farther of two device depth values.
   *
   * @param scope - Current shader scope
   * @param a - First device depth value
   * @param b - Second device depth value
   * @returns The value farther from the camera
   */
  static fartherDepth(scope: PBInsideFunctionScope, a: PBShaderExp, b: PBShaderExp): PBShaderExp {
    return scope.$builder[DEPTH_REDUCE_FARTHER](a, b);
  }
  /**
   * Sample linear depth from linear depth texture
   * @param scope - Current shader scope
   * @param tex - The linear depth texture
   * @param uv - The uv coordinates
   * @param level - The mipmap level to sample
   * @returns Linear depth value
   */
  static sampleLinearDepth(
    scope: PBInsideFunctionScope,
    tex: PBShaderExp,
    uv: PBShaderExp,
    level: PBShaderExp | number
  ): PBShaderExp {
    const pb = scope.$builder;
    const depth = pb.textureSampleLevel(tex, uv, level);
    return pb.getDevice().type === 'webgl' ? decodeNormalizedFloatFromRGBA(scope, depth) : depth.r;
  }
  static samplePositionFromDepth(
    scope: PBInsideFunctionScope,
    depthTex: PBShaderExp,
    uv: PBShaderExp,
    mat: PBShaderExp,
    cameraNearFar: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    pb.func(
      'zSamplePositionFromDepth',
      [pb.vec2('uv'), pb.vec2('cameraNearFar'), pb.mat4('mat')],
      function () {
        this.$l.linearDepth = that.sampleLinearDepth(this, depthTex, this.uv, 0);
        this.$l.nonLinearDepth = that.linearNormalizedToNonLinearDepth(
          this,
          this.linearDepth,
          this.cameraNearFar
        );
        this.$l.clipSpacePos = pb.vec4(
          pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
          that.deviceDepthToClipZ(this, pb.clamp(this.nonLinearDepth, 0, 1)),
          1
        );
        this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
        this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
      }
    );
    return scope.zSamplePositionFromDepth(uv, cameraNearFar, mat);
  }
  /**
   * Sample linear depth from linear depth texture with backface
   * @param scope - Current shader scope
   * @param tex - The linear depth texture
   * @param uv - The uv coordinates
   * @param level - The mipmap level to sample
   * @returns Linear depth value
   */
  static sampleLinearDepthWithBackface(
    scope: PBInsideFunctionScope,
    tex: PBShaderExp,
    uv: PBShaderExp,
    level: PBShaderExp | number
  ): PBShaderExp {
    const pb = scope.$builder;
    return pb.textureSampleLevel(tex, uv, level).rg;
  }
  /**
   * Transform color to sRGB color space if nessesary
   *
   * @param scope - Current shader scope
   * @param outputColor - The color to be transformed
   * @returns The transformed color
   */
  static encodeColorOutput(scope: PBInsideFunctionScope, outputColor: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const funcName = 'Z_encodeColorOutput';
    pb.func(funcName, [pb.vec4('outputColor')], function () {
      const params = that.getCameraParams(this);
      this.$if(pb.notEqual(params.w, 0), function () {
        this.$return(pb.vec4(linearToGamma(this, this.outputColor.rgb), this.outputColor.w));
      }).$else(function () {
        this.$return(this.outputColor);
      });
    });
    return pb.getGlobalScope()[funcName](outputColor);
  }
  /** @internal */
  static getMaxClusterLights() {
    return getDevice().type === 'webgl' ? 64 : 255;
  }
}
