import { Vector3, Vector4 } from '@zephyr3d/base';
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
import { ScatteringLut } from '../../render/scatteringlut';
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
import { linearToGamma } from '../../shaders';
import type { Camera } from '../../camera';
import { Application } from '../../app';

const UNIFORM_NAME_GLOBAL = 'Z_UniformGlobal';
const UNIFORM_NAME_LIGHT_BUFFER = 'Z_UniformLightBuffer';
const UNIFORM_NAME_LIGHT_INDEX_TEXTURE = 'Z_UniformLightIndexTex';
const UNIFORM_NAME_AERIALPERSPECTIVE_LUT = 'Z_UniformAerialPerspectiveLUT';
const UNIFORM_NAME_SHADOW_MAP = 'Z_UniformShadowMap';
const UNIFORM_NAME_WORLD_MATRIX = 'Z_UniformWorldMatrix';
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
  static readonly FOG_TYPE_NONE = 0;
  static readonly FOG_TYPE_LINEAR = 1;
  static readonly FOG_TYPE_EXP = 2;
  static readonly FOG_TYPE_EXP2 = 3;
  static readonly FOG_TYPE_SCATTER = 4;
  static readonly BILLBOARD_SPHERICAL = 1;
  static readonly BILLBOARD_SYLINDRAL = 2;
  /** @internal */
  static defaultSunDir = Vector3.one().inplaceNormalize();
  /** @internal */
  private static readonly SKIN_MATRIX_NAME = 'Z_SkinMatrix';
  /** @internal */
  private static _drawableBindGroupLayouts: Record<string, BindGroupLayout> = {};
  /** @internal */
  private static _lightUniformShadow = {
    light: {
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
    }
  };
  /** @internal */
  private static _fogUniforms = {
    fog: {
      fogType: 0,
      fogColor: null,
      // [near, far, top, density]
      fogParams: null,
      // aerial perspective density
      apDensity: 1
    }
  };
  static getWorldMatrixUniformName(): string {
    return UNIFORM_NAME_WORLD_MATRIX;
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
      const device = Application.instance.device;
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
      pb.mat4('viewMatrix'),
      pb.mat4('projectionMatrix'),
      pb.vec4('params'),
      pb.float('roughnessFactor')
    ]);
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const lightStruct = pb.defineStruct([
        pb.vec4('positionAndRange'),
        pb.vec4('directionCutoff'),
        pb.mat4('viewMatrix'),
        pb.vec4('depthBias'),
        pb.int('lightType')
      ]);
      const globalStruct = pb.defineStruct([cameraStruct('camera'), lightStruct('light')]);
      scope[UNIFORM_NAME_GLOBAL] = globalStruct().uniform(0);
    } else if (
      ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH ||
      ctx.renderPass.type === RENDER_PASS_TYPE_OBJECT_COLOR
    ) {
      const globalStruct = pb.defineStruct([cameraStruct('camera')]);
      scope[UNIFORM_NAME_GLOBAL] = globalStruct().uniform(0);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
      const useClusteredLighting = !ctx.currentShadowLight;
      const fogStruct = pb.defineStruct([
        pb.int('fogType'),
        pb.vec4('fogColor'),
        pb.vec4('fogParams'),
        pb.float('apDensity')
      ]);
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
      const globalStruct = pb.defineStruct([cameraStruct('camera'), lightStruct('light'), fogStruct('fog')]);
      scope[UNIFORM_NAME_GLOBAL] = globalStruct().uniform(0);
      if (useClusteredLighting) {
        scope[UNIFORM_NAME_LIGHT_BUFFER] = pb.vec4[(MAX_CLUSTERED_LIGHTS + 1) * 3]().uniformBuffer(0);
        scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE] = (
          pb.getDevice().type === 'webgl' ? pb.tex2D() : pb.utex2D()
        ).uniform(0);
      }
      if (ctx.applyFog === 'scatter') {
        scope[UNIFORM_NAME_AERIALPERSPECTIVE_LUT] = pb.tex2D().uniform(0);
      }
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
      ctx.drawEnvLight && ctx.env.light.envLight.initShaderBindings(pb);
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
      this.$l.w = pb.float(this[UNIFORM_NAME_BONE_TEXTURE_SIZE]);
      this.$l.pixelIndex = pb.float(pb.mul(this.boneIndex, 4));
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
  /**
   * Calculates the vertex position of type vec3 in object space
   *
   * @param scope - Current shader scope
   * @param pos - Vertex position input, must be type of vec3, null if no vertex position input
   * @param skinMatrix - The skinning matrix if there is skeletal animation, otherwise null
   * @returns The calculated vertex position in object space, or null if pos is null
   */
  static resolveVertexPosition(scope: PBInsideFunctionScope, pos?: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    if (pb.shaderKind !== 'vertex') {
      throw new Error(`ShaderHelper.resolveVertexPosition(): must be called at vertex stage`);
    }
    const funcScope = pb.getCurrentFunctionScope();
    if (!funcScope || !funcScope.$isMain()) {
      throw new Error(`ShaderHelper.resolveVertexPosition(): must be called at entry function`);
    }
    if (!pos) {
      if (!scope.$getVertexAttrib('position')) {
        scope.$inputs.Z_pos = pb.vec3().attrib('position');
      }
      pos = scope.$getVertexAttrib('position');
    }
    if (this.hasMorphing(scope)) {
      pos = pb.add(pos, this.calculateMorphDelta(scope, MORPH_TARGET_POSITION).xyz);
    }
    if (this.hasSkinning(scope)) {
      if (!funcScope[this.SKIN_MATRIX_NAME]) {
        funcScope[this.SKIN_MATRIX_NAME] = this.calculateSkinMatrix(funcScope);
      }
      return pb.mul(scope[this.SKIN_MATRIX_NAME], pb.vec4(pos, 1)).xyz;
    } else {
      return pos;
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
    if (this.hasSkinning(scope)) {
      if (!funcScope[this.SKIN_MATRIX_NAME]) {
        funcScope[this.SKIN_MATRIX_NAME] = this.calculateSkinMatrix(funcScope);
      }
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
    if (this.hasSkinning(scope)) {
      if (!funcScope[this.SKIN_MATRIX_NAME]) {
        funcScope[this.SKIN_MATRIX_NAME] = this.calculateSkinMatrix(funcScope);
      }
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
        uniformIndex
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
    }
    if (skinning) {
      scope[UNIFORM_NAME_BONE_MATRICES] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_BONE_INV_BIND_MATRIX] = pb.mat4().uniform(1);
      scope[UNIFORM_NAME_BONE_TEXTURE_SIZE] = pb.int().uniform(1);
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
    /*
    const skinning = !!ctx.target?.getBoneMatrices();
    const scope = pb.getGlobalScope();
    if (ctx.instanceData) {
      scope[UNIFORM_NAME_INSTANCE_DATA_STRIDE] = pb.uint().uniform(1);
      scope[UNIFORM_NAME_INSTANCE_DATA_OFFSET] = pb.uint().uniform(1);
      scope[UNIFORM_NAME_INSTANCE_DATA] = pb.vec4[65536 >> 4]().uniformBuffer(3);
    } else {
      scope[UNIFORM_NAME_WORLD_MATRIX] = pb.mat4().uniform(1);
    }
    if (skinning) {
      scope[UNIFORM_NAME_BONE_MATRICES] = pb.tex2D().uniform(1).sampleType('unfilterable-float');
      scope[UNIFORM_NAME_BONE_INV_BIND_MATRIX] = pb.mat4().uniform(1);
      scope[UNIFORM_NAME_BONE_TEXTURE_SIZE] = pb.int().uniform(1);
    }
    */
  }
  /** @internal */
  static setCameraUniforms(bindGroup: BindGroup, camera: Camera, flip: boolean, linear: boolean) {
    const pos = camera.getWorldPosition();
    const cameraStruct = {
      position: new Vector4(pos.x, pos.y, pos.z, camera.clipPlane ? 1 : 0),
      clipPlane: camera.clipPlane ?? Vector4.zero(),
      viewProjectionMatrix: camera.viewProjectionMatrix,
      viewMatrix: camera.viewMatrix,
      projectionMatrix: camera.getProjectionMatrix(),
      params: new Vector4(camera.getNearPlane(), camera.getFarPlane(), flip ? -1 : 1, linear ? 0 : 1),
      roughnessFactor: camera.SSR ? camera.ssrRoughnessFactor : 1
    };
    bindGroup.setValue(UNIFORM_NAME_GLOBAL, {
      camera: cameraStruct
    });
  }
  /** @internal */
  static setLightUniformsShadowMap(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    if (light) {
      const shadowMapParams = ctx.shadowMapInfo.get(light);
      bindGroup.setValue(UNIFORM_NAME_GLOBAL, {
        light: {
          positionAndRange: light.positionAndRange,
          directionCutoff: light.directionAndCutoff,
          viewMatrix: light.viewMatrix,
          depthBias: shadowMapParams.depthBiasValues[0],
          lightType: light.lightType
        }
      });
    }
  }
  /** @internal */
  static setFogUniforms(
    bindGroup: BindGroup,
    fogType: number,
    fogColor: Vector4,
    fogParams: Vector4,
    apDensity: number,
    aerialPerspectiveLUT?: Texture2D
  ) {
    this._fogUniforms.fog.fogColor = fogColor;
    this._fogUniforms.fog.fogParams = fogParams;
    this._fogUniforms.fog.fogType = fogType;
    this._fogUniforms.fog.apDensity = apDensity;
    bindGroup.setValue(UNIFORM_NAME_GLOBAL, this._fogUniforms);
    if (aerialPerspectiveLUT) {
      bindGroup.setTexture(UNIFORM_NAME_AERIALPERSPECTIVE_LUT, aerialPerspectiveLUT);
    }
  }
  /** @internal */
  static setLightUniforms(
    bindGroup: BindGroup,
    ctx: DrawContext,
    clusterParams: Float32Array,
    countParams: Int32Array,
    lightBuffer: StructuredBuffer,
    lightIndexTexture: Texture2D
  ) {
    bindGroup.setValue(UNIFORM_NAME_GLOBAL, {
      light: {
        sunDir: ctx.sunLight ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1) : this.defaultSunDir,
        clusterParams: clusterParams,
        countParams: countParams,
        envLightStrength: ctx.env.light.strength ?? 0,
        lightIndexTexSize: new Int32Array([lightIndexTexture.width, lightIndexTexture.height])
      }
    });
    bindGroup.setBuffer(UNIFORM_NAME_LIGHT_BUFFER, lightBuffer);
    bindGroup.setTexture(UNIFORM_NAME_LIGHT_INDEX_TEXTURE, lightIndexTexture);
    ctx.drawEnvLight && ctx.env.light.envLight.updateBindGroup(bindGroup);
  }
  /** @internal */
  static setLightUniformsShadow(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    const shadowMapParams = ctx.shadowMapInfo.get(light);
    (this._lightUniformShadow.light.sunDir = ctx.sunLight
      ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1)
      : this.defaultSunDir),
      (this._lightUniformShadow.light.envLightStrength = ctx.env?.light.strength ?? 0);
    this._lightUniformShadow.light.shadowCascades = shadowMapParams.numShadowCascades;
    this._lightUniformShadow.light.positionAndRange.set(light.positionAndRange);
    this._lightUniformShadow.light.directionAndCutoff.set(light.directionAndCutoff);
    this._lightUniformShadow.light.diffuseAndIntensity.set(light.diffuseAndIntensity);
    this._lightUniformShadow.light.cascadeDistances.set(shadowMapParams.cascadeDistances);
    this._lightUniformShadow.light.depthBiasValues.set(shadowMapParams.depthBiasValues[0]);
    this._lightUniformShadow.light.shadowCameraParams.set(shadowMapParams.cameraParams);
    this._lightUniformShadow.light.depthBiasScales.set(shadowMapParams.depthBiasScales);
    this._lightUniformShadow.light.shadowMatrices.set(shadowMapParams.shadowMatrices);
    bindGroup.setValue(UNIFORM_NAME_GLOBAL, this._lightUniformShadow);
    bindGroup.setTexture(
      UNIFORM_NAME_SHADOW_MAP,
      shadowMapParams.shadowMap,
      shadowMapParams.shadowMapSampler
    );
    ctx.drawEnvLight && ctx.env.light.envLight.updateBindGroup(bindGroup);
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
    return scope[UNIFORM_NAME_GLOBAL].light.envLightStrength;
  }
  /**
   * Gets the uniform variable of type vec3 which holds the camera position
   * @param scope - Current shader scope
   * @returns The camera position
   */
  static getCameraPosition(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.position.xyz;
  }
  /**
   * Gets the uniform variable of type float which holds the roughness factor
   * @param scope - Current shader scope
   * @returns The roughness factor
   */
  static getCameraRoughnessFactor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.roughnessFactor;
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
    return scope[UNIFORM_NAME_GLOBAL].camera.position.w;
  }
  /**
   * Gets the clip plane
   * @param scope - Current shader scope
   * @returns A vec4 presents the clip plane
   */
  static getCameraClipPlane(scope: PBInsideFunctionScope) {
    return scope[UNIFORM_NAME_GLOBAL].camera.clipPlane;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the camera parameters
   * @param scope - Current shader scope
   * @returns The camera parameters
   */
  static getCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.params;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the fog color
   * @param scope - Current shader scope
   * @returns The fog color
   */
  static getFogColor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].fog.fogColor;
  }
  /** @internal */
  static getClusterParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.clusterParams;
  }
  /** @internal */
  static getCountParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.countParams;
  }
  /** @internal */
  static getClusteredLightIndexTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_LIGHT_INDEX_TEXTURE];
  }
  /**
   * Gets the uniform variable of type vec4 which holds the fog color
   * @param scope - Current shader scope
   * @returns The fog color
   */
  static getFogType(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].fog.fogType;
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
   * Gets the uniform variable of type vec4 which holds the fog parameters
   * @param scope - Current shader scope
   * @returns The fog parameters
   */
  static getFogParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].fog.fogParams;
  }
  /**
   * Gets the uniform variable of type float which holds the aerial perspective density
   * @param scope - Current shader scope
   * @returns aerial perspective density
   */
  static getAPDensity(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].fog.apDensity;
  }
  /**
   * Computes the fog factor for a given view vector
   * @param scope - Current shader scope
   * @param viewDir - the view vector
   * @param fogType - Type of the fog
   * @param fogParams - Fog parameters [start, end, top, density]
   * @returns The computed fog factor
   */
  static computeFogFactor(
    scope: PBInsideFunctionScope,
    viewDir: PBShaderExp,
    fogType: PBShaderExp,
    fogParams: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'Z_computeFogFactor';
    const that = this;
    pb.func(funcName, [pb.vec3('viewDir'), pb.int('fogType'), pb.vec4('fogParams')], function () {
      this.$l.distance = pb.length(this.viewDir);
      this.$l.top = pb.max(this.viewDir.y, 0.0001);
      this.$l.distance = pb.mul(this.$l.distance, pb.min(1, pb.div(this.fogParams.z, this.top)));
      this.$if(pb.equal(this.fogType, that.FOG_TYPE_LINEAR), function () {
        this.$return(
          pb.clamp(
            pb.div(pb.sub(this.distance, this.fogParams.x), pb.sub(this.fogParams.y, this.fogParams.x)),
            0,
            1
          )
        );
      })
        .$elseif(pb.equal(this.fogType, that.FOG_TYPE_EXP), function () {
          this.$l.e = pb.mul(this.distance, this.fogParams.w);
          this.$return(pb.sub(1, pb.div(1, pb.exp(this.e))));
        })
        .$elseif(pb.equal(this.fogType, that.FOG_TYPE_EXP2), function () {
          this.$l.e = pb.mul(this.distance, this.fogParams.w);
          this.$return(pb.sub(1, pb.div(1, pb.exp(pb.mul(this.e, this.e)))));
        })
        .$else(function () {
          this.$return(0);
        });
    });
    return pb.getGlobalScope()[funcName](viewDir, fogType, fogParams);
  }
  /**
   * Computes the fog factor with given type for a given view vector
   * @param scope - Current shader scope
   * @param viewDir - the view vector
   * @param fogParams - The fog params [start, end, top, density]
   * @param fogType - Type of the fog
   * @returns The computed fog factor
   */
  static computeFogFactorForType(
    scope: PBInsideFunctionScope,
    viewDir: PBShaderExp,
    fogParams: PBShaderExp,
    fogType: 'linear' | 'exp' | 'exp2'
  ): PBShaderExp {
    const pb = scope.$builder;
    const funcName = `Z_computeFogFactor${fogType[0].toUpperCase()}${fogType.slice(1)}`;
    pb.func(funcName, [pb.vec3('viewDir'), pb.vec4('fogParams')], function () {
      this.$l.distance = pb.length(this.viewDir);
      this.$l.top = pb.max(this.viewDir.y, 0.0001);
      this.$l.distance = pb.mul(this.$l.distance, pb.min(1, pb.div(this.fogParams.z, this.top)));
      if (fogType === 'linear') {
        this.$return(
          pb.clamp(
            pb.div(pb.sub(this.distance, this.fogParams.x), pb.sub(this.fogParams.y, this.fogParams.x)),
            0,
            1
          )
        );
      } else if (fogType === 'exp') {
        this.$l.e = pb.mul(this.distance, this.fogParams.w);
        this.$return(pb.sub(1, pb.div(1, pb.exp(this.e))));
      } else if (fogType === 'exp2') {
        this.$l.e = pb.mul(this.distance, this.fogParams.w);
        this.$return(pb.sub(1, pb.div(1, pb.exp(pb.mul(this.e, this.e)))));
      } else {
        this.$return(0);
      }
    });
    return pb.getGlobalScope()[funcName](viewDir, fogParams);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The view projection matrix of current camera
   */
  static getViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.viewProjectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view matrix of current camera
   * @param scope - Current shader scope
   * @returns The view matrix of current camera
   */
  static getViewMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.viewMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The projection matrix of current camera
   */
  static getProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].camera.projectionMatrix;
  }
  /** @internal */
  static getCascadeDistances(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.cascadeDistances;
  }
  /** @internal */
  static getDepthBiasValues(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.depthBiasValues;
  }
  /** @internal */
  static getShadowCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.shadowCameraParams;
  }
  /** @internal */
  static getDepthBiasScales(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.depthBiasScales;
  }
  /** @internal */
  static getNumLights(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.numLights;
  }
  /** @internal */
  static getSunLightDir(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.sunDir;
  }
  /** @internal */
  static getLightTypeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.lightType;
  }
  /** @internal */
  static getLightPositionAndRangeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.positionAndRange;
  }
  /** @internal */
  static getLightViewMatrixForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL].light.viewMatrix;
  }
  /** @internal */
  static calculateShadowSpaceVertex(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    cascade: PBShaderExp | number = 0
  ): PBShaderExp {
    const pb = scope.$builder;
    return pb.vec4(
      pb.dot(scope[UNIFORM_NAME_GLOBAL].light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 0)), worldPos),
      pb.dot(scope[UNIFORM_NAME_GLOBAL].light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 1)), worldPos),
      pb.dot(scope[UNIFORM_NAME_GLOBAL].light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 2)), worldPos),
      pb.dot(scope[UNIFORM_NAME_GLOBAL].light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 3)), worldPos)
    );
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
   * Get global uniforms
   *
   * @param scope - Shader scope
   */
  static getGlobalUniforms(scope: PBInsideFunctionScope): PBShaderExp {
    return scope[UNIFORM_NAME_GLOBAL];
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
        this.$l.shadowCascades = that.getGlobalUniforms(this).light.shadowCascades;
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
    if (ctx.applyFog === 'scatter') {
      const funcName = 'Z_applySkyFog';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('color').inout()], function () {
        this.$l.viewDir = pb.sub(this.worldPos, that.getCameraPosition(this));
        this.viewDir.y = pb.max(this.viewDir.y, 0);
        this.$l.distance = pb.mul(pb.length(this.viewDir), that.getAPDensity(this));
        this.$l.sliceDist = pb.div(
          pb.mul(that.getCameraParams(this).y, that.getAPDensity(this)),
          ScatteringLut.aerialPerspectiveSliceZ
        );
        this.$l.slice0 = pb.floor(pb.div(this.distance, this.sliceDist));
        this.$l.slice1 = pb.add(this.slice0, 1);
        this.$l.factor = pb.sub(pb.div(this.distance, this.sliceDist), this.slice0);
        this.$l.viewNormal = pb.normalize(this.viewDir);
        this.$l.horizonAngle = pb.acos(
          pb.clamp(pb.dot(pb.normalize(that.getSunLightDir(this).xz), pb.normalize(this.viewNormal.xz)), 0, 1)
        );
        this.$l.zenithAngle = pb.asin(this.viewNormal.y);
        this.$l.sliceU = pb.max(
          pb.div(this.horizonAngle, Math.PI * 2),
          0.5 / ScatteringLut.aerialPerspectiveSliceZ
        );
        this.$l.u0 = pb.div(pb.add(this.slice0, this.sliceU), ScatteringLut.aerialPerspectiveSliceZ);
        this.$l.u1 = pb.add(this.u0, 1 / ScatteringLut.aerialPerspectiveSliceZ);
        this.$l.v = pb.div(this.zenithAngle, Math.PI / 2);
        this.$l.t0 = pb.textureSampleLevel(that.getAerialPerspectiveLUT(this), pb.vec2(this.u0, this.v), 0);
        this.$l.t1 = pb.textureSampleLevel(that.getAerialPerspectiveLUT(this), pb.vec2(this.u1, this.v), 0);
        this.$l.t = pb.mix(this.t0, this.t1, this.factor);

        this.color = pb.vec4(pb.add(pb.mul(this.color.rgb, this.t.a), this.t.rgb), this.color.a);
        //this.color = pb.vec4(pb.vec3(pb.mix(this.u0, this.u1, this.factor)), this.color.a);
      });
      scope[funcName](worldPos, color);
    } else if (ctx.applyFog) {
      const funcName = 'Z_applyFog';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('color').inout()], function () {
        this.$l.viewDir = pb.sub(this.worldPos, that.getCameraPosition(this));
        this.$l.fogFactor = that.computeFogFactor(
          this,
          this.viewDir,
          that.getFogType(this),
          that.getFogParams(this)
        );
        this.color = pb.vec4(
          pb.mix(this.color.rgb, that.getFogColor(this).rgb, this.fogFactor),
          this.color.a
        );
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
