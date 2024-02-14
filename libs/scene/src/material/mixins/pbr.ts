import { Vector4 } from '@zephyr3d/base';
import { applyMaterialMixins, type IMeshMaterial } from '../meshmaterial';
import type { TextureMixinTypes } from './texture';
import { mixinTextureProps } from './texture';
import { ShaderFramework } from '../../shaders';
import type { Vector3 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import type { DrawContext } from '../../render';
import { getGGXLUT } from './ggxlut';

export interface IMixinPBR {
  ior: number;
  occlusionStrength: number;
  clearcoat: boolean;
  clearcoatIntensity: number;
  clearcoatRoughnessFactor: number;
  clearcoatNormalScale: number;
  sheen: boolean;
  sheenColorFactor: Vector3;
  sheenRoughnessFactor: number;
  sheenLut: Texture2D;
  getF0(scope: PBInsideFunctionScope): PBShaderExp;
  getF90(scope: PBInsideFunctionScope): PBShaderExp;
  calculateSheenColor(scope: PBInsideFunctionScope): PBShaderExp;
  calculateSheenRoughness(scope: PBInsideFunctionScope): PBShaderExp;
  calculateSheenDFG(
    scope: PBInsideFunctionScope,
    NoV: PBShaderExp,
    sheenRoughness: PBShaderExp
  ): PBShaderExp;
  calculateSheenAlbedoScaling(
    scope: PBInsideFunctionScope,
    sheenColor: PBShaderExp,
    sheenDFG: PBShaderExp
  ): PBShaderExp;
  calculateOcclusion(scope: PBInsideFunctionScope): PBShaderExp;
  calculateClearcoatFactor(scope: PBInsideFunctionScope): PBShaderExp;
  calculateClearcoatNormalAndNoV(
    scope: PBInsideFunctionScope,
    TBN: PBShaderExp,
    viewVec: PBShaderExp
  ): PBShaderExp;
  sampleGGXLut(scope: PBInsideFunctionScope, NoV: PBShaderExp, roughness: PBShaderExp): PBShaderExp;
  calculateSpecularIBL(
    scope: PBInsideFunctionScope,
    brdf: PBShaderExp,
    f0: PBShaderExp,
    radiance: PBShaderExp,
    NoV: PBShaderExp,
    roughness: PBShaderExp,
    specularWeight: PBShaderExp
  ): PBShaderExp;
  calculateDiffuseIBL(
    scope: PBInsideFunctionScope,
    brdf: PBShaderExp,
    f0: PBShaderExp,
    diffuse: PBShaderExp,
    irradiance: PBShaderExp,
    NoV: PBShaderExp,
    roughness: PBShaderExp,
    specularWeight: PBShaderExp
  ): PBShaderExp;
}

export type PBRTextureNames = [
  'occlusion',
  'cheenColor',
  'sheenRoughness',
  'clearcoatIntensity',
  'clearcoatNormal',
  'clearcoatRoughness'
];

function mixinPBR<T extends IMeshMaterial>(BaseCls: { new (...args: any[]): T }) {
  if ((BaseCls as any).pbrMixed) {
    return BaseCls as { new (...args: any[]): T & IMixinPBR } & TextureMixinTypes<PBRTextureNames>;
  }
  const S = applyMaterialMixins(
    BaseCls as { new (...args: any[]): IMeshMaterial },
    mixinTextureProps('occlusion'),
    mixinTextureProps('sheenColor'),
    mixinTextureProps('sheenRoughness'),
    mixinTextureProps('clearcoatIntensity'),
    mixinTextureProps('clearcoatNormal'),
    mixinTextureProps('clearcoatRoughness')
  );
  const FEATURE_PBR_CLEARCOAT = 'FEATURE_PBR_CLEARCOAT';
  const FEATURE_PBR_SHEEN = 'FEATURE_PBR_SHEEN';
  const FEATURE_PBR_SHEEN_USE_LUT = 'FEATURE_PBR_SHEEN_USE_LUT';
  return class extends S {
    static pbrMixed = true;
    private _f0: Vector4;
    private _occlusionStrength: number;
    private _sheenFactor: Vector4;
    private _sheenLut: Texture2D;
    private _clearcoatFactor: Vector4;
    constructor(...args: any[]) {
      super(...args);
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._sheenFactor = Vector4.zero();
      this._sheenLut = null;
      this._clearcoatFactor = new Vector4(0, 0, 1, 0);
      this._occlusionStrength = 1;
    }
    /** ior value */
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
    /** occlusion strength */
    get occlusionStrength(): number {
      return this._occlusionStrength;
    }
    set occlusionStrength(val: number) {
      if (this._occlusionStrength !== val) {
        this._occlusionStrength = val;
        this.optionChanged(false);
      }
    }
    get clearcoat(): boolean {
      return this.featureUsed(FEATURE_PBR_CLEARCOAT);
    }
    set clearcoat(val: boolean) {
      this.useFeature(FEATURE_PBR_CLEARCOAT, !!val);
    }
    /** Intensity of clearcoat lighting */
    get clearcoatIntensity(): number {
      return this._clearcoatFactor.x;
    }
    set clearcoatIntensity(val: number) {
      if (val !== this._clearcoatFactor.x) {
        this._clearcoatFactor.x = val;
        this.optionChanged(false);
      }
    }
    /** Roughness factor of clearcoat lighting */
    get clearcoatRoughnessFactor(): number {
      return this._clearcoatFactor.y;
    }
    set clearcoatRoughnessFactor(val: number) {
      if (val !== this._clearcoatFactor.y) {
        this._clearcoatFactor.y = val;
        this.optionChanged(false);
      }
    }
    /** Normal scale of clearcoat lighting */
    get clearcoatNormalScale(): number {
      return this._clearcoatFactor.z;
    }
    set clearcoatNormalScale(val: number) {
      if (val !== this._clearcoatFactor.z) {
        this._clearcoatFactor.z = val;
        this.optionChanged(false);
      }
    }
    /** true if sheen lighting is being used */
    get sheen(): boolean {
      return this.featureUsed(FEATURE_PBR_SHEEN);
    }
    set sheen(val: boolean) {
      this.useFeature(FEATURE_PBR_SHEEN, !!val);
    }
    /** Color factor for sheen lighting */
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
    /** Roughness factor for sheen lighting */
    get sheenRoughnessFactor(): number {
      return this._sheenFactor.w;
    }
    set sheenRoughnessFactor(val: number) {
      if (val !== this._sheenFactor.w) {
        this._sheenFactor.w = val;
        this.optionChanged(false);
      }
    }
    /** Lut texture for sheen lighting */
    get sheenLut(): Texture2D {
      return this._sheenLut;
    }
    set sheenLut(tex: Texture2D) {
      if (this._sheenLut !== tex) {
        this._sheenLut = tex;
        if (this.sheen) {
          this.useFeature(FEATURE_PBR_SHEEN_USE_LUT, !!this._sheenLut);
          this.optionChanged(false);
        }
      }
    }
    fragmentShader(scope: PBFunctionScope, ctx: DrawContext): void {
      super.fragmentShader(scope, ctx);
      if (this.needFragmentColor(ctx)) {
        const pb = scope.$builder;
        if (ctx.drawEnvLight) {
          scope.$g.kkGGXLut = pb.tex2D().uniform(2);
        }
        scope.$g.kkF0 = scope.$builder.vec4().uniform(2);
        if (this.occlusionTexture) {
          scope.$g.kkOcclusionStrength = pb.float().uniform(2);
        }
        if (this.sheen) {
          scope.$g.kkSheenFactor = pb.vec4().uniform(2);
          if (this._sheenLut) {
            scope.$g.kkSheenLut = pb.tex2D().uniform(2);
          }
        }
        if (this.clearcoat) {
          scope.$g.kkClearcoatFactor = pb.vec4().uniform(2);
        }
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext): void {
      super.applyUniformValues(bindGroup, ctx);
      if (this.needFragmentColor(ctx)) {
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('kkGGXLut', getGGXLUT(1024));
        }
        bindGroup.setValue('kkF0', this._f0);
        if (this.occlusionTexture) {
          bindGroup.setValue(
            'kkOcclusionStrength',
            this._occlusionStrength < 0 ? 0 : this._occlusionStrength > 1 ? 1 : this._occlusionStrength
          );
        }
        if (this.sheen) {
          bindGroup.setValue('kkSheenFactor', this._sheenFactor);
          if (this._sheenLut) {
            bindGroup.setTexture('kkSheenLut', this._sheenLut);
          }
        }
        if (this.clearcoat) {
          bindGroup.setValue('kkClearcoatFactor', this._clearcoatFactor);
        }
      }
    }
    getF0(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.kkF0;
    }
    getF90(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.$builder.vec3(1);
    }
    calculateSheenColor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$buidler;
      if (!this.sheen) {
        console.warn('mixinPBR.calculateSheenColor() sheen not enabled');
        return pb.vec3(0);
      }
      let sheenColor = scope.kkSheenFactor.rgb;
      if (this.sheenColorTexture) {
        sheenColor = pb.mul(
          sheenColor,
          pb.textureSample(this.getSheenColorTextureUniform(scope), this.getSheenColorTexCoord(scope)).rgb
        );
      }
      return sheenColor;
    }
    calculateSheenRoughness(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      if (!this.sheen) {
        console.warn('mixinPBR.calculateSheenRoughness() sheen not enabled');
        return pb.float(0);
      }
      let sheenRoughness = scope.kkSheenFactor.a;
      if (this.sheenRoughnessTexture) {
        sheenRoughness = pb.mul(
          sheenRoughness,
          pb.textureSample(this.getSheenRoughnessTextureUniform(scope), this.getSheenRoughnessTexCoord(scope))
            .a
        );
      }
      return sheenRoughness;
    }
    calculateSheenDFG(
      scope: PBInsideFunctionScope,
      NoV: PBShaderExp,
      sheenRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      if (!this.sheen) {
        console.warn('mixinPBR.calculateSheenDFG() sheen not enabled');
        return pb.float(0);
      }
      if (this.sheenLut) {
        return pb.textureSample(scope.kkSheenLut, pb.vec2(NoV, sheenRoughness)).b;
      } else {
        return pb.float(0.157);
      }
    }
    calculateSheenAlbedoScaling(
      scope: PBInsideFunctionScope,
      sheenColor: PBShaderExp,
      sheenDFG: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      if (!this.sheen) {
        console.warn('mixinPBR.calculateSheenAlbedoScaling() sheen not enabled');
        return pb.float(1);
      }
      const funcName = 'mixinPBR_calcSheenAlbedoScaling';
      pb.func(funcName, [pb.vec3('sheenColor'), pb.float('sheenDFG')], function () {
        return pb.sub(
          1,
          pb.mul(pb.max(pb.max(this.sheenColor.r, this.sheenColor.g), this.sheenColor.b), this.sheenDFG)
        );
      });
      return scope.$g[funcName](sheenColor, sheenDFG);
    }
    calculateOcclusion(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      const envStrength = ShaderFramework.getEnvLightStrength(scope);
      if (this.occlusionTexture) {
        const strength = scope.kkOcclusionStrength;
        const texCoord = this.getOcclusionTexCoord(scope);
        const texture = this.getOcclusionTextureUniform(scope);
        return pb.mul(pb.mix(pb.sub(1, strength), 1, pb.textureSample(texture, texCoord).r), envStrength);
      } else {
        return envStrength;
      }
    }
    calculateClearcoatFactor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      if (!this.clearcoat) {
        console.warn('mixinPBR.calculateClearcoatFactor(): clearcoat not enalbed');
        return pb.vec4(0);
      }
      const clearcoatIntensityFactor = this.clearcoatIntensityTexture
        ? pb.textureSample(
            this.getClearcoatIntensityTextureUniform(scope),
            this.getClearcoatIntensityTexCoord(scope)
          ).r
        : pb.float(1);
      const clearcoatRoughnessFactor = this.clearcoatRoughnessTexture
        ? pb.textureSample(
            this.getClearcoatRoughnessTextureUniform(scope),
            this.getClearcoatRoughnessTexCoord(scope)
          ).g
        : pb.float(1);
      return pb.vec4(
        pb.mul(scope.kkClearcoatFactor.x, clearcoatIntensityFactor),
        pb.clamp(pb.mul(scope.kkClearcoatFactor.y, clearcoatRoughnessFactor), 0, 1),
        scope.kkClearcoatFactor.z,
        1
      );
    }
    calculateClearcoatNormalAndNoV(
      scope: PBInsideFunctionScope,
      TBN: PBShaderExp,
      viewVec: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      if (!this.clearcoat) {
        console.warn('mixinPBR.calculateClearcoatFactor(): clearcoat not enalbed');
        return pb.vec4(0);
      }
      if (this.clearcoatNormalTexture) {
        const normalSample = pb.sub(
          pb.mul(
            pb.textureSample(
              this.getClearcoatNormalTextureUniform(scope),
              this.getClearcoatNormalTexCoord(scope)
            ).rgb,
            2
          ),
          pb.vec3(1)
        );
        const factor = pb.vec3(scope.kkClearcoatFactor.zz, 1);
        const normal = pb.normalize(pb.mul(TBN, pb.mul(normalSample, factor)));
        const NoV = pb.clamp(pb.dot(normal, viewVec), 0.0001, 1);
        return pb.vec4(normal, NoV);
      } else {
        const normal = TBN[2];
        const NoV = pb.clamp(pb.dot(normal, viewVec), 0.0001, 1);
        return pb.vec4(normal, NoV);
      }
    }
    sampleGGXLut(scope: PBInsideFunctionScope, NoV: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      return pb.clamp(pb.textureSample(scope.kkGGXLut, pb.vec2(NoV, roughness)), pb.vec4(0), pb.vec4(1));
    }
    calculateFresnelSchlick(scope: PBInsideFunctionScope, VoH: PBShaderExp, f0: PBShaderExp, f90: PBShaderExp) {
      const pb = scope.$builder;
      const funcName = 'kkPBRCalcFresnelSchlick';
      pb.func(funcName, [pb.float('VdotH'), pb.vec3('F0'), pb.vec3('F90')], function () {
        this.$return(
          pb.add(this.F0, pb.mul(pb.sub(this.F90, this.F0), pb.pow(pb.clamp(pb.sub(1, this.VdotH), 0, 1), 5)))
        );
      });
      return scope.$g[funcName](VoH, f0, f90);
    }
    calculateSpecularIBL(
      scope: PBInsideFunctionScope,
      brdf: PBShaderExp,
      f0: PBShaderExp,
      radiance: PBShaderExp,
      NoV: PBShaderExp,
      roughness: PBShaderExp,
      specularWeight: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkPBRCalcSpecularIBL';
      pb.func(
        funcName,
        [
          pb.vec4('brdf'),
          pb.vec3('f0'),
          pb.vec3('radiance'),
          pb.float('NdotV'),
          pb.float('roughness'),
          pb.float('specularWeight')
        ],
        function () {
          this.$l.f_ab = this.brdf.rg;
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
          this.$return(pb.mul(this.radiance, this.FssEss, this.specularWeight));
        }
      );
      return pb.getGlobalScope()[funcName](brdf, f0, radiance, NoV, roughness, specularWeight);
    }
    calculateDiffuseIBL(
      scope: PBInsideFunctionScope,
      brdf: PBShaderExp,
      f0: PBShaderExp,
      diffuse: PBShaderExp,
      irradiance: PBShaderExp,
      NoV: PBShaderExp,
      roughness: PBShaderExp,
      specularWeight: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'kkPBRCalcDiffuseIBL';
      pb.func(
        funcName,
        [
          pb.vec4('brdf'),
          pb.vec3('f0'),
          pb.vec3('diffuse'),
          pb.vec3('irradiance'),
          pb.float('NdotV'),
          pb.float('roughness'),
          pb.float('specularWeight')
        ],
        function () {
          this.$l.f_ab = this.brdf.rg;
          this.$l.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.roughness)), this.f0), this.f0);
          this.$l.k_S = pb.add(this.f0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NdotV), 5)));
          this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x, this.specularWeight), pb.vec3(this.f_ab.y));
          this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
          this.$l.F_avg = pb.mul(
            pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21)),
            this.specularWeight
          );
          this.$l.FmsEms = pb.div(
            pb.mul(this.FssEss, this.F_avg, this.Ems),
            pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems))
          );
          this.$l.k_D = pb.mul(this.diffuse, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
          this.$return(pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance));
        }
      );
      return pb.getGlobalScope()[funcName](brdf, f0, diffuse, irradiance, NoV, roughness, specularWeight);
    }
  } as unknown as { new (...args: any[]): T & IMixinPBR } & TextureMixinTypes<PBRTextureNames>;
}

export { mixinPBR };
