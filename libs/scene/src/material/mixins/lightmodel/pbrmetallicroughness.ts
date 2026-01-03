import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import type { IMixinPBRCommon } from '../pbr/common';
import { mixinPBRCommon } from '../pbr/common';
import type { DrawContext } from '../../../render';
import type { Immutable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import { ShaderHelper } from '../../shader/helper';
import { MaterialVaryingFlags } from '../../../values';

/**
 * Interface for PBRMetallicRoughness lighting model mixin
 * @public
 */
export type IMixinPBRMetallicRoughness = {
  metallic: number;
  roughness: number;
  specularFactor: Vector4;
  PBRLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    TBN: PBShaderExp,
    outRoughness?: PBShaderExp
  ): PBShaderExp;
  calculateMetallic(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp): PBShaderExp;
  calculateRoughness(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp): PBShaderExp;
  calculateSpecularFactor(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp);
  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ): void;
} & IMixinPBRCommon &
  IMixinLight &
  TextureMixinInstanceTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor']>;

/**
 * PBRMetallicRoughness lighting model mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 * @public
 */
export function mixinPBRMetallicRoughness<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrMetallicRoughnessMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
  }
  const S = applyMaterialMixins(
    BaseCls,
    mixinPBRCommon,
    mixinLight,
    mixinTextureProps('metallicRoughness'),
    mixinTextureProps('specular'),
    mixinTextureProps('specularColor')
  );
  const METALLIC_UNIFORM = S.defineInstanceUniform('metallic', 'float', 'Metallic');
  const ROUGHNESS_UNIFORM = S.defineInstanceUniform('roughness', 'float', 'Roughness');
  const SPECULAR_FACTOR_UNFORM = S.defineInstanceUniform('specularFactor', 'rgba', 'SpecularFactor');

  return class extends S {
    static readonly pbrMetallicRoughnessMixed = true;
    private _metallic: number;
    private _roughness: number;
    private readonly _specularFactor: Vector4;
    constructor() {
      super();
      this._metallic = 1;
      this._roughness = 1;
      this._specularFactor = Vector4.one();
    }
    copyFrom(other: this) {
      super.copyFrom(other);
      this.metallic = other.metallic;
      this.roughness = other.roughness;
      this.specularFactor = other.specularFactor;
    }
    get metallic() {
      return this._metallic;
    }
    set metallic(val) {
      if (val !== this._metallic) {
        this._metallic = val;
        this.uniformChanged();
      }
    }
    get roughness() {
      return this._roughness;
    }
    set roughness(val) {
      if (val !== this._roughness) {
        this._roughness = val;
        this.uniformChanged();
      }
    }
    get specularFactor(): Immutable<Vector4> {
      return this._specularFactor;
    }
    set specularFactor(val: Immutable<Vector4>) {
      if (!val.equalsTo(this._specularFactor)) {
        this._specularFactor.set(val);
        this.uniformChanged();
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
    ) {
      const pb = scope.$builder;
      const funcName = 'Z_PBRMetallicRoughnessLight';
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
      return (
        outRoughness
          ? pb.getGlobalScope()[funcName](worldPos, normal, TBN, viewVec, albedo, outRoughness)
          : pb.getGlobalScope()[funcName](worldPos, normal, TBN, viewVec, albedo)
      ) as PBShaderExp;
    }
    vertexShader(scope: PBFunctionScope) {
      super.vertexShader(scope);
      if (this.needFragmentColor() && this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING) {
        scope.$outputs.zMetallic = this.getInstancedUniform(scope, METALLIC_UNIFORM);
        scope.$outputs.zRoughness = this.getInstancedUniform(scope, ROUGHNESS_UNIFORM);
        scope.$outputs.zSpecularFactor = this.getInstancedUniform(scope, SPECULAR_FACTOR_UNFORM);
      }
    }
    fragmentShader(scope: PBFunctionScope) {
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        const pb = scope.$builder;
        if (!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING)) {
          scope.zMetallic = pb.float().uniform(2);
          scope.zRoughness = pb.float().uniform(2);
          scope.zSpecularFactor = pb.vec4().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        if (!(ctx.materialFlags & MaterialVaryingFlags.INSTANCING)) {
          bindGroup.setValue('zMetallic', this._metallic);
          bindGroup.setValue('zRoughness', this._roughness);
          bindGroup.setValue('zSpecularFactor', this._specularFactor);
        }
      }
    }
    calculateMetallic(scope: PBInsideFunctionScope, _albedo: PBShaderExp, _normal: PBShaderExp) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zMetallic : scope.zMetallic) as PBShaderExp;
    }
    calculateRoughness(scope: PBInsideFunctionScope, _albedo: PBShaderExp, _normal: PBShaderExp) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zRoughness : scope.zRoughness) as PBShaderExp;
    }
    calculateSpecularFactor(scope: PBInsideFunctionScope, _albedo: PBShaderExp, _normal: PBShaderExp) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zSpecularFactor : scope.zSpecularFactor) as PBShaderExp;
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp,
      data: PBShaderExp
    ) {
      const pb = scope.$builder;
      const metallic = this.calculateMetallic(scope, albedo, normal);
      const roughness = this.calculateRoughness(scope, albedo, normal);
      const specularFactor = this.calculateSpecularFactor(scope, albedo, normal);
      if (this.metallicRoughnessTexture) {
        scope.$l.metallicRoughnessSample = this.sampleMetallicRoughnessTexture(scope);
        data.metallic = pb.mul(metallic, scope.metallicRoughnessSample.z);
        data.roughness = pb.mul(roughness, scope.metallicRoughnessSample.y);
      } else {
        data.metallic = metallic;
        data.roughness = roughness;
      }
      data.roughness = pb.mul(data.roughness, ShaderHelper.getCameraRoughnessFactor(scope));
      if (this.specularColorTexture) {
        scope.$l.specularColor = pb.mul(specularFactor.rgb, this.sampleSpecularColorTexture(scope).rgb);
      } else {
        scope.$l.specularColor = specularFactor.rgb;
      }
      if (this.specularTexture) {
        data.specularWeight = pb.mul(specularFactor.a, this.sampleSpecularTexture(scope).a);
      } else {
        data.specularWeight = specularFactor.a;
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
      super.calculateCommonData(scope, albedo, normal, viewVec, TBN, data);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
}
