import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from "@zephyr3d/device";
import { IMeshMaterial, applyMaterialMixins } from "../../meshmaterial";
import { TextureMixinTypes, mixinTextureProps } from "../texture";
import { IMixinPBRCommon, mixinPBRCommon } from "./common";
import { DrawContext } from "../../../render";
import { Vector4 } from "@zephyr3d/base";

export interface IMixinPBRMetallicRoughness {
  metallic: number;
  roughness: number;
  specularFactor: Vector4;
  calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp): PBShaderExp;
}

export function mixinPBRMetallicRoughness<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).pbrMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinPBRMetallicRoughness & IMixinPBRCommon } & TextureMixinTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor']>;
  }
  const S = applyMaterialMixins(
    BaseCls as { new (...args: any[]): IMeshMaterial },
    mixinPBRCommon,
    mixinTextureProps('metallicRoughness'),
    mixinTextureProps('occlusion'),
    mixinTextureProps('specular'),
    mixinTextureProps('specularColor')
  );
  return class extends S {
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
    calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkGetCommonData';
      pb.func(funcName, [pb.vec4('albedo')], function(){
        this.$l.data = that.getCommonDatasStruct(this)();
        if (that.metallicRoughnessTexture){
          this.$l.metallicRoughnessSample = pb.textureSample(that.getMetallicRoughnessTextureUniform(this), that.getMetallicRoughnessTexCoord(this));
          this.data.metallic = pb.mul(scope.kkMetallic, this.metallicRoughnessSample.z);
          this.data.roughness = pb.mul(scope.kkRoughness, this.metallicRoughnessSample.y);
        } else {
          this.data.metallic = scope.kkMetallic;
          this.data.roughness = scope.kkRoughness;
        }
        if (that.specularColorTexture){
          this.$l.specularColor = pb.mul(this.kkSpecularFactor.rgb, pb.textureSample(that.getSpecularColorTextureUniform(this), that.getSpecularColorTexCoord(this))).rgb;
        } else {
          this.$l.specularColor = this.kkSpecularFactor.rgb;
        }
        if (that.specularTexture){
          this.data.specularWeight = pb.mul(this.kkSpecularFactor.a, pb.textureSample(that.getSpecularTextureUniform(this), that.getSpecularTexCoord(this))).a;
        } else {
          this.data.specularWeight = this.kkSpecularFactor.a;
        }
        this.data.f0 = pb.vec4(pb.mix(pb.min(pb.mul(that.getF0(this).rgb, this.specularColor), pb.vec3(1)), this.albedo.rgb, this.data.metallic), that.getF0(this).a);
        this.data.f90 = pb.vec3(1);
        this.data.diffuse = pb.vec4(pb.mix(this.albedo.rgb, pb.vec3(0), this.data.metallic), this.albedo.a);
        this.$return(this.data);
      });
      return scope.$g[funcName](albedo);
    }
  } as unknown as {
    new (...args: any[]): T & IMixinPBRMetallicRoughness & IMixinPBRCommon;
  } & { new (...args: any[]): T & IMixinPBRMetallicRoughness & IMixinPBRCommon } & TextureMixinTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor']>;
}



