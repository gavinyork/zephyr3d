import type {
  AbstractDevice,
  FrameBuffer,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  TextureCube
} from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { WaterMesh } from '../render';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { WaterShaderImpl } from '../shaders';
import { linearToGamma } from '../shaders';
import { Interpolator, Matrix4x4, Plane, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { Camera } from '../camera';
import { CopyBlitter } from '../blitter';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import type { WaveGenerator } from '../render/wavegenerator';
import { fetchSampler } from '../utility/misc';
import { ShaderHelper } from '../material';

/**
 * The post water effect
 * @public
 */
export class PostWater extends AbstractPostEffect {
  private _reflectSize: number;
  private _copyBlitter: CopyBlitter;
  private _renderingReflections: boolean;
  private _antiReflectanceLeak: number;
  private _displace: number;
  private _depthMulti: number;
  private _refractionStrength: number;
  private _causticsParams: Vector4;
  private _absorptionGrad: Interpolator;
  private _scatterGrad: Interpolator;
  private _rampTex: Texture2D;
  private _targetSize: Vector4;
  private _envMap: TextureCube;
  private _ssr: boolean;
  private _ssrParams: Vector4;
  private _waterImpls: Record<string, WaterShaderImpl>;
  private _waterMesh: WaterMesh;
  /**
   * Creates an instance of PostWater.
   * @param elevation - Elevation of the water
   */
  constructor(elevation: number, waveGenerator: WaveGenerator) {
    super();
    this._reflectSize = 512;
    this._antiReflectanceLeak = 0.5;
    this._layer = PostEffectLayer.opaque;
    this._displace = 16;
    this._depthMulti = 0.1;
    this._refractionStrength = 0;
    this._causticsParams = new Vector4(0.8, 1.0, 1, 0);
    this._copyBlitter = new CopyBlitter();
    this._renderingReflections = false;
    this._absorptionGrad = new Interpolator(
      'linear',
      'vec3',
      new Float32Array([0, 0.082, 0.318, 0.665, 1]),
      new Float32Array([1, 1, 1, 0.22, 0.87, 0.87, 0, 0.47, 0.49, 0, 0.275, 0.44, 0, 0, 0])
    );
    this._scatterGrad = new Interpolator(
      'linear',
      'vec3',
      new Float32Array([0, 0.15, 0.42, 1]),
      new Float32Array([0, 0, 0, 0.08, 0.41, 0.34, 0.13, 0.4, 0.45, 0.21, 0.5, 0.6])
    );
    this._rampTex = null;
    this._targetSize = new Vector4();
    this._envMap = null;
    this._ssr = true;
    this._ssrParams = new Vector4(32, 80, 0.5, 6);
    this._waterImpls = {};
    this._waterMesh = new WaterMesh();
    this._waterMesh.waveImpl = waveGenerator;
    this._waterMesh.wireframe = false;
    this._waterMesh.gridScale = 1;
    this._waterMesh.level = elevation;
  }
  get waveGenerator(): WaveGenerator {
    return this._waterMesh.waveImpl;
  }
  get wireframe() {
    return this._waterMesh.wireframe;
  }
  set wireframe(val: boolean) {
    this._waterMesh.wireframe = val;
  }
  get ssrMaxDistance(): number {
    return this._ssrParams.x;
  }
  set ssrMaxDistance(val: number) {
    this._ssrParams.x = val;
  }
  get causticsSlopeMin(): number {
    return this._causticsParams.x;
  }
  set causticsSlopeMin(val: number) {
    this._causticsParams.x = val;
  }
  get causticsSlopeMax(): number {
    return this._causticsParams.y;
  }
  set causticsSlopeMax(val: number) {
    this._causticsParams.y = val;
  }
  get causticsFalloff(): number {
    return this._causticsParams.z;
  }
  set causticsFalloff(val: number) {
    this._causticsParams.z = val;
  }
  get causticsIntensity(): number {
    return this._causticsParams.w;
  }
  set causticsIntensity(val: number) {
    this._causticsParams.w = val;
  }
  get ssrIterations(): number {
    return this._ssrParams.y;
  }
  set ssrIterations(val: number) {
    this._ssrParams.y = val;
  }
  get ssrThickness(): number {
    return this._ssrParams.z;
  }
  set ssrThickness(val: number) {
    this._ssrParams.z = val;
  }
  /** Refraction strength */
  get refractionStrength(): number {
    return this._refractionStrength;
  }
  set refractionStrength(val: number) {
    this._refractionStrength = val;
  }
  /** Water depth multiply factor */
  get depthMulti(): number {
    return this._depthMulti;
  }
  set depthMulti(val: number) {
    this._depthMulti = val;
  }
  /** Water elevation in world space */
  get elevation(): number {
    return this._waterMesh.level;
  }
  set elevation(val: number) {
    this._waterMesh.level = val;
  }
  /** Water boundary in world space ( minX, minZ, maxX, maxZ ) */
  get boundary(): Vector4 {
    return this._waterMesh.region;
  }
  set boundary(val: Vector4) {
    this._waterMesh.region = val;
  }
  /** Water clipmap grid scale */
  get gridScale(): number {
    return this._waterMesh.gridScale;
  }
  set gridScale(val: number) {
    this._waterMesh.gridScale = val;
  }
  /** Water animation speed factor */
  get speed(): number {
    return this._waterMesh.speed;
  }
  set speed(val: number) {
    this._waterMesh.speed = val;
  }
  /** The amount for increasing the water elevation to reduce leaking artifact */
  get antiReflectanceLeak() {
    return this._antiReflectanceLeak;
  }
  set antiReflectanceLeak(val: number) {
    this._antiReflectanceLeak = val;
  }
  /** Texture displace */
  get displace(): number {
    return this._displace;
  }
  set displace(val: number) {
    this._displace = val;
  }
  /** Environment map */
  get envMap(): TextureCube {
    return this._envMap;
  }
  set envMap(tex: TextureCube) {
    this._envMap = tex;
  }
  /** SSR */
  get ssr(): boolean {
    return this._ssr;
  }
  set ssr(val: boolean) {
    this._ssr = !!val;
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    const ssr = this._ssr; // ctx.device.type === 'webgl' ? false : this._ssr;
    const rampTex = this._getRampTexture(device);
    this._copyBlitter.srgbOut = srgbOutput;
    this._copyBlitter.blit(inputColorTexture, device.getFramebuffer(), fetchSampler('clamp_nearest_nomip'));
    let fbRefl: FrameBuffer;
    if (!ssr) {
      if (this._renderingReflections) {
        return;
      }
      this._renderingReflections = true;
      fbRefl = ctx.device.pool.fetchTemporalFramebuffer(
        true,
        this._reflectSize,
        this._reflectSize,
        inputColorTexture.format,
        ctx.depthFormat,
        false
      );
      const plane = new Plane(0, -1, 0, this._waterMesh.level);
      const clipPlane = new Plane(0, -1, 0, this._waterMesh.level - this._antiReflectanceLeak);
      const matReflectionR = Matrix4x4.invert(Matrix4x4.reflection(-plane.a, -plane.b, -plane.c, -plane.d));
      const reflCamera = new Camera(ctx.scene);
      Matrix4x4.multiply(matReflectionR, ctx.camera.worldMatrix).decompose(
        reflCamera.scale,
        reflCamera.rotation,
        reflCamera.position
      );
      reflCamera.setProjectionMatrix(ctx.camera.getProjectionMatrix());
      reflCamera.clipPlane = clipPlane;
      ctx.device.pushDeviceStates();
      ctx.device.setFramebuffer(fbRefl);
      reflCamera.render(ctx.scene);
      ctx.device.popDeviceStates();
      reflCamera.remove();
      this._renderingReflections = false;
    }
    const cameraNearFar = new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    const waterMesh = this._getWaterMesh(ctx);
    const waterBindGroup = waterMesh.getWaterBindGroup(ctx.device);
    if (!waterBindGroup) {
      return;
    }
    waterBindGroup.setTexture('tex', inputColorTexture);
    waterBindGroup.setTexture('depthTex', ctx.linearDepthTexture);
    waterBindGroup.setTexture('rampTex', rampTex);
    waterBindGroup.setTexture('envMap', this._envMap ?? ctx.scene.env.sky.getBakedSkyTexture(ctx));
    if (ssr) {
      waterBindGroup.setValue('ssrParams', this._ssrParams);
      if (ctx.HiZTexture) {
        waterBindGroup.setTexture('hizTex', ctx.HiZTexture, fetchSampler('clamp_nearest'));
        waterBindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
      }
    } else {
      waterBindGroup.setTexture('reflectionTex', fbRefl.getColorAttachments()[0]);
    }
    waterBindGroup.setValue('invViewProj', ctx.camera.invViewProjectionMatrix);
    waterBindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    waterBindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
    if (ssr) {
      waterBindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    }
    waterBindGroup.setValue('cameraNearFar', cameraNearFar);
    waterBindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    waterBindGroup.setValue('displace', this._displace / inputColorTexture.width);
    waterBindGroup.setValue('depthMulti', this._depthMulti);
    waterBindGroup.setValue('refractionStrength', this._refractionStrength);
    waterBindGroup.setValue('causticsParams', this._causticsParams);
    waterBindGroup.setValue(
      'targetSize',
      this._targetSize.setXYZW(
        device.getFramebuffer().getWidth(),
        device.getFramebuffer().getHeight(),
        ctx.linearDepthTexture.width,
        ctx.linearDepthTexture.height
      )
    );
    waterBindGroup.setValue('waterLevel', this._waterMesh.level);
    waterBindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    if (ctx.sunLight) {
      waterBindGroup.setValue('lightDir', ctx.sunLight.directionAndCutoff.xyz());
      waterBindGroup.setValue('lightShininess', 0.7);
      waterBindGroup.setValue('lightDiffuseAndIntensity', ctx.sunLight.diffuseAndIntensity);
    }
    if (ctx.env.light.envLight) {
      waterBindGroup.setValue('envLightStrength', ctx.env.light.strength);
      ctx.env.light.envLight.updateBindGroup(waterBindGroup);
    }
    waterMesh.render(ctx.device, ctx.camera, this.needFlip(device));
  }
  /** @internal */
  private _getRampTexture(device: AbstractDevice) {
    if (!this._rampTex) {
      const width = 128;
      const height = 64;
      this._rampTex = device.createTexture2D('rgba8unorm', width, height, {
        samplerOptions: { mipFilter: 'none' }
      });
      const numTexels = width * height;
      const data = new Uint8Array(numTexels * 4);
      const tmpcolor = new Vector3();
      for (let i = 0; i < numTexels; i++) {
        const grad = i >= numTexels / 2 ? this._scatterGrad : this._absorptionGrad;
        grad.interpolate((i % width) / width, tmpcolor);
        data[i * 4 + 0] = (tmpcolor.x * 255) >> 0;
        data[i * 4 + 1] = (tmpcolor.y * 255) >> 0;
        data[i * 4 + 2] = (tmpcolor.z * 255) >> 0;
        data[i * 4 + 3] = 255;
      }
      this._rampTex.update(data, 0, 0, this._rampTex.width, this._rampTex.height);
      this._rampTex.name = 'WaterRampTex';
    }
    return this._rampTex;
  }
  /** @internal */
  private _getWaterMesh(ctx: DrawContext): WaterMesh {
    const ssr = this._ssr; // ctx.device.type === 'webgl' ? false : this._ssr;
    const HiZ = ssr && !!ctx.HiZTexture;
    const hash = `${ctx.sunLight ? 1 : 0}:${ctx.env.light.getHash()}:${ssr}:${HiZ}`;
    let impl = this._waterImpls[hash];
    if (!impl) {
      impl = new WaterShaderImpl(
        function (this: WaterShaderImpl, scope: PBGlobalScope) {
          const pb = scope.$builder;
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
            scope.srgbOut = pb.int().uniform(0);
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
        },
        null, //function (this: WaterShaderImpl, scope: PBInsideFunctionScope, pos: PBShaderExp, xz: PBShaderExp) {},
        function (
          this: WaterShaderImpl,
          scope: PBInsideFunctionScope,
          worldPos: PBShaderExp,
          worldNormal: PBShaderExp,
          foamFactor: PBShaderExp,
          discardable: PBShaderExp,
          waveGenerator: WaveGenerator
        ) {
          const pb = scope.$builder;
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
            this.$l.linearDepth = ShaderHelper.sampleLinearDepth(this, this.depthTex, this.uv, 0);
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
              this.$l.wPos = ShaderHelper.samplePositionFromDepth(
                this,
                this.depthTex,
                this.screenUV,
                this.invViewProj,
                this.cameraNearFar
              );
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
                  /*
                  this.$l.thicknessFactor = pb.add(
                    pb.mul(pb.dot(this.incidentVec, this.reflectVecW), 0.5),
                    0.5
                  );
                  this.thicknessFactor = pb.div(
                    this.thicknessFactor,
                    pb.max(pb.mul(pb.length(this.viewPos), 5), 1)
                  );
                  this.thicknessFactor = pb.mul(this.thicknessFactor, 50);
                  this.$l.thickness = pb.mul(this.thicknessFactor, this.ssrParams.z);
                  */
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
              this.displacedPos = ShaderHelper.samplePositionFromDepth(
                this,
                this.depthTex,
                this.refractUV,
                this.invProjMatrix,
                this.cameraNearFar
              );
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
              this.$if(pb.notEqual(this.srgbOut, 0), function () {
                this.finalColor = linearToGamma(this, this.finalColor);
              });
              this.$return(pb.vec4(this.finalColor, 1));
            }
          );
          scope.$if(discardable, function () {
            pb.discard();
          });
          return pb.getGlobalScope()['waterShading'](worldPos, worldNormal, foamFactor);
        }
      );
      this._waterImpls[hash] = impl;
    }
    this._waterMesh.shadingImpl = impl;

    return this._waterMesh;
  }
}
