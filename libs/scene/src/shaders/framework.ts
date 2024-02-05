import { Vector4 } from "@zephyr3d/base";
import { DrawContext } from "../render/drawable";
import { MAX_CLUSTERED_LIGHTS, MAX_FORWARD_LIGHT_COUNT, RENDER_PASS_TYPE_DEPTH_ONLY, RENDER_PASS_TYPE_FORWARD, RENDER_PASS_TYPE_SHADOWMAP } from "../values";
import { Application } from "../app";
import type { ProgramBuilder, BindGroup, PBShaderExp, PBInsideFunctionScope, StructuredBuffer, Texture2D } from "@zephyr3d/device"
import type { PunctualLight } from "../scene/light";
import { ScatteringLut } from "../render/scatteringlut";

/**
 * Helper shader functions for the builtin material system
 * @public
 */
export class ShaderFramework {
  static readonly FOG_TYPE_NONE = 0;
  static readonly FOG_TYPE_LINEAR = 1;
  static readonly FOG_TYPE_EXP = 2;
  static readonly FOG_TYPE_EXP2 = 3;
  static readonly FOG_TYPE_SCATTER = 4;
  static readonly BILLBOARD_SPHERICAL = 1;
  static readonly BILLBOARD_SYLINDRAL = 2;
  static readonly USAGE_VERTEX_COLOR = 'usage_VertexColor';
  static readonly USAGE_WORLD_MATRIX = 'usage_WorldMatrix';
  static readonly USAGE_BONE_MATRICIES = 'usage_BoneMatrices';
  static readonly USAGE_INV_BIND_MATRIX = 'usage_InvBindMatrix';
  static readonly USAGE_BONE_TEXTURE_SIZE = 'usage_BoneTextureSize';
  static readonly USAGE_WORLD_POSITION = 'usage_WorldPosition';
  static readonly USAGE_WORLD_NORMAL = 'usage_WorldNormal';
  static readonly USAGE_WORLD_TANGENT = 'usage_WorldTangent';
  static readonly USAGE_WORLD_BINORMAL = 'usage_WorldBinormal';
  /** @internal */
  private static _lightUniformShadow = {
    light: {
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
  }
  /** @internal */
  private static _fogUniforms = {
    fog: {
      fogType: 0,
      fogColor: null,
      // [near, far, top, density]
      fogParams: null,
    },
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
    /*
    if (ctx.renderPass.type === RENDER_PASS_TYPE_SHADOWMAP) {
      const scope = pb.getGlobalScope();
      const globalStruct = this.defineGlobalStructShadowMap(pb);
      scope.global = globalStruct().uniform(0);
      // this.prepareFragmentShaderShadowMap(pb, ctx);
    } else {
      //this.prepareFragmentShaderForward(pb, ctx);
      const scope = pb.getGlobalScope();
      const globalStruct = this.defineGlobalStruct(pb, ctx);
      scope.global = globalStruct().uniform(0);

      this.prepareShadowUniforms(pb, ctx);
      ctx.drawEnvLight && ctx.env.light.envLight.initShaderBindings(pb);
    }
    */
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
      pb.mat4('rotationMatrix'),
      pb.mat4('projectionMatrix'),
      pb.vec4('params'),
      pb.float('worldUnit')
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
      scope.global = globalStruct().uniform(0);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_DEPTH_ONLY) {
      const globalStruct = pb.defineStruct([cameraStruct('camera')]);
      scope.global = globalStruct().uniform(0);
    } else if (ctx.renderPass.type === RENDER_PASS_TYPE_FORWARD) {
      const useClusteredLighting = !ctx.currentShadowLight;
      const fogStruct = pb.defineStruct([
        pb.int('fogType'),
        pb.vec4('fogColor'),
        pb.vec4('fogParams')
      ]);
      const lightStruct = ctx.currentShadowLight
        ? pb.defineStruct([
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
            pb.float('envLightStrength'),
            pb.vec4('clusterParams'),
            pb.ivec4('countParams'),
            pb.ivec2('lightIndexTexSize'),
          ]);
      const globalStruct = pb.defineStruct([cameraStruct('camera'), lightStruct('light'), fogStruct('fog')]);
      scope.global = globalStruct().uniform(0);
      if (useClusteredLighting) {
        scope.lightBuffer = pb.vec4[(MAX_CLUSTERED_LIGHTS + 1) * 3]().uniformBuffer(0);
        scope.lightIndexTex = (pb.getDevice().type === 'webgl' ? pb.tex2D() : pb.utex2D()).uniform(0);
      }
      if (ctx.applyFog && ctx.scene.env.sky.drawScatteredFog(ctx)) {
        scope.aerialPerspectiveLUT = pb.tex2D().uniform(0);
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
          !Application.instance.device.getDeviceCaps().textureCaps.getTextureFormatInfo(shadowMapParams.shadowMap.format).filterable
        ) {
          tex.sampleType('unfilterable-float');
        }
        scope.shadowMap = tex.uniform(0);
      }
      ctx.drawEnvLight && ctx.env.light.envLight.initShaderBindings(pb);
    }
  }
  /** @internal */
  static prepareVertexShaderCommon(pb: ProgramBuilder, ctx: DrawContext) {
    const instancing = ctx.instanceData?.worldMatrices?.length > 1;
    const skinning = !!ctx.target?.getBoneMatrices();
    const scope = pb.getGlobalScope();
    if (instancing) {
      const maxNumInstances = Application.instance.device.getDeviceCaps().shaderCaps.maxUniformBufferSize >> 6;
      scope.instanceBufferOffset = pb.uint().uniform(1);
      scope.worldMatrix = pb.mat4[maxNumInstances]().uniformBuffer(3);
      pb.getReflection().tag(ShaderFramework.USAGE_WORLD_MATRIX, () =>
        scope.worldMatrix.at(
          pb.add(scope.instanceBufferOffset, pb.uint(scope.$builtins.instanceIndex))
        )
      );
    } else {
      scope.worldMatrix = pb.mat4().uniform(1).tag(ShaderFramework.USAGE_WORLD_MATRIX);
    }
    if (skinning) {
      scope.boneMatrices = pb.tex2D().uniform(1).sampleType('unfilterable-float').tag(ShaderFramework.USAGE_BONE_MATRICIES);
      scope.invBindMatrix = pb.mat4().uniform(1).tag(ShaderFramework.USAGE_INV_BIND_MATRIX);
      scope.boneTextureSize = pb.int().uniform(1).tag(ShaderFramework.USAGE_BONE_TEXTURE_SIZE);
    }
  }
  /** @internal */
  static setCameraUniforms(bindGroup: BindGroup, ctx: DrawContext, linear: boolean) {
    const pos = ctx.camera.getWorldPosition();
    const cameraStruct = {
      position: new Vector4(pos.x, pos.y, pos.z, ctx.camera.clipPlane ? 1 : 0),
      clipPlane: ctx.camera.clipPlane ?? Vector4.zero(),
      viewProjectionMatrix: ctx.camera.viewProjectionMatrix,
      viewMatrix: ctx.camera.viewMatrix,
      rotationMatrix: ctx.camera.getRotationMatrix(),
      projectionMatrix: ctx.camera.getProjectionMatrix(),
      worldUnit: ctx.scene.worldUnit,
      params: new Vector4(
        ctx.camera.getNearPlane(),
        ctx.camera.getFarPlane(),
        ctx.flip ? -1 : 1,
        linear ? 0 : 1
      )
    };
    bindGroup.setValue('global', {
      camera: cameraStruct
    });
  }
  /** @internal */
  static setLightUniformsShadowMap(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    if (light) {
      const shadowMapParams = ctx.shadowMapInfo.get(light);
      bindGroup.setValue('global', {
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
  static setFogUniforms(bindGroup: BindGroup, fogType: number, fogColor: Vector4, fogParams: Vector4, aerialPerspectiveLUT?: Texture2D) {
    this._fogUniforms.fog.fogColor = fogColor;
    this._fogUniforms.fog.fogParams = fogParams;
    this._fogUniforms.fog.fogType = fogType;
    bindGroup.setValue('global', this._fogUniforms);
    if (aerialPerspectiveLUT) {
      bindGroup.setTexture('aerialPerspectiveLUT', aerialPerspectiveLUT);
    }
  }
  /** @internal */
  static setLightUniforms(bindGroup: BindGroup, ctx: DrawContext, clusterParams: Float32Array, countParams: Int32Array, lightBuffer: StructuredBuffer, lightIndexTexture: Texture2D) {
    bindGroup.setValue('global', {
      light: {
        clusterParams: clusterParams,
        countParams: countParams,
        envLightStrength: ctx.env.light.strength ?? 0,
        lightIndexTexSize: new Int32Array([lightIndexTexture.width, lightIndexTexture.height])
      }
    });
    bindGroup.setBuffer('lightBuffer', lightBuffer);
    bindGroup.setTexture('lightIndexTex', lightIndexTexture);
    ctx.drawEnvLight && ctx.env.light.envLight.updateBindGroup(bindGroup);
  }
  /** @internal */
  static setLightUniformsShadow(bindGroup: BindGroup, ctx: DrawContext, light: PunctualLight) {
    const shadowMapParams = ctx.shadowMapInfo.get(light);
    this._lightUniformShadow.light.envLightStrength = ctx.env?.light.strength ?? 0;
    this._lightUniformShadow.light.shadowCascades = shadowMapParams.numShadowCascades;
    this._lightUniformShadow.light.positionAndRange.set(light.positionAndRange);
    this._lightUniformShadow.light.directionAndCutoff.set(light.directionAndCutoff);
    this._lightUniformShadow.light.diffuseAndIntensity.set(light.diffuseAndIntensity);
    this._lightUniformShadow.light.cascadeDistances.set(shadowMapParams.cascadeDistances);
    this._lightUniformShadow.light.depthBiasValues.set(shadowMapParams.depthBiasValues[0]);
    this._lightUniformShadow.light.shadowCameraParams.set(shadowMapParams.cameraParams);
    this._lightUniformShadow.light.depthBiasScales.set(shadowMapParams.depthBiasScales);
    this._lightUniformShadow.light.shadowMatrices.set(shadowMapParams.shadowMatrices);
    bindGroup.setValue('global', this._lightUniformShadow);
    bindGroup.setTexture('shadowMap', shadowMapParams.shadowMap, shadowMapParams.shadowMapSampler);
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
    return scope.global.light.envLightStrength;
  }
  /**
   * Gets the uniform variable of type vec3 which holds the camera position
   * @param scope - Current shader scope
   * @returns The camera position
   */
  static getCameraPosition(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.position.xyz;
  }
  /**
   * Discard the fragment if it was clipped by the clip plane
   * @param scope - Current shader scope
   */
  static discardIfClipped(scope: PBInsideFunctionScope) {
    const funcName = 'lib_discardIfClippped';
    const pb = scope.$builder;
    const that = this;
    pb.func(funcName, [], function(){
      this.$if(pb.notEqual(that.getCameraClipPlaneFlag(this), 0), function(){
        this.$l.worldPos = that.getWorldPosition(this);
        this.$l.clipPlane = that.getCameraClipPlane(this);
        this.$if(pb.greaterThan(pb.add(pb.dot(this.worldPos.xyz, this.clipPlane.xyz), this.clipPlane.w), 0), function(){
          pb.discard();
        });
      });
    });
    pb.getGlobalScope()[funcName]();
  }
  /**
   * Gets the clip plane flag
   * @param scope - Current shader scope
   * @returns A float value of 1 indices the clip plane presents, otherwise 0
   */
  static getCameraClipPlaneFlag(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.position.w;
  }
  /**
   * Gets the world unit
   * @param scope - Current shader scope
   * @returns The world unit
   */
  static getWorldUnit(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.worldUnit;
  }
  /**
   * Gets the clip plane
   * @param scope - Current shader scope
   * @returns A vec4 presents the clip plane
   */
  static getCameraClipPlane(scope: PBInsideFunctionScope) {
    return scope.global.camera.clipPlane;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the camera parameters
   * @param scope - Current shader scope
   * @returns The camera parameters
   */
  static getCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.params;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the fog color
   * @param scope - Current shader scope
   * @returns The fog color
   */
  static getFogColor(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.fog.fogColor;
  }
  /** @internal */
  static getClusterParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.clusterParams;
  }
  /** @internal */
  static getCountParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.countParams;
  }
  /** @internal */
  static getClusteredLightIndexTexture(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.lightIndexTex;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the fog color
   * @param scope - Current shader scope
   * @returns The fog color
   */
  static getFogType(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.fog.fogType;
  }
  /**
   * Gets the aerial perspective LUT
   * @param scope - Current shader scope
   * @returns The aerial perspective LUT texture
   */
  static getAerialPerspectiveLUT(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.aerialPerspectiveLUT;
  }
  /**
   * Gets the uniform variable of type vec4 which holds the fog parameters
   * @param scope - Current shader scope
   * @returns The fog parameters
   */
  static getFogParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.fog.fogParams;
  }
  /**
   * Computes the fog factor for a given view vector
   * @param scope - Current shader scope
   * @param viewDir - the view vector
   * @param fogType - Type of the fog
   * @param fogParams - Fog parameters [start, end, top, density]
   * @returns The computed fog factor
   */
   static computeFogFactor(scope: PBInsideFunctionScope, viewDir: PBShaderExp, fogType: PBShaderExp, fogParams: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'lib_applyFog'
    const that = this;
    pb.func(funcName, [pb.vec3('viewDir'), pb.int('fogType'), pb.vec4('fogParams')], function(){
      this.$l.distance = pb.length(this.viewDir);
      this.$l.top = pb.max(this.viewDir.y, 0.0001);
      this.$l.distance = pb.mul(this.$l.distance, pb.min(1, pb.div(this.fogParams.z, this.top)));
      this.$if(pb.equal(this.fogType, that.FOG_TYPE_LINEAR), function(){
        this.$return(pb.clamp(pb.div(pb.sub(this.distance, this.fogParams.x), pb.sub(this.fogParams.y, this.fogParams.x)), 0, 1));
      }).$elseif(pb.equal(this.fogType, that.FOG_TYPE_EXP), function(){
        this.$l.e = pb.mul(this.distance, this.fogParams.w);
        this.$return(pb.sub(1, pb.div(1, pb.exp(this.e))));
      }).$elseif(pb.equal(this.fogType, that.FOG_TYPE_EXP2), function(){
        this.$l.e = pb.mul(this.distance, this.fogParams.w);
        this.$return(pb.sub(1, pb.div(1, pb.exp(pb.mul(this.e, this.e)))));
      }).$else(function(){
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
  static computeFogFactorForType(scope: PBInsideFunctionScope, viewDir: PBShaderExp, fogParams: PBShaderExp, fogType: 'linear'|'exp'|'exp2'): PBShaderExp {
    const pb = scope.$builder;
    const funcName = 'lib_applyFog'
    pb.func(funcName, [pb.vec3('viewDir'), pb.vec4('fogParams')], function(){
      this.$l.distance = pb.length(this.viewDir);
      this.$l.top = pb.max(this.viewDir.y, 0.0001);
      this.$l.distance = pb.mul(this.$l.distance, pb.min(1, pb.div(this.fogParams.z, this.top)));
      if (fogType === 'linear') {
        this.$return(pb.clamp(pb.div(pb.sub(this.distance, this.fogParams.x), pb.sub(this.fogParams.y, this.fogParams.x)), 0, 1));
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
   * Gets the uniform variable of type mat4 which holds the world matrix of current object to be drawn
   * @param scope - Current shader scope
   * @returns The world matrix of current object to be drawn
   */
  static getWorldMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$query(ShaderFramework.USAGE_WORLD_MATRIX);
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The view projection matrix of current camera
   */
  static getViewProjectionMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.viewProjectionMatrix;
  }
  /**
   * Gets the uniform variable of type mat4 which holds the view projection matrix of current camera
   * @param scope - Current shader scope
   * @returns The view projection matrix of current camera
   */
  static getCameraRotationMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.camera.rotationMatrix;
  }
  /**
   * Gets the varying input value of type vec4 which holds the world position of current fragment
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The world position of current fragment
   */
  static getWorldPosition(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$query(ShaderFramework.USAGE_WORLD_POSITION);
  }
  /**
   * Gets the varying input value of type vec3 which holds the world normal of current fragment
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The world normal of current fragment
   */
  static getWorldNormal(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$query(ShaderFramework.USAGE_WORLD_NORMAL);
  }
  /**
   * Gets the varying input value of type vec3 which holds the world tangent vector of current fragment
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The world tangent vector of current fragment
   */
  static getWorldTangent(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$query(ShaderFramework.USAGE_WORLD_TANGENT);
  }
  /**
   * Gets the varying input value of type vec3 which holds the world binormal vector of current fragment
   *
   * @remarks
   * This function can only be used in the fragment shader
   *
   * @param scope - Current shader scope
   * @returns The world binormal vector of current fragment
   */
  static getWorldBinormal(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.$query(ShaderFramework.USAGE_WORLD_BINORMAL);
  }
  /** @internal */
  static getCascadeDistances(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.cascadeDistances;
  }
  /** @internal */
  static getDepthBiasValues(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.depthBiasValues;
  }
  /** @internal */
  static getShadowCameraParams(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.shadowCameraParams;
  }
  /** @internal */
  static getDepthBiasScales(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.depthBiasScales;
  }
  /** @internal */
  static getNumLights(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.numLights;
  }
  /** @internal */
  static getLightTypeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.lightType;
  }
  /** @internal */
  static getLightPositionAndRangeForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.positionAndRange;
  }
  /** @internal */
  static getLightViewMatrixForShadow(scope: PBInsideFunctionScope): PBShaderExp {
    return scope.global.light.viewMatrix;
  }
  /** @internal */
  static calculateShadowSpaceVertex(scope: PBInsideFunctionScope, cascade: PBShaderExp|number = 0): PBShaderExp {
    const pb = scope.$builder;
    const worldPos = ShaderFramework.getWorldPosition(scope);
    return pb.vec4(
      pb.dot(scope.global.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 0)), worldPos),
      pb.dot(scope.global.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 1)), worldPos),
      pb.dot(scope.global.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 2)), worldPos),
      pb.dot(scope.global.light.shadowMatrices.at(pb.add(pb.mul(cascade, 4), 3)), worldPos)
    );
  }
  /** @internal */
  static getLightPositionAndRange(scope: PBInsideFunctionScope, lightIndex: PBShaderExp|number): PBShaderExp {
    return scope.lightBuffer.at(scope.$builder.mul(lightIndex, 3));
  }
  /** @internal */
  static getLightDirectionAndCutoff(scope: PBInsideFunctionScope, lightIndex: PBShaderExp|number): PBShaderExp {
    return scope.lightBuffer.at(scope.$builder.add(scope.$builder.mul(lightIndex, 3), 1));
  }
  /** @internal */
  static getLightColorAndIntensity(scope: PBInsideFunctionScope, lightIndex: PBShaderExp|number): PBShaderExp {
    return scope.lightBuffer.at(scope.$builder.add(scope.$builder.mul(lightIndex, 3), 2));
  }
  /**
   * Transform vertex position to the clip space and calcuate the world normal and tangent frame if needed
   *
   * @remarks
   * This function handles skin animation and geometry instancing if needed
   *
   * @param scope - Current shader scope
   * @param billboardMode - If not zero, transform vertex as billboard
   */
  static ftransform(scope: PBInsideFunctionScope, billboardMode = 0): void {
    const pb = scope.$builder;
    const funcName = 'lib_ftransform'
    const that = this;
    pb.func(funcName, [], function () {
      const viewProjMatrix = that.getViewProjectionMatrix(this);
      if (billboardMode === 0) {
        this.$l.worldMatrix = this.$query(ShaderFramework.USAGE_WORLD_MATRIX);
      } else {
        this.$l.rotMat = that.getCameraRotationMatrix(this);
        this.$l.wMat = this.$query(ShaderFramework.USAGE_WORLD_MATRIX);
        if (billboardMode === that.BILLBOARD_SYLINDRAL) {
          this.$l.xaxis = this.rotMat[0].xyz;
          this.$l.xscale = pb.length(this.wMat[0]);
          this.$l.yaxis = pb.vec3(0, 1, 0);
          this.$l.yscale = pb.length(this.wMat[1]);
          this.$l.zaxis = pb.cross(this.xaxis, this.yaxis);
          this.$l.xaxis = pb.cross(this.yaxis, this.zaxis);
          this.$l.zscale = pb.length(this.wMat[2]);
        } else if (billboardMode === that.BILLBOARD_SPHERICAL) {
          this.$l.xaxis = this.rotMat[0].xyz;
          this.$l.xscale = pb.length(this.wMat[0]);
          this.$l.yaxis = this.rotMat[1].xyz
          this.$l.yscale = pb.length(this.wMat[1]);
          this.$l.zaxis = this.rotMat[2].xyz
          this.$l.zscale = pb.length(this.wMat[2]);
        } else {
          throw new Error(`ftransform(): invalid billboard mode: ${billboardMode}`);
        }
        this.$l.m0 = pb.vec4(pb.mul(this.xaxis, this.xscale), 0);
        this.$l.m1 = pb.vec4(pb.mul(this.yaxis, this.yscale), 0);
        this.$l.m2 = pb.vec4(pb.mul(this.zaxis, this.zscale), 0);
        //this.$l.xaxis = pb.mul(this.rotMat[0], pb.length(this.wMat[0]));
        //this.$l.yaxis = pb.mul(pb.vec4(0, 1, 0, 0)/*this.rotMat[1]*/, pb.length(this.wMat[1]));
        //this.$l.zaxis = pb.mul(pb.vec4(pb.cross(this.xaxis.xyz, this.yaxis.xyz), 0);
        //this.$l.zaxis = pb.mul(pb.vec4(0, 0, 1, 0)/*this.rotMat[2]*/, pb.length(this.wMat[2]));
        this.$l.worldMatrix = pb.mat4(this.m0, this.m1, this.m2, this.wMat[3]);
      }
      //const worldMatrix = this.$query(ShaderFramework.USAGE_WORLD_MATRIX);
      const pos = pb.getGlobalScope().$getVertexAttrib('position');
      if (this.$query(ShaderFramework.USAGE_BONE_MATRICIES)) {
        this.$l.skinMatrix = that.getSkinMatrix(this);
      }
      this.$l.pos = pb.vec4(pos.xyz, 1);
      if (this.$l.skinMatrix) {
        this.$l.pos = pb.mul(this.$l.skinMatrix, this.$l.pos);
        this.$l.pos = pb.div(this.$l.pos, this.$l.pos.w);
      }
      this.$outputs.worldPosition = pb.mul(this.worldMatrix, this.$l.pos).tag(ShaderFramework.USAGE_WORLD_POSITION);
      that.setClipSpacePosition(this, pb.mul(viewProjMatrix, this.$outputs.worldPosition));
      const norm = pb.getGlobalScope().$getVertexAttrib('normal');
      if (norm) {
        this.$l.norm = pb.vec4(norm.xyz, 0);
        if (this.$l.skinMatrix) {
          this.$l.norm = pb.mul(this.$l.skinMatrix, this.$l.norm);
        }
        this.$outputs.worldNormal = pb.normalize(pb.mul(this.worldMatrix, this.$l.norm).xyz).tag(ShaderFramework.USAGE_WORLD_NORMAL);
        const tan = pb.getGlobalScope().$getVertexAttrib('tangent');
        if (tan) {
          this.$l.tangent = pb.vec4(tan.xyz, 0);
          if (this.$l.skinMatrix) {
            this.$l.tangent = pb.mul(this.$l.skinMatrix, this.$l.tangent);
          }
          this.$outputs.worldTangent = pb.normalize(pb.mul(this.worldMatrix, this.$l.tangent).xyz).tag(ShaderFramework.USAGE_WORLD_TANGENT);
          this.$outputs.worldBinormal = pb.normalize(
            pb.mul(pb.cross(this.$outputs.worldNormal, this.$outputs.worldTangent), tan.w)
          ).tag(ShaderFramework.USAGE_WORLD_BINORMAL);
        }
      }
    });
    pb.getGlobalScope()[funcName]();
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
  /** @internal */
  static getSkinMatrix(scope: PBInsideFunctionScope): PBShaderExp {
    const pb = scope.$builder;
    const funcNameGetBoneMatrixFromTexture = 'lib_getBoneMatrixFromTexture';
    pb.func(funcNameGetBoneMatrixFromTexture, [pb.int('boneIndex')], function () {
      const boneTexture = this.$query(ShaderFramework.USAGE_BONE_MATRICIES);
      this.$l.w = pb.float(this.$query(ShaderFramework.USAGE_BONE_TEXTURE_SIZE));
      this.$l.pixelIndex = pb.float(pb.mul(this.boneIndex, 4));
      this.$l.xIndex = pb.mod(this.pixelIndex, this.w);
      this.$l.yIndex = pb.floor(pb.div(this.pixelIndex, this.w));
      this.$l.u1 = pb.div(pb.add(this.xIndex, 0.5), this.w);
      this.$l.u2 = pb.div(pb.add(this.xIndex, 1.5), this.w);
      this.$l.u3 = pb.div(pb.add(this.xIndex, 2.5), this.w);
      this.$l.u4 = pb.div(pb.add(this.xIndex, 3.5), this.w);
      this.$l.v = pb.div(pb.add(this.yIndex, 0.5), this.w);
      if (Application.instance.device.type !== 'webgl') {
        this.$l.row1 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u1, this.v), 0);
        this.$l.row2 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u2, this.v), 0);
        this.$l.row3 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u3, this.v), 0);
        this.$l.row4 = pb.textureSampleLevel(boneTexture, pb.vec2(this.u4, this.v), 0);
      } else {
        this.$l.row1 = pb.textureSample(boneTexture, pb.vec2(this.u1, this.v));
        this.$l.row2 = pb.textureSample(boneTexture, pb.vec2(this.u2, this.v));
        this.$l.row3 = pb.textureSample(boneTexture, pb.vec2(this.u3, this.v));
        this.$l.row4 = pb.textureSample(boneTexture, pb.vec2(this.u4, this.v));
      }
      this.$return(pb.mat4(this.row1, this.row2, this.row3, this.row4));
    });
    const funcNameGetSkinningMatrix = 'lib_getSkinningMatrix';
    pb.func(funcNameGetSkinningMatrix, [], function () {
      const invBindMatrix = this.$query(ShaderFramework.USAGE_INV_BIND_MATRIX);
      const blendIndices = pb.getGlobalScope().$getVertexAttrib('blendIndices');
      const blendWeights = pb.getGlobalScope().$getVertexAttrib('blendWeights');
      this.$l.m0 = pb.getGlobalScope()[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[0]));
      this.$l.m1 = pb.getGlobalScope()[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[1]));
      this.$l.m2 = pb.getGlobalScope()[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[2]));
      this.$l.m3 = pb.getGlobalScope()[funcNameGetBoneMatrixFromTexture](pb.int(blendIndices[3]));
      this.$l.m = pb.add(
        pb.mul(this.m0, blendWeights.x),
        pb.mul(this.m1, blendWeights.y),
        pb.mul(this.m2, blendWeights.z),
        pb.mul(this.m3, blendWeights.w)
      );
      this.$return(pb.mul(invBindMatrix, this.m));
    });
    return pb.getGlobalScope()[funcNameGetSkinningMatrix]();
  }
  static applyFog(scope: PBInsideFunctionScope, color: PBShaderExp, ctx: DrawContext) {
    if (ctx.applyFog) {
      const pb = scope.$builder;
      if (ctx.env.sky.drawScatteredFog(ctx)) {
        const funcName = 'applyAerialPerspective';
        pb.func(funcName, [pb.vec4('color').inout()], function(){
          this.$l.viewDir = pb.sub(ShaderFramework.getWorldPosition(this).xyz, ShaderFramework.getCameraPosition(this));
          this.viewDir.y = pb.max(this.viewDir.y, 0);
          this.$l.distance = pb.mul(pb.length(this.viewDir), ShaderFramework.getWorldUnit(this));
          this.$l.sliceDist = pb.div(pb.mul(ShaderFramework.getCameraParams(this).y, ShaderFramework.getWorldUnit(this)), ScatteringLut.aerialPerspectiveSliceZ);
          this.$l.slice0 = pb.floor(pb.div(this.distance, this.sliceDist));
          this.$l.slice1 = pb.add(this.slice0, 1);
          this.$l.factor = pb.sub(pb.div(this.distance, this.sliceDist), this.slice0);
          this.$l.viewNormal = pb.normalize(this.viewDir);
          this.$l.zenithAngle = pb.asin(this.viewNormal.y);
          this.$l.horizonAngle = pb.atan2(this.viewNormal.z, this.viewNormal.x);
          this.$l.u0 = pb.div(pb.add(this.slice0, pb.div(this.horizonAngle, Math.PI * 2)), ScatteringLut.aerialPerspectiveSliceZ);
          this.$l.u1 = pb.add(this.u0, 1 / ScatteringLut.aerialPerspectiveSliceZ);
          this.$l.v = pb.div(this.zenithAngle, Math.PI/2);
          this.$l.t0 = pb.textureSampleLevel(ShaderFramework.getAerialPerspectiveLUT(this), pb.vec2(this.u0, this.v), 0);
          this.$l.t1 = pb.textureSampleLevel(ShaderFramework.getAerialPerspectiveLUT(this), pb.vec2(this.u1, this.v), 0);
          this.$l.t = pb.mix(this.t0, this.t1, this.factor);
          this.color = pb.vec4(pb.add(pb.mul(this.color.rgb, this.factor), this.t.rgb), this.color.a);
        });
        scope[funcName](color);
      } else {
        const funcName = 'applyFog';
        pb.func(funcName, [pb.vec4('color').inout()], function(){
          this.$l.viewDir = pb.sub(ShaderFramework.getWorldPosition(this).xyz, ShaderFramework.getCameraPosition(this));
          this.$l.fogFactor = ShaderFramework.computeFogFactor(this, this.viewDir, ShaderFramework.getFogType(this), ShaderFramework.getFogParams(this));
          this.color = pb.vec4(pb.mix(this.color.rgb, ShaderFramework.getFogColor(this).rgb, pb.mul(this.fogFactor, this.color.a, this.color.a)), this.color.a);
        });
        scope[funcName](color);
      }
    }
  }
}
