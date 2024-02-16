import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from "@zephyr3d/device";
import { MeshMaterial, applyMaterialMixins } from "../../meshmaterial";
import { TextureMixinInstanceTypes, mixinTextureProps } from "../texture";
import { IMixinPBRCommon, mixinPBRCommon } from "./common";
import { DrawContext } from "../../../render";
import { Vector4 } from "@zephyr3d/base";

export type IMixinPBRMetallicRoughness = {
  metallic: number;
  roughness: number;
  specularFactor: Vector4;
  calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp): PBShaderExp;
} & IMixinPBRCommon & TextureMixinInstanceTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor']>;

export function mixinPBRMetallicRoughness<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrMetallicRoughnessMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
  }
  const S = applyMaterialMixins(
    BaseCls,
    mixinPBRCommon,
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
    constructor(){
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
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)){
        const pb = scope.$builder;
        scope.$g.kkMetallic = pb.float().uniform(2);
        scope.$g.kkRoughness = pb.float().uniform(2);
        scope.$g.kkSpecularFactor = pb.vec4().uniform(2);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)){
        bindGroup.setValue('kkMetallic', this._metallic);
        bindGroup.setValue('kkRoughness', this._roughness);
        bindGroup.setValue('kkSpecularFactor', this._specularFactor);
      }
    }
    calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp, viewVec: PBShaderExp, TBN: PBShaderExp, data: PBShaderExp): void {
      super.calculateCommonData(scope, albedo, viewVec, TBN, data);
      const pb = scope.$builder;
      if (this.metallicRoughnessTexture){
        scope.$l.metallicRoughnessSample = this.sampleMetallicRoughnessTexture(scope);
        data.metallic = pb.mul(scope.kkMetallic, scope.metallicRoughnessSample.z);
        data.roughness = pb.mul(scope.kkRoughness, scope.metallicRoughnessSample.y);
      } else {
        data.metallic = scope.kkMetallic;
        data.roughness = scope.kkRoughness;
      }
      if (this.specularColorTexture){
        scope.$l.specularColor = pb.mul(scope.kkSpecularFactor.rgb, this.sampleSpecularColorTexture(scope).rgb);
      } else {
        scope.$l.specularColor = scope.kkSpecularFactor.rgb;
      }
      if (this.specularTexture){
        data.specularWeight = pb.mul(scope.kkSpecularFactor.a, this.sampleSpecularTexture(scope).a);
      } else {
        data.specularWeight = scope.kkSpecularFactor.a;
      }
      data.f0 = pb.vec4(pb.mix(pb.min(pb.mul(this.getF0(scope).rgb, scope.specularColor), pb.vec3(1)), albedo.rgb, data.metallic), this.getF0(scope).a);
      data.f90 = pb.vec3(1);
      data.diffuse = pb.vec4(pb.mix(albedo.rgb, pb.vec3(0), data.metallic), albedo.a);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
}
