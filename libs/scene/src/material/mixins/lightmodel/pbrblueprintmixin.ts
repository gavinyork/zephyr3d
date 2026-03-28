import type { BindGroup, PBFunctionScope, PBInsideFunctionScope, ShaderTypeFunc } from '@zephyr3d/device';
import type { PBShaderExp } from '@zephyr3d/device';
import type { MeshMaterial } from '../../meshmaterial';
import { applyMaterialMixins } from '../../meshmaterial';
import type { IMixinLight } from '../lit';
import { mixinLight } from '../lit';
import type { IMixinPBRBRDF } from '../pbr/brdf';
import { mixinPBRBRDF } from '../pbr/brdf';
import type { MaterialBlueprintIR } from '../../../utility/blueprint/material/ir';
import { ShaderHelper } from '../../shader/helper';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_RECT } from '../../../values';
import type { DrawContext } from '../../../render';
import { getGGXLUT } from '../../../utility/textures/ggxlut';

const PBR_REFLECTION_MODE = {
  none: 0,
  ggx: 1,
  anisotropic: 2,
  glint: 3
} as const;

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
  getCommonDatasStruct(scope: PBInsideFunctionScope): ShaderTypeFunc;
  getCommonData(
    scope: PBInsideFunctionScope,
    data: PBShaderExp,
    viewVec: PBShaderExp,
    worldPos: PBShaderExp,
    worldNorm: PBShaderExp,
    worldTangent: PBShaderExp,
    worldBinormal: PBShaderExp,
    vertexColor: PBShaderExp,
    vertexUV: PBShaderExp,
    ir: MaterialBlueprintIR
  ): void;
  calculateCommonData(
    scope: PBInsideFunctionScope,
    ir: MaterialBlueprintIR,
    viewVec: PBShaderExp,
    worldPos: PBShaderExp,
    worldNorm: PBShaderExp,
    worldTangent: PBShaderExp,
    worldBinormal: PBShaderExp,
    vertexColor: PBShaderExp,
    vertexUV: PBShaderExp,
    data: PBShaderExp
  ): void;
  directLighting(
    scope: PBInsideFunctionScope,
    lightDir: PBShaderExp,
    lightColor: PBShaderExp,
    viewVec: PBShaderExp,
    commonData: PBShaderExp,
    diffuseScale: PBShaderExp,
    specularScale: PBShaderExp,
    sourceRadiusFactor: PBShaderExp,
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
    copyFrom(other: this) {
      super.copyFrom(other);
    }
    getCommonData(
      scope: PBInsideFunctionScope,
      data: PBShaderExp,
      viewVec: PBShaderExp,
      worldPos: PBShaderExp,
      worldNorm: PBShaderExp,
      worldTangent: PBShaderExp,
      worldBinormal: PBShaderExp,
      vertexColor: PBShaderExp,
      vertexUV: PBShaderExp,
      ir: MaterialBlueprintIR
    ) {
      this.calculateCommonData(
        scope,
        ir,
        viewVec,
        worldPos,
        worldNorm,
        worldTangent,
        worldBinormal,
        vertexColor,
        vertexUV,
        data
      );
    }
    getCommonDatasStruct(scope: PBInsideFunctionScope) {
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
    ) {
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
          that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, extra, shadow) {
            this.$if(pb.equal(type, LIGHT_TYPE_RECT), function () {
              this.$l.center = posRange.xyz;
              this.$l.range = posRange.w;
              this.$l.ax = dirCutoff.xyz;
              this.$l.ay = extra.xyz;
              this.$l.halfWidth = pb.length(this.ax);
              this.$l.halfHeight = pb.length(this.ay);
              this.$l.area = pb.mul(this.halfWidth, this.halfHeight, 4);
              this.$l.lightNormal = pb.normalize(pb.cross(this.ax, this.ay));
              this.lightNormal = pb.neg(this.lightNormal);
              this.$if(pb.greaterThan(this.area, 0), function () {
                this.$l.baseColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.area, 0.25);
                this.$l.samplePos = pb.vec3();
                this.$l.Lvec = pb.vec3();
                this.$l.L = pb.vec3();
                this.$l.dist = pb.float();
                this.$l.invDist2 = pb.float();
                this.$l.NoL = pb.float();
                this.$l.NoL_light = pb.float();
                this.$l.falloff = pb.float();
                this.$l.atten = pb.float();
                this.$l.lightColor = pb.vec3();

                const sample = (u: number, v: number) => {
                  this.samplePos = pb.add(
                    this.center,
                    pb.add(
                      pb.mul(this.ax, pb.sub(pb.mul(u, 2), 1)),
                      pb.mul(this.ay, pb.sub(pb.mul(v, 2), 1))
                    )
                  );
                  this.Lvec = pb.sub(this.samplePos, this.worldPos);
                  this.dist = pb.length(this.Lvec);
                  this.invDist2 = pb.div(1, pb.max(pb.mul(this.dist, this.dist), 0.0001));
                  this.L = pb.normalize(this.Lvec);
                  this.NoL = pb.clamp(pb.dot(this.pbrData.normal, this.L), 0, 1);
                  this.NoL_light = pb.clamp(pb.dot(this.lightNormal, pb.neg(this.L)), 0, 1);
                  this.$if(pb.greaterThan(this.NoL_light, 0), function () {
                    this.falloff = pb.float(1);
                    this.$if(pb.greaterThan(this.range, 0), function () {
                      this.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.range)));
                      this.falloff = pb.mul(this.falloff, this.falloff);
                    });
                    this.atten = pb.mul(this.invDist2, this.NoL_light, this.falloff);
                    this.lightColor = pb.mul(this.baseColor, this.atten, this.NoL);
                    that.directLighting(
                      this,
                      this.L,
                      this.lightColor,
                      this.viewVec,
                      this.pbrData,
                      pb.float(1),
                      pb.float(1),
                      pb.float(0),
                      this.lightingColor
                    );
                  });
                };

                sample(0.25, 0.25);
                sample(0.75, 0.25);
                sample(0.25, 0.75);
                sample(0.75, 0.75);
              });
            }).$else(function () {
              this.$l.diffuse = pb.vec3();
              this.$l.specular = pb.vec3();
              this.$l.diffuseScale = pb.float(1);
              this.$l.specularScale = pb.float(1);
              this.$l.sourceRadiusFactor = pb.float(0);
              this.$if(pb.equal(type, LIGHT_TYPE_POINT), function () {
                this.diffuseScale = extra.x;
                this.specularScale = extra.y;
                this.sourceRadiusFactor = pb.div(
                  extra.z,
                  pb.max(pb.distance(posRange.xyz, this.worldPos), 0.0001)
                );
              });
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
                this.diffuseScale,
                this.specularScale,
                this.sourceRadiusFactor,
                this.lightingColor
              );
            });
          });
          this.$return(pb.vec4(pb.add(this.lightingColor, this.emissiveColor), this.pbrData.albedo.a));
        }
      );
      return (
        outRoughness
          ? pb.getGlobalScope()[funcName](commonData, viewVec, worldPos, outRoughness)
          : pb.getGlobalScope()[funcName](commonData, viewVec, worldPos)
      ) as PBShaderExp;
    }
    vertexShader(scope: PBFunctionScope) {
      super.vertexShader(scope);
    }
    fragmentShader(scope: PBFunctionScope) {
      const pb = scope.$builder;
      super.fragmentShader(scope);
      if (this.needFragmentColor()) {
        scope.zReflectionMode = pb.float().uniform(2);
        if (this.drawContext.drawEnvLight) {
          scope.zGGXLut = pb.tex2D().uniform(2);
        }
      }
    }
    calculateCommonData(
      scope: PBInsideFunctionScope,
      ir: MaterialBlueprintIR,
      viewVec: PBShaderExp,
      worldPos: PBShaderExp,
      worldNorm: PBShaderExp,
      worldTangent: PBShaderExp,
      worldBinormal: PBShaderExp,
      vertexColor: PBShaderExp,
      vertexUV: PBShaderExp,
      data: PBShaderExp
    ) {
      const that = this;
      const pb = scope.$builder;
      const funcName = 'zCalculateCommonDataPBRBluePrint';
      const params: PBShaderExp[] = [
        this.getCommonDatasStruct(scope)('zCommonData').out(),
        pb.vec3('zViewVec'),
        pb.vec3('zWorldPos'),
        pb.vec3('zVertexNormal'),
        pb.vec3('zVertexTangent'),
        pb.vec3('zVertexBinormal'),
        pb.vec4('zVertexColor'),
        pb.vec2('zVertexUV')
      ];
      const paramValues: PBShaderExp[] = [
        data,
        viewVec,
        worldPos,
        worldNorm,
        worldTangent,
        worldBinormal,
        vertexColor,
        vertexUV
      ];
      pb.func(funcName, params, function () {
        const outputs = ir.create(pb)!;
        this.zCommonData.albedo = pb.vec4(
          (that.getOutput(outputs, 'BaseColor') as PBShaderExp)?.rgb ?? pb.vec3(1),
          (that.getOutput(outputs, 'Opacity') as number | PBShaderExp) ?? 1
        );
        this.zCommonData.metallic = that.getOutput(outputs, 'Metallic') ?? 0;
        this.zCommonData.roughness = that.getOutput(outputs, 'Roughness')
          ? pb.mul(
              that.getOutput(outputs, 'Roughness') as number | PBShaderExp,
              ShaderHelper.getCameraRoughnessFactor(scope)
            )
          : ShaderHelper.getCameraRoughnessFactor(scope);
        this.zCommonData.specular = that.getOutput(outputs, 'Specular') ?? pb.vec3(1);
        this.zCommonData.emissive = that.getOutput(outputs, 'Emissive') ?? pb.vec3(0);
        this.zCommonData.f90 = pb.vec3(1);
        this.zCommonData.f0 = pb.vec4(
          pb.mix(
            pb.min(pb.mul(pb.vec3(0.04), this.zCommonData.specular), pb.vec3(1)),
            this.zCommonData.albedo.rgb,
            this.zCommonData.metallic
          ),
          1.5
        );
        this.$l.tangent = that.getOutput(outputs, 'Tangent') ?? this.zVertexTangent;
        this.$l.ng = pb.normalize(this.zVertexNormal);
        this.$l.t_ = pb.normalize(this.tangent);
        this.$l.t = pb.normalize(pb.sub(this.t_, pb.mul(this.ng, pb.dot(this.ng, this.t_))));
        this.$l.b = pb.cross(this.ng, this.t);
        if (that.doubleSidedLighting && that.cullMode !== 'back') {
          this.$if(pb.not(this.$builtins.frontFacing), function () {
            this.t = pb.mul(this.t, -1);
            this.b = pb.mul(this.b, -1);
            this.ng = pb.mul(this.ng, -1);
          });
        }
        this.zCommonData.TBN = pb.mat3(this.t, this.b, this.ng);

        if (that.getOutput(outputs, 'Normal')) {
          this.zCommonData.normal = pb.normalize(
            pb.mul(this.zCommonData.TBN, that.getOutput(outputs, 'Normal') as number | PBShaderExp)
          );
        } else {
          this.zCommonData.normal = this.ng;
        }
        this.zCommonData.diffuse = pb.vec4(
          pb.mix(this.zCommonData.albedo.rgb, pb.vec3(0), this.zCommonData.metallic),
          this.zCommonData.albedo.a
        );
      });
      scope[funcName](...paramValues);
    }
    private getOutput(
      outputs: {
        name: string;
        exp: number | boolean | PBShaderExp;
      }[],
      name: string
    ) {
      return outputs.find((output) => output.name === name)?.exp;
    }
    directLighting(
      scope: PBInsideFunctionScope,
      lightDir: PBShaderExp,
      lightColor: PBShaderExp,
      viewVec: PBShaderExp,
      commonData: PBShaderExp,
      diffuseScale: PBShaderExp,
      specularScale: PBShaderExp,
      sourceRadiusFactor: PBShaderExp,
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
          pb.float('diffuseScale'),
          pb.float('specularScale'),
          pb.float('sourceRadiusFactor'),
          pb.vec3('outColor').inout()
        ],
        function () {
          this.$l.reflectionMode = this.zReflectionMode;
          this.$l.H = pb.normalize(pb.add(this.viewVec, this.L));
          this.$l.NoH = pb.clamp(pb.dot(this.data.normal, this.H), 0, 1);
          this.$l.NoL = pb.clamp(pb.dot(this.data.normal, this.L), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.data.normal, this.viewVec), 0, 1);
          this.$if(pb.greaterThan(this.NoL, 0), function () {
            this.$l.VoH = pb.clamp(pb.dot(this.viewVec, this.H), 0, 1);
            this.$l.schlickFresnel = that.fresnelSchlick(this, this.VoH, this.data.f0.rgb, this.data.f90);
            this.$l.F = this.schlickFresnel;
            this.$l.specularRoughness = pb.clamp(pb.add(this.data.roughness, this.sourceRadiusFactor), 0, 1);
            this.$l.alphaRoughness = pb.mul(this.specularRoughness, this.specularRoughness);
            this.$l.D = that.distributionGGX(this, this.NoH, this.alphaRoughness);
            this.$if(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.anisotropic), function () {
              this.$l.dirAngle = pb.mul(
                pb.add(
                  pb.mul(this.zAnisotropyDirection, this.zAnisotropyDirectionScaleBias.x),
                  this.zAnisotropyDirectionScaleBias.y
                ),
                Math.PI / 180
              );
              this.$l.t0 = pb.normalize(this.data.TBN[0]);
              this.$l.b0 = pb.normalize(this.data.TBN[1]);
              this.$l.tangent = pb.normalize(
                pb.add(pb.mul(this.t0, pb.cos(this.dirAngle)), pb.mul(this.b0, pb.sin(this.dirAngle)))
              );
              this.$l.bitangent = pb.normalize(pb.cross(this.data.normal, this.tangent));
              this.$l.ToH = pb.dot(this.tangent, this.H);
              this.$l.BoH = pb.dot(this.bitangent, this.H);
              this.$l.at = pb.max(pb.mul(this.alphaRoughness, pb.add(1, this.zAnisotropy)), 0.0001);
              this.$l.ab = pb.max(pb.mul(this.alphaRoughness, pb.sub(1, this.zAnisotropy)), 0.0001);
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
            });
            this.$if(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.glint), function () {
              this.$l.glintNoise = pb.fract(
                pb.mul(
                  pb.sin(pb.add(pb.dot(this.H, pb.vec3(127.1, 311.7, 74.7)), pb.mul(this.NoH, 43.1))),
                  43758.5453
                )
              );
              this.$l.glintMask = pb.smoothStep(0.97, 1, this.glintNoise);
              this.D = pb.mul(this.D, pb.add(1, pb.mul(this.glintMask, 8)));
            });
            this.$l.V = that.visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
            this.$l.specular = pb.mul(this.lightColor, this.D, this.V, this.F, this.specularScale);
            this.$if(pb.equal(this.reflectionMode, PBR_REFLECTION_MODE.none), function () {
              this.specular = pb.vec3(0);
            });
            this.outColor = pb.add(this.outColor, this.specular);
            this.$l.diffuseBRDF = pb.mul(pb.sub(pb.vec3(1), this.F), pb.div(this.data.diffuse.rgb, Math.PI));
            this.$l.diffuse = pb.mul(this.lightColor, pb.max(this.diffuseBRDF, pb.vec3(0)), this.diffuseScale);
            this.outColor = pb.add(this.outColor, this.diffuse);
          });
        }
      );
      scope.$g[funcName](
        lightDir,
        lightColor,
        viewVec,
        commonData,
        diffuseScale,
        specularScale,
        sourceRadiusFactor,
        outColor
      );
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
            (!ctx.env!.light.envLight.hasRadiance() && !ctx.env!.light.envLight.hasIrradiance())
          ) {
            return;
          }
          const envLightStrength = ShaderHelper.getEnvLightStrength(this);
          this.$l.occlusion = envLightStrength;
          this.$l.reflectionMode = this.zReflectionMode;
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
          if (outRoughness || ctx.env!.light.envLight.hasRadiance()) {
            this.$l.FssEss = pb.add(pb.mul(this.k_S, this.f_ab.x), pb.vec3(this.f_ab.y));
            this.$l.specularFactor = pb.mul(this.FssEss, this.occlusion);
            this.specularFactor = pb.mul(
              this.specularFactor,
              pb.float(pb.notEqual(this.reflectionMode, PBR_REFLECTION_MODE.none))
            );
            if (outRoughness) {
              this.outRoughness = pb.vec4(this.specularFactor /*this.data.f0.rgb*/, this.data.roughness);
            } else if (ctx.env!.light.envLight.hasRadiance()) {
              this.$l.radiance = ctx.env!.light.envLight.getRadiance(
                this,
                pb.reflect(pb.neg(this.viewVec), this.data.normal),
                this.data.roughness
              );
              this.outColor = pb.add(this.outColor, pb.mul(this.radiance, this.specularFactor));
            }
          }
          if (ctx.env!.light.envLight.hasIrradiance()) {
            this.$l.irradiance = ctx.env!.light.envLight.getIrradiance(this, this.data.normal);
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
    applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
      super.applyUniformValues(bindGroup, ctx, pass);
      if (this.needFragmentColor(ctx)) {
        if (ctx.drawEnvLight) {
          bindGroup.setTexture('zGGXLut', getGGXLUT(1024));
        }
      }
    }
  } as unknown as T & { new (...args: any[]): IMixinPBRBluePrint };
}
