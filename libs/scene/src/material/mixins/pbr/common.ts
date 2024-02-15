import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp, ShaderTypeFunc } from "@zephyr3d/device";
import { IMeshMaterial, applyMaterialMixins } from "../../meshmaterial";
import { Vector3, Vector4 } from "@zephyr3d/base";
import { DrawContext } from "../../../render";
import { getGGXLUT } from "../ggxlut";
import { TextureMixinInstanceTypes, mixinTextureProps } from "../texture";
import { ShaderFramework } from "../../../shaders";

export type IMixinPBRCommon = {
  ior: number;
  emissiveColor: Vector3;
  emissiveStrength: number;
  occlusionStrength: number;
  sheen: boolean;
  sheenColorFactor: Vector3;
  sheenRoughnessFactor: number;
  getCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp): PBShaderExp;
  calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp, data: PBShaderExp): void;
  fresnelSchlick(scope: PBInsideFunctionScope, cosTheta: PBShaderExp, F0: PBShaderExp): PBShaderExp;
  distributionGGX(
    scope: PBInsideFunctionScope,
    NdotH: PBShaderExp,
    alphaRoughness: PBShaderExp
  ): PBShaderExp;
  visGGX(
    scope: PBInsideFunctionScope,
    NdotV: PBShaderExp,
    NdotL: PBShaderExp,
    alphaRoughness: PBShaderExp
  ): PBShaderExp;
  getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc;
  calculateEmissiveColor(scope: PBInsideFunctionScope): PBShaderExp;
  getF0(scope: PBInsideFunctionScope): PBShaderExp;
  directLighting(scope: PBInsideFunctionScope, lightDir: PBShaderExp, lightColor: PBShaderExp, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outColor: PBShaderExp);
  indirectLighting(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outColor: PBShaderExp, ctx: DrawContext);
} & TextureMixinInstanceTypes<['occlusion', 'emissive', 'sheenColor', 'sheenRoughness']>;

const FEATURE_SHEEN = 'FEATURE_SHEEN';

export function mixinPBRCommon<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).pbrCommonMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinPBRCommon };
  }
  const S = applyMaterialMixins(
    BaseCls as { new (...args: any[]): IMeshMaterial },
    mixinTextureProps('occlusion'),
    mixinTextureProps('emissive'),
    mixinTextureProps('sheenColor'),
    mixinTextureProps('sheenRoughness')
  );
  return class extends S {
    static readonly pbrCommonMixed = true;
    private _f0: Vector4;
    private _emissiveFactor: Vector4;
    private _occlusionStrength: number;
    private _sheenFactor: Vector4;
    constructor(){
      super();
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._occlusionStrength = 1;
      this._emissiveFactor = new Vector4(0, 0, 0, 1);
      this._sheenFactor = Vector4.zero();
    }
    get ior(): number {
      return this._f0.w;
    }
    set ior(val: number) {
      if (val !== this._f0.w) {
        let k = (val - 1) / (val + 1);
        k *= k;
        this._f0.setXYZW(k, k, k, val);
        this.optionChanged(false);
      }
    }
    get occlusionStrength(): number {
      return this._occlusionStrength;
    }
    set occlusionStrength(val: number) {
      if (val !== this._occlusionStrength) {
        this._occlusionStrength = val;
        this.optionChanged(false);
      }
    }
    get emissiveColor(): Vector3 {
      return this._emissiveFactor.xyz();
    }
    set emissiveColor(val: Vector3) {
      if (
        val.x !== this._emissiveFactor.x ||
        val.y !== this._emissiveFactor.y ||
        val.z !== this._emissiveFactor.z
      ) {
        this._emissiveFactor.x = val.x;
        this._emissiveFactor.y = val.y;
        this._emissiveFactor.z = val.z;
        this.optionChanged(false);
      }
    }
    get emissiveStrength(): number {
      return this._emissiveFactor.w;
    }
    set emissiveStrength(val: number) {
      if (this._emissiveFactor.w !== val) {
        this._emissiveFactor.w = val;
        this.optionChanged(false);
      }
    }
    get sheen(): boolean {
      return this.featureUsed<boolean>(FEATURE_SHEEN);
    }
    set sheen(val: boolean) {
      this.useFeature(FEATURE_SHEEN, !!val);
    }
    get sheenColorFactor(): Vector3 {
      return this._sheenFactor.xyz();
    }
    set sheenColorFactor(val: Vector3) {
      if (val.x !== this._sheenFactor.x || val.y !== this._sheenFactor.y || val.z !== this._sheenFactor.z) {
        this._sheenFactor.x = val.x;
        this._sheenFactor.y = val.y;
        this._sheenFactor.z = val.z;
        this.optionChanged(false);
      }
    }
    get sheenRoughnessFactor(): number {
      return this._sheenFactor.w;
    }
    set sheenRoughnessFactor(val: number) {
      if (val !== this._sheenFactor.w) {
        this._sheenFactor.w = val;
        this.optionChanged(false);
      }
    }
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      const pb = scope.$builder;
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)){
        scope.$g.kkF0 = pb.vec4().uniform(2);
        scope.$g.kkEmissiveFactor = pb.vec4().uniform(2);
        if (this.occlusionTexture) {
          scope.$g.kkOcclusionStrength = pb.float().uniform(2);
        }
        if (this.sheen){
          scope.$g.kkSheenFactor = pb.vec4().uniform(2);
        }
        if (ctx.drawEnvLight) {
          scope.$g.kkGGXLut = pb.tex2D().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)){
        bindGroup.setValue('kkF0', this._f0);
        bindGroup.setValue('kkEmissiveFactor', this._emissiveFactor);
        if (this.occlusionTexture) {
          bindGroup.setValue('kkOcclusionStrength', this._occlusionStrength);
        }
        if (this.sheen){
          bindGroup.setValue('kkSheenFactor', this._sheenFactor);
        }
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('kkGGXLut', getGGXLUT(1024));
        }
      }
    }
    getF0(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.kkF0;
    }
    getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc {
      const pb = scope.$builder;
      return pb.defineStruct([
        pb.vec4('f0'),
        pb.vec3('f90'),
        pb.vec4('diffuse'),
        pb.float('metallic'),
        pb.float('roughness'),
        pb.float('specularWeight'),
        ...(this.sheen ? [pb.float('sheenAlbedoScaling'), pb.vec3('sheenColor'), pb.float('sheenRoughness')] : [])
      ]);
    }
    getCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkGetCommonData';
      pb.func(funcName, [pb.vec4('albedo')], function(){
        this.$l.data = that.getCommonDatasStruct(this)();
        that.calculateCommonData(this, this.albedo, this.data);
        this.$return(this.data);
      });
      return scope.$g[funcName](albedo);
    }
    calculateCommonData(scope: PBInsideFunctionScope, albedo: PBShaderExp, data: PBShaderExp): void {
      const pb = scope.$builder;
      if (this.sheen) {
        if (this.sheenColorTexture){
          const sheenColorSample = pb.textureSample(this.getSheenColorTextureUniform(scope), this.getSheenColorTexCoord(scope)).rgb;
          data.sheenColor = pb.mul(sheenColorSample, scope.kkSheenFactor.rgb);
        } else {
          data.sheenColor = scope.kkSheenFactor.rgb;
        }
        if (this.sheenRoughnessTexture){
          const sheenRoughnessSample = pb.textureSample(this.getSheenRoughnessTextureUniform(scope), this.getSheenRoughnessTexCoord(scope)).a;
          data.sheenRoughness = pb.mul(sheenRoughnessSample, scope.kkSheenFactor.a);
        } else {
          data.sheenRoughness = scope.kkSheenFactor.a;
        }
        scope.$l.sheenDFG = 0.157;
        data.sheenAlbedoScaling = pb.sub(1, pb.mul(pb.max(pb.max(data.sheenColor.r, data.sheenColor.g), data.sheenColor.b), scope.sheenDFG));
      }
    }
    calculateEmissiveColor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      if (this.emissiveTexture){
        return pb.mul(pb.textureSample(this.getEmissiveTextureUniform(scope), this.getEmissiveTexCoord(scope)).rgb, scope.kkEmissiveFactor.rgb, scope.kkEmissiveFactor.a);
      } else {
        return pb.mul(scope.kkEmissiveFactor.rgb, scope.kkEmissiveFactor.a);
      }
    }
    D_Charlie(
      scope: PBInsideFunctionScope,
      NdotH: PBShaderExp,
      sheenRoughness: PBShaderExp
    ): PBShaderExp {
      const funcNameDCharlie = 'kkDCharlie';
      const pb = scope.$builder;
      pb.func(funcNameDCharlie, [pb.float('NdotH'), pb.float('sheenRoughness')], function () {
        this.$l.alphaG = pb.mul(this.sheenRoughness, this.sheenRoughness);
        this.$l.invR = pb.div(1, this.alphaG);
        this.$l.cos2h = pb.mul(this.NdotH, this.NdotH);
        this.$l.sin2h = pb.max(pb.sub(1, this.cos2h), 0.0078125);
        this.$return(
          pb.div(pb.mul(pb.add(this.invR, 2), pb.pow(this.sin2h, pb.mul(this.invR, 0.5))), 2 * Math.PI)
        );
      });
      return scope.$g[funcNameDCharlie](NdotH, sheenRoughness);
    }
    V_Ashikhmin(
      scope: PBInsideFunctionScope,
      NdotL: PBShaderExp,
      NdotV: PBShaderExp
    ): PBShaderExp {
      const funcNameVAshikhmin = 'kkVAshikhmin';
      const pb = scope.$builder;
      pb.func(funcNameVAshikhmin, [pb.float('NdotL'), pb.float('NdotV')], function () {
        this.$return(
          pb.clamp(
            pb.div(1, pb.mul(pb.sub(pb.add(this.NdotL, this.NdotV), pb.mul(this.NdotL, this.NdotV)), 4)),
            0,
            1
          )
        );
      });
      return scope.$g[funcNameVAshikhmin](NdotL, NdotV);
    }
    directLighting(scope: PBInsideFunctionScope, lightDir: PBShaderExp, lightColor: PBShaderExp, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outColor: PBShaderExp) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkPBRDirectLighting';
      pb.func(funcName, [pb.vec3('L'), pb.vec3('lightColor'), pb.vec3('normal'), pb.vec3('viewVec'), that.getCommonDatasStruct(scope)('data'), pb.vec3('outColor').inout()], function(){
        this.$l.H = pb.normalize(pb.add(this.viewVec, this.L));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.H), 0, 1);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
        this.$l.VoH = pb.clamp(pb.dot(this.viewVec,this.H), 0, 1);
        this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0, 1);
        this.$l.F = that.fresnelSchlick(this, this.VoH, this.data.f0.rgb, this.data.f90);
        this.$l.alphaRoughness = pb.mul(this.data.roughness, this.data.roughness);
        this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
        this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
        this.$l.specular = pb.mul(this.lightColor, this.D, this.V, this.F, this.data.specularWeight);
        if (that.sheen){
          this.specular = pb.mul(this.specular, this.data.sheenAlbedoScaling);
        }
        this.outColor = pb.add(this.outColor, this.specular);
        this.$l.diffuse = pb.mul(this.lightColor, pb.max(pb.mul(pb.sub(pb.vec3(1), pb.mul(this.F, this.data.specularWeight)), pb.div(this.data.diffuse.rgb, Math.PI)), pb.vec3(0)));
        if (that.sheen){
          this.diffuse = pb.mul(this.diffuse, this.data.sheenAlbedoScaling);
        }
        this.outColor = pb.add(this.outColor, this.diffuse);
        if (that.sheen){
          this.$l.sheenD = that.D_Charlie(this, this.NoH, this.data.sheenRoughness);
          this.$l.sheenV = that.V_Ashikhmin(this, this.NoL, this.NoV);
          this.outColor = pb.add(this.outColor, pb.mul(this.lightColor, this.data.sheenColor, this.sheenD, this.sheenV));
        }
      });
      scope.$g[funcName](lightDir, lightColor, normal, viewVec, commonData, outColor);
    }
    indirectLighting(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outColor: PBShaderExp, ctx: DrawContext) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkPBRIndirectLighting';
      pb.func(funcName, [pb.vec3('normal'), pb.vec3('viewVec'), that.getCommonDatasStruct(scope)('data'), pb.vec3('outColor').inout()], function(){
        if (!ctx.drawEnvLight || (!ctx.env.light.envLight.hasRadiance() && !ctx.env.light.envLight.hasIrradiance())) {
          return;
        }
        const envLightStrength = ShaderFramework.getEnvLightStrength(this);
        if (that.occlusionTexture){
          const occlusionSample = pb.textureSample(that.getOcclusionTextureUniform(this), that.getOcclusionTexCoord(this)).r;
          this.$l.occlusion = pb.mul(pb.add(pb.mul(this.kkOcclusionStrength, pb.sub(occlusionSample, 1)), 1), envLightStrength);
        } else {
          this.$l.occlusion = envLightStrength;
        }
        this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0.0001, 1)
        this.$l.ggxLutSample = pb.clamp(pb.textureSampleLevel(this.kkGGXLut, pb.clamp(pb.vec2(this.NoV, this.data.roughness), pb.vec2(0), pb.vec2(1)), 0), pb.vec4(0), pb.vec4(1));
        this.$l.f_ab = this.ggxLutSample.rg;
        this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.data.roughness)), this.data.f0.rgb), this.data.f0.rgb);
        this.$l.k_S = pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
        if (ctx.env.light.envLight.hasRadiance()) {
          this.$l.radiance = ctx.env.light.envLight.getRadiance(this, pb.reflect(pb.neg(this.viewVec), this.normal), this.data.roughness);
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
          this.$l.iblSpecular = pb.mul(this.radiance, this.FssEss, this.data.specularWeight, this.occlusion);
          if (that.sheen){
            this.iblSpecular = pb.mul(this.iblSpecular, this.data.sheenAlbedoScaling);
          }
          this.outColor = pb.add(this.outColor, this.iblSpecular);
        }
        if (ctx.env.light.envLight.hasIrradiance()) {
          this.$l.irradiance = ctx.env.light.envLight.getIrradiance(this, this.normal);
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x, this.data.specularWeight), pb.vec3(this.f_ab.y));
          this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
          this.$l.F_avg = pb.mul(pb.add(this.data.f0.rgb, pb.div(pb.sub(pb.vec3(1), this.data.f0.rgb), 21)), this.data.specularWeight);
          this.$l.FmsEms = pb.div(
            pb.mul(this.FssEss, this.F_avg, this.Ems),
            pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems))
          );
          this.$l.k_D = pb.mul(this.data.diffuse.rgb, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
          this.$l.iblDiffuse = pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance, this.occlusion);
          if (that.sheen){
            this.iblDiffuse = pb.mul(this.iblDiffuse, this.data.sheenAlbedoScaling);
          }
          this.outColor = pb.add(this.outColor, this.iblDiffuse);
        }
        if (that.sheen && ctx.env.light.envLight.hasIrradiance()) {
          this.$l.refl = pb.reflect(pb.neg(this.viewVec), this.normal);
          this.$l.sheenBRDF = pb.clamp(pb.textureSampleLevel(this.kkGGXLut, pb.clamp(pb.vec2(this.NoV, this.data.sheenRoughness), pb.vec2(0), pb.vec2(1)), 0), pb.vec4(0), pb.vec4(1)).b;
          this.outColor = pb.add(this.outColor, pb.mul(this.data.sheenColor, this.iblDiffuse, this.sheenBRDF));
        }
      });
      scope.$g[funcName](normal, viewVec, commonData, outColor);
    }
    fresnelSchlick(scope: PBInsideFunctionScope, cosTheta: PBShaderExp, F0: PBShaderExp, F90: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkFresnelSchlick';
      pb.func(funcName, [pb.float('cosTheta'), pb.vec3('f0'), pb.vec3('f90')], function(){
        this.$return(pb.add(this.f0, pb.mul(pb.sub(this.f90, this.f0), pb.pow(pb.clamp(pb.sub(1, this.cosTheta), 0, 1), 5))));
      });
      return scope.$g[funcName](cosTheta, F0, F90);
    }
    distributionGGX(
      scope: PBInsideFunctionScope,
      NdotH: PBShaderExp,
      alphaRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkDistributionGGX';
      pb.func(funcName, [pb.float('NdotH'), pb.float('roughness')], function () {
        this.$l.a2 = pb.mul(this.roughness, this.roughness);
        this.$l.NdotH2 = pb.mul(this.NdotH, this.NdotH);
        this.$l.num = this.a2;
        this.$l.denom = pb.add(pb.mul(this.NdotH2, pb.sub(this.a2, 1)), 1);
        this.denom = pb.mul(pb.mul(3.14159265, this.denom), this.denom);
        this.$return(pb.div(this.num, this.denom));
      });
      return scope.$g[funcName](NdotH, alphaRoughness);
    }
    visGGX(
      scope: PBInsideFunctionScope,
      NdotV: PBShaderExp,
      NdotL: PBShaderExp,
      alphaRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkVisGGX';
      pb.func(funcName, [pb.float('NdotV'), pb.float('NdotL'), pb.float('roughness')], function () {
        this.$l.a2 = pb.mul(this.roughness, this.roughness);
        this.$l.ggxV = pb.mul(
          this.NdotL,
          pb.sqrt(pb.add(pb.mul(this.NdotV, this.NdotV, pb.sub(1, this.a2)), this.a2))
        );
        this.$l.ggxL = pb.mul(
          this.NdotV,
          pb.sqrt(pb.add(pb.mul(this.NdotL, this.NdotL, pb.sub(1, this.a2)), this.a2))
        );
        this.$l.ggx = pb.add(this.ggxV, this.ggxL);
        this.$if(pb.greaterThan(this.ggx, 0), function () {
          this.$return(pb.div(0.5, this.ggx));
        }).$else(function () {
          this.$return(pb.float(0));
        });
      });
      return scope.$g[funcName](NdotV, NdotL, alphaRoughness);
    }
  } as unknown as { new (...args: any[]): T & IMixinPBRCommon };
}
