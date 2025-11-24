import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import {
  LIGHT_TYPE_DIRECTIONAL,
  LIGHT_TYPE_POINT,
  LIGHT_TYPE_SPOT,
  RENDER_PASS_TYPE_LIGHT
} from '../../values';
import type { DrawContext } from '../../render';
import type { MeshMaterial } from '../meshmaterial';
import { applyMaterialMixins } from '../meshmaterial';
import type { TextureMixinInstanceTypes } from './texture';
import { mixinTextureProps } from './texture';
import type { IMixinAlbedoColor } from './albedocolor';
import { mixinAlbedoColor } from './albedocolor';
import { ShaderHelper } from '../shader/helper';

/**
 * Interface for light mixin
 * @public
 */
export type IMixinLight = {
  normalScale: number;
  normalMapMode: 'tangent-space' | 'object-space';
  doubleSidedLighting: boolean;
  needCalculateEnvLight(): boolean;
  getUniformNormalScale(scope: PBInsideFunctionScope): PBShaderExp;
  getEnvLightIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp;
  getEnvLightRadiance(
    scope: PBInsideFunctionScope,
    reflectVec: PBShaderExp,
    roughness: PBShaderExp
  ): PBShaderExp;
  calculateViewVector(scope: PBInsideFunctionScope, worldPos: PBShaderExp): PBShaderExp;
  calculateReflectionVector(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    viewVec: PBShaderExp
  ): PBShaderExp;
  calculateTBN(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ): PBShaderExp;
  calculateNormal(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ): PBShaderExp;
  calculateNormalAndTBN(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal?: PBShaderExp,
    worldTangent?: PBShaderExp,
    worldBinormal?: PBShaderExp
  ): PBShaderExp;
  calculateLightAttenuation(
    scope: PBInsideFunctionScope,
    type: PBShaderExp,
    worldPos: PBShaderExp,
    posRange: PBShaderExp,
    dirCutoff: PBShaderExp
  ): PBShaderExp;
  calculateLightDirection(
    scope: PBInsideFunctionScope,
    type: PBShaderExp,
    worldPos: PBShaderExp,
    posRange: PBShaderExp,
    dirCutoff: PBShaderExp
  ): PBShaderExp;
  calculateShadow(scope: PBInsideFunctionScope, worldPos: PBShaderExp, NoL: PBShaderExp): PBShaderExp;
  forEachLight(
    scope: PBInsideFunctionScope,
    callback: (
      this: PBInsideFunctionScope,
      type: PBShaderExp,
      posRange: PBShaderExp,
      dirCutoff: PBShaderExp,
      colorIntensity: PBShaderExp,
      shadow: boolean
    ) => void
  ): void;
} & TextureMixinInstanceTypes<['normal']> &
  IMixinAlbedoColor;

/**
 * Light mixin
 * @param BaseCls - class to mix in
 * @returns Mixed class
 * @public
 */
export function mixinLight<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).lightMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinLight };
  }
  const S = applyMaterialMixins(BaseCls, mixinAlbedoColor, mixinTextureProps('normal'));
  let FEATURE_DOUBLE_SIDED_LIGHTING = 0;
  let FEATURE_OBJECT_SPACE_NORMALMAP = 0;
  const cls = class extends S {
    static readonly lightMixed = true;
    private _normalScale: number;
    constructor() {
      super();
      this._normalScale = 1;
      this.useFeature(FEATURE_DOUBLE_SIDED_LIGHTING, true);
    }
    copyFrom(other: this): void {
      super.copyFrom(other);
      this.normalScale = other.normalScale;
      this.normalMapMode = other.normalMapMode;
      this.doubleSidedLighting = other.doubleSidedLighting;
    }
    get normalScale(): number {
      return this._normalScale;
    }
    set normalScale(val: number) {
      if (val !== this._normalScale) {
        this._normalScale = val;
        this.uniformChanged();
      }
    }
    get normalMapMode(): 'tangent-space' | 'object-space' {
      return this.featureUsed(FEATURE_OBJECT_SPACE_NORMALMAP);
    }
    set normalMapMode(val: 'tangent-space' | 'object-space') {
      this.useFeature(FEATURE_OBJECT_SPACE_NORMALMAP, val);
    }
    /** true if double sided lighting is used */
    get doubleSidedLighting(): boolean {
      return this.featureUsed(FEATURE_DOUBLE_SIDED_LIGHTING);
    }
    set doubleSidedLighting(val: boolean) {
      this.useFeature(FEATURE_DOUBLE_SIDED_LIGHTING, !!val);
    }
    /**
     * Calculates the normalized vector from world coordinates to the viewpoint.
     *
     * @param scope - Shader scope
     *
     * @returns The view vector
     */
    calculateViewVector(scope: PBInsideFunctionScope, worldPos: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      return pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), worldPos.xyz));
    }
    /**
     * Calculate the reflection vector of the view vector with respect to the normal.
     *
     * @param scope - Shader scope
     * @param normal - Surface normal
     * @param viewVec - The view vector
     * @returns The reflection vector
     */
    calculateReflectionVector(
      scope: PBInsideFunctionScope,
      normal: PBShaderExp,
      viewVec: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      return pb.reflect(pb.neg(viewVec), normal);
    }
    /**
     * Calculate the normal vector for current fragment
     * @param scope - The shader scope
     * @returns Normal vector for current fragment
     */
    calculateNormal(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      worldNormal?: PBShaderExp,
      worldTangent?: PBShaderExp,
      worldBinormal?: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const args: PBShaderExp[] = [worldPos];
      const params: PBShaderExp[] = [pb.vec3('worldPos')];
      let funcName = 'Z_calculateNormal';
      if (worldNormal) {
        params.push(pb.vec3('worldNormal'));
        args.push(worldNormal);
        funcName += '_N';
        if (worldTangent && worldBinormal) {
          params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
          args.push(worldTangent, worldBinormal);
          funcName += '_T';
        }
      }
      pb.func(funcName, params, function () {
        this.$l.uv = that.normalTexture
          ? (that.getNormalTexCoord(this) ?? pb.vec2(0))
          : that.albedoTexture
            ? (that.getAlbedoTexCoord(this) ?? pb.vec2(0))
            : pb.vec2(0);
        this.$l.TBN = that.calculateTBN(
          this,
          this.worldPos,
          this.worldNormal,
          this.worldTangent,
          this.worldBinormal
        );
        if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT && that.normalTexture) {
          if (that.normalMapMode === 'object-space') {
            const pixel = pb.sub(
              pb.mul(pb.textureSample(that.getNormalTextureUniform(this), this.uv).rgb, 2),
              pb.vec3(1)
            );
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.zNormalScale).xx, 1));
            this.$return(pb.normalize(normalTex));
          } else {
            const pixel = pb.sub(
              pb.mul(pb.textureSample(that.getNormalTextureUniform(this), this.uv).rgb, 2),
              pb.vec3(1)
            );
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.zNormalScale).xx, 1));
            this.$return(pb.normalize(pb.mul(this.TBN, normalTex)));
          }
        } else {
          this.$return(this.TBN[2]);
        }
      });
      return pb.getGlobalScope()[funcName](...args);
    }
    /**
     * Normal scale uniform
     * @return Normal scale uniform
     */
    getUniformNormalScale(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.zNormalScale;
    }
    /**
     * Calculate the normal vector for current fragment
     *
     * @param scope - The shader scope
     * @returns Structure that contains normal vector and TBN matrix
     */
    calculateNormalAndTBN(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      worldNormal?: PBShaderExp,
      worldTangent?: PBShaderExp,
      worldBinormal?: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const NormalStruct = pb.defineStruct([pb.mat3('TBN'), pb.vec3('normal')]);
      const that = this;
      const args: PBShaderExp[] = [worldPos.xyz];
      const params: PBShaderExp[] = [pb.vec3('worldPos')];
      let funcName = 'Z_calculateNormalAndTBN';
      if (worldNormal) {
        params.push(pb.vec3('worldNormal'));
        args.push(worldNormal);
        funcName += '_N';
        if (worldTangent && worldBinormal) {
          params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
          args.push(worldTangent, worldBinormal);
          funcName += '_T';
        }
      }
      pb.func(funcName, params, function () {
        this.$l.uv = that.normalTexture
          ? (that.getNormalTexCoord(this) ?? pb.vec2(0))
          : that.albedoTexture
            ? (that.getAlbedoTexCoord(this) ?? pb.vec2(0))
            : pb.vec2(0);
        this.$l.TBN = that.calculateTBN(
          this,
          this.worldPos,
          this.worldNormal,
          this.worldTangent,
          this.worldBinormal
        );
        if (that.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT && that.normalTexture) {
          if (that.normalMapMode === 'object-space') {
            const pixel = pb.sub(
              pb.mul(pb.textureSample(that.getNormalTextureUniform(this), this.uv).rgb, 2),
              pb.vec3(1)
            );
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.zNormalScale).xx, 1));
            this.$return(NormalStruct(this.TBN, pb.normalize(normalTex)));
          } else {
            const pixel = pb.sub(
              pb.mul(pb.textureSample(that.getNormalTextureUniform(this), this.uv).rgb, 2),
              pb.vec3(1)
            );
            const normalTex = pb.mul(pixel, pb.vec3(pb.vec3(this.zNormalScale).xx, 1));
            this.$return(NormalStruct(this.TBN, pb.normalize(pb.mul(this.TBN, normalTex))));
          }
        } else {
          this.$return(NormalStruct(this.TBN, this.TBN[2]));
        }
      });
      return pb.getGlobalScope()[funcName](...args);
    }
    /**
     * Calculate the TBN matrix
     *
     * @param scope - The shader scope
     * @returns TBN matrix
     */
    calculateTBN(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      worldNormal?: PBShaderExp,
      worldTangent?: PBShaderExp,
      worldBinormal?: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const args: PBShaderExp[] = [worldPos.xyz];
      const params: PBShaderExp[] = [pb.vec3('worldPos')];
      let funcName = 'Z_calculateTBN';
      if (worldNormal) {
        params.push(pb.vec3('worldNormal'));
        args.push(worldNormal);
        funcName += '_N';
        if (worldTangent && worldBinormal) {
          params.push(pb.vec3('worldTangent'), pb.vec3('worldBinormal'));
          args.push(worldTangent, worldBinormal);
          funcName += '_T';
        }
      }
      pb.func(funcName, params, function () {
        const posW = this.worldPos;
        this.$l.uv = that.normalTexture
          ? (that.getNormalTexCoord(this) ?? pb.vec2(0))
          : that.albedoTexture
            ? (that.getAlbedoTexCoord(this) ?? pb.vec2(0))
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
          this.$l.ng = pb.normalize(this.worldNormal);
          this.$l.t = pb.normalize(this.worldTangent);
          this.$l.b = pb.normalize(this.worldBinormal);
          if (that.doubleSidedLighting) {
            this.$if(pb.not(this.$builtins.frontFacing), function () {
              this.t = pb.mul(this.t, -1);
              this.b = pb.mul(this.b, -1);
              this.ng = pb.mul(this.ng, -1);
            });
          }
          this.TBN = pb.mat3(this.t, this.b, this.ng);
        }
        this.$return(this.TBN);
      });
      return pb.getGlobalScope()[funcName](...args);
    }
    /**
     * {@inheritDoc MeshMaterial.applyUniformsValues}
     * @override
     */
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (ctx.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        if (this.normalTexture) {
          bindGroup.setValue('zNormalScale', this._normalScale);
        }
      }
    }
    /**
     * Check if the environment lighting should be calculated.
     *
     * @returns true Environment lighting should be calculated, otherwise false
     */
    needCalculateEnvLight(): boolean {
      return this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT && this.drawContext.drawEnvLight;
    }
    /**
     * Get irradiance of current environment light
     *
     * @param scope - Shader scope
     * @param normal - Fragment normal vector
     *
     * @returns Irradiance of current environment light of type vec3
     */
    getEnvLightIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
      if (!this.needCalculateEnvLight()) {
        console.warn('getEnvLightIrradiance(): No need to calculate environment lighting');
        return scope.$builder.vec3(0);
      }
      return this.drawContext.env.light.envLight.hasIrradiance()
        ? scope.$builder.mul(
            this.drawContext.env.light.envLight.getIrradiance(scope, normal).rgb,
            ShaderHelper.getEnvLightStrength(scope)
          )
        : scope.$builder.vec3(0);
    }
    /**
     * Get Radiance of current environment light
     *
     * @param scope - Shader scope
     * @param reflectVec - The reflection vector
     * @param roughness - Roughness value of current fragment
     *
     * @returns Radiance of current environment light of type vec3
     */
    getEnvLightRadiance(
      scope: PBInsideFunctionScope,
      reflectVec: PBShaderExp,
      roughness: PBShaderExp
    ): PBShaderExp {
      if (!this.needCalculateEnvLight()) {
        console.warn('getEnvLightRadiance(): No need to calculate environment lighting');
        return scope.$builder.vec3(0);
      }
      return this.drawContext.env.light.envLight.hasRadiance()
        ? scope.$builder.mul(
            this.drawContext.env.light.envLight.getRadiance(scope, reflectVec, roughness).rgb,
            ShaderHelper.getEnvLightStrength(scope)
          )
        : scope.$builder.vec3(0);
    }
    /**
     * Checks if shadow should be computed
     *
     * @returns true if shadow should be computed, other wise false
     */
    protected needCalculateShadow(): boolean {
      return (
        this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT && !!this.drawContext.currentShadowLight
      );
    }
    /**
     * Calculates shadow of current fragment
     *
     * @param scope - Shader scope
     * @param NoL - NdotL vector
     * @returns Shadow of current fragment, 1 means no shadow and 0 means full shadowed.
     */
    calculateShadow(scope: PBInsideFunctionScope, worldPos: PBShaderExp, NoL: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      if (!this.needCalculateShadow()) {
        console.warn('calculateShadow(): No need to calculate shadow');
        return pb.float(1);
      }
      return ShaderHelper.calculateShadow(scope, worldPos, NoL, this.drawContext);
    }
    private getClusterIndex(scope: PBInsideFunctionScope, fragCoord: PBShaderExp) {
      const pb = scope.$builder;
      const funcName = 'lm_getClusterIndex';
      pb.func(funcName, [pb.vec3('fragCoord')], function () {
        const clusterParams = ShaderHelper.getClusterParams(this);
        const countParams = ShaderHelper.getCountParams(this);
        this.$l.zTile = pb.int(
          pb.max(
            pb.add(
              pb.mul(pb.log2(ShaderHelper.nonLinearDepthToLinear(this, this.fragCoord.z)), clusterParams.z),
              clusterParams.w
            ),
            0
          )
        );
        this.$l.f = pb.vec2(this.fragCoord.x, pb.sub(clusterParams.y, pb.add(this.fragCoord.y, 1)));
        this.$l.xyTile = pb.ivec2(pb.div(this.f, pb.div(clusterParams.xy, pb.vec2(countParams.xy))));
        this.$return(pb.ivec3(this.xyTile, this.zTile));
      });
      return pb.getGlobalScope()[funcName](fragCoord);
    }
    protected calculatePointLightAttenuation(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      posRange: PBShaderExp
    ) {
      const pb = scope.$builder;
      const funcName = 'Z_calculatePointLightAttenuation';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('posRange')], function () {
        this.$l.dist = pb.distance(this.posRange.xyz, this.worldPos);
        this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.posRange.w)));
        this.$return(pb.mul(this.falloff, this.falloff));
      });
      return pb.getGlobalScope()[funcName](worldPos, posRange);
    }
    protected calculateSpotLightAttenuation(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      posRange: PBShaderExp,
      dirCutoff: PBShaderExp
    ) {
      const pb = scope.$builder;
      const funcName = 'Z_calculateSpotLightAttenuation';
      pb.func(funcName, [pb.vec3('worldPos'), pb.vec4('posRange'), pb.vec4('dirCutoff')], function () {
        this.$l.dist = pb.distance(this.posRange.xyz, this.worldPos);
        this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.posRange.w)));
        this.$l.spotFactor = pb.dot(
          pb.normalize(pb.sub(this.worldPos, this.posRange.xyz)),
          this.dirCutoff.xyz
        );
        this.spotFactor = pb.smoothStep(this.dirCutoff.w, pb.mix(this.dirCutoff.w, 1, 0.5), this.spotFactor);
        this.$return(pb.mul(this.spotFactor, this.falloff, this.falloff));
      });
      return pb.getGlobalScope()[funcName](worldPos, posRange, dirCutoff);
    }
    calculateLightAttenuation(
      scope: PBInsideFunctionScope,
      type: PBShaderExp,
      worldPos: PBShaderExp,
      posRange: PBShaderExp,
      dirCutoff: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      return scope.$choice(
        pb.equal(type, LIGHT_TYPE_DIRECTIONAL),
        pb.float(1),
        scope.$choice(
          pb.equal(type, LIGHT_TYPE_POINT),
          this.calculatePointLightAttenuation(scope, worldPos.xyz, posRange),
          this.calculateSpotLightAttenuation(scope, worldPos.xyz, posRange, dirCutoff)
        )
      );
    }
    calculateLightDirection(
      scope: PBInsideFunctionScope,
      type: PBShaderExp,
      worldPos: PBShaderExp,
      posRange: PBShaderExp,
      dirCutoff: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      return scope.$choice(
        pb.equal(type, LIGHT_TYPE_DIRECTIONAL),
        pb.neg(dirCutoff.xyz),
        pb.normalize(pb.sub(posRange.xyz, worldPos.xyz))
      );
    }
    forEachLight(
      scope: PBInsideFunctionScope,
      callback: (
        this: PBInsideFunctionScope,
        type: PBShaderExp,
        posRange: PBShaderExp,
        dirCutoff: PBShaderExp,
        colorIntensity: PBShaderExp,
        shadow: boolean
      ) => void
    ) {
      const pb = scope.$builder;
      const that = this;
      if (that.drawContext.renderPass.type !== RENDER_PASS_TYPE_LIGHT) {
        console.warn('LitMaterial.forEachLight(): must be called in forward render pass');
        return;
      }
      if (that.drawContext.currentShadowLight) {
        const posRange = scope.light.positionAndRange;
        const dirCutoff = scope.light.directionAndCutoff;
        const colorIntensity = scope.light.diffuseAndIntensity;
        scope.$scope(function () {
          const lightType = scope.$choice(
            pb.lessThan(posRange.w, 0),
            pb.int(LIGHT_TYPE_DIRECTIONAL),
            scope.$choice(pb.lessThan(dirCutoff.w, 0), pb.int(LIGHT_TYPE_POINT), pb.int(LIGHT_TYPE_SPOT))
          );
          callback.call(this, lightType, posRange, dirCutoff, colorIntensity, true);
        });
      } else {
        scope.$scope(function () {
          const countParams = ShaderHelper.getCountParams(this);
          this.$l.cluster = that.getClusterIndex(this, this.$builtins.fragCoord.xyz);
          this.$l.clusterIndex = pb.add(
            this.cluster.x,
            pb.mul(this.cluster.y, countParams.x),
            pb.mul(this.cluster.z, countParams.x, countParams.y)
          );
          this.$l.texSize = scope.light.lightIndexTexSize;
          if (pb.getDevice().type === 'webgl') {
            this.$l.texCoordX = pb.div(
              pb.add(pb.mod(pb.float(this.clusterIndex), pb.float(this.texSize.x)), 0.5),
              pb.float(this.texSize.x)
            );
            this.$l.texCoordY = pb.div(
              pb.add(pb.float(pb.div(this.clusterIndex, this.texSize.x)), 0.5),
              pb.float(this.texSize.y)
            );
            this.$l.samp = pb.textureSample(
              ShaderHelper.getClusteredLightIndexTexture(this),
              pb.vec2(this.texCoordX, this.texCoordY)
            );
          } else {
            this.$l.texCoordX = pb.mod(this.clusterIndex, this.texSize.x);
            this.$l.texCoordY = pb.div(this.clusterIndex, this.texSize.x);
            this.$l.samp = pb.textureLoad(
              ShaderHelper.getClusteredLightIndexTexture(this),
              pb.ivec2(this.texCoordX, this.texCoordY),
              0
            );
          }
          if (pb.getDevice().type === 'webgl') {
            this.$for(pb.int('i'), 0, 4, function () {
              this.$l.k = this.samp.at(this.i);
              this.$l.lights = pb.int[2]();
              this.$l.lights[0] = pb.int(pb.mod(this.k, 256));
              this.$l.lights[1] = pb.int(pb.div(this.k, 256));
              this.$for(pb.int('k'), 0, 2, function () {
                this.$l.li = this.lights.at(this.k);
                this.$if(pb.greaterThan(this.li, 0), function () {
                  this.$for(pb.int('j'), 1, 256, function () {
                    this.$if(pb.equal(this.j, this.li), function () {
                      this.$l.positionRange = ShaderHelper.getLightPositionAndRange(this, this.j);
                      this.$l.directionCutoff = ShaderHelper.getLightDirectionAndCutoff(this, this.j);
                      this.$l.diffuseIntensity = ShaderHelper.getLightColorAndIntensity(this, this.j);
                      this.$l.lightType = this.$choice(
                        pb.lessThan(this.positionRange.w, 0),
                        pb.int(LIGHT_TYPE_DIRECTIONAL),
                        this.$choice(
                          pb.lessThan(this.directionCutoff.w, 0),
                          pb.int(LIGHT_TYPE_POINT),
                          pb.int(LIGHT_TYPE_SPOT)
                        )
                      );
                      this.$scope(function () {
                        callback.call(
                          this,
                          this.lightType,
                          this.positionRange,
                          this.directionCutoff,
                          this.diffuseIntensity,
                          false
                        );
                      });
                      this.$break();
                    });
                  });
                });
              });
            });
          } else {
            this.$for(pb.uint('i'), 0, 4, function () {
              this.$for(pb.uint('k'), 0, 4, function () {
                this.$l.c = pb.compAnd(pb.sar(this.samp.at(this.i), pb.mul(this.k, 8)), 0xff);
                this.$if(pb.greaterThan(this.c, 0), function () {
                  this.$l.positionRange = ShaderHelper.getLightPositionAndRange(this, this.c);
                  this.$l.directionCutoff = ShaderHelper.getLightDirectionAndCutoff(this, this.c);
                  this.$l.diffuseIntensity = ShaderHelper.getLightColorAndIntensity(this, this.c);
                  this.$l.lightType = this.$choice(
                    pb.lessThan(this.positionRange.w, 0),
                    pb.int(LIGHT_TYPE_DIRECTIONAL),
                    this.$choice(
                      pb.lessThan(this.directionCutoff.w, 0),
                      pb.int(LIGHT_TYPE_POINT),
                      pb.int(LIGHT_TYPE_SPOT)
                    )
                  );
                  this.$scope(function () {
                    callback.call(
                      this,
                      this.lightType,
                      this.positionRange,
                      this.directionCutoff,
                      this.diffuseIntensity,
                      false
                    );
                  });
                });
              });
            });
          }
        });
      }
    }
    /**
     * Fragment shader implementation
     *
     * @param scope - Shader scope
     * @returns Calucated fragment color
     */
    fragmentShader(scope: PBFunctionScope) {
      super.fragmentShader(scope);
      const pb = scope.$builder;
      if (this.drawContext.renderPass.type === RENDER_PASS_TYPE_LIGHT) {
        if (this.normalTexture) {
          scope.zNormalScale = pb.float().uniform(2);
        }
      }
    }
    /**
     * {@inheritDoc Material.supportLighting}
     * @override
     */
    supportLighting(): boolean {
      return true;
    }
  } as unknown as T & { new (...args: any[]): IMixinLight };
  FEATURE_DOUBLE_SIDED_LIGHTING = cls.defineFeature();
  FEATURE_OBJECT_SPACE_NORMALMAP = cls.defineFeature();
  return cls;
}
