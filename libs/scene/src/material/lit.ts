import { BindGroup, PBInsideFunctionScope, PBShaderExp, Texture2D, TextureSampler, VertexSemantic } from "@zephyr3d/device";
import { UnlitMaterial } from "./unlit";
import { Matrix4x4 } from "@zephyr3d/base";
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT, RENDER_PASS_TYPE_FORWARD } from "../values";
import { ShaderFramework, nonLinearDepthToLinear } from "../shaders";
import { DrawContext } from "../render";
import { Application } from "../app";

export class LitMaterial extends UnlitMaterial {
    protected static readonly FEATURE_DOUBLE_SIDED_LIGHTING = 'lm_doublesided_lighting';
    protected static readonly FEATURE_VERTEX_NORMAL = 'lm_vertexnormal';
    protected static readonly FEATURE_VERTEX_TANGENT = 'lm_vertextangent';
    protected static readonly FEATURE_NORMAL_TEXTURE = 'lm_normaltexture';
    protected static readonly FEATURE_NORMAL_TEXCOORD_INDEX = 'lm_normaltexcoord';
    protected static readonly FEATURE_NORMAL_TEXTURE_MATRIX = 'lm_normal_texture_matrix';
    protected static readonly FEATURE_OBJECT_SPACE_NORMALMAP = 'lm_objectspace_normalmap';
    private _normalTexture: Texture2D;
    private _normalSampler: TextureSampler;
    private _normalTexCoordIndex: number;
    private _normalTexCoordMatrix: Matrix4x4;
    private _normalScale: number;
    constructor() {
      super();
      this._normalTexture = null;
      this._normalSampler = null;
      this._normalTexCoordIndex = 0;
      this._normalTexCoordMatrix = null;
      this._normalScale = 1;
    }
    get normalScale(): number {
      return this._normalScale;
    }
    set normalScale(val: number) {
      this._normalScale = val;
    }
    get normalMapMode(): 'tangent-space'|'object-space' {
      return this.featureUsed(LitMaterial.FEATURE_OBJECT_SPACE_NORMALMAP, RENDER_PASS_TYPE_FORWARD);
    }
    set normalMapMode(val: 'tangent-space'|'object-space') {
      this.useFeature(LitMaterial.FEATURE_OBJECT_SPACE_NORMALMAP, val, RENDER_PASS_TYPE_FORWARD);
    }
    /** true if double sided lighting is used */
    get doubleSidedLighting(): boolean {
      return this.featureUsed(LitMaterial.FEATURE_DOUBLE_SIDED_LIGHTING, RENDER_PASS_TYPE_FORWARD)
    }
    set doubleSidedLighting(val: boolean) {
      this.useFeature(LitMaterial.FEATURE_DOUBLE_SIDED_LIGHTING, !!val, RENDER_PASS_TYPE_FORWARD);
    }
    /** true if vertex normal attribute presents */
    get vertexNormal(): boolean {
      return this.featureUsed(LitMaterial.FEATURE_VERTEX_NORMAL, RENDER_PASS_TYPE_FORWARD)
    }
    set vertexNormal(val: boolean) {
      this.useFeature(LitMaterial.FEATURE_VERTEX_NORMAL, !!val);
    }
    /** true if vertex normal attribute presents */
    get vertexTangent(): boolean {
      return this.featureUsed(LitMaterial.FEATURE_VERTEX_TANGENT, RENDER_PASS_TYPE_FORWARD)
    }
    set vertexTangent(val: boolean) {
      this.useFeature(LitMaterial.FEATURE_VERTEX_TANGENT, !!val);
    }
    /** Normal texture */
    get normalTexture(): Texture2D {
      return this._normalTexture;
    }
    set normalTexture(tex: Texture2D) {
      this.useFeature(LitMaterial.FEATURE_NORMAL_TEXTURE, !!tex);
      if (tex) {
        this.useFeature(LitMaterial.FEATURE_NORMAL_TEXCOORD_INDEX, this._normalTexCoordIndex);
      }
      this._normalTexture = tex ?? null;
    }
    /** Normal texture sampler */
    get normalTextureSampler(): TextureSampler {
      return this._normalSampler;
    }
    set normalTextureSampler(sampler: TextureSampler) {
      this._normalSampler = sampler ?? null;
    }
    /** Normal texture coordinate index */
    get normalTexCoordIndex(): number {
      return this._normalTexCoordIndex;
    }
    set normalTexCoordIndex(val: number) {
      if (val !== this._normalTexCoordIndex) {
        this._normalTexCoordIndex = val;
        if (this._normalTexture) {
          this.useFeature(LitMaterial.FEATURE_NORMAL_TEXCOORD_INDEX, this._normalTexCoordIndex);
        }
      }
    }
    /** Normal texture coordinate transform matrix */
    get normalTexMatrix(): Matrix4x4 {
      return this._normalTexCoordMatrix;
    }
    set normalTexMatrix(val: Matrix4x4) {
      if (val !== this._normalTexCoordMatrix) {
        this._normalTexCoordMatrix = val;
        if (this._normalTexture) {
          this.useFeature(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, !!this._normalTexCoordMatrix);
        }
      }
    }
    /**
     * Calculates the normalized vector from world coordinates to the viewpoint.
     * 
     * @param scope - Shader scope
     * @returns The view vector
     */
    calculateViewVector(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      return pb.normalize(pb.sub(ShaderFramework.getCameraPosition(scope), ShaderFramework.getWorldPosition(scope).xyz));
    }
    /**
     * Calculate the reflection vector of the view vector with respect to the normal.
     * 
     * @param scope - Shader scope
     * @param normal - Surface normal
     * @param viewVec - The view vector
     * @returns The reflection vector
     */
    calculateReflectionVector(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      return pb.reflect(pb.neg(viewVec), normal);
    }
    /**
     * Calculate the normal vector for current fragment
     * @param scope - The shader scope
     * @param ctx - The drawing context
     * @returns Normal vector for current fragment
     */
    calculateNormal(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const args: PBShaderExp[] = [];
      const params: PBShaderExp[] = [];
      const worldNormal = ShaderFramework.getWorldNormal(scope);
      const worldTangent = ShaderFramework.getWorldTangent(scope);
      const worldBinormal = ShaderFramework.getWorldBinormal(scope);
      if (worldNormal) {
        params.push(pb.vec3('worldNormal'));
        args.push(worldNormal);
        if (worldTangent) {
          params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
          args.push(worldTangent, worldBinormal);
        }
      }
      pb.func('kkCalculateNormal', params, function(){
        const posW = ShaderFramework.getWorldPosition(this).xyz;
        this.$l.uv = that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)
          ? scope.$inputs.kkNormalTexCoord ?? pb.vec2(0)
          : that.featureUsed(LitMaterial.FEATURE_ALBEDO_TEXTURE, ctx.renderPass.type)
            ? scope.$inputs.kkAlbedoTexCoord ?? pb.vec2(0)
            : pb.vec2(0);
        this.$l.TBN = pb.mat3();
        if (!worldNormal) {
          this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
          this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
          this.$if(
            pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001),
            function () {
              this.uv_dx = pb.vec3(1, 0, 0);
              this.uv_dy = pb.vec3(0, 1, 0);
            }
          );
          this.$l.t_ = pb.div(
            pb.sub(pb.mul(pb.dpdx(posW), this.uv_dy.y), pb.mul(pb.dpdy(posW), this.uv_dx.y)),
            pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
          );
          this.$l.ng = pb.normalize(pb.cross(pb.dpdx(posW), pb.dpdy(posW)));
          this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
          this.$l.b = pb.cross(this.ng, this.t);
          if (that.doubleSidedLighting) {
            this.$if(pb.not(this.$builtins.frontFacing), function () {
              this.t = pb.mul(this.t, -1);
              this.b = pb.mul(this.b, -1);
              this.ng = pb.mul(this.ng, -1);
            });
          }
          this.TBN = pb.mat3(this.t, this.b, this.ng);
        } else if (!worldTangent) {
          this.$l.uv_dx = pb.dpdx(pb.vec3(this.uv, 0));
          this.$l.uv_dy = pb.dpdy(pb.vec3(this.uv, 0));
          this.$if(
            pb.lessThanEqual(pb.add(pb.length(this.uv_dx), pb.length(this.uv_dy)), 0.000001),
            function () {
              this.uv_dx = pb.vec3(1, 0, 0);
              this.uv_dy = pb.vec3(0, 1, 0);
            }
          );
          this.$l.t_ = pb.div(
            pb.sub(pb.mul(pb.dpdx(posW), this.uv_dy.y), pb.mul(pb.dpdy(posW), this.uv_dx.y)),
            pb.sub(pb.mul(this.uv_dx.x, this.uv_dy.y), pb.mul(this.uv_dx.y, this.uv_dy.x))
          );
          this.$l.ng = pb.normalize(this.worldNormal);
          this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
          this.$l.b = pb.cross(this.ng, this.t);
          if (that.doubleSidedLighting) {
            this.$if(pb.not(this.$builtins.frontFacing), function () {
              this.t = pb.mul(this.t, -1);
              this.b = pb.mul(this.b, -1);
              this.ng = pb.mul(this.ng, -1);
            });
          }
          this.TBN = pb.mat3(this.t, this.b, this.ng);
        } else {
          this.TBN = pb.mat3(pb.normalize(this.worldTangent), pb.normalize(this.worldBinormal), pb.normalize(this.worldNormal));
        }
        if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)) {
          if (that.normalMapMode === 'object-space') {
            const pixel = pb.sub(pb.mul(pb.textureSample(this.kkNormalTexture, this.uv).rgb, 2), pb.vec3(1));
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.kkNormalScale).xx, 1));
            this.$return(pb.normalize(normalTex));
          } else {
            const pixel = pb.sub(pb.mul(pb.textureSample(this.kkNormalTexture, this.uv).rgb, 2), pb.vec3(1));
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.kkNormalScale).xx, 1));
            this.$return(pb.normalize(pb.mul(this.TBN, normalTex)));
          }
        } else {
          this.$return(this.TBN[2]);
        }
      });
      return pb.getGlobalScope().kkCalculateNormal(...args);
    }
    /**
     * {@inheritDoc NewUnlitMaterial._applyUniforms}
     * @override
     */
    protected _applyUniforms(bindGroup: BindGroup, ctx: DrawContext): void {
      super._applyUniforms(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        if (this.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)) {
          bindGroup.setValue('kkNormalScale', this._normalScale);
          bindGroup.setTexture('kkNormalTexture', this._normalTexture, this._normalSampler);
          if (this.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, ctx.renderPass.type)) {
            bindGroup.setValue('kkNormalTextureMatrix', this._normalTexCoordMatrix);
          }
        }
      }
    }
    /**
     * Check if the environment lighting should be calculated.
     * 
     * @param ctx - Draw context
     * @returns true Environment lighting should be calculated, otherwise false
     */
    protected needCalculateEnvLight(ctx: DrawContext): boolean {
      return ctx.drawEnvLight;
    }
    /**
     * Get irradiance of current environment light
     * 
     * @param scope - Shader scope
     * @param normal - Fragment normal vector
     * @param ctx - The drawing context
     * 
     * @returns Irradiance of current environment light of type vec3
     */
    protected getEnvLightIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx: DrawContext): PBShaderExp {
      if (!this.needCalculateEnvLight) {
        console.warn('getEnvLightIrradiance(): No need to calculate environment lighting');
        return scope.$builder.vec3(0);
      }
      return ctx.env.light.envLight.hasIrradiance() ? scope.$builder.mul(ctx.env.light.envLight.getIrradiance(scope, normal).rgb, ShaderFramework.getEnvLightStrength(scope)) : scope.$builder.vec3(0);
    }
    /**
     * Get Radiance of current environment light
     * 
     * @param scope - Shader scope
     * @param reflectVec - The reflection vector
     * @param roughness - Roughness value of current fragment
     * @param ctx - The drawing context
     * 
     * @returns Radiance of current environment light of type vec3
     */
    protected getEnvLightRadiance(scope: PBInsideFunctionScope, reflectVec: PBShaderExp, roughness: PBShaderExp, ctx: DrawContext): PBShaderExp {
      if (!this.needCalculateEnvLight) {
        console.warn('getEnvLightRadiance(): No need to calculate environment lighting');
        return scope.$builder.vec3(0);
      }
      return ctx.env.light.envLight.hasRadiance() ? scope.$builder.mul(ctx.env.light.envLight.getRadiance(scope, reflectVec, roughness).rgb, ShaderFramework.getEnvLightStrength(scope)) : scope.$builder.vec3(0);
    }
    /**
     * Checks if shadow should be computed
     * @param ctx - The drawing context
     * @returns true if shadow should be computed, other wise false
     */
    protected needCalucateShadow(ctx: DrawContext): boolean {
      return !!ctx.currentShadowLight;
    }
    /**
     * Calculates shadow of current fragment
     * 
     * @param scope - Shader scope
     * @param NoL - NdotL vector
     * @param ctx - The drawing context
     * @returns Shadow of current fragment, 1 means no shadow and 0 means full shadowed.
     */
    protected calculateShadow(scope: PBInsideFunctionScope, NoL: PBShaderExp, ctx: DrawContext): PBShaderExp {
      const pb = scope.$builder;
      if (!this.needCalucateShadow(ctx)) {
        console.warn('calculateShadow(): No need to calculate shadow');
        return pb.float(1);
      }
      const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
      const funcName = 'lm_calculateCSM';
      pb.func(funcName, [pb.float('NoL')], function(){
        if (shadowMapParams.numShadowCascades > 1) {
          this.$l.shadowCascades = this.global.light.shadowCascades;
          this.$l.shadowBound = pb.vec4(0, 0, 1, 1);
          this.$l.linearDepth = nonLinearDepthToLinear(this, this.$builtins.fragCoord.z);
          this.$l.splitDistances = ShaderFramework.getCascadeDistances(this);
          this.$l.comparison = pb.vec4(pb.greaterThan(pb.vec4(this.linearDepth), this.splitDistances));
          this.$l.cascadeFlags = pb.vec4(
            pb.float(pb.greaterThan(this.shadowCascades, 0)),
            pb.float(pb.greaterThan(this.shadowCascades, 1)),
            pb.float(pb.greaterThan(this.shadowCascades, 2)),
            pb.float(pb.greaterThan(this.shadowCascades, 3))
          );
          this.$l.split = pb.int(pb.dot(this.comparison, this.cascadeFlags));
          if (Application.instance.device.type === 'webgl') {
            this.$l.shadowVertex = pb.vec4();
            this.$for(pb.int('cascade'), 0, 4, function () {
              this.$if(pb.equal(this.cascade, this.split), function () {
                this.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this, this.cascade);
                this.$break();
              });
            });
          } else {
            this.$l.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this, this.split);
          }
          const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
          this.$l.shadow = shadowMapParams.impl.computeShadowCSM(shadowMapParams, this, this.shadowVertex, this.NoL, this.split);
          this.$l.shadowDistance = ShaderFramework.getShadowCameraParams(scope).w;
          this.shadow = pb.mix(this.shadow, 1, pb.smoothStep(pb.mul(this.shadowDistance, 0.8), this.shadowDistance, pb.distance(ShaderFramework.getCameraPosition(this), ShaderFramework.getWorldPosition(this).xyz)));
          this.$return(this.shadow);
        } else {
          this.$l.shadowVertex = ShaderFramework.calculateShadowSpaceVertex(this);
          const shadowMapParams = ctx.shadowMapInfo.get(ctx.currentShadowLight);
          this.$l.shadow = shadowMapParams.impl.computeShadow(shadowMapParams, this, this.shadowVertex, this.NoL);
          this.$l.shadowDistance = ShaderFramework.getShadowCameraParams(scope).w;
          this.shadow = pb.mix(this.shadow, 1, pb.smoothStep(pb.mul(this.shadowDistance, 0.8), this.shadowDistance, pb.distance(ShaderFramework.getCameraPosition(this), ShaderFramework.getWorldPosition(this).xyz)));
          this.$return(this.shadow);
        }
      });
      return pb.getGlobalScope()[funcName](NoL);
    }
    private getClusterIndex(scope: PBInsideFunctionScope, fragCoord: PBShaderExp) {
      const pb = scope.$builder;
      const funcName = 'lm_getClusterIndex';
      pb.func(funcName, [pb.vec3('fragCoord')], function(){
        const clusterParams = ShaderFramework.getClusterParams(this);
        const countParams = ShaderFramework.getCountParams(this);
        this.$l.zTile = pb.int(pb.max(pb.add(pb.mul(pb.log2(nonLinearDepthToLinear(this, this.fragCoord.z)), clusterParams.z), clusterParams.w), 0));
        this.$l.f = pb.vec2(this.fragCoord.x, pb.sub(clusterParams.y, pb.add(this.fragCoord.y, 1)));
        this.$l.xyTile = pb.ivec2(pb.div(this.f, pb.div(clusterParams.xy, pb.vec2(countParams.xy))));
        this.$return(pb.ivec3(this.xyTile, this.zTile));
      });
      return pb.getGlobalScope()[funcName](fragCoord);
    }
    protected calculatePointLightAttenuation(scope: PBInsideFunctionScope, posRange: PBShaderExp) {
      const pb = scope.$builder;
      const funcName = 'lm_calculatePointLightAttenuation';
      pb.func(funcName, [pb.vec4('posRange')], function(){
        this.$l.dist = pb.distance(this.posRange.xyz, ShaderFramework.getWorldPosition(this).xyz);
        this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.posRange.w)));
        this.$return(pb.mul(this.falloff, this.falloff));
      });
      return pb.getGlobalScope()[funcName](posRange);
    }
    protected calculateSpotLightAttenuation(scope: PBInsideFunctionScope, posRange: PBShaderExp, dirCutoff: PBShaderExp) {
      const pb = scope.$builder;
      const funcName = 'lm_calculateSpotLightAttenuation';
      pb.func(funcName, [pb.vec4('posRange'), pb.vec4('dirCutoff')], function(){
        this.$l.dist = pb.distance(this.posRange.xyz, ShaderFramework.getWorldPosition(this).xyz);
        this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.posRange.w)));
        this.$l.spotFactor = pb.dot(pb.normalize(pb.sub(ShaderFramework.getWorldPosition(this).xyz, this.posRange.xyz)), this.dirCutoff.xyz);
        this.spotFactor = pb.smoothStep(this.dirCutoff.w, pb.mix(this.dirCutoff.w, 1, 0.5), this.spotFactor);
        this.$return(pb.mul(this.spotFactor, this.falloff, this.falloff));
      });
      return pb.getGlobalScope()[funcName](posRange, dirCutoff);
    }
    protected calculateLightAttenuation(scope: PBInsideFunctionScope, type: PBShaderExp, posRange: PBShaderExp, dirCutoff: PBShaderExp) {
      const pb = scope.$builder;
      return scope.$choice(pb.equal(type, LIGHT_TYPE_DIRECTIONAL),
        pb.float(1),
        scope.$choice(pb.equal(type, LIGHT_TYPE_POINT),
          this.calculatePointLightAttenuation(scope, posRange),
          this.calculateSpotLightAttenuation(scope, posRange, dirCutoff)));
    }
    protected calculateLightDirection(scope: PBInsideFunctionScope, type: PBShaderExp, posRange: PBShaderExp, dirCutoff: PBShaderExp) {
      const pb = scope.$builder;
      return scope.$choice(pb.equal(type, LIGHT_TYPE_DIRECTIONAL),
        pb.neg(dirCutoff.xyz),
        pb.normalize(pb.sub(posRange.xyz, ShaderFramework.getWorldPosition(scope).xyz)));
    }
    protected forEachLight(scope: PBInsideFunctionScope, ctx: DrawContext, callback: (this: PBInsideFunctionScope, type: PBShaderExp, posRange: PBShaderExp, dirCutoff: PBShaderExp, colorIntensity: PBShaderExp, shadow: boolean) => void) {
      const pb = scope.$builder;
      const that = this;
      if (ctx.currentShadowLight) {
        const posRange = scope.global.light.positionAndRange;
        const dirCutoff = scope.global.light.directionAndCutoff;
        const colorIntensity = scope.global.light.diffuseAndIntensity;
        scope.$scope(function(){
          const lightType = scope.$choice(pb.lessThan(posRange.w, 0),
          pb.int(LIGHT_TYPE_DIRECTIONAL),
          scope.$choice(pb.lessThan(dirCutoff.w, 0), pb.int(LIGHT_TYPE_POINT), pb.int(LIGHT_TYPE_SPOT)));
          callback.call(this, lightType, posRange, dirCutoff, colorIntensity, true);
        });
      } else {
        scope.$scope(function(){
          const countParams = ShaderFramework.getCountParams(this);
          this.$l.cluster = that.getClusterIndex(this, this.$builtins.fragCoord.xyz);
          this.$l.clusterIndex = (pb.add(this.cluster.x, pb.mul(this.cluster.y, countParams.x), pb.mul(this.cluster.z, countParams.x, countParams.y)));
          this.$l.texSize = this.global.light.lightIndexTexSize;
          if (pb.getDevice().type === 'webgl') {
            this.$l.texCoordX = pb.div(pb.add(pb.mod(pb.float(this.clusterIndex), pb.float(this.texSize.x)), 0.5), pb.float(this.texSize.x));
            this.$l.texCoordY = pb.div(pb.add(pb.float(pb.div(this.clusterIndex, this.texSize.x)), 0.5), pb.float(this.texSize.y));
            this.$l.samp = pb.textureSample(ShaderFramework.getClusteredLightIndexTexture(this), pb.vec2(this.texCoordX, this.texCoordY));
          } else {
            this.$l.texCoordX = pb.mod(this.clusterIndex, this.texSize.x);
            this.$l.texCoordY = pb.div(this.clusterIndex, this.texSize.x);
            this.$l.samp = pb.textureLoad(ShaderFramework.getClusteredLightIndexTexture(this), pb.ivec2(this.texCoordX, this.texCoordY), 0);
          }
          if (pb.getDevice().type === 'webgl') {
            this.$for(pb.int('i'), 0, 4, function(){
              this.$l.k = this.samp.at(this.i);
              this.$l.lights = pb.int[2]();
              this.$l.lights[0] = pb.int(pb.mod(this.k, 256));
              this.$l.lights[1] = pb.int(pb.div(this.k, 256));
              this.$for(pb.int('k'), 0, 2, function(){
                this.$l.li = this.lights.at(this.k);
                this.$if(pb.greaterThan(this.li, 0), function(){
                  this.$for(pb.int('j'), 1, 256, function(){
                    this.$if(pb.equal(this.j, this.li), function() {
                      this.$l.positionRange = ShaderFramework.getLightPositionAndRange(this, this.j);
                      this.$l.directionCutoff = ShaderFramework.getLightDirectionAndCutoff(this, this.j);
                      this.$l.diffuseIntensity = ShaderFramework.getLightColorAndIntensity(this, this.j);
                      this.$l.lightType = this.$choice(pb.lessThan(this.positionRange.w, 0),
                        pb.int(LIGHT_TYPE_DIRECTIONAL),
                        this.$choice(pb.lessThan(this.directionCutoff.w, 0), pb.int(LIGHT_TYPE_POINT), pb.int(LIGHT_TYPE_SPOT)));
                      this.$scope(function(){
                        callback.call(this, this.lightType, this.positionRange, this.directionCutoff, this.diffuseIntensity, false);
                      });
                      this.$break();
                    });
                  });
                })
              });
            });
          } else {
            this.$for(pb.uint('i'), 0, 4, function(){
              this.$for(pb.uint('k'), 0, 4, function(){
                this.$l.c = pb.compAnd(pb.sar(this.samp.at(this.i), pb.mul(this.k, 8)), 0xff);
                this.$if(pb.greaterThan(this.c, 0), function(){
                  this.$l.positionRange = ShaderFramework.getLightPositionAndRange(this, this.c);
                  this.$l.directionCutoff = ShaderFramework.getLightDirectionAndCutoff(this, this.c);
                  this.$l.diffuseIntensity = ShaderFramework.getLightColorAndIntensity(this, this.c);
                  this.$l.lightType = this.$choice(pb.lessThan(this.positionRange.w, 0),
                    pb.int(LIGHT_TYPE_DIRECTIONAL),
                    this.$choice(pb.lessThan(this.directionCutoff.w, 0), pb.int(LIGHT_TYPE_POINT), pb.int(LIGHT_TYPE_SPOT)));
                  this.$scope(function(){
                    callback.call(this, this.lightType, this.positionRange, this.directionCutoff, this.diffuseIntensity, false);
                  });
                });
              });
            });
          }
        });
      }
    }
    /**
     * Vertex shader implementation.
     * 
     * @param scope - Shader scope
     * @param ctx - The drawing context
     */
    protected vertexShader(scope: PBInsideFunctionScope, ctx: DrawContext): void {
      const that = this;
      const pb = scope.$builder;
      (function(this: PBInsideFunctionScope) {
        if (that.needFragmentColor(ctx)) {
          if (that.vertexNormal) {
            this.$inputs.normal = pb.vec3().attrib('normal');
          }
          if (that.vertexTangent) {
            this.$inputs.tangent = pb.vec4().attrib('tangent');
          }
          if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)) {
            const semantic = `texCoord${that.normalTexCoordIndex}` as VertexSemantic;
            if (!this.$getVertexAttrib(semantic)) {
              this.$inputs[semantic] = pb.vec2().attrib(semantic);
            }
            if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE_MATRIX, ctx.renderPass.type)) {
              this.$g.kkNormalTextureMatrix = pb.mat4().uniform(2);
              this.$outputs.kkNormalTexCoord = pb.mul(this.kkNormalTextureMatrix, pb.vec4(this.$inputs[semantic], 0, 1)).xy;
            } else {
              this.$outputs.kkNormalTexCoord = this.$inputs[semantic];
            }
          }
        }
      }).call(scope);
      super.vertexShader(scope, ctx);
    }
    /**
     * Fragment shader implementation
     * 
     * @param scope - Shader scope
     * @param ctx - The drawing context
     * @returns Calucated fragment color
     */
    protected fragmentShader(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
      const that = this;
      const pb = scope.$builder;
      (function(this: PBInsideFunctionScope) {
        if (that.featureUsed(LitMaterial.FEATURE_NORMAL_TEXTURE, ctx.renderPass.type)) {
          this.$g.kkNormalTexture = pb.tex2D().uniform(2);
          this.$g.kkNormalScale = pb.float().uniform(2);
        }
      }).call(scope);
      return super.fragmentShader(scope, ctx);
    }
    /**
     * {@inheritDoc Material.supportLighting}
     * @override
     */
    supportLighting(): boolean {
      return true;
    }
  }
  
  export class TestLitMaterial extends LitMaterial {
    constructor(){
      super();   
    }
    protected fragmentShader(scope: PBInsideFunctionScope, ctx: DrawContext): PBShaderExp {
      const albedoColor = super.fragmentShader(scope, ctx);
      const that = this;
      const pb = scope.$builder;
      return (function(this: PBInsideFunctionScope) {
        this.$l.albedo = albedoColor;
        this.$l.color = pb.vec3(0);
        this.$l.normal = that.calculateNormal(scope, ctx);
        if (that.needCalculateEnvLight(ctx)) {
          this.color = pb.add(this.color, that.getEnvLightIrradiance(this, this.normal, ctx));
        }
        that.forEachLight(this, ctx, function(type, posRange, dirCutoff, colorIntensity, shadow){
          this.$l.NoL = pb.clamp(pb.neg(pb.dot(this.normal, dirCutoff.xyz)), 0, 1);
          this.$l.lightContrib = pb.mul(colorIntensity.rgb, colorIntensity.a, this.NoL);
          if (shadow) {
            this.lightContrib = pb.mul(this.lightContrib, that.calculateShadow(this, this.NoL, ctx));
          }
          this.color = pb.add(this.color, this.lightContrib);
        });
        return pb.mul(this.albedo, pb.vec4(this.color, 1));
      }).call(scope);
    }
  }