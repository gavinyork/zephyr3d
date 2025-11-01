import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../../render/drawable';
import {
  MaterialVaryingFlags,
  MAX_CLUSTERED_LIGHTS,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_POSITION,
  MORPH_TARGET_TANGENT,
  MORPH_WEIGHTS_VECTOR_COUNT,
  RENDER_PASS_TYPE_DEPTH,
  RENDER_PASS_TYPE_LIGHT,
  RENDER_PASS_TYPE_OBJECT_COLOR,
  RENDER_PASS_TYPE_SHADOWMAP
} from '../../values';
import type {
  BindGroup,
  PBShaderExp,
  PBInsideFunctionScope,
  StructuredBuffer,
  Texture2D,
  PBGlobalScope,
  BindGroupLayout
} from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import type { PunctualLight } from '../../scene/light';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../../shaders/misc';
import { fetchSampler } from '../../utility/misc';
import type { AtmosphereParams } from '../../shaders';
import { getAtmosphereParamsStruct, getDefaultAtmosphereParams } from '../../shaders';
import type { HeightFogParams } from '../../shaders/fog';
import { calculateFog, getDefaultHeightFogParams, getHeightFogParamsStruct } from '../../shaders/fog';
import { getDevice } from '../../app/api';

const UNIFORM_NAME_LIGHT_BUFFER = 'Z_UniformLightBuffer';
const UNIFORM_NAME_LIGHT_INDEX_TEXTURE = 'Z_UniformLightIndexTex';
const UNIFORM_NAME_BAKED_SKY_MAP = 'Z_UniformBakedSky';
const UNIFORM_NAME_AERIALPERSPECTIVE_LUT = 'Z_UniformAerialPerspectiveLUT';
const UNIFORM_NAME_SKYDISTANTLIGHT_LUT = 'Z_UniformSkyDistantLightLUT';
const UNIFORM_NAME_SHADOW_MAP = 'Z_UniformShadowMap';
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
  /** @internal */
  private static readonly SKIN_MATRIX_NAME = 'Z_SkinMatrix';
  private static readonly SKIN_PREV_MATRIX_NAME = 'Z_PrevSkinMatrix';
  private static readonly SKIN_BONE_OFFSET = 'Z_boneOffset';
  /** @internal */
  private static _drawableBindGroupLayouts: Record<string, BindGroupLayout> = {};
  /** @internal */
  private static readonly _lightUniformShadow = {
    sunDir: new Vector3(),
    envLightStrength: 1,
    shadowCascades: 1,
    positionAndRange: new Vector4(),
    directionAndCutoff: new Vector4(),
    diffuseAndIntensity: new Vector4(),
    cascadeDistances: new Vector4(),
    depthBiasValues: new Vector4(),
    shadowCameraParams: new Vector4(),
    depthBiasScales: new Vector4(),
    shadowMatrices: new Float32Array(16 * 4)
  };
  /** @internal */
  private static readonly _fogUniforms = {
    withAerialPerspective: 0,
    fogType: 0,
    additive: 0,
    atmosphereParams: getDefaultAtmosphereParams(),
    heightFogParams: getDefaultHeightFogParams()
  };
  static getObjectColorUniformName(): string {
    return UNIFORM_NAME_OBJECT_COLOR;
  }
  static getWorldMatrixUniformName(): string {
    return UNIFORM_NAME_WORLD_MATRIX;
  }
  static getPrevWorldMatrixUniformName(): string {
    return UNIFORM_NAME_PREV_WORLD_MATRIX;
  }
  static getPrevWorldMatrixFrameUniformName(): string {
    return UNIFORM_NAME_PREV_WORLD_MATRXI_FRAME;
  }
  static getInstanceDataUniformName(): string {
    return UNIFORM_NAME_INSTANCE_DATA;
  }
  static getInstanceDataOffsetUniformName(): string {
    return UNIFORM_NAME_INSTANCE_DATA_OFFSET;
  }
  static getInstanceDataStrideUniformName(): string {
    return UNIFORM_NAME_INSTANCE_DATA_STRIDE;
  }
  static getBoneMatricesUniformName(): string {
    return UNIFORM_NAME_BONE_MATRICES;
  }
  static getBoneTextureSizeUniformName(): string {
    return UNIFORM_NAME_BONE_TEXTURE_SIZE;
  }
  static getBoneInvBindMatrixUniformName(): string {
    return UNIFORM_NAME_BONE_INV_BIND_MATRIX;
  }
  static getMorphDataUniformName(): string {
    return UNIFORM_NAME_MORPH_DATA;
  }
  static getMorphInfoUniformName(): string {
    return UNIFORM_NAME_MORPH_INFO;
  }
  static getLightBufferUniformName(): string {
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
      pb.vec4('clipPlane'),
      pb.mat4('viewProjectionMatrix'),
      pb.mat4('invViewProjectionMatrix'),
      pb.mat4('unjitteredVPMatrix'),
      pb.mat4('jitteredInvVPMatrix'),
      pb.mat4('viewMatrix'),
      pb.mat4('worldMatrix'),
      pb.mat4('projectionMatrix'),
      pb.mat4('invProjectionMatrix'),
      pb.vec4('params'),
      ...(ctx.motionVectors && ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH
        ? [pb.mat4('prevUnjitteredVPMatrix')]
        : []),
      pb.vec2('renderSize'),
      pb.vec2('jitterValue'),
      pb.float('roughnessFactor'),
      pb.float('frameDeltaTime'),
      pb.float('elapsedTime'),
      pb.int('framestamp')
    ]);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const lightStruct = pb.defineStruct([
        pb.vec4('positionAndRange'),
        pb.vec4('directionCutoff'),
        pb.mat4('viewMatrix'),
        pb.vec4('depthBias'),
        pb.int('lightType')
      ]);
      scope.camera = cameraStruct().uniform(0);
      scope.light = lightStruct().uniform(0);
    } else if (
      ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH ||
      ctx.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR
    ) {
      scope.camera = cameraStruct().uniform(0);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
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
        scope[UNIFORM_NAME_AERIALPERSPECTIVE_LUT] = pb.tex2D().uniform(0);
        scope[UNIFORM_NAME_SKYDISTANTLIGHT_LUT] = pb.tex2D().uniform(0);
      }
      const lightStruct = ctx.currentShadowLight
        ? pb.defineStruct([
            pb.vec3('sunDir'),
            pb.int('shadowCascades'),
            pb.vec4('positionAndRange'),
            pb.vec4('directionAndCutoff'),
            pb.vec4('diffuseAndIntensity'),
            pb.vec4('cascadeDistances'),
            pb.vec4('depthBiasValues'),
            pb.vec4('shadowCameraParams'),
            pb.vec4('depthBiasScales'),
            pb.vec4[16]('shadowMatrices'),
            pb.float('envLightStrength')
          ])
        : pb.defineStruct([
            pb.vec3('sunDir'),
            pb.float('envLightStrength'),
            pb.vec4('clusterParams'),
            pb.ivec4('countParams'),
            pb.ivec2('lightIndexTexSize')
          ]);
      scope.camera = cameraStruct().uniform(0);
      scope.light = lightStruct().uniform(0);
      if (useClusteredLighting) {
        scope[UNIFORM_NAME_LIGHT_BUFFER] = pb.vec4[(MAX_CLUSTERED_LIGHTS + 1) * 3]().uniformBuffer(0);
        scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE] = (
          pb.getDevice().type === 'webgl' ? pb.tex2D() : pb.utex2D()
        ).uniform(0);
      }
      scope[UNIFORM_NAME_BAKED_SKY_MAP] = pb.texCube().uniform(0);
      if (ctx.currentShadowLight) {
        const scope = pb.getGlobalScope();
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        const tex = shadowMapParams.shadowMap.isTextureCube()
          ? shadowMapParams.shadowMap.isDepth()
            ? scope.$builder.texCubeShadow()
            : scope.$builder.texCube()
          : shadowMapParams.shadowMap.isTexture2D()
            ? shadowMapParams.shadowMap.isDepth()
              ? scope.$builder.tex2DShadow()
              : scope.$builder.tex2D()
            : shadowMapParams.shadowMap.isDepth()
              ? scope.$builder.tex2DArrayShadow()
              : scope.$builder.tex2DArray();
        if (
          !shadowMapParams.shadowMap.isDepth() &&
          !ctx.device.getDeviceCaps().textureCaps.getTextureFormatInfo(shadowMapParams.shadowMap.format)
            .filterable
        ) {
          tex.sampleType('unfilterable-float');
        }
        scope[UNIFORM_NAME_SHADOW_MAP] = tex.uniform(0);
      }
      if (ctx.drawEnvLight) {
        ctx.env.light.envLight.initShaderBindings(pb);
      }
      if (ctx.linearDepthTexture) {
        scope[UNIFORM_NAME_LINEAR_DEPTH_MAP] = pb.tex2D().uniform(0);
        scope[UNIFORM_NAME_LINEAR_DEPTH_MAP_SIZE] = pb.vec2().uniform(0);
      }
      if (ctx.sceneColorTexture) {
        scope[UNIFORM_NAME_SCENE_COLOR_MAP] = pb.tex2D().uniform(0);
        scope[UNIFORM_NAME_SCENE_COLOR_MAP_SIZE] = pb.vec2().uniform(0);
      }
      if (ctx.HiZTexture) {
        scope[UNIFORM_NAME_HIZ_DEPTH_MAP] = pb.tex2D().uniform(0);
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
  static hasSkinning(scope: PBInsideFunctionScope): boolean {
    return !!scope[UNIFORM_NAME_BONE_MATRICES];
  }
  /**
   * This function checks if the shader needs to process morph target animation.
   *
   * @param scope - Current shader scope
   *
   * @returns true if the shader needs to process morph target animation, otherwise false.
   */
  static hasMorphing(scope: PBInsideFunctionScope): boolean {
    return !!scope[UNIFORM_NAME_MORPH_DATA];
  }
  /**
   * Calculate skinning matrix for current vertex
   *
   * @param scope - Current shader scope
   *
   * @returns Skinning matrix for current vertex, or null if there is not skeletal animation
   */
  static calculateSkinMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    if (!this.hasSkinning(scope)) {
      return null;
    }
    const pb = scope.$builder;
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
      const blendIndices = scope.$getVertexAttrib('blendIndices');
      const blendWeights = scope.$getVertexAttrib('blendWeights');
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
      this.$return(pb.mul(invBindMatrix, this.m));
    });
    return scope.$g[funcNameGetSkinningMatrix]();
  }
  static calculateMorphDelta(scope: PBInsideFunctionScope, attrib: number): PBShaderExp {
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
            this.$l.pixelIndex = pb.float(
              pb.add(this.offset, pb.mul(this.index, this.numVertices), this.vertexIndex)
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
      } else {
        this.$for(pb.int('t'), 0, this.numTargets, function () {
          this.$l.i = pb.sar(this.t, 2);
          this.$l.j = pb.compAnd(this.t, 3);
          this.$l.weight = morphInfo.at(pb.add(1, this.i)).at(this.j);
          this.$l.pixelIndex = pb.float(
            pb.add(this.offset, pb.mul(this.t, this.numVertices), this.vertexIndex)
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
      }
      this.$return(this.value);
    });
    const pos = 1 + MORPH_WEIGHTS_VECTOR_COUNT + (attrib >> 2);
    const comp = attrib & 3;
    const offset = scope[this.getMorphInfoUniformName()][pos][comp];
    return scope[funcName](pb.int(offset));
  }
  /** @internal */
  static prepareSkinAnimation(scope: PBInsideFunctionScope) {
    if (!this.hasSkinning(scope)) {
      return;
    }
    const that = this;
    const pb = scope.$builder;
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
      const blendIndices = scope.$getVertexAttrib('blendIndices');
      const blendWeights = scope.$getVertexAttrib('blendWeights');
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
  static resolveVertexPosition(scope: PBInsideFunctionScope): PBShaderExp {
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
      this.$l.opos = this.$getVertexAttrib('position').xyz;
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
    return scope[that.SKIN_MATRIX_NAME] && scope[that.SKIN_PREV_MATRIX_NAME]
      ? scope.Z_resolveVertexPosition(scope[that.SKIN_MATRIX_NAME], scope[that.SKIN_PREV_MATRIX_NAME])
      : scope[that.SKIN_MATRIX_NAME]
        ? scope.Z_resolveVertexPosition(scope[that.SKIN_MATRIX_NAME])
        : scope.Z_resolveVertexPosition();
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
   * Calculates the normal vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param normal - Vertex normal input, must be type of vec3, null if no vertex normal input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated normal vector in object space, or null if normal is null
   */
  static resolveVertexNormal(scope: PBInsideFunctionScope, normal?: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.resolveVertexNormal(): must be called in vertex stage`);
    }
    const funcScope = pb.getCurrentFunctionScope();
    if (!funcScope || !funcScope.$isMain()) {
      throw new Error(`ShaderHelper.resolveVertexNormal(): must be called at entry function`);
    }
    if (!normal) {
      if (!scope.$getVertexAttrib('normal')) {
        scope.$inputs.Z_normal = pb.vec3().attrib('normal');
      }
      normal = scope.$getVertexAttrib('normal');
    }
    if (this.hasMorphing(scope)) {
      normal = pb.normalize(pb.add(normal, this.calculateMorphDelta(scope, MORPH_TARGET_NORMAL).xyz));
    }
    if (scope[this.SKIN_MATRIX_NAME]) {
      return pb.mul(scope[this.SKIN_MATRIX_NAME], pb.vec4(normal, 0)).xyz;
    } else {
      return normal;
    }
  }
  /**
   * Calculates the tangent vector of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param tangent - Vertex tangent input, must be type of vec4, null if no vertex tangent input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated tangent vector of type vec4 in object space, or null if tangent is null
   */
  static resolveVertexTangent(scope: PBInsideFunctionScope, tangent?: PBShaderExp): PBShaderExp {
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
      tangent = scope.$getVertexAttrib('tangent');
    }
    if (this.hasMorphing(scope)) {
      tangent = pb.normalize(
        pb.add(tangent, pb.vec4(this.calculateMorphDelta(scope, MORPH_TARGET_TANGENT).xyz, 0))
      );
    }
    if (scope[this.SKIN_MATRIX_NAME]) {
      return pb.vec4(pb.mul(scope[this.SKIN_MATRIX_NAME], pb.vec4(tangent.xyz, 0)).xyz, tangent.w);
    } else {
      return tangent;
    }
  }
  /**
   * Gets the uniform variable of type mat4 which holds the world matrix of current object to be drawn
   * @param scope - Current shader scope
   * @returns The world matrix of current object to be drawn
   */
  static getWorldMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    return (
      scope[UNIFORM_NAME_WORLD_MATRIX] ??
      pb.mat4(
        this.getInstancedUniform(scope, 0),
        this.getInstancedUniform(scope, 1),
        this.getInstancedUniform(scope, 2),
        this.getInstancedUniform(scope, 3)
      )
    );
  }
  /**
   * Gets the uniform variable of type mat4 which holds the world matrix at previous frame of current object to be drawn
   * @param scope - Current shader scope
   * @returns The world matrix at previous frame of current object to be drawn
   */
  static getPrevWorldMatrix(scope: PBInsideFunctionScope): PBShaderExp {
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
      return scope.Z_getPrevWorldMatrix(framestamp);
    }
  }
  /**
   * Gets the instance uniform value of type vec4 by uniform index
   * @param scope - Current shader scope
   * @returns instance uniform value
   */
  static getInstancedUniform(scope: PBInsideFunctionScope, uniformIndex: number): PBShaderExp {
    const pb = scope.$builder;
    return scope[UNIFORM_NAME_INSTANCE_DATA].at(
      pb.add(
        pb.mul(scope[UNIFORM_NAME_INSTANCE_DATA_STRIDE], pb.uint(scope.$builtins.instanceIndex)),
        scope[UNIFORM_NAME_INSTANCE_DATA_OFFSET],
        pb.uint(uniformIndex)
      )
    );
  }
  /**
   * Gets the uniform variable of type mat4 which holds the normal matrix of current object to be drawn
   *
   * @param scope - Current shader scope
   * @returns The normal matrix of current object to be drawn
   */
  static getNormalMatrix(scope: PBInsideFunctionScope): PBShaderExp {
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
    }
    if (morphing) {
      scope[UNIFORM_NAME_MORPH_DATA] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_MORPH_INFO] =
        pb.vec4[1 + MORPH_WEIGHTS_VECTOR_COUNT + MORPH_ATTRIBUTE_VECTOR_COUNT]().uniformBuffer(1);
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
  static setCameraUniforms(bindGroup: BindGroup, ctx: DrawContext, linear: boolean) {
    const pos = ctx.camera.getWorldPosition();
    const useJitter =
      ctx.motionVectors &&
      ctx.renderPass.type !== RENDER_PASS_TYPE_SHADOWMAP &&
      ctx.renderPass.type !== RENDER_PASS_TYPE_OBJECT_COLOR;
    const cameraStruct = {
      position: new Vector4(pos.x, pos.y, pos.z, ctx.camera.clipPlane ? 1 : 0),
      clipPlane: ctx.camera.clipPlane ?? Vector4.zero(),
      renderSize: new Vector2(ctx.renderWidth, ctx.renderHeight),
      viewProjectionMatrix: useJitter ? ctx.camera.jitteredVPMatrix : ctx.camera.viewProjectionMatrix,
      unjitteredVPMatrix: ctx.camera.viewProjectionMatrix,
      jitteredInvVPMatrix: useJitter ? ctx.camera.jitteredInvVPMatrix : ctx.camera.invViewProjectionMatrix,
      jitterValue: ctx.camera.jitterValue,
      invViewProjectionMatrix: ctx.camera.invViewProjectionMatrix,
      projectionMatrix: ctx.camera.getProjectionMatrix(),
      invProjectionMatrix: ctx.camera.getInvProjectionMatrix(),
      viewMatrix: ctx.camera.viewMatrix,
      worldMatrix: ctx.camera.worldMatrix,
      params: new Vector4(
        ctx.camera.getNearPlane(),
        ctx.camera.getFarPlane(),
        ctx.flip ? -1 : 1,
        linear ? 0 : 1
      ),
      roughnessFactor: ctx.camera.SSR ? ctx.camera.ssrRoughnessFactor : 1,
      frameDeltaTime: getDevice().frameInfo.elapsedFrame * 0.001,
      elapsedTime: getDevice().frameInfo.elapsedOverall * 0.001,
      framestamp: getDevice().frameInfo.frameCounter
    } as any;
    if (ctx.motionVectors && ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH) {
      cameraStruct.prevUnjitteredVPMatrix = ctx.camera.prevVPMatrix;
    }
    if (ctx.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
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
      const shadowMapParams = ctx.shadowMapInfo.get(light);
      bindGroup.setValue('light', {
        positionAndRange: light.positionAndRange,
        directionCutoff: light.directionAndCutoff,
        viewMatrix: light.viewMatrix,
        depthBias: shadowMapParams.depthBiasValues[0],
        lightType: light.lightType
      });
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
  /** @internal */
  static setLightUniforms(
    bindGroup: BindGroup,
    ctx: DrawContext,
    clusterParams: Float32Array<ArrayBuffer>,
    countParams: Int32Array<ArrayBuffer>,
    lightBuffer: StructuredBuffer,
    lightIndexTexture: Texture2D
  ) {
    bindGroup.setValue('light', {
      sunDir: ctx.sunLight ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1) : this.defaultSunDir,
      clusterParams: clusterParams,
      countParams: countParams,
      envLightStrength: ctx.env.light.strength ?? 0,
      lightIndexTexSize: new Int32Array([lightIndexTexture.width, lightIndexTexture.height])
    });
    bindGroup.setBuffer(UNIFORM_NAME_LIGHT_BUFFER, lightBuffer);
    bindGroup.setTexture(UNIFORM_NAME_LIGHT_INDEX_TEXTURE, lightIndexTexture);
    bindGroup.setTexture(UNIFORM_NAME_BAKED_SKY_MAP, ctx.scene.env.sky.getBakedSkyTexture(ctx));
    if (ctx.drawEnvLight) {
      ctx.env.light.envLight.updateBindGroup(bindGroup);
    }
  }
  /** @internal */
  static setLightUniformsShadow(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    const shadowMapParams = ctx.shadowMapInfo.get(light);
    this._lightUniformShadow.sunDir = ctx.sunLight
      ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1)
      : this.defaultSunDir;
    this._lightUniformShadow.envLightStrength = ctx.env?.light.strength ?? 0;
    this._lightUniformShadow.shadowCascades = shadowMapParams.numShadowCascades;
    this._lightUniformShadow.positionAndRange.set(light.positionAndRange);
    this._lightUniformShadow.directionAndCutoff.set(light.directionAndCutoff);
    this._lightUniformShadow.diffuseAndIntensity.set(light.diffuseAndIntensity);
    this._lightUniformShadow.cascadeDistances.set(shadowMapParams.cascadeDistances);
    this._lightUniformShadow.depthBiasValues.set(shadowMapParams.depthBiasValues[0]);
    this._lightUniformShadow.shadowCameraParams.set(shadowMapParams.cameraParams);
    this._lightUniformShadow.depthBiasScales.set(shadowMapParams.depthBiasScales);
    this._lightUniformShadow.shadowMatrices.set(shadowMapParams.shadowMatrices);
    bindGroup.setValue('light', this._lightUniformShadow);
    bindGroup.setTexture(
      UNIFORM_NAME_SHADOW_MAP,
      shadowMapParams.shadowMap,
      shadowMapParams.shadowMapSampler
    );
    bindGroup.setTexture(UNIFORM_NAME_BAKED_SKY_MAP, ctx.scene.env.sky.getBakedSkyTexture(ctx));
    if (ctx.drawEnvLight) {
      ctx.env.light.envLight.updateBindGroup(bindGroup);
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
   * Discard the fragment if it was clipped by the clip plane
   * @param scope - Current shader scope
   */
  static discardIfClipped(scope: PBInsideFunctionScope, worldPos: PBShaderExp) {
    const funcName = 'Z_discardIfClippped';
    const pb = scope.$builder;
    const that = this;
    pb.func(funcName, [pb.vec3('worldPos')], function () {
      this.$if(pb.notEqual(that.getCameraClipPlaneFlag(this), 0), function () {
        this.$l.clipPlane = that.getCameraClipPlane(this);
        this.$if(
          pb.greaterThan(pb.add(pb.dot(this.worldPos.xyz, this.clipPlane.xyz), this.clipPlane.w), 0),
          function () {
            pb.discard();
          }
        );
      });
    });
    pb.getGlobalScope()[funcName](worldPos);
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
  /** @internal */
  static getClusteredLightIndexTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE];
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
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.mul(lightIndex, 3));
  }
  /** @internal */
  static getLightDirectionAndCutoff(
    scope: PBInsideFunctionScope,
    lightIndex: PBShaderExp | number
  ): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.add(scope.$builder.mul(lightIndex, 3), 1));
  }
  /** @internal */
  static getLightColorAndIntensity(
    scope: PBInsideFunctionScope,
    lightIndex: PBShaderExp | number
  ): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_BUFFER].at(scope.$builder.add(scope.$builder.mul(lightIndex, 3), 2));
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
   * Calculates shadow of current fragment
   *
   * @param scope - Shader scope
   * @param NoL - NdotL vector
   * @returns Shadow of current fragment, 1 means no shadow and 0 means full shadowed.
   */
  static calculateShadow(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    NoL: PBShaderExp,
    ctx: DrawContext
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
    const funcName = 'Z_calculateShadow';
    pb.func(funcName, [pb.vec3('worldPos'), pb.float('NoL')], function () {
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
        if (ctx.device.type === 'webgl') {
          this.$l.shadowVertex = pb.vec4();
          this.$for(pb.int('cascade'), 0, 4, function () {
            this.$if(pb.equal(this.cascade, this.split), function () {
              this.shadowVertex = that.calculateShadowSpaceVertex(
                this,
                pb.vec4(this.worldPos, 1),
                this.cascade
              );
              this.$break();
            });
          });
        } else {
          this.$l.shadowVertex = that.calculateShadowSpaceVertex(this, pb.vec4(this.worldPos, 1), this.split);
        }
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        this.$l.shadow = shadowMapParams.impl.computeShadowCSM(
          shadowMapParams,
          this,
          this.shadowVertex,
          this.NoL,
          this.split
        );
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
        this.$return(this.shadow);
      } else {
        this.$l.shadowVertex = that.calculateShadowSpaceVertex(this, pb.vec4(this.worldPos, 1));
        const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
        this.$l.shadow = shadowMapParams.impl.computeShadow(
          shadowMapParams,
          this,
          this.shadowVertex,
          this.NoL
        );
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
        this.$return(this.shadow);
      }
    });
    return pb.getGlobalScope()[funcName](worldPos, NoL);
  }
  static applyFog(scope: PBInsideFunctionScope, worldPos: PBShaderExp, color: PBShaderExp, ctx: DrawContext) {
    const pb = scope.$builder;
    const that = this;
    if (ctx.materialFlags & MaterialVaryingFlags.APPLY_FOG) {
      const funcName = 'Z_applyFog';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('color').inout()], function () {
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
        this.color = pb.vec4(pb.add(pb.mul(this.color.rgb, this.fogging.a), this.fogging.rgb), this.color.a);
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
    return pb.div(nearFar.x, pb.mix(nearFar.y, nearFar.x, depth));
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
        this.$l.nonLinearDepth = pb.div(
          pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
          pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
        );
        this.$l.clipSpacePos = pb.vec4(
          pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
          pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
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
}
