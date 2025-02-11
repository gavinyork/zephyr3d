import { PBFunctionScope, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { MeshMaterial } from './meshmaterial';
import { GerstnerWaveGenerator, WaveGenerator } from '../render';
import { Ref } from '../app';
import { sampleLinearDepth, screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';

export class WaterMaterial extends MeshMaterial {
  private static FEATURE_SSR = this.defineFeature();
  private _waveGenerator: Ref<WaveGenerator>;
  constructor() {
    super();
    this._waveGenerator = new Ref(new GerstnerWaveGenerator());
    this.useFeature(WaterMaterial.FEATURE_SSR, true);
  }
  get SSR() {
    return this.featureUsed<boolean>(WaterMaterial.FEATURE_SSR);
  }
  set SSR(val: boolean) {
    this.useFeature(WaterMaterial.FEATURE_SSR, !!val);
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const that = this;
    const pb = scope.$builder;
    const init = function (this: PBGlobalScope) {
      this.$outputs.outPos = pb.vec3();
      this.$outputs.outNormal = pb.vec3();
      this.$outputs.outXZ = pb.vec2();
      this.flip = pb.int().uniform(0);
      this.viewProjMatrix = pb.mat4().uniform(0);
      this.modelMatrix = pb.mat4().uniform(1);
      this.gridScale = pb.float().uniform(1);
      this.level = pb.float().uniform(0);
      this.offset = pb.vec2().uniform(1);
      this.scale = pb.float().uniform(1);
      that._waveGenerator.get().setupUniforms(pb.getGlobalScope());
    };
    init.call(pb.getGlobalScope());
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
  }
  private setupUniforms(scope: PBGlobalScope) {
    const pb = scope.$builder;
    const ctx = this.drawContext;
    const ssr = this.SSR;
    const HiZ = ssr && !!ctx.HiZTexture;
    if (pb.shaderKind === 'fragment') {
      scope.tex = pb.tex2D().uniform(0);
      scope.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      scope.rampTex = pb.tex2D().uniform(0);
      scope.envMap = pb.texCube().uniform(0);
      if (ssr) {
        scope.ssrParams = pb.vec4().uniform(0);
        if (HiZ) {
          scope.hizTex = pb.tex2D().uniform(0);
          scope.depthMipLevels = pb.int().uniform(0);
        }
      } else {
        scope.reflectionTex = pb.tex2D().uniform(0);
      }
      scope.displace = pb.float().uniform(0);
      scope.depthMulti = pb.float().uniform(0);
      scope.refractionStrength = pb.float().uniform(0);
      scope.causticsParams = pb.vec4().uniform(0);
      scope.cameraNearFar = pb.vec2().uniform(0);
      scope.cameraPos = pb.vec3().uniform(0);
      scope.invViewProj = pb.mat4().uniform(0);
      scope.invProjMatrix = pb.mat4().uniform(0);
      scope.viewMatrix = pb.mat4().uniform(0);
      if (ssr) {
        scope.projMatrix = pb.mat4().uniform(0);
      }
      scope.targetSize = pb.vec4().uniform(0);
      scope.waterLevel = pb.float().uniform(0);
      if (ctx.sunLight) {
        scope.lightDir = pb.vec3().uniform(0);
        scope.lightShininess = pb.float().uniform(0);
        scope.lightDiffuseAndIntensity = pb.vec4().uniform(0);
      }
    }
    if (ctx.env.light.envLight) {
      scope.envLightStrength = pb.float().uniform(0);
      ctx.env.light.envLight.initShaderBindings(pb);
    }
  }
  shading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp,
    discardable: PBShaderExp
  ) {
    const waveGenerator = this._waveGenerator.get();
    const pb = scope.$builder;
    const ctx = this.drawContext;
    const ssr = this.SSR;
    const HiZ = ssr && !!ctx.HiZTexture;
    pb.func('getAbsorption', [pb.float('depth')], function () {
      this.$l.c = pb.textureSampleLevel(
        this.rampTex,
        pb.vec2(pb.mul(this.depth, this.depthMulti), 0.25),
        0
      ).rgb;
      this.$return(pb.mul(this.c, this.c));
    });
    pb.func('getScattering', [pb.float('depth')], function () {
      this.$l.c = pb.textureSampleLevel(
        this.rampTex,
        pb.vec2(pb.mul(this.depth, this.depthMulti), 0.75),
        0
      ).rgb;
      this.$return(pb.mul(this.c, this.c));
    });
    pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
      this.$l.linearDepth = sampleLinearDepth(this, this.depthTex, this.uv, 0);
      this.$l.nonLinearDepth = pb.div(
        pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
        pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
      );
      this.$l.clipSpacePos = pb.vec4(
        pb.sub(pb.mul(this.uv, 2), pb.vec2(1)),
        pb.sub(pb.mul(pb.clamp(this.nonLinearDepth, 0, 1), 2), 1),
        1
      );
      this.$l.wPos = pb.mul(this.mat, this.clipSpacePos);
      this.$return(pb.vec4(pb.div(this.wPos.xyz, this.wPos.w), this.linearDepth));
    });
    pb.func('fresnel', [pb.vec3('normal'), pb.vec3('eyeVec')], function () {
      this.$return(
        pb.clamp(
          pb.sub(pb.pow(pb.sub(1, pb.dot(this.normal, this.eyeVec)), 5), this.refractionStrength),
          0,
          1
        )
      );
    });
    pb.func(
      'waterShading',
      [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor')],
      function () {
        this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
        this.$l.dist = pb.length(pb.sub(this.worldPos, this.cameraPos));
        this.$l.normalScale = pb.pow(pb.clamp(pb.div(100, this.dist), 0, 1), 2);
        this.$l.normal = pb.normalize(
          pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
        );
        this.$l.displacedTexCoord = pb.add(this.screenUV, pb.mul(this.normal.xz, this.displace));
        this.$l.wPos = this.getPosition(this.screenUV, this.invViewProj).xyz;
        this.$l.eyeVec = pb.sub(this.worldPos.xyz, this.cameraPos);
        this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(this.viewMatrix, pb.vec4(this.worldPos, 1)).xyz;
        if (ssr) {
          this.incidentVec = pb.normalize(pb.sub(this.worldPos, this.cameraPos));
          this.reflectVecW = pb.reflect(this.incidentVec, this.normal);
          this.$l.reflectance = pb.vec3();
          this.$l.hitInfo = pb.vec4(0);
          this.$if(pb.greaterThan(this.reflectVecW.y, 0), function () {
            this.reflectVec = pb.mul(this.viewMatrix, pb.vec4(this.reflectVecW, 0)).xyz;
            this.hitInfo = HiZ
              ? screenSpaceRayTracing_HiZ(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar,
                  this.depthMipLevels,
                  this.ssrParams.y,
                  this.ssrParams.z,
                  this.targetSize,
                  this.hizTex
                )
              : screenSpaceRayTracing_Linear2D(
                  this,
                  this.viewPos,
                  this.reflectVec,
                  this.viewMatrix,
                  this.projMatrix,
                  this.invProjMatrix,
                  this.cameraNearFar,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.ssrParams.z,
                  4,
                  this.targetSize,
                  this.depthTex
                );
          });
          this.$l.refl = pb.reflect(pb.normalize(pb.sub(this.worldPos, this.cameraPos)), this.normal);
          this.refl.y = pb.max(this.refl.y, 0.1);
          this.reflectance = pb.mix(
            pb.textureSampleLevel(this.envMap, this.refl, 0).rgb,
            pb.textureSampleLevel(this.tex, this.hitInfo.xy, 0).rgb,
            this.hitInfo.w
          );
        } else {
          this.$l.reflectance = pb.textureSampleLevel(
            this.reflectionTex,
            pb.clamp(this.displacedTexCoord, pb.vec2(0.01), pb.vec2(0.99)),
            0
          ).rgb;
        }
        this.refractUV = this.displacedTexCoord;
        this.$l.caustics = pb.float(0);
        this.displacedPos = this.getPosition(this.refractUV, this.invProjMatrix);
        this.$if(
          pb.or(
            pb.greaterThanEqual(this.displacedPos.w, 0.99999),
            pb.greaterThan(this.displacedPos.z, this.viewPos.z)
          ),
          function () {
            this.refractUV = this.screenUV;
          }
        ).$else(function () {
          this.depth = pb.length(pb.sub(this.displacedPos.xyz, this.viewPos));
          this.$l.worldPos = this.getPosition(this.refractUV, this.invViewProj);
          this.$l.unprojectedNormal = waveGenerator.calcFragmentNormal(
            this,
            pb.add(this.worldPos.xz, pb.mul(pb.vec2(this.depth), 0.2)),
            this.normal
          );
          this.caustics = pb.sub(
            1,
            pb.smoothStep(this.causticsParams.x, this.causticsParams.y, this.unprojectedNormal.y)
          );
          this.caustics = pb.mul(this.caustics, this.causticsParams.w);
          this.caustics = pb.pow(this.caustics, this.causticsParams.z);
        });
        this.$l.refraction = pb.textureSampleLevel(this.tex, this.refractUV, 0).rgb;
        this.refraction = pb.mul(
          pb.add(this.refraction, pb.vec3(this.caustics)),
          this.getAbsorption(this.depth)
        );

        this.$l.fresnelTerm = this.fresnel(this.normal, pb.neg(this.eyeVecNorm));
        this.$l.finalColor = pb.mix(
          pb.mix(this.refraction, this.reflectance, this.fresnelTerm),
          pb.vec3(1),
          this.foamFactor
        );
        if (ctx.sunLight) {
          this.$l.roughness = pb.float(0.04);
          this.$l.f0 = pb.vec3(0.02);
          this.$l.f90 = pb.vec3(1);
          this.$l.L = pb.neg(this.lightDir);
          this.$l.V = pb.neg(this.eyeVecNorm);
          this.$l.halfVec = pb.normalize(pb.add(this.L, this.V));
          this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
          this.$l.VoH = pb.clamp(pb.dot(this.V, this.halfVec), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.normal, this.V), 0, 1);
          this.$l.F = fresnelSchlick(this, this.VoH, this.f0, this.f90);
          this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
          this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
          this.$l.VIS = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
          this.$l.specular = pb.mul(
            this.D,
            this.VIS,
            this.F,
            this.lightDiffuseAndIntensity.rgb,
            this.lightDiffuseAndIntensity.a
          );
          this.finalColor = pb.add(this.finalColor, this.specular);
        }
        if (ctx.env.light.envLight) {
          const irradiance = ctx.env.light.envLight.getIrradiance(this, this.normal);
          if (irradiance) {
            this.$l.sss = pb.mul(this.getScattering(this.depth), irradiance, this.envLightStrength);
            this.finalColor = pb.add(this.finalColor, this.sss);
          }
        }
        this.$return(pb.vec4(this.finalColor, 1));
      }
    );
    scope.$if(discardable, function () {
      pb.discard();
    });
    return pb.getGlobalScope()['waterShading'](worldPos, worldNormal, foamFactor);
  }
}
