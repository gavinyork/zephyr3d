import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, ShaderTypeFunc } from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import type { IMixinPBRBRDF } from '../pbr/brdf';
import { mixinPBRBRDF } from '../pbr/brdf';
import type { MaterialBlueprintIR } from '../../../utility/blueprint/material/ir';
import { ShaderHelper } from '../../shader/helper';
import type { DrawContext } from '../../../render';
import { getGGXLUT } from '../../../utility/textures/ggxlut';

/**
 * Interface for mixinPBRBluePrint lighting model mixin
 * @public
 */
export type IMixinPBRBluePrint = {
  PBRLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outRoughness?: PBShaderExp
  ): PBShaderExp;
  getCommonData(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNorm: PBShaderExp,
    worldTangent: PBShaderExp,
    worldBinormal: PBShaderExp,
    vertexColor: PBShaderExp,
    ir: MaterialBlueprintIR
  ): PBShaderExp;
  calculateCommonData(
    scope: PBInsideFunctionScope,
    ir: MaterialBlueprintIR,
    worldPos: PBShaderExp,
    worldNorm: PBShaderExp,
    worldTangent: PBShaderExp,
    worldBinormal: PBShaderExp,
    vertexColor: PBShaderExp,
    data: PBShaderExp
  ): void;
  directLighting(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    lightColor: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outColor: PBShaderExp
  ): void;
  indirectLighting(
    scope: PBInsideFunctionScope,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    outColor: PBShaderExp,
    outRoughness?: PBShaderExp
  ): void;
} & IMixinPBRBRDF &
  IMixinLight;

/**
 * PBRBluePrint lighting model mixin
 * @param BaseCls - Class to mix in
 * @returns Mixed class
 * @public
 */
export function mixinPBRBluePrint<T extends typeof MeshMaterial>(BaseCls: T) {
  if ((BaseCls as any).pbrBluePrint) {
    return BaseCls as T & { new (...args: any[]): IMixinPBRBluePrint };
  }
  const S = applyMaterialMixins(BaseCls, mixinPBRBRDF, mixinLight);

  return class extends S {
    static readonly pbrBluePrint = true;
    constructor() {
      super();
    }
    copyFrom(other: this): void {
      super.copyFrom(other);
    }

    getCommonData(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      worldNorm: PBShaderExp,
      worldTangent: PBShaderExp,
      worldBinormal: PBShaderExp,
      vertexColor: PBShaderExp,
      ir: MaterialBlueprintIR
    ): PBShaderExp {
      const pb = scope.$builder;
      const that = this;
      const funcName = 'Z_getCommonData';
      pb.func(funcName, [], function () {
        this.$l.data = that.getCommonDatasStruct(this)();
        that.calculateCommonData(
          this,
          ir,
          worldPos,
          worldNorm,
          worldTangent,
          worldBinormal,
          vertexColor,
          this.data
        );
        this.$return(this.data);
      });
      return scope.$g[funcName]();
    }
    getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc {
      const pb = scope.$builder;
      return pb.defineStruct([
        pb.vec4('f0'),
        pb.vec3('f90'),
        pb.vec4('albedo'),
        pb.vec4('diffuse'),
        pb.float('metallic'),
        pb.float('roughness'),
        pb.vec3('normal'),
        pb.mat3('TBN'),
        pb.vec3('emissive'),
        pb.vec3('specular')
      ]);
    }

    PBRLight(
      scope: PBInsideFunctionScope,
      worldPos: PBShaderExp,
      viewVec: PBShaderExp,
      commonData: PBShaderExp,
      outRoughness?: PBShaderExp
    ): PBShaderExp {
      const pb = scope.$builder;
      const funcName = 'Z_PBRBluePrintLight';
      const that = this;
      pb.func(
        funcName,
        [
          that.getCommonDatasStruct(scope)('pbrData'),
          pb.vec3('viewVec'),
          pb.vec3('worldPos'),
          ...(outRoughness ? [pb.vec4('outRoughness').out()] : [])
        ],
        function () {
          this.$l.lightingColor = pb.vec3(0);
          this.$l.emissiveColor = this.pbrData.emissive;
          if (outRoughness) {
            that.indirectLighting(this, this.viewVec, this.pbrData, this.lightingColor, this.outRoughness);
          } else {
            that.indirectLighting(this, this.viewVec, this.pbrData, this.lightingColor);
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
            this.$l.NoL = pb.clamp(pb.dot(this.pbrData.normal, this.lightDir), 0, 1);
            this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten, this.NoL);
            if (shadow) {
              this.lightColor = pb.mul(this.lightColor, that.calculateShadow(this, this.worldPos, this.NoL));
            }
            that.directLighting(
              this,
              this.lightDir,
              this.lightColor,
              this.viewVec,
              this.pbrData,
              this.lightingColor
            );
          });
          this.$return(pb.vec4(pb.add(this.lightingColor, this.emissiveColor), this.pbrData.albedo.a));
        }
      );
      return outRoughness
        ? pb.getGlobalScope()[funcName](commonData, viewVec, worldPos, outRoughness)
        : pb.getGlobalScope()[funcName](commonData, viewVec, worldPos);
    }
    vertexShader(scope: PBFunctionScope): void {
      super.vertexShader(scope);
    }
    fragmentShader(scope: PBFunctionScope): void {
      const pb = scope.$builder;
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        if (this.drawContext.drawEnvLight) {
          scope.zGGXLut = pb.tex2D().uniform(2);
        }
      }
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      ir: MaterialBlueprintIR,
      worldPos: PBShaderExp,
      worldNorm: PBShaderExp,
      worldTangent: PBShaderExp,
      worldBinormal: PBShaderExp,
      vertexColor: PBShaderExp,
      data: PBShaderExp
    ): void {
      const that = this;
      const pb = scope.$builder;
      const funcName = 'zCalculateCommonDataPBRBluePrint';
      const params: PBShaderExp[] = [
        this.getCommonDatasStruct(scope)('zCommonData').out(),
        pb.vec3('zWorldPos'),
        pb.vec3('zVertexNormal')
      ];
      const paramValues: PBShaderExp[] = [data, worldPos, worldNorm];
      if (worldTangent) {
        params.push(pb.vec3('zVertexTangent'), pb.vec3('zVertexBinormal'));
        paramValues.push(worldTangent, worldBinormal);
      }
      if (vertexColor) {
        params.push(pb.vec4('zVertexColor'));
        paramValues.push(vertexColor);
      }
      pb.func(funcName, params, function () {
        const outputs = ir.create(pb);
        this.zCommonData.albedo = outputs.BaseColor;
        this.zCommonData.metallic = outputs.Metallic;
        this.zCommonData.roughness = outputs.Roughness;
        this.zCommonData.specular = outputs.Specular;
        this.zCommonData.emissive = outputs.Emissive;
        this.zCommonData.f90 = pb.vec3(1);
        this.zCommonData.f0 = pb.vec4(
          pb.mix(
            pb.min(pb.mul(pb.vec3(0.04), this.zCommonData.specular), pb.vec3(1)),
            this.zCommonData.albedo.rgb,
            this.zCommonData.metallic
          ),
          1.5
        );
        if (outputs.Normal) {
          this.zCommonData.normal = outputs.Normal;
          this.zCommonData.TBN = that.calculateTBN(
            this,
            this.zWorldPos,
            this.zCommonData.normal,
            outputs.Tangent instanceof PBShaderExp ? outputs.Tangent : undefined
          );
        } else {
          this.$l.normalInfo = that.calculateNormalAndTBN(
            this,
            this.zWorldPos,
            this.zVertexNormal,
            worldTangent ? this.zVertexTangent : undefined,
            worldBinormal ? this.zVertexBinormal : undefined
          );
          this.zCommonData.normal = this.normalInfo.normal;
          this.zCommonData.TBN = this.normalInfo.TBN;
        }
        this.zCommonData.diffuse = pb.vec4(
          pb.mix(this.zCommonData.albedo.rgb, pb.vec3(0), this.zCommonData.metallic),
          this.zCommonData.albedo.a
        );
      });
      scope[funcName](...paramValues);
    }
    directLighting(
      scope: PBInsideFunctionScope,
      lightDir: PBShaderExp,
      lightColor: PBShaderExp,
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
          pb.vec3('viewVec'),
          that.getCommonDatasStruct(scope)('data'),
          pb.vec3('outColor').inout()
        ],
        function () {
          this.$l.H = pb.normalize(pb.add(this.viewVec, this.L));
          this.$l.NoH = pb.clamp(pb.dot(this.data.normal, this.H), 0, 1);
          this.$l.NoL = pb.clamp(pb.dot(this.data.normal, this.L), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.data.normal, this.viewVec), 0, 1);
          this.$if(pb.greaterThan(this.NoL, 0), function () {
            this.$l.VoH = pb.clamp(pb.dot(this.viewVec, this.H), 0, 1);
            this.$l.schlickFresnel = that.fresnelSchlick(this, this.VoH, this.data.f0.rgb, this.data.f90);
            this.$l.F = this.schlickFresnel;
            this.$l.alphaRoughness = pb.mul(this.data.roughness, this.data.roughness);
            this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
            this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
            this.$l.specular = pb.mul(this.lightColor, this.D, this.V, this.F);
            this.outColor = pb.add(this.outColor, this.specular);
            this.$l.diffuseBRDF = pb.mul(pb.sub(pb.vec3(1), this.F), pb.div(this.data.diffuse.rgb, Math.PI));
            this.$l.diffuse = pb.mul(this.lightColor, pb.max(this.diffuseBRDF, pb.vec3(0)));
            this.outColor = pb.add(this.outColor, this.diffuse);
          });
        }
      );
      scope.$g[funcName](lightDir, lightColor, viewVec, commonData, outColor);
    }
    indirectLighting(
      scope: PBInsideFunctionScope,
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
          this.$l.occlusion = envLightStrength;
          this.$l.NoV = pb.clamp(pb.dot(this.data.normal, this.viewVec), 0.0001, 1);
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
          this.$l.k_S = pb.add(this.data.f0.rgb, pb.mul(this.Fr, pb.pow(pb.sub(1, this.NoV), 5)));
          if (outRoughness || ctx.env.light.envLight.hasRadiance()) {
            this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
            this.$l.specularFactor = pb.mul(this.FssEss, this.occlusion);
            if (outRoughness) {
              this.outRoughness = pb.vec4(this.specularFactor /*this.data.f0.rgb*/, this.data.roughness);
            } else if (ctx.env.light.envLight.hasRadiance()) {
              this.$l.radiance = ctx.env.light.envLight.getRadiance(
                this,
                pb.reflect(pb.neg(this.viewVec), this.data.normal),
                this.data.roughness
              );
              this.outColor = pb.add(this.outColor, pb.mul(this.radiance, this.specularFactor));
            }
          }
          if (ctx.env.light.envLight.hasIrradiance()) {
            this.$l.irradiance = ctx.env.light.envLight.getIrradiance(this, this.data.normal);
            this.$l.mixedF0 = this.data.f0.rgb;
            this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
            this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
            this.$l.F_avg = pb.add(this.mixedF0, pb.div(pb.sub(pb.vec3(1), this.mixedF0), 21));
            this.$l.FmsEms = pb.div(
              pb.mul(this.FssEss, this.F_avg, this.Ems),
              pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems))
            );
            this.$l.k_D = pb.mul(this.data.diffuse.rgb, pb.add(pb.sub(pb.vec3(1), this.FssEss), this.FmsEms));
            this.$l.iblDiffuse = pb.mul(pb.add(this.FmsEms, this.k_D), this.irradiance, this.occlusion);
            this.outColor = pb.add(this.outColor, this.iblDiffuse);
          }
        }
      );
      if (outRoughness) {
        scope.$g[funcName](viewVec, commonData, outColor, outRoughness);
      } else {
        scope.$g[funcName](viewVec, commonData, outColor);
      }
    }
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('zGGXLut', getGGXLUT(1024));
        }
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRBluePrint };
}
