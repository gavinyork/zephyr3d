import { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp, ShaderTypeFunc } from "@zephyr3d/device";
import { IMeshMaterial } from "../../meshmaterial";
import { Vector4 } from "@zephyr3d/base";
import { DrawContext } from "../../../render";
import { getGGXLUT } from "../ggxlut";

export interface IMixinPBRCommon {
  ior: number;
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
  getF0(scope: PBInsideFunctionScope): PBShaderExp;
  directLighting(scope: PBInsideFunctionScope, lightDir: PBShaderExp, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outDiffuse: PBShaderExp, outSpecular: PBShaderExp);
  indirectLighting(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outDiffuse: PBShaderExp, outSpecular: PBShaderExp, ctx: DrawContext);
}

export function mixinPBRCommon<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).pbrCommonMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinPBRCommon };
  }
  return class extends (BaseCls as { new (...args: any[]): IMeshMaterial }) {
    static readonly pbrCommonMixed = true;
    private _f0: Vector4;
    private _commonDataStruct: ShaderTypeFunc;
    constructor(){
      super();
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._commonDataStruct = null;
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
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      const pb = scope.$builder;
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)){
        scope.$g.kkF0 = pb.vec4().uniform(2);
        if (ctx.drawEnvLight) {
          scope.$g.kkGGXLut = pb.tex2D().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)){
        bindGroup.setValue('kkF0', this._f0);
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('kkGGXLut', getGGXLUT(1024));
        }
      }
    }
    getF0(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.kkF0;
    }
    getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc {
      if (!this._commonDataStruct) {
        const pb = scope.$builder;
        this._commonDataStruct = pb.defineStruct([
          pb.vec4('f0'),
          pb.vec3('f90'),
          pb.vec4('diffuse'),
          pb.float('metallic'),
          pb.float('roughness'),
          pb.float('specularWeight')
        ]);
      }
      return this._commonDataStruct;
    }
    directLighting(scope: PBInsideFunctionScope, lightDir: PBShaderExp, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outDiffuse: PBShaderExp, outSpecular: PBShaderExp) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkPBRDirectLighting';
      pb.func(funcName, [pb.vec3('L'), pb.vec3('normal'), pb.vec3('viewVec'), that.getCommonDatasStruct(scope)('data'), pb.vec3('outDiffuse').out(), pb.vec3('outSpecular').out()], function(){
        this.$l.H = pb.normalize(pb.add(this.viewVec, this.L));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.H), 0, 1);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
        this.$l.VoH = pb.clamp(pb.dot(this.viewVec,this.H), 0, 1);
        this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0, 1);
        this.$l.F = that.fresnelSchlick(this, this.VoH, this.data.f0.rgb, this.data.f90);
        this.$l.alphaRoughness = pb.mul(this.data.roughness, this.data.roughness);
        this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
        this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
        this.outSpecular = pb.mul(this.D, this.V, this.F, this.data.specularWeight);
        this.outDiffuse = pb.max(pb.mul(pb.sub(pb.vec3(1), pb.mul(this.F, this.data.specularWeight)), pb.div(this.data.diffuse.rgb, Math.PI)), pb.vec3(0));
      });
      scope.$g[funcName](lightDir, normal, viewVec, commonData, outDiffuse, outSpecular);
    }
    indirectLighting(scope: PBInsideFunctionScope, normal: PBShaderExp, viewVec: PBShaderExp, commonData: PBShaderExp, outDiffuse: PBShaderExp, outSpecular: PBShaderExp, ctx: DrawContext) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'kkPBRIndirectLighting';
      pb.func(funcName, [pb.vec3('normal'), pb.vec3('viewVec'), that.getCommonDatasStruct(scope)('data'), pb.vec3('outDiffuse').out(), pb.vec3('outSpecular').out()], function(){
        if (!ctx.drawEnvLight || (!ctx.env.light.envLight.hasRadiance() && !ctx.env.light.envLight.hasIrradiance())) {
          this.outDiffuse = pb.vec3(0);
          this.outSpecular = pb.vec3(0);
          return;
        }
        this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0.0001, 1)
        this.$l.ggxLutSample = pb.clamp(pb.textureSampleLevel(this.kkGGXLut, pb.vec2(this.NoV, this.data.roughness), 0), pb.vec4(0), pb.vec4(1));
        this.$l.f_ab = this.ggxLutSample.rg;
        this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.data.roughness)), this.data.f0.rgb), this.data.f0.rgb);
        this.$l.k_S = pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
        if (ctx.env.light.envLight.hasRadiance()) {
          this.$l.radiance = ctx.env.light.envLight.getRadiance(this, pb.reflect(pb.neg(this.viewVec), this.normal), this.data.roughness);
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
          this.outSpecular = pb.mul(this.radiance, this.FssEss, this.data.specularWeight);
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
          this.outDiffuse = pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance);
        }
      });
      scope.$g[funcName](normal, viewVec, commonData, outDiffuse, outSpecular);
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
  } as unknown as {
    new (...args: any[]): T & IMixinPBRCommon;
  }
}
