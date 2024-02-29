import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import type { IMixinPBRCommon } from '../pbr/common';
import { mixinPBRCommon } from '../pbr/common';
import type { DrawContext } from '../../../render';
import { Vector4 } from '@zephyr3d/base';
import { IMixinLight, mixinLight } from '../lit';

export type IMixinPBRMetallicRoughness = {
  metallic: number;
  roughness: number;
  specularFactor: Vector4;
  PBRLight(scope: PBInsideFunctionScope, normal: PBShaderExp, TBN: PBShaderExp, viewVec: PBShaderExp, albedo: PBShaderExp): PBShaderExp;
  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ): void;
} & IMixinPBRCommon & IMixinLight &
  TextureMixinInstanceTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor']>;

export function mixinPBRMetallicRoughness<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrMetallicRoughnessMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
  }
  const S = applyMaterialMixins(
    BaseCls,
    mixinPBRCommon,
    mixinLight,
    mixinTextureProps('metallicRoughness'),
    mixinTextureProps('occlusion'),
    mixinTextureProps('specular'),
    mixinTextureProps('specularColor')
  );
  return class extends S {
    static readonly pbrMetallicRoughnessMixed = true;
    private _metallic: number;
    private _roughness: number;
    private _specularFactor: Vector4;
    constructor() {
      super();
      this._metallic = 1;
      this._roughness = 1;
      this._specularFactor = Vector4.one();
    }
    get metallic(): number {
      return this._metallic;
    }
    set metallic(val: number) {
      if (val !== this._metallic) {
        this._metallic = val;
        this.optionChanged(false);
      }
    }
    get roughness(): number {
      return this._roughness;
    }
    set roughness(val: number) {
      if (val !== this._roughness) {
        this._roughness = val;
        this.optionChanged(false);
      }
    }
    get specularFactor(): Vector4 {
      return this._specularFactor;
    }
    set specularFactor(val: Vector4) {
      if (!val.equalsTo(this._specularFactor)) {
        this._specularFactor.set(val);
        this.optionChanged(true);
      }
    }
    PBRLight(scope: PBInsideFunctionScope, normal: PBShaderExp, TBN: PBShaderExp, viewVec: PBShaderExp, albedo: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_PBRLight';
      const that = this;
      pb.func(funcName, [pb.vec3('normal'), pb.mat3('TBN'), pb.vec3('viewVec'), pb.vec4('albedo')], function(){
        this.$l.pbrData = that.getCommonData(this, this.albedo, this.viewVec, this.TBN);
        this.$l.lightingColor = pb.vec3(0);
        this.$l.emissiveColor = that.calculateEmissiveColor(this);
        that.indirectLighting(this, this.normal, this.viewVec, this.pbrData, this.lightingColor);
        that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, shadow) {
          this.$l.diffuse = pb.vec3();
          this.$l.specular = pb.vec3();
          this.$l.lightAtten = that.calculateLightAttenuation(this, type, posRange, dirCutoff);
          this.$l.lightDir = that.calculateLightDirection(this, type, posRange, dirCutoff);
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
          if (shadow) {
            this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.NoL));
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
      });
      return pb.getGlobalScope()[funcName](normal, TBN, viewVec, albedo);
    }
    fragmentShader(scope: PBFunctionScope): void {
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        const pb = scope.$builder;
        scope.zMetallic = pb.float().uniform(2);
        scope.zRoughness = pb.float().uniform(2);
        scope.zSpecularFactor = pb.vec4().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('zMetallic', this._metallic);
        bindGroup.setValue('zRoughness', this._roughness);
        bindGroup.setValue('zSpecularFactor', this._specularFactor);
      }
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp,
      data: PBShaderExp
    ): void {
      super.calculateCommonData(scope, albedo, viewVec, TBN, data);
      const pb = scope.$builder;
      if (this.metallicRoughnessTexture) {
        scope.$l.metallicRoughnessSample = this.sampleMetallicRoughnessTexture(scope);
        data.metallic = pb.mul(scope.zMetallic, scope.metallicRoughnessSample.z);
        data.roughness = pb.mul(scope.zRoughness, scope.metallicRoughnessSample.y);
      } else {
        data.metallic = scope.zMetallic;
        data.roughness = scope.zRoughness;
      }
      if (this.specularColorTexture) {
        scope.$l.specularColor = pb.mul(
          scope.zSpecularFactor.rgb,
          this.sampleSpecularColorTexture(scope).rgb
        );
      } else {
        scope.$l.specularColor = scope.zSpecularFactor.rgb;
      }
      if (this.specularTexture) {
        data.specularWeight = pb.mul(scope.zSpecularFactor.a, this.sampleSpecularTexture(scope).a);
      } else {
        data.specularWeight = scope.zSpecularFactor.a;
      }
      data.f0 = pb.vec4(
        pb.mix(
          pb.min(pb.mul(this.getF0(scope).rgb, scope.specularColor), pb.vec3(1)),
          albedo.rgb,
          data.metallic
        ),
        this.getF0(scope).a
      );
      data.f90 = pb.vec3(1);
      data.diffuse = pb.vec4(pb.mix(albedo.rgb, pb.vec3(0), data.metallic), albedo.a);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
}