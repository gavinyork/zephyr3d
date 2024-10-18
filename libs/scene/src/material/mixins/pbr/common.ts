import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ShaderTypeFunc
} from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import { Vector3 } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { DrawContext } from '../../../render';
import { getGGXLUT } from '../../../utility/textures/ggxlut';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import { ShaderHelper } from '../../shader/helper';

/**
 * Interface for common PBR mixin
 *
 * @public
 */
export type IMixinPBRCommon = {
  ior: number;
  emissiveColor: Vector3;
  emissiveStrength: number;
  occlusionStrength: number;
  transmission: boolean;
  transmissionFactor: number;
  thicknessFactor: number;
  attenuationColor: Vector3;
  attenuationDistance: number;
  sheen: boolean;
  sheenColorFactor: Vector3;
  sheenRoughnessFactor: number;
  clearcoat: boolean;
  clearcoatIntensity: number;
  clearcoatRoughnessFactor: number;
  clearcoatNormalScale: number;
  iridescence: boolean;
  iridescenceFactor: number;
  iridescenceIor: number;
  iridescenceThicknessMin: number;
  iridescenceThicknessMax: number;
  getCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp
  ): PBShaderExp;
  calculateCommonData(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    TBN: PBShaderExp,
    data: PBShaderExp
  ): void;
  fresnelSchlick(scope: PBInsideFunctionScope, cosTheta: PBShaderExp, F0: PBShaderExp): PBShaderExp;
  distributionGGX(scope: PBInsideFunctionScope, NdotH: PBShaderExp, alphaRoughness: PBShaderExp): PBShaderExp;
  visGGX(
    scope: PBInsideFunctionScope,
    NdotV: PBShaderExp,
    NdotL: PBShaderExp,
    alphaRoughness: PBShaderExp
  ): PBShaderExp;
  getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc;
  calculateEmissiveColor(scope: PBInsideFunctionScope): PBShaderExp;
  getF0(scope: PBInsideFunctionScope): PBShaderExp;
  directLighting(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    lightColor: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outColor: PBShaderExp
  );
  indirectLighting(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outColor: PBShaderExp,
    outRoughness?: PBShaderExp
  );
} & TextureMixinInstanceTypes<
  [
    'occlusion',
    'emissive',
    'sheenColor',
    'sheenRoughness',
    'clearcoatIntensity',
    'clearcoatRoughness',
    'clearcoatNormal',
    'transmission',
    'thickness',
    'iridescence',
    'iridescenceThickness'
  ]
>;

/**
 * PBR common stuff mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 *
 * @public
 */
export function mixinPBRCommon<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrCommonMixed) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRCommon; FEATURE_TRANSMISSION: number };
  }
  const S = applyMaterialMixins(
    BaseCls,
    mixinTextureProps('occlusion'),
    mixinTextureProps('emissive'),
    mixinTextureProps('sheenColor'),
    mixinTextureProps('sheenRoughness'),
    mixinTextureProps('clearcoatIntensity'),
    mixinTextureProps('clearcoatRoughness'),
    mixinTextureProps('clearcoatNormal'),
    mixinTextureProps('transmission'),
    mixinTextureProps('thickness'),
    mixinTextureProps('iridescence'),
    mixinTextureProps('iridescenceThickness')
  );
  let FEATURE_SHEEN = 0;
  let FEATURE_CLEARCOAT = 0;
  let FEATURE_TRANSMISSION = 0;
  let FEATURE_IRIDESCENCE = 0;

  const cls = class extends S {
    static readonly pbrCommonMixed = true;
    private _f0: Vector4;
    private _emissiveFactor: Vector4;
    private _occlusionStrength: number;
    private _sheenFactor: Vector4;
    private _clearcoatFactor: Vector4;
    private _transmissionFactor: number;
    private _thicknessFactor: number;
    private _attenuationColor: Vector3;
    private _attenuationDistance: number;
    private _iridescenceFactor: Vector4;
    private _sceneColorTexSize: Vector2;
    constructor() {
      super();
      this._f0 = new Vector4(0.04, 0.04, 0.04, 1.5);
      this._occlusionStrength = 1;
      this._emissiveFactor = new Vector4(0, 0, 0, 1);
      this._sheenFactor = Vector4.zero();
      this._clearcoatFactor = new Vector4(0, 0, 1, 0);
      this._transmissionFactor = 0;
      this._thicknessFactor = 0;
      this._attenuationColor = Vector3.one();
      this._attenuationDistance = 99999;
      this._iridescenceFactor = new Vector4(0, 1.3, 100, 400);
      this._sceneColorTexSize = new Vector2();
    }
    get ior(): number {
      return this._f0.w;
    }
    set ior(val: number) {
      if (val !== this._f0.w) {
        let k = (val - 1) / (val + 1);
        k *= k;
        this._f0.setXYZW(k, k, k, val);
        this.uniformChanged();
      }
    }
    get transmissionFactor(): number {
      return this._transmissionFactor;
    }
    set transmissionFactor(val: number) {
      if (val !== this._transmissionFactor) {
        this._transmissionFactor = val;
        this.uniformChanged();
      }
    }
    get thicknessFactor(): number {
      return this._thicknessFactor;
    }
    set thicknessFactor(val: number) {
      if (this._thicknessFactor !== val) {
        this._thicknessFactor = val;
        this.uniformChanged();
      }
    }
    get attenuationColor(): Vector3 {
      return this._attenuationColor;
    }
    set attenuationColor(val: Vector3) {
      if (!val.equalsTo(this._attenuationColor)) {
        this._attenuationColor.set(val);
        this.uniformChanged();
      }
    }
    get attenuationDistance(): number {
      return this._attenuationDistance;
    }
    set attenuationDistance(val: number) {
      if (val !== this._attenuationDistance) {
        this._attenuationDistance = val;
        this.uniformChanged();
      }
    }
    get iridescenceFactor(): number {
      return this._iridescenceFactor.x;
    }
    set iridescenceFactor(val: number) {
      if (this._iridescenceFactor.x !== val) {
        this._iridescenceFactor.x = val;
        this.uniformChanged();
      }
    }
    get iridescenceIor(): number {
      return this._iridescenceFactor.y;
    }
    set iridescenceIor(val: number) {
      if (this._iridescenceFactor.y !== val) {
        this._iridescenceFactor.y = val;
        this.uniformChanged();
      }
    }
    get iridescenceThicknessMin(): number {
      return this._iridescenceFactor.z;
    }
    set iridescenceThicknessMin(val: number) {
      if (this._iridescenceFactor.z !== val) {
        this._iridescenceFactor.z = val;
        this.uniformChanged();
      }
    }
    get iridescenceThicknessMax(): number {
      return this._iridescenceFactor.w;
    }
    set iridescenceThicknessMax(val: number) {
      if (this._iridescenceFactor.w !== val) {
        this._iridescenceFactor.w = val;
        this.uniformChanged();
      }
    }
    get occlusionStrength(): number {
      return this._occlusionStrength;
    }
    set occlusionStrength(val: number) {
      if (val !== this._occlusionStrength) {
        this._occlusionStrength = val;
        this.uniformChanged();
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
        this.uniformChanged();
      }
    }
    get emissiveStrength(): number {
      return this._emissiveFactor.w;
    }
    set emissiveStrength(val: number) {
      if (this._emissiveFactor.w !== val) {
        this._emissiveFactor.w = val;
        this.uniformChanged();
      }
    }
    get transmission(): boolean {
      return this.featureUsed<boolean>(FEATURE_TRANSMISSION);
    }
    set transmission(val: boolean) {
      this.useFeature(FEATURE_TRANSMISSION, !!val);
    }
    get iridescence(): boolean {
      return this.featureUsed<boolean>(FEATURE_IRIDESCENCE);
    }
    set iridescence(val: boolean) {
      this.useFeature(FEATURE_IRIDESCENCE, !!val);
    }
    get clearcoat(): boolean {
      return this.featureUsed<boolean>(FEATURE_CLEARCOAT);
    }
    set clearcoat(val: boolean) {
      this.useFeature(FEATURE_CLEARCOAT, !!val);
    }
    get clearcoatIntensity(): number {
      return this._clearcoatFactor.x;
    }
    set clearcoatIntensity(val: number) {
      if (val !== this._clearcoatFactor.x) {
        this._clearcoatFactor.x = val;
        this.uniformChanged();
      }
    }
    get clearcoatRoughnessFactor(): number {
      return this._clearcoatFactor.y;
    }
    set clearcoatRoughnessFactor(val: number) {
      if (val !== this._clearcoatFactor.y) {
        this._clearcoatFactor.y = val;
        this.uniformChanged();
      }
    }
    get clearcoatNormalScale(): number {
      return this._clearcoatFactor.z;
    }
    set clearcoatNormalScale(val: number) {
      if (val !== this._clearcoatFactor.z) {
        this._clearcoatFactor.z = val;
        this.uniformChanged();
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
        this.uniformChanged();
      }
    }
    get sheenRoughnessFactor(): number {
      return this._sheenFactor.w;
    }
    set sheenRoughnessFactor(val: number) {
      if (val !== this._sheenFactor.w) {
        this._sheenFactor.w = val;
        this.uniformChanged();
      }
    }
    fragmentShader(scope: PBFunctionScope): void {
      const pb = scope.$builder;
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        scope.zF0 = pb.vec4().uniform(2);
        scope.zEmissiveFactor = pb.vec4().uniform(2);
        if (this.occlusionTexture) {
          scope.zOcclusionStrength = pb.float().uniform(2);
        }
        if (this.sheen) {
          scope.zSheenFactor = pb.vec4().uniform(2);
        }
        if (this.clearcoat) {
          scope.zClearcoatFactor = pb.vec4().uniform(2);
        }
        if (this.transmission) {
          scope.zTransmissionFactor = pb.float().uniform(2);
          scope.zThicknessFactor = pb.float().uniform(2);
          scope.zAttenuationColor = pb.vec3().uniform(2);
          scope.zAttenuationDistance = pb.float().uniform(2);
          scope.zSceneColorTex = pb.tex2D().uniform(2);
          scope.zSceneColorTexSize = pb.vec2().uniform(2);
        }
        if (this.iridescence) {
          scope.zIridescenceFactor = pb.vec4().uniform(2);
        }
        if (this.drawContext.drawEnvLight) {
          scope.zGGXLut = pb.tex2D().uniform(2);
        }
      }
    }
    needSceneColor(): boolean {
      return this.transmission;
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        bindGroup.setValue('zF0', this._f0);
        bindGroup.setValue('zEmissiveFactor', this._emissiveFactor);
        if (this.occlusionTexture) {
          bindGroup.setValue('zOcclusionStrength', this._occlusionStrength);
        }
        if (this.sheen) {
          bindGroup.setValue('zSheenFactor', this._sheenFactor);
        }
        if (this.clearcoat) {
          bindGroup.setValue('zClearcoatFactor', this._clearcoatFactor);
        }
        if (this.transmission) {
          bindGroup.setValue('zTransmissionFactor', this._transmissionFactor);
          bindGroup.setValue('zThicknessFactor', this._thicknessFactor);
          bindGroup.setValue('zAttenuationColor', this._attenuationColor);
          bindGroup.setValue('zAttenuationDistance', this._attenuationDistance);
          bindGroup.setTexture('zSceneColorTex', ctx.sceneColorTexture);
          this._sceneColorTexSize.setXY(ctx.sceneColorTexture.width, ctx.sceneColorTexture.height);
          bindGroup.setValue('zSceneColorTexSize', this._sceneColorTexSize);
        }
        if (this.iridescence) {
          bindGroup.setValue('zIridescenceFactor', this._iridescenceFactor);
        }
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('zGGXLut', getGGXLUT(1024));
        }
      }
    }
    getF0(scope: PBInsideFunctionScope): PBShaderExp {
      return scope.zF0;
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
        ...(this.sheen
          ? [pb.float('sheenAlbedoScaling'), pb.vec3('sheenColor'), pb.float('sheenRoughness')]
          : []),
        ...(this.clearcoat
          ? [pb.vec4('ccFactor'), pb.vec3('ccNormal'), pb.float('ccNoV'), pb.float('ccFresnel')]
          : []),
        ...(this.transmission
          ? [
              pb.float('transmissionFactor'),
              pb.float('thicknessFactor'),
              pb.vec3('attenuationColor'),
              pb.float('attenuationDistance')
            ]
          : []),
        ...(this.iridescence
          ? [pb.vec4('iridescenceFactor'), pb.vec3('iridescenceFresnel'), pb.vec3('iridescenceF0')]
          : [])
      ]);
    }
    getCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'Z_getCommonData';
      pb.func(
        funcName,
        [pb.vec4('albedo'), pb.vec3('normal'), pb.vec3('viewVec'), pb.mat3('TBN')],
        function () {
          this.$l.data = that.getCommonDatasStruct(this)();
          that.calculateCommonData(this, this.albedo, this.normal, this.viewVec, this.TBN, this.data);
          this.$return(this.data);
        }
      );
      return scope.$g[funcName](albedo, normal, viewVec, TBN);
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      albedo: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      TBN: PBShaderExp,
      data: PBShaderExp
    ): void {
      const pb = scope.$builder;
      if (this.sheen) {
        if (this.sheenColorTexture) {
          data.sheenColor = pb.mul(this.sampleSheenColorTexture(scope).rgb, scope.zSheenFactor.rgb);
        } else {
          data.sheenColor = scope.zSheenFactor.rgb;
        }
        if (this.sheenRoughnessTexture) {
          data.sheenRoughness = pb.mul(this.sampleSheenRoughnessTexture(scope).a, scope.zSheenFactor.a);
        } else {
          data.sheenRoughness = scope.zSheenFactor.a;
        }
        scope.$l.sheenDFG = 0.157;
        data.sheenAlbedoScaling = pb.sub(
          1,
          pb.mul(pb.max(pb.max(data.sheenColor.r, data.sheenColor.g), data.sheenColor.b), scope.sheenDFG)
        );
      }
      if (this.clearcoat) {
        if (this.clearcoatNormalTexture) {
          const ccNormal = pb.mul(
            pb.sub(pb.mul(this.sampleClearcoatNormalTexture(scope).rgb, 2), pb.vec3(1)),
            pb.vec3(scope.zClearcoatFactor.zz, 1)
          );
          data.ccNormal = pb.normalize(pb.mul(TBN, ccNormal));
        } else {
          data.ccNormal = TBN[2];
        }
        data.ccNoV = pb.clamp(pb.dot(data.ccNormal, viewVec), 0.0001, 1);
        data.ccFactor = scope.zClearcoatFactor;
        if (this.clearcoatIntensityTexture) {
          data.ccFactor.x = pb.mul(data.ccFactor.x, this.sampleClearcoatIntensityTexture(scope).r);
        }
        if (this.clearcoatRoughnessTexture) {
          data.ccFactor.y = pb.clamp(
            pb.mul(data.ccFactor.y, this.sampleClearcoatRoughnessTexture(scope).g),
            0,
            1
          );
        }
      }
      if (this.transmission) {
        if (this.transmissionTexture) {
          data.transmissionFactor = pb.mul(
            this.sampleTransmissionTexture(scope).r,
            scope.zTransmissionFactor
          );
        } else {
          data.transmissionFactor = scope.zTransmissionFactor;
        }
        if (this.thicknessTexture) {
          data.thicknessFactor = pb.mul(this.sampleThicknessTexture(scope).g, scope.zThicknessFactor);
        } else {
          data.thicknessFactor = scope.zThicknessFactor;
        }
        data.attenuationColor = scope.zAttenuationColor;
        data.attenuationDistance = scope.zAttenuationDistance;
      }
      if (this.iridescence) {
        data.iridescenceFactor = scope.zIridescenceFactor;
        if (this.iridescenceTexture) {
          data.iridescenceFactor.x = pb.mul(this.sampleIridescenceTexture(scope).r, data.iridescenceFactor.x);
        }
        if (this.iridescenceThicknessTexture) {
          data.iridescenceFactor.w = pb.mix(
            data.iridescenceFactor.z,
            data.iridescenceFactor.w,
            this.sampleIridescenceThicknessTexture(scope).g
          );
        }
        data.iridescenceFresnel = this.evalIridescence(
          scope,
          1,
          data.iridescenceFactor.y,
          pb.clamp(pb.dot(normal, viewVec), 0, 1),
          data.iridescenceFactor.w,
          data.f0.rgb
        );
        data.iridescenceF0 = this.schlickToF0(
          scope,
          data.iridescenceFresnel,
          pb.vec3(1),
          pb.clamp(pb.dot(normal, viewVec), 0, 1)
        );
      }
    }
    calculateEmissiveColor(scope: PBInsideFunctionScope): PBShaderExp {
      const pb = scope.$builder;
      if (this.emissiveTexture) {
        return pb.mul(
          this.sampleEmissiveTexture(scope).rgb,
          scope.zEmissiveFactor.rgb,
          scope.zEmissiveFactor.a
        );
      } else {
        return pb.mul(scope.zEmissiveFactor.rgb, scope.zEmissiveFactor.a);
      }
    }
    D_Charlie(scope: PBInsideFunctionScope, NdotH: PBShaderExp, sheenRoughness: PBShaderExp): PBShaderExp {
      const funcNameDCharlie = 'Z_DCharlie';
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
    V_Ashikhmin(scope: PBInsideFunctionScope, NdotL: PBShaderExp, NdotV: PBShaderExp): PBShaderExp {
      const funcNameVAshikhmin = 'Z_VAshikhmin';
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
    getVolumeTransmissionRay(
      scope: PBInsideFunctionScope,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      thickness: PBShaderExp,
      ior: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'getVolumeTransmissionRay';
      pb.func(
        funcName,
        [pb.vec3('normal'), pb.vec3('viewVec'), pb.float('thickness'), pb.float('ior')],
        function () {
          this.$l.refractionVector = pb.refract(pb.neg(this.viewVec), this.normal, pb.div(1, this.ior));
          this.$return(pb.mul(this.refractionVector, this.$inputs.modelScale, this.thickness));
        }
      );
      return pb.getGlobalScope()[funcName](normal, viewVec, thickness, ior);
    }
    getTransmissionSample(
      scope: PBInsideFunctionScope,
      fragCoord: PBShaderExp,
      roughness: PBShaderExp,
      ior: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'getTransmissionSample';
      pb.func(funcName, [pb.vec2('fragCoord'), pb.float('roughness'), pb.float('ior')], function () {
        this.$l.applyIorToRoughness = pb.mul(
          this.roughness,
          pb.clamp(pb.sub(pb.mul(this.ior, 2), 2), 0.0, 1.0)
        );
        this.$l.framebufferLod = pb.mul(pb.log2(this.zSceneColorTexSize.x), this.applyIorToRoughness);
        this.$return(pb.textureSampleLevel(this.zSceneColorTex, this.fragCoord, this.framebufferLod).rgb);
      });
      return pb.getGlobalScope()[funcName](fragCoord, roughness, ior);
    }
    getPunctualRadianceTransmission(
      scope: PBInsideFunctionScope,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      lightDir: PBShaderExp,
      alphaRoughness: PBShaderExp,
      f0: PBShaderExp,
      f90: PBShaderExp,
      baseColor: PBShaderExp,
      ior: PBShaderExp
    ) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'getPunctualRadianceTransmission';
      pb.func(
        funcName,
        [
          pb.vec3('normal'),
          pb.vec3('viewVec'),
          pb.vec3('L'),
          pb.float('alphaRoughness'),
          pb.vec3('f0'),
          pb.vec3('f90'),
          pb.vec3('baseColor'),
          pb.float('ior')
        ],
        function () {
          this.$l.transmissionRoughness = pb.mul(
            this.alphaRoughness,
            pb.clamp(pb.sub(pb.mul(this.ior, 2), 2), 0.0, 1.0)
          );
          this.$l.mirrorL = pb.normalize(
            pb.add(this.L, pb.mul(this.normal, pb.dot(pb.neg(this.L), this.normal), 2))
          );
          this.$l.h = pb.normalize(pb.add(this.viewVec, this.mirrorL));
          this.$l.D = that.distributionGGX(
            this,
            pb.clamp(pb.dot(this.normal, this.h), 0, 1),
            this.transmissionRoughness
          );
          this.$l.F = that.fresnelSchlick(
            this,
            pb.clamp(pb.dot(this.viewVec, this.h), 0, 1),
            this.f0,
            this.f90
          );
          this.$l.V = that.visGGX(
            this,
            pb.clamp(pb.dot(this.normal, this.viewVec), 0, 1),
            pb.clamp(pb.dot(this.normal, this.mirrorL), 0, 1),
            this.transmissionRoughness
          );
          this.$return(pb.mul(pb.sub(pb.vec3(1), this.F), this.baseColor, this.D, this.V));
        }
      );
      return pb
        .getGlobalScope()
        [funcName](normal, viewVec, lightDir, alphaRoughness, f0, f90, baseColor, ior);
    }
    applyVolumeAttenuation(
      scope: PBInsideFunctionScope,
      radiance: PBShaderExp,
      transmissionDistance: PBShaderExp,
      attenuationColor: PBShaderExp,
      attenuationDistance: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'applyVolumeAttenuation';
      pb.func(
        funcName,
        [
          pb.vec3('radiance'),
          pb.float('transmissionDistance'),
          pb.vec3('attenuationColor'),
          pb.float('attenuationDistance')
        ],
        function () {
          this.$if(pb.equal(this.attenuationDistance, 0), function () {
            this.$return(this.radiance);
          }).$else(function () {
            this.$l.attenuationCoefficient = pb.div(
              pb.neg(pb.log(this.attenuationColor)),
              this.attenuationDistance
            );
            this.$l.transmittance = pb.exp(
              pb.mul(pb.neg(this.attenuationCoefficient), this.transmissionDistance)
            );
            this.$return(pb.mul(this.radiance, this.transmittance));
          });
        }
      );
      return pb
        .getGlobalScope()
        [funcName](radiance, transmissionDistance, attenuationColor, attenuationDistance);
    }
    getIBLVolumnRefraction(
      scope: PBInsideFunctionScope,
      brdf: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      roughness: PBShaderExp,
      baseColor: PBShaderExp,
      f0: PBShaderExp,
      f90: PBShaderExp,
      position: PBShaderExp,
      ior: PBShaderExp,
      thickness: PBShaderExp,
      attenuationColor: PBShaderExp,
      attenuationDistance: PBShaderExp
    ) {
      const pb = scope.$builder;
      const funcName = 'getIBLVolumeRefraction';
      const that = this;
      pb.func(
        funcName,
        [
          pb.vec2('brdf'),
          pb.vec3('normal'),
          pb.vec3('viewVec'),
          pb.float('roughness'),
          pb.vec3('baseColor'),
          pb.vec3('f0'),
          pb.vec3('f90'),
          pb.vec3('position'),
          pb.float('ior'),
          pb.float('thickness'),
          pb.vec3('attenuationColor'),
          pb.float('attenuationDistance')
        ],
        function () {
          this.$l.transmissionRay = that.getVolumeTransmissionRay(
            this,
            this.normal,
            this.viewVec,
            this.thickness,
            this.ior
          );
          this.$l.transmissionRayLength = pb.length(this.transmissionRay);
          this.$l.refractedRayExit = pb.add(this.position, this.transmissionRay);
          this.$l.ndcPos = pb.mul(
            ShaderHelper.getViewProjectionMatrix(this),
            pb.vec4(this.refractedRayExit, 1)
          );
          this.$l.refractionCoords = pb.add(pb.mul(pb.div(this.ndcPos.xy, this.ndcPos.w), 0.5), pb.vec2(0.5));
          this.$l.transmittedLight = that.getTransmissionSample(
            this,
            this.refractionCoords,
            this.roughness,
            this.ior
          );
          this.$l.attColor = that.applyVolumeAttenuation(
            this,
            this.transmittedLight,
            this.transmissionRayLength,
            this.attenuationColor,
            this.attenuationDistance
          );
          this.$l.specularColor = pb.add(pb.mul(this.f0, this.brdf.x), pb.mul(this.f90, this.brdf.y));
          this.$return(pb.mul(pb.sub(pb.vec3(1), this.specularColor), this.attColor, this.baseColor));
        }
      );
      return pb
        .getGlobalScope()
        [funcName](
          brdf,
          normal,
          viewVec,
          roughness,
          baseColor,
          f0,
          f90,
          position,
          ior,
          thickness,
          attenuationColor,
          attenuationDistance
        );
    }
    directLighting(
      scope: PBInsideFunctionScope,
      lightDir: PBShaderExp,
      lightColor: PBShaderExp,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      commonData: PBShaderExp,
      outColor: PBShaderExp
    ) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'Z_PBRDirectLighting';
      pb.func(
        funcName,
        [
          pb.vec3('L'),
          pb.vec3('lightColor'),
          pb.vec3('normal'),
          pb.vec3('viewVec'),
          that.getCommonDatasStruct(scope)('data'),
          pb.vec3('outColor').inout()
        ],
        function () {
          this.$l.H = pb.normalize(pb.add(this.viewVec, this.L));
          this.$l.NoH = pb.clamp(pb.dot(this.normal, this.H), 0, 1);
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0, 1);
          this.$if(pb.greaterThan(this.NoL, 0), function () {
            this.$l.VoH = pb.clamp(pb.dot(this.viewVec, this.H), 0, 1);
            this.$l.schlickFresnel = that.fresnelSchlick(this, this.VoH, this.data.f0.rgb, this.data.f90);
            if (that.iridescence) {
              this.$l.F = pb.mix(
                this.schlickFresnel,
                this.data.iridescenceFresnel,
                this.data.iridescenceFactor.x
              );
            } else {
              this.$l.F = this.schlickFresnel;
            }
            this.$l.alphaRoughness = pb.mul(this.data.roughness, this.data.roughness);
            this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
            this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
            this.$l.specular = pb.mul(this.lightColor, this.D, this.V, this.F, this.data.specularWeight);
            if (that.sheen) {
              this.specular = pb.mul(this.specular, this.data.sheenAlbedoScaling);
            }
            this.outColor = pb.add(this.outColor, this.specular);
            if (that.iridescence) {
              this.$l.iridescenceFresnelMax = pb.vec3(
                pb.max(
                  pb.max(this.data.iridescenceFresnel.r, this.data.iridescenceFresnel.g),
                  this.data.iridescenceFresnel.b
                )
              );
              this.F = pb.mix(this.schlickFresnel, this.iridescenceFresnelMax, this.data.iridescenceFactor.x);
            }
            this.$l.diffuseBRDF = pb.mul(
              pb.sub(pb.vec3(1), pb.mul(this.F, this.data.specularWeight)),
              pb.div(this.data.diffuse.rgb, Math.PI)
            );
            this.$l.diffuse = pb.mul(this.lightColor, pb.max(this.diffuseBRDF, pb.vec3(0)));
            if (that.transmission) {
              this.$l.transmissionRay = that.getVolumeTransmissionRay(
                this,
                this.normal,
                this.viewVec,
                this.data.thicknessFactor,
                this.data.f0.a
              );
              this.$l.pointToLight = pb.normalize(pb.sub(this.L, this.transmissionRay));
              this.$l.transmittedLight = pb.mul(
                this.lightColor,
                that.getPunctualRadianceTransmission(
                  this,
                  this.normal,
                  this.viewVec,
                  this.pointToLight,
                  this.alphaRoughness,
                  this.data.f0.rgb,
                  this.data.f90.rgb,
                  this.data.diffuse.rgb,
                  this.data.f0.a
                )
              );
              this.transmittedLight = that.applyVolumeAttenuation(
                this,
                this.transmittedLight,
                pb.length(this.transmissionRay),
                this.data.attenuationColor,
                this.data.attenuationDistance
              );
              this.diffuse = pb.mix(this.diffuse, this.transmittedLight, this.data.transmissionFactor);
            }
            if (that.sheen) {
              this.diffuse = pb.mul(this.diffuse, this.data.sheenAlbedoScaling);
            }
            this.outColor = pb.add(this.outColor, this.diffuse);
            if (that.sheen) {
              this.$l.sheenD = that.D_Charlie(this, this.NoH, this.data.sheenRoughness);
              this.$l.sheenV = that.V_Ashikhmin(this, this.NoL, this.NoV);
              this.outColor = pb.add(
                this.outColor,
                pb.mul(this.lightColor, this.data.sheenColor, this.sheenD, this.sheenV)
              );
            }
            if (that.clearcoat) {
              this.alphaRoughness = pb.mul(this.data.ccFactor.y, this.data.ccFactor.y);
              this.NoH = pb.clamp(pb.dot(this.data.ccNormal, this.H), 0, 1);
              this.NoL = pb.clamp(pb.dot(this.data.ccNormal, this.L), 0, 1);
              this.ccF0 = pb.vec3(pb.pow(pb.div(pb.sub(this.data.f0.a, 1), pb.add(this.data.f0.a, 1)), 2));
              this.F = that.fresnelSchlick(this, this.VoH, this.ccF0, pb.vec3(1));
              this.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
              this.V = that.visGGX(this, this.data.ccNoV, this.NoL, this.alphaRoughness);
              this.outColor = pb.add(this.outColor, pb.mul(this.D, this.V, this.F, this.data.ccFactor.x));
            }
          });
        }
      );
      scope.$g[funcName](lightDir, lightColor, normal, viewVec, commonData, outColor);
    }
    fresnel0ToIor(scope: PBInsideFunctionScope, fresnel0: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_fresnel0ToIor';
      pb.func(funcName, [pb.vec3('fresnel0')], function () {
        this.$l.sqrtF0 = pb.sqrt(this.fresnel0);
        this.$return(pb.div(pb.add(this.sqrtF0, pb.vec3(1)), pb.sub(pb.vec3(1), this.sqrtF0)));
      });
      return pb.getGlobalScope()[funcName](fresnel0);
    }
    iorToFresnel0v(
      scope: PBInsideFunctionScope,
      transmittedIor: PBShaderExp,
      incidentIor: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_iorToFresnel0v';
      pb.func(funcName, [pb.vec3('transmittedIor'), pb.float('incidentIor')], function () {
        this.$l.t = pb.div(
          pb.sub(this.transmittedIor, pb.vec3(this.incidentIor)),
          pb.add(this.transmittedIor, pb.vec3(this.incidentIor))
        );
        this.$return(pb.mul(this.t, this.t));
      });
      return pb.getGlobalScope()[funcName](transmittedIor, incidentIor);
    }
    iorToFresnel0(
      scope: PBInsideFunctionScope,
      transmittedIor: PBShaderExp,
      incidentIor: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_iorToFresnel0';
      pb.func(funcName, [pb.float('transmittedIor'), pb.float('incidentIor')], function () {
        this.$l.t = pb.div(
          pb.sub(this.transmittedIor, this.incidentIor),
          pb.add(this.transmittedIor, this.incidentIor)
        );
        this.$return(pb.mul(this.t, this.t));
      });
      return pb.getGlobalScope()[funcName](transmittedIor, incidentIor);
    }
    evalSensitivity(scope: PBInsideFunctionScope, OPD: PBShaderExp, shift: PBShaderExp): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_evalSensitivity';
      pb.func(funcName, [pb.float('OPD'), pb.vec3('shift')], function () {
        this.$l.phase = pb.mul(Math.PI * 2, this.OPD, 1e-9);
        this.$l.val = pb.vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
        this.$l.pos = pb.vec3(1.681e6, 1.7953e6, 2.2084e6);
        this.$l.va = pb.vec3(4.3278e9, 9.3046e9, 6.6121e9);
        this.$l.xyz = pb.mul(
          this.val,
          pb.sqrt(pb.mul(Math.PI * 2, this.va)),
          pb.cos(pb.add(pb.mul(this.pos, this.phase), this.shift)),
          pb.exp(pb.neg(pb.mul(this.phase, this.phase, this.va)))
        );
        this.xyz.x = pb.add(
          this.xyz.x,
          pb.mul(
            9.747e-14,
            Math.sqrt(Math.PI * 2 * 4.5282e9),
            pb.cos(pb.add(pb.mul(this.phase, 2.2399e6), this.shift.x)),
            pb.exp(pb.mul(-4.5282e9, this.phase, this.phase))
          )
        );
        this.xyz = pb.div(this.xyz, 1.0685e-7);
        this.$return(
          pb.mul(
            pb.mat3(
              3.2404542,
              -0.969266,
              0.0556434,
              -1.5371385,
              1.8760108,
              -0.2040259,
              -0.4985314,
              0.041556,
              1.0572252
            ),
            this.xyz
          )
        );
      });
      return pb.getGlobalScope()[funcName](OPD, shift);
    }
    schlickToF0(
      scope: PBInsideFunctionScope,
      f: PBShaderExp,
      f90: PBShaderExp,
      VdotH: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_schlickToF0';
      pb.func(funcName, [pb.vec3('f'), pb.vec3('f90'), pb.float('VdotH')], function () {
        this.$l.x = pb.clamp(pb.sub(1, this.VdotH), 0, 1);
        this.$l.x2 = pb.mul(this.x, this.x);
        this.$l.x5 = pb.clamp(pb.mul(this.x, this.x2, this.x2), 0, 0.9999);
        this.$return(pb.div(pb.sub(this.f, pb.mul(this.f90, this.x5)), pb.sub(1, this.x5)));
      });
      return pb.getGlobalScope()[funcName](f, f90, VdotH);
    }
    evalIridescence(
      scope: PBInsideFunctionScope,
      outsideIOR: PBShaderExp | number,
      eta2: PBShaderExp,
      cosTheta1: PBShaderExp,
      thinFilmThickness: PBShaderExp,
      baseF0: PBShaderExp
    ) {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'Z_evalIridescence';
      pb.func(
        funcName,
        [
          pb.float('outsideIOR'),
          pb.float('eta2'),
          pb.float('cosTheta1'),
          pb.float('thinFilmThickness'),
          pb.vec3('baseF0')
        ],
        function () {
          this.$l.iridescenceIor = pb.mix(
            this.outsideIOR,
            this.eta2,
            pb.smoothStep(0, 0.03, this.thinFilmThickness)
          );
          this.$l.t = pb.div(this.outsideIOR, this.iridescenceIor);
          this.$l.sinTheta2Sq = pb.mul(this.t, this.t, pb.sub(1, pb.mul(this.cosTheta1, this.cosTheta1)));
          this.$l.cosTheta2Sq = pb.sub(1, this.sinTheta2Sq);
          this.$if(pb.lessThan(this.cosTheta2Sq, 0), function () {
            this.$return(pb.vec3(1));
          });
          this.$l.cosTheta2 = pb.sqrt(this.cosTheta2Sq);

          this.$l.R0 = that.iorToFresnel0(this, this.iridescenceIor, this.outsideIOR);
          this.$l.R12 = that.fresnelSchlick(this, this.cosTheta1, pb.vec3(this.R0), pb.vec3(1)).x;
          this.$l.R21 = this.R12;
          this.$l.T121 = pb.sub(1, this.R12);
          this.$l.phi12 = pb.float(0);
          this.$if(pb.lessThan(this.iridescenceIor, this.outsideIOR), function () {
            this.phi12 = Math.PI;
          });
          this.$l.phi21 = pb.sub(Math.PI, this.phi12);

          this.$l.baseIOR = that.fresnel0ToIor(this, pb.clamp(this.baseF0, pb.vec3(0), pb.vec3(0.9999)));
          this.$l.R1 = that.iorToFresnel0v(this, this.baseIOR, this.iridescenceIor);
          this.$l.R23 = that.fresnelSchlick(this, this.cosTheta2, this.R1, pb.vec3(1));
          this.$l.phi23 = pb.vec3(0);
          this.$if(pb.lessThan(this.baseIOR.x, this.iridescenceIor), function () {
            this.phi23.x = Math.PI;
          });
          this.$if(pb.lessThan(this.baseIOR.y, this.iridescenceIor), function () {
            this.phi23.y = Math.PI;
          });
          this.$if(pb.lessThan(this.baseIOR.z, this.iridescenceIor), function () {
            this.phi23.z = Math.PI;
          });

          this.$l.OPD = pb.mul(this.iridescenceIor, this.thinFilmThickness, this.cosTheta2, 2);
          this.$l.phi = pb.add(pb.vec3(this.phi21), this.phi23);

          this.$l.R123 = pb.clamp(pb.mul(this.R12, this.R23), pb.vec3(1e-5), pb.vec3(0.9999));
          this.$l.r123 = pb.sqrt(this.R123);
          this.$l.Rs = pb.div(pb.mul(this.T121, this.T121, this.R23), pb.sub(pb.vec3(1), this.R123));

          this.$l.C0 = pb.add(pb.vec3(this.R12), this.Rs);
          this.$l.I = this.C0;

          this.$l.Cm = pb.sub(this.Rs, pb.vec3(this.T121));
          this.$for(pb.int('m'), 1, 3, function () {
            this.Cm = pb.mul(this.Cm, this.r123);
            this.$l.Sm = pb.mul(
              that.evalSensitivity(
                this,
                pb.mul(this.OPD, pb.float(this.m)),
                pb.mul(this.phi, pb.float(this.m))
              ),
              2
            );
            this.I = pb.add(this.I, pb.mul(this.Cm, this.Sm));
          });
          this.$return(pb.max(this.I, pb.vec3(0)));
        }
      );
      return pb.getGlobalScope()[funcName](outsideIOR, eta2, cosTheta1, thinFilmThickness, baseF0);
    }
    indirectLighting(
      scope: PBInsideFunctionScope,
      normal: PBShaderExp,
      viewVec: PBShaderExp,
      commonData: PBShaderExp,
      outColor: PBShaderExp,
      outRoughness?: PBShaderExp
    ) {
      const pb = scope.$builder;
      const that = this;
      const ctx = that.drawContext;
      const funcName = 'Z_PBRIndirectLighting';
      pb.func(
        funcName,
        [
          pb.vec3('normal'),
          pb.vec3('viewVec'),
          that.getCommonDatasStruct(scope)('data'),
          pb.vec3('outColor').inout(),
          ...(outRoughness ? [pb.vec4('outRoughness').out()] : [])
        ],
        function () {
          if (
            !ctx.drawEnvLight ||
            (!ctx.env.light.envLight.hasRadiance() && !ctx.env.light.envLight.hasIrradiance())
          ) {
            return;
          }
          const envLightStrength = ShaderHelper.getEnvLightStrength(this);
          if (that.occlusionTexture) {
            const occlusionSample = that.sampleOcclusionTexture(this).r;
            this.$l.occlusion = pb.mul(
              pb.add(pb.mul(this.zOcclusionStrength, pb.sub(occlusionSample, 1)), 1),
              envLightStrength
            );
          } else {
            this.$l.occlusion = envLightStrength;
          }
          this.$l.NoV = pb.clamp(pb.dot(this.normal, this.viewVec), 0.0001, 1);
          this.$l.ggxLutSample = pb.clamp(
            pb.textureSampleLevel(
              this.zGGXLut,
              pb.clamp(pb.vec2(this.NoV, this.data.roughness), pb.vec2(0), pb.vec2(1)),
              0
            ),
            pb.vec4(0),
            pb.vec4(1)
          );
          this.$l.f_ab = this.ggxLutSample.rg;
          this.$l.Fr = pb.sub(
            pb.max(pb.vec3(pb.sub(1, this.data.roughness)), this.data.f0.rgb),
            this.data.f0.rgb
          );
          if (that.iridescence) {
            this.$l.k_S = pb.mix(
              pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5))),
              this.data.iridescenceFresnel,
              this.data.iridescenceFactor.x
            );
          } else {
            this.$l.k_S = pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
          }
          if (outRoughness || ctx.env.light.envLight.hasRadiance()) {
            this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
            this.$l.specularFactor = pb.mul(this.FssEss, this.data.specularWeight, this.occlusion);
            if (that.sheen) {
              this.specularFactor = pb.mul(this.specularFactor, this.data.sheenAlbedoScaling);
            }
            if (outRoughness) {
              this.outRoughness = pb.vec4(this.specularFactor /*this.data.f0.rgb*/, this.data.roughness);
            } else if (ctx.env.light.envLight.hasRadiance()) {
              this.$l.radiance = ctx.env.light.envLight.getRadiance(
                this,
                pb.reflect(pb.neg(this.viewVec), this.normal),
                this.data.roughness
              );
              this.outColor = pb.add(this.outColor, pb.mul(this.radiance, this.specularFactor));
            }
          }
          if (ctx.env.light.envLight.hasIrradiance()) {
            this.$l.irradiance = ctx.env.light.envLight.getIrradiance(this, this.normal);
            if (that.iridescence) {
              this.$l.iridescenceF0Max = pb.vec3(
                pb.max(
                  pb.max(this.data.iridescenceF0.r, this.data.iridescenceF0.g),
                  this.data.iridescenceF0.b
                )
              );
              this.$l.mixedF0 = pb.mix(
                this.data.f0.rgb,
                this.iridescenceF0Max,
                this.data.iridescenceFactor.x
              );
              this.Fr = pb.sub(pb.max(pb.vec3(pb.sub(1, this.data.roughness)), this.mixedF0), this.mixedF0);
              this.k_S = pb.add(this.mixedF0, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
            } else {
              this.$l.mixedF0 = this.data.f0.rgb;
            }
            this.$l.FssEss = pb.add(
              pb.mul(this.k_S, this.f_ab.x, this.data.specularWeight),
              pb.vec3(this.f_ab.y)
            );
            this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
            this.$l.F_avg = pb.mul(
              pb.add(this.mixedF0, pb.div(pb.sub(pb.vec3(1), this.mixedF0), 21)),
              this.data.specularWeight
            );
            this.$l.FmsEms = pb.div(
              pb.mul(this.FssEss, this.F_avg, this.Ems),
              pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems))
            );
            this.$l.k_D = pb.mul(this.data.diffuse.rgb, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
            this.$l.iblDiffuse = pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance, this.occlusion);
            if (that.sheen) {
              this.iblDiffuse = pb.mul(this.iblDiffuse, this.data.sheenAlbedoScaling);
            }
            if (that.transmission) {
              this.$l.iblTransmission = that.getIBLVolumnRefraction(
                this,
                this.ggxLutSample.rg,
                this.normal,
                this.viewVec,
                this.data.roughness,
                this.data.diffuse.rgb,
                this.data.f0.rgb,
                this.data.f90,
                this.$inputs.worldPos,
                this.data.f0.a,
                this.data.thicknessFactor,
                this.data.attenuationColor,
                this.data.attenuationDistance
              );
              this.iblDiffuse = pb.mix(this.iblDiffuse, this.iblTransmission, this.data.transmissionFactor);
            }
            this.outColor = pb.add(this.outColor, this.iblDiffuse);
          }
          if (that.sheen && ctx.env.light.envLight.hasIrradiance()) {
            this.$l.refl = pb.reflect(pb.neg(this.viewVec), this.normal);
            this.$l.sheenBRDF = pb.clamp(
              pb.textureSampleLevel(
                this.zGGXLut,
                pb.clamp(pb.vec2(this.NoV, this.data.sheenRoughness), pb.vec2(0), pb.vec2(1)),
                0
              ),
              pb.vec4(0),
              pb.vec4(1)
            ).b;
            this.outColor = pb.add(
              this.outColor,
              pb.mul(this.data.sheenColor, this.irradiance.rgb, this.sheenBRDF)
            );
          }
          if (that.clearcoat && ctx.env.light.envLight.hasRadiance()) {
            this.$l.NoV = pb.clamp(pb.dot(this.data.ccNormal, this.viewVec), 0.0001, 1);
            this.$l.ggxLutSample = pb.clamp(
              pb.textureSampleLevel(
                this.zGGXLut,
                pb.clamp(pb.vec2(this.NoV, this.data.ccFactor.y), pb.vec2(0), pb.vec2(1)),
                0
              ),
              pb.vec4(0),
              pb.vec4(1)
            );
            this.$l.f_ab = this.ggxLutSample.rg;
            this.$l.Fr = pb.sub(
              pb.max(pb.vec3(pb.sub(1, this.data.ccFactor.y)), this.data.f0.rgb),
              this.data.f0.rgb
            );
            this.$l.k_S = pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
            this.$l.radiance = ctx.env.light.envLight.getRadiance(
              this,
              pb.reflect(pb.neg(this.viewVec), this.data.ccNormal),
              this.data.ccFactor.y
            );
            this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
            this.$l.ccSpecular = pb.mul(this.radiance, this.FssEss, this.data.specularWeight, this.occlusion);
            this.outColor = pb.add(this.outColor, pb.mul(this.ccSpecular, this.data.ccFactor.x));
          }
        }
      );
      if (outRoughness) {
        scope.$g[funcName](normal, viewVec, commonData, outColor, outRoughness);
      } else {
        scope.$g[funcName](normal, viewVec, commonData, outColor);
      }
    }
    fresnelSchlick(
      scope: PBInsideFunctionScope,
      cosTheta: PBShaderExp,
      F0: PBShaderExp,
      F90: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_fresnelSchlick';
      pb.func(funcName, [pb.float('cosTheta'), pb.vec3('f0'), pb.vec3('f90')], function () {
        this.$return(
          pb.add(
            this.f0,
            pb.mul(pb.sub(this.f90, this.f0), pb.pow(pb.clamp(pb.sub(1, this.cosTheta), 0, 1), 5))
          )
        );
      });
      return scope.$g[funcName](cosTheta, F0, F90);
    }
    distributionGGX(
      scope: PBInsideFunctionScope,
      NdotH: PBShaderExp,
      alphaRoughness: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_distributionGGX';
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
      const funcName = 'Z_visGGX';
      pb.func(funcName, [pb.float('NdotV'), pb.float('NdotL'), pb.float('roughness')], function () {
        this.$l.a = this.roughness;
        this.$l.ggxV = pb.mul(
          this.NdotL,
          pb.sqrt(pb.add(pb.mul(this.NdotV, this.NdotV, pb.sub(1, this.a)), this.a))
        );
        this.$l.ggxL = pb.mul(
          this.NdotV,
          pb.sqrt(pb.add(pb.mul(this.NdotL, this.NdotL, pb.sub(1, this.a)), this.a))
        );
        this.$l.ggx = pb.add(this.ggxV, this.ggxL, 1e-5);
        this.$if(pb.greaterThan(this.ggx, 0), function () {
          this.$return(pb.div(0.5, this.ggx));
        }).$else(function () {
          this.$return(pb.float(0));
        });
      });
      return scope.$g[funcName](NdotV, NdotL, alphaRoughness);
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRCommon };
  FEATURE_SHEEN = cls.defineFeature();
  FEATURE_CLEARCOAT = cls.defineFeature();
  FEATURE_TRANSMISSION = cls.defineFeature();
  FEATURE_IRIDESCENCE = cls.defineFeature();
  return cls;
}
