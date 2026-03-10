import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { TextureMixinInstanceTypes } from '../texture';
import { mixinTextureProps } from '../texture';
import type { IMixinPBRCommon } from '../pbr/common';
import { mixinPBRCommon } from '../pbr/common';
import type { DrawContext } from '../../../render';
import type { Immutable } from '@zephyr3d/base';
import { Vector2, Vector4 } from '@zephyr3d/base';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import { ShaderHelper } from '../../shader/helper';
import { LIGHT_TYPE_RECT, MaterialVaryingFlags, RENDER_PASS_TYPE_LIGHT } from '../../../values';

export type PBRReflectionMode = 'none' | 'ggx' | 'anisotropic' | 'glint';

const PBR_REFLECTION_MODE: Record<PBRReflectionMode, number> = {
  none: 0,
  ggx: 1,
  anisotropic: 2,
  glint: 3
};

/**
 * Interface for PBRMetallicRoughness lighting model mixin
 * @public
 */
export type IMixinPBRMetallicRoughness = {
  metallic: number;
  roughness: number;
  specularFactor: Vector4;
  reflectionMode: PBRReflectionMode;
  anisotropy: number;
  anisotropyDirection: number;
  anisotropyDirectionScaleBias: Vector2;
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
  calculateSpecularFactor(
    scope: PBInsideFunctionScope,
    albedo: PBShaderExp,
    normal: PBShaderExp
  ): PBShaderExp;
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
  TextureMixinInstanceTypes<['metallicRoughness', 'occlusion', 'specular', 'specularColor', 'anisotropyDirection']>;

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
    mixinTextureProps('specularColor'),
    mixinTextureProps('anisotropyDirection')
  );
  const METALLIC_UNIFORM = S.defineInstanceUniform('metallic', 'float', 'Metallic');
  const ROUGHNESS_UNIFORM = S.defineInstanceUniform('roughness', 'float', 'Roughness');
  const SPECULAR_FACTOR_UNFORM = S.defineInstanceUniform('specularFactor', 'rgba', 'SpecularFactor');
  const REFLECTION_MODE_UNIFORM = S.defineInstanceUniform('reflectionMode', 'float', 'ReflectionMode');
  const ANISOTROPY_UNIFORM = S.defineInstanceUniform('anisotropy', 'float', 'Anisotropy');
  const ANISOTROPY_DIRECTION_UNIFORM = S.defineInstanceUniform(
    'anisotropyDirection',
    'float',
    'AnisotropyDirection'
  );
  const ANISOTROPY_DIRECTION_SCALE_BIAS_UNIFORM = S.defineInstanceUniform(
    'anisotropyDirectionScaleBias',
    'vec2',
    'AnisotropyDirectionScaleBias'
  );

  return class extends S {
    static readonly pbrMetallicRoughnessMixed = true;
    private _metallic: number;
    private _roughness: number;
    private readonly _specularFactor: Vector4;
    private _reflectionMode: PBRReflectionMode;
    private _anisotropy: number;
    private _anisotropyDirection: number;
    private readonly _anisotropyDirectionScaleBias: Vector2;
    constructor() {
      super();
      this._metallic = 1;
      this._roughness = 1;
      this._specularFactor = Vector4.one();
      this._reflectionMode = 'ggx';
      this._anisotropy = 0.75;
      this._anisotropyDirection = 0;
      this._anisotropyDirectionScaleBias = new Vector2(1, 0);
    }
    copyFrom(other: this) {
      super.copyFrom(other);
      this.metallic = other.metallic;
      this.roughness = other.roughness;
      this.specularFactor = other.specularFactor;
      this.reflectionMode = other.reflectionMode;
      this.anisotropy = other.anisotropy;
      this.anisotropyDirection = other.anisotropyDirection;
      this.anisotropyDirectionScaleBias = other.anisotropyDirectionScaleBias;
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
      const that = this as any;
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      const funcName = 'Z_PBRMR_DirectLighting';
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
          this.$l.reflectionMode = instancing ? this.$inputs.zReflectionMode : this.zReflectionMode;
          this.$l.anisotropy = instancing ? this.$inputs.zAnisotropy : this.zAnisotropy;
          this.$l.anisotropyDirection = instancing
            ? this.$inputs.zAnisotropyDirection
            : this.zAnisotropyDirection;
          this.$l.anisotropyDirectionScaleBias = instancing
            ? this.$inputs.zAnisotropyDirectionScaleBias
            : this.zAnisotropyDirectionScaleBias;
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
            this.$l.Dggx = that.distributionGGX(this, this.NoH, this.alphaRoughness);
            this.$l.D = this.Dggx;
            this.$if(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.anisotropic), function () {
              this.$l.dirAngle = pb.mul(this.anisotropyDirection, Math.PI / 180);
              if (that.anisotropyDirectionTexture) {
                this.$l.dirSample = that.sampleAnisotropyDirectionTexture(this);
                this.$l.dirAngle = pb.mul(
                  pb.add(
                    pb.mul(this.dirSample.r, this.anisotropyDirectionScaleBias.x),
                    this.anisotropyDirectionScaleBias.y
                  ),
                  Math.PI / 180
                );
              }
              this.$l.anisoAngle = this.dirAngle;
              this.$l.up = pb.vec3(0, 1, 0);
              this.$l.t0 = pb.normalize(pb.cross(this.up, this.normal));
              this.$if(pb.lessThan(pb.length(this.t0), 0.001), function () {
                this.t0 = pb.normalize(pb.cross(pb.vec3(1, 0, 0), this.normal));
              });
              this.$l.b0 = pb.normalize(pb.cross(this.normal, this.t0));
              this.$l.tangent = pb.normalize(
                pb.add(pb.mul(this.t0, pb.cos(this.anisoAngle)), pb.mul(this.b0, pb.sin(this.anisoAngle)))
              );
              this.$l.bitangent = pb.normalize(pb.cross(this.normal, this.tangent));
              this.$l.ToH = pb.dot(this.tangent, this.H);
              this.$l.BoH = pb.dot(this.bitangent, this.H);
              this.$l.at = pb.max(pb.mul(this.alphaRoughness, pb.add(1, this.anisotropy)), 0.0001);
              this.$l.ab = pb.max(pb.mul(this.alphaRoughness, pb.sub(1, this.anisotropy)), 0.0001);
              this.$l.anisoDenom = pb.mul(
                Math.PI,
                this.at,
                this.ab,
                pb.pow(
                  pb.add(
                    pb.div(pb.mul(this.ToH, this.ToH), pb.mul(this.at, this.at)),
                    pb.div(pb.mul(this.BoH, this.BoH), pb.mul(this.ab, this.ab)),
                    pb.mul(this.NoH, this.NoH)
                  ),
                  2
                )
              );
              this.D = pb.div(1, pb.max(this.anisoDenom, 0.0001));
            }).$elseif(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.glint), function () {
              this.$l.glintNoise = pb.fract(
                pb.mul(
                  pb.sin(pb.add(pb.dot(this.H, pb.vec3(127.1, 311.7, 74.7)), pb.mul(this.NoH, 43.1))),
                  43758.5453
                )
              );
              this.$l.glintMask = pb.smoothStep(0.97, 1, this.glintNoise);
              this.D = pb.mul(this.Dggx, pb.add(1, pb.mul(this.glintMask, 8)));
            });
            this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
            this.$l.specular = pb.mul(this.lightColor, this.D, this.V, this.F, this.data.specularWeight);
            if (that.sheen) {
              this.specular = pb.mul(this.specular, this.data.sheenAlbedoScaling);
            }
            this.$if(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.none), function () {
              this.specular = pb.vec3(0);
            });
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
            if (that.transmission && that.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
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
    get reflectionMode() {
      return this._reflectionMode;
    }
    set reflectionMode(val: PBRReflectionMode) {
      if (val !== this._reflectionMode) {
        this._reflectionMode = val;
        this.uniformChanged();
      }
    }
    get anisotropy() {
      return this._anisotropy;
    }
    set anisotropy(val) {
      const clamped = Math.max(-0.95, Math.min(0.95, val));
      if (clamped !== this._anisotropy) {
        this._anisotropy = clamped;
        this.uniformChanged();
      }
    }
    get anisotropyDirection() {
      return this._anisotropyDirection;
    }
    set anisotropyDirection(val) {
      if (val !== this._anisotropyDirection) {
        this._anisotropyDirection = val;
        this.uniformChanged();
      }
    }
    get anisotropyDirectionScaleBias(): Immutable<Vector2> {
      return this._anisotropyDirectionScaleBias;
    }
    set anisotropyDirectionScaleBias(val: Immutable<Vector2>) {
      if (!val.equalsTo(this._anisotropyDirectionScaleBias)) {
        this._anisotropyDirectionScaleBias.set(val);
        this.uniformChanged();
      }
    }
    calculateAnisotropyDirectionScaleBias(scope: PBInsideFunctionScope) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing
        ? scope.$inputs.zAnisotropyDirectionScaleBias
        : scope.zAnisotropyDirectionScaleBias) as PBShaderExp;
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
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
            this.$if(pb.equal(type, LIGHT_TYPE_RECT), function () {
              that.directRectLight(
                this,
                this.worldPos,
                this.normal,
                this.viewVec,
                this.pbrData,
                posRange,
                dirCutoff,
                extra,
                colorIntensity,
                this.lightingColor
              );
            }).$else(function () {
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
        scope.$outputs.zReflectionMode = this.getInstancedUniform(scope, REFLECTION_MODE_UNIFORM);
        scope.$outputs.zAnisotropy = this.getInstancedUniform(scope, ANISOTROPY_UNIFORM);
        scope.$outputs.zAnisotropyDirection = this.getInstancedUniform(scope, ANISOTROPY_DIRECTION_UNIFORM);
        scope.$outputs.zAnisotropyDirectionScaleBias = this.getInstancedUniform(
          scope,
          ANISOTROPY_DIRECTION_SCALE_BIAS_UNIFORM
        );
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
          scope.zReflectionMode = pb.float().uniform(2);
          scope.zAnisotropy = pb.float().uniform(2);
          scope.zAnisotropyDirection = pb.float().uniform(2);
          scope.zAnisotropyDirectionScaleBias = pb.vec2().uniform(2);
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
          bindGroup.setValue('zReflectionMode', PBR_REFLECTION_MODE[this._reflectionMode]);
          bindGroup.setValue('zAnisotropy', this._anisotropy);
          bindGroup.setValue('zAnisotropyDirection', this._anisotropyDirection);
          bindGroup.setValue('zAnisotropyDirectionScaleBias', this._anisotropyDirectionScaleBias);
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
      const reflectionMode = this.calculateReflectionMode(scope) as PBShaderExp;
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
      data.specularWeight = pb.mul(data.specularWeight, pb.float(pb.notEqual(reflectionMode, PBR_REFLECTION_MODE.none)));
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
    calculateReflectionMode(scope: PBInsideFunctionScope) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zReflectionMode : scope.zReflectionMode) as PBShaderExp;
    }
    calculateAnisotropy(scope: PBInsideFunctionScope) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zAnisotropy : scope.zAnisotropy) as PBShaderExp;
    }
    calculateAnisotropyDirection(scope: PBInsideFunctionScope) {
      const instancing = !!(this.drawContext.materialFlags & MaterialVaryingFlags.INSTANCING);
      return (instancing ? scope.$inputs.zAnisotropyDirection : scope.zAnisotropyDirection) as PBShaderExp;
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRMetallicRoughness };
}
