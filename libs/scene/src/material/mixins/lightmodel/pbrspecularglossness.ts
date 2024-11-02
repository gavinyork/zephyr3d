import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import type { IMixinPBRCommon } from '../pbr/common';
import { mixinPBRCommon } from '../pbr/common';
import type { DrawContext } from '../../../render';
import { Vector4 } from '@zephyr3d/base';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import { ShaderHelper } from '../../shader/helper';

/**
 * Interface for PBRSpecularGlossiness mixin
 * @public
 */
export type IMixinPBRSpecularGlossiness = {
  specularFactor: Vector4;
  glossinessFactor: number;
  PBRLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    TBN: PBShaderExp,
    outRoughness?: PBShaderExp
  ): PBShaderExp;
  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ): void;
} & IMixinPBRCommon &
  IMixinLight &
  TextureMixinInstanceTypes<['specular']>;

/**
 * PBRSpecularGlossiness mixin
 *
 * @param BaseCls - Base class to mix in
 * @returns Mixed class
 *
 * @public
 */
export function mixinPBRSpecularGlossness<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrSpecularGlossnessMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRSpecularGlossiness };
  }
  const S = applyMaterialMixins(BaseCls, mixinPBRCommon, mixinLight, mixinTextureProps('specular'));
  return class extends S {
    static readonly pbrSpecularGlossnessMixed = true;
    private _specularFactor: Vector4;
    private _glossinessFactor: number;
    constructor() {
      super();
      this._specularFactor = Vector4.one();
      this._glossinessFactor = 1;
    }
    get specularFactor(): Vector4 {
      return this._specularFactor;
    }
    set specularFactor(val: Vector4) {
      if (!val.equalsTo(this._specularFactor)) {
        this._specularFactor.set(val);
        this.uniformChanged();
      }
    }
    get glossinessFactor(): number {
      return this._glossinessFactor;
    }
    set glossinessFactor(val: number) {
      if (val !== this._glossinessFactor) {
        this._glossinessFactor = val;
        this.uniformChanged();
      }
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        const pb = scope.$builder;
        scope.zSpecularFactor = pb.vec4().uniform(2);
        scope.zGlossinessFactor = pb.float().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('zSpecularFactor', this._specularFactor);
        bindGroup.setValue('zGlossinessFactor', this._glossinessFactor);
      }
    }
    PBRLight(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      albedo: PBShaderExp,
      TBN: PBShaderExp,
      outRoughness?: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_PBRSpecularGlossinessLight';
      const that = this;
      pb.func(
        funcName,
        [
          pb.vec3('worldPos'),
          pb.vec3('normal'),
          pb.mat3('TBN'),
          pb.vec3('viewVec'),
          pb.vec4('albedo'),
          ...(outRoughness ? [pb.vec4('outRoughness').out()] : [])
        ],
        function () {
          this.$l.pbrData = that.getCommonData(this, this.albedo, this.normal, this.viewVec, this.TBN);
          this.$l.lightingColor = pb.vec3(0);
          this.$l.emissiveColor = that.calculateEmissiveColor(this);
          if (outRoughness) {
            that.indirectLighting(
              this,
              this.normal,
              this.viewVec,
              this.pbrData,
              this.lightingColor,
              this.outRoughness
            );
          } else {
            that.indirectLighting(this, this.normal, this.viewVec, this.pbrData, this.lightingColor);
          }
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, shadow) {
            this.$l.diffuse = pb.vec3();
            this.$l.specular = pb.vec3();
            this.$l.lightAtten = that.calculateLightAttenuation(
              this,
              type,
              this.worldPos,
              posRange,
              dirCutoff
            );
            this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
            this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
            if (shadow) {
              this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.worldPos, this.NoL));
            }
            that.directLighting(
              this,
              this.lightDir,
              this.lightColor,
              this.normal,
              this.viewVec,
              this.pbrData,
              this.lightingColor
            );
          });
          this.$return(pb.add(this.lightingColor, this.emissiveColor));
        }
      );
      return outRoughness
        ? pb.getGlobalScope()[funcName](worldPos, normal, TBN, viewVec, albedo, outRoughness)
        : pb.getGlobalScope()[funcName](worldPos, normal, TBN, viewVec, albedo);
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp,
      data: PBShaderExp
    ): void {
      super.calculateCommonData(scope, albedo, normal, viewVec, TBN, data);
      const pb = scope.$builder;
      if (this.specularTexture) {
        scope.$l.specularTextureSample = this.sampleSpecularTexture(scope);
        data.roughness = pb.sub(1, pb.mul(scope.zGlossinessFactor, scope.specularTextureSample.a));
        data.f0 = pb.vec4(
          pb.mul(scope.specularTextureSample.rgb, scope.zSpecularFactor.rgb),
          this.getF0(scope).a
        );
      } else {
        data.roughness = pb.sub(1, scope.zGlossinessFactor);
        data.f0 = pb.vec4(scope.zSpecularFactor.rgb, this.getF0(scope).a);
      }
      data.roughness = pb.mul(data.roughness, ShaderHelper.getCameraRoughnessFactor(scope));
      data.metallic = pb.max(pb.max(data.f0.r, data.f0.g), data.f0.b);
      data.diffuse = pb.vec4(pb.mul(albedo.rgb, pb.sub(1, data.metallic)), albedo.a);
      data.specularWeight = 1;
      data.f90 = pb.vec3(1);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRSpecularGlossiness };
}
