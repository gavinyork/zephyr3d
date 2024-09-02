import type {
  AbstractDevice,
  FrameBuffer,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  TextureCube,
  TextureSampler
} from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { WaterMesh } from '../render';
import { AbstractPostEffect } from './posteffect';
import { WaterShaderImpl } from '../shaders';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../shaders';
import { Interpolator, Matrix4x4, Plane, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { Camera } from '../camera';
import { CopyBlitter } from '../blitter';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import { Application } from '../app';
import {
  screenSpaceRayTracing_HiZ,
  screenSpaceRayTracing_Linear,
  //screenSpaceRayTracing_Linear,
  screenSpaceRayTracing_VS
} from '../shaders/ssr';

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
  private _absorptionGrad: Interpolator;
  private _scatterGrad: Interpolator;
  private _rampTex: Texture2D;
  private _targetSize: Vector4;
  private _envMap: TextureCube;
  private _ssr: boolean;
  private _ssrParams: Vector4;
  private _waterImpls: Record<string, WaterShaderImpl>;
  private _waterMesh: WaterMesh;
  private _hizdepthTexSampler: TextureSampler;
  /**
   * Creates an instance of PostWater.
   * @param elevation - Elevation of the water
   */
  constructor(elevation: number) {
    super();
    this._reflectSize = 512;
    this._antiReflectanceLeak = 0.5;
    this._opaque = true;
    this._displace = 16;
    this._depthMulti = 0.1;
    this._refractionStrength = 0;
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
    this._hizdepthTexSampler = Application.instance.device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      mipFilter: 'nearest',
      addressU: 'clamp',
      addressV: 'clamp'
    });
    this._waterImpls = {};
    this._waterMesh = new WaterMesh(Application.instance.device);
    this._waterMesh.foamWidth = 1.2;
    this._waterMesh.foamContrast = 7.2;
    this._waterMesh.wireframe = false;
    this._waterMesh.alignment = 1;
    this._waterMesh.wind = new Vector2(2, 2);
    this._waterMesh.gridScale = 1;
    this._waterMesh.level = elevation;
    this._waterMesh.setWaveLength(0, 400);
    this._waterMesh.setWaveStrength(0, 0.4);
    this._waterMesh.setWaveCroppiness(0, -1.5);
    this._waterMesh.setWaveLength(1, 100);
    this._waterMesh.setWaveStrength(1, 0.4);
    this._waterMesh.setWaveCroppiness(1, -1.2);
    this._waterMesh.setWaveLength(2, 15);
    this._waterMesh.setWaveStrength(2, 0.2);
    this._waterMesh.setWaveCroppiness(2, -0.5);
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
  get ssrBinarySearchSteps() {
    return this._ssrParams.w >> 0;
  }
  set ssrBinarySearchSteps(val: number) {
    this._ssrParams.w = val >> 0;
  }
  get alignment() {
    return this._waterMesh.alignment;
  }
  set alignment(val: number) {
    this._waterMesh.alignment = val;
  }
  get wind(): Vector2 {
    return this._waterMesh.wind;
  }
  set wind(val: Vector2) {
    this._waterMesh.wind = val;
  }
  get foamWidth() {
    return this._waterMesh.foamWidth;
  }
  set foamWidth(val: number) {
    this._waterMesh.foamWidth = val;
  }
  get foamContrast() {
    return this._waterMesh.foamContrast;
  }
  set foamContrast(val: number) {
    this._waterMesh.foamContrast = val;
  }
  get waveLength0() {
    return this._waterMesh.getWaveLength(0);
  }
  set waveLength0(val: number) {
    this._waterMesh.setWaveLength(0, val);
  }
  get waveStrength0() {
    return this._waterMesh.getWaveStrength(0);
  }
  set waveStrength0(val: number) {
    this._waterMesh.setWaveStrength(0, val);
  }
  get waveCroppiness0() {
    return this._waterMesh.getWaveCroppiness(0);
  }
  set waveCroppiness0(val: number) {
    this._waterMesh.setWaveCroppiness(0, val);
  }
  get waveLength1() {
    return this._waterMesh.getWaveLength(1);
  }
  set waveLength1(val: number) {
    this._waterMesh.setWaveLength(1, val);
  }
  get waveStrength1() {
    return this._waterMesh.getWaveStrength(1);
  }
  set waveStrength1(val: number) {
    this._waterMesh.setWaveStrength(1, val);
  }
  get waveCroppiness1() {
    return this._waterMesh.getWaveCroppiness(1);
  }
  set waveCroppiness1(val: number) {
    this._waterMesh.setWaveCroppiness(1, val);
  }
  get waveLength2() {
    return this._waterMesh.getWaveLength(2);
  }
  set waveLength2(val: number) {
    this._waterMesh.setWaveLength(2, val);
  }
  get waveStrength2() {
    return this._waterMesh.getWaveStrength(2);
  }
  set waveStrength2(val: number) {
    this._waterMesh.setWaveStrength(2, val);
  }
  get waveCroppiness2() {
    return this._waterMesh.getWaveCroppiness(2);
  }
  set waveCroppiness2(val: number) {
    this._waterMesh.setWaveCroppiness(2, val);
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
    this._copyBlitter.blit(
      inputColorTexture,
      device.getFramebuffer(),
      device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipFilter: 'none',
        addressU: 'clamp',
        addressV: 'clamp'
      })
    );
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
      reflCamera.framebuffer = fbRefl;
      Matrix4x4.multiply(matReflectionR, ctx.camera.worldMatrix).decompose(
        reflCamera.scale,
        reflCamera.rotation,
        reflCamera.position
      );
      reflCamera.setProjectionMatrix(ctx.camera.getProjectionMatrix());
      reflCamera.clipPlane = clipPlane;
      reflCamera.render(ctx.scene, ctx.compositor);
      reflCamera.remove();
      this._renderingReflections = false;
    }
    const cameraNearFar = new Vector2(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    const waterMesh = this._getWaterMesh(ctx);
    waterMesh.bindGroup.setTexture('tex', inputColorTexture);
    waterMesh.bindGroup.setTexture('depthTex', ctx.linearDepthTexture);
    waterMesh.bindGroup.setTexture('rampTex', rampTex);
    waterMesh.bindGroup.setTexture('envMap', this._envMap ?? ctx.scene.env.sky.bakedSkyTexture);
    if (ssr) {
      waterMesh.bindGroup.setValue('ssrParams', this._ssrParams);
      if (ctx.HiZTexture) {
        waterMesh.bindGroup.setTexture('hizTex', ctx.HiZTexture, this._hizdepthTexSampler);
        waterMesh.bindGroup.setValue('depthMipLevels', ctx.HiZTexture.mipLevelCount);
      }
    } else {
      waterMesh.bindGroup.setTexture('reflectionTex', fbRefl.getColorAttachments()[0]);
    }
    waterMesh.bindGroup.setValue('invViewProj', ctx.camera.invViewProjectionMatrix);
    if (ssr) {
      waterMesh.bindGroup.setValue('viewMatrix', ctx.camera.viewMatrix);
      waterMesh.bindGroup.setValue('projMatrix', ctx.camera.getProjectionMatrix());
      waterMesh.bindGroup.setValue('invProjMatrix', Matrix4x4.invert(ctx.camera.getProjectionMatrix()));
    }
    waterMesh.bindGroup.setValue('cameraNearFar', cameraNearFar);
    waterMesh.bindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
    waterMesh.bindGroup.setValue('displace', this._displace / inputColorTexture.width);
    waterMesh.bindGroup.setValue('depthMulti', this._depthMulti);
    waterMesh.bindGroup.setValue('refractionStrength', this._refractionStrength);
    waterMesh.bindGroup.setValue(
      'targetSize',
      this._targetSize.setXYZW(
        device.getFramebuffer().getWidth(),
        device.getFramebuffer().getHeight(),
        inputColorTexture.width,
        inputColorTexture.height
      )
    );
    waterMesh.bindGroup.setValue('waterLevel', this._waterMesh.level);
    waterMesh.bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    if (ctx.sunLight) {
      waterMesh.bindGroup.setValue('lightDir', ctx.sunLight.directionAndCutoff.xyz());
      waterMesh.bindGroup.setValue('lightShininess', 0.7);
      waterMesh.bindGroup.setValue('lightDiffuseAndIntensity', ctx.sunLight.diffuseAndIntensity);
    }
    if (ctx.env.light.envLight) {
      waterMesh.bindGroup.setValue('envLightStrength', ctx.env.light.strength);
      ctx.env.light.envLight.updateBindGroup(waterMesh.bindGroup);
    }
    waterMesh.render(ctx.camera, this.needFlip(device));
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
    const device = ctx.device;
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
            scope.cameraNearFar = pb.vec2().uniform(0);
            scope.cameraPos = pb.vec3().uniform(0);
            scope.invViewProj = pb.mat4().uniform(0);
            if (ssr) {
              scope.viewMatrix = pb.mat4().uniform(0);
              scope.projMatrix = pb.mat4().uniform(0);
              scope.invProjMatrix = pb.mat4().uniform(0);
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
        function (
          this: WaterShaderImpl,
          scope: PBInsideFunctionScope,
          pos: PBShaderExp,
          xz: PBShaderExp,
          useComputeShader: boolean
        ) {},
        function (
          this: WaterShaderImpl,
          scope: PBInsideFunctionScope,
          worldPos: PBShaderExp,
          worldNormal: PBShaderExp,
          foamFactor: PBShaderExp
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
          pb.func('getLinearDepth', [pb.vec2('uv'), pb.float('level')], function () {
            this.$l.depthValue = pb.textureSampleLevel(this.depthTex, this.uv, this.level);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
            this.$return(this.linearDepth);
          });
          pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
            this.$l.linearDepth = this.getLinearDepth(this.uv, 0);
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
            this.$return(pb.div(this.wPos.xyz, this.wPos.w));
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
              this.$l.myNormal = pb.normalize(
                pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
              );
              this.$l.displacedTexCoord = pb.add(this.screenUV, pb.mul(this.myNormal.xz, this.displace));
              this.$l.wPos = this.getPosition(this.displacedTexCoord, this.invViewProj);
              this.$l.eyeVec = pb.sub(this.wPos.xyz, this.cameraPos);
              this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
              this.$l.surfacePoint = this.worldPos;
              this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.surfacePoint));
              this.$l.wPosRefract = this.getPosition(this.displacedTexCoord, this.invViewProj);
              if (ssr) {
                this.$l.viewPos = pb.mul(this.viewMatrix, pb.vec4(this.worldPos, 1)).xyz;
                this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.worldNormal, 0)).xyz;
                this.$l.viewPosNorm = pb.normalize(this.viewPos);
                this.$l.reflectVec = pb.reflect(this.viewPosNorm, this.viewNormal);
                this.$l.reflectance = pb.vec3();
                this.$l.hitInfo = HiZ
                  ? screenSpaceRayTracing_HiZ(
                      this,
                      this.viewPos,
                      this.reflectVec,
                      this.projMatrix,
                      this.ssrParams.x,
                      this.ssrParams.y,
                      this.hizTex
                    )
                  : screenSpaceRayTracing_Linear(
                      this,
                      this.viewPos,
                      this.reflectVec,
                      this.projMatrix,
                      this.cameraNearFar.y,
                      this.ssrParams.x,
                      this.ssrParams.y,
                      this.ssrParams.z,
                      pb.int(this.ssrParams.w),
                      this.depthTex
                    );
                this.$if(pb.greaterThan(this.hitInfo.w, 0), function () {
                  this.reflectance = pb.textureSampleLevel(this.tex, this.hitInfo.xy, 0).rgb;
                }).$else(function () {
                  this.$l.refl = pb.reflect(
                    pb.normalize(pb.sub(this.surfacePoint, this.cameraPos)),
                    this.myNormal
                  );
                  this.refl.y = pb.max(this.refl.y, 0.1);
                  this.reflectance = pb.textureSampleLevel(this.envMap, this.refl, 0).rgb;
                });
                this.$l.t = pb.min(pb.div(this.screenUV.y, 0.5), 1);
                this.$l.refractVec = pb.mix(
                  this.viewPosNorm,
                  pb.refract(this.viewPosNorm, this.viewNormal, 1 / 1.33),
                  this.t
                );
                this.$l.refraction = pb.vec3();
                this.$l.hitInfo = screenSpaceRayTracing_VS(
                  this,
                  this.viewPos,
                  this.refractVec,
                  this.projMatrix,
                  this.cameraNearFar.y,
                  pb.add(pb.mul(this.depth, 2), 10),
                  20,
                  999,
                  pb.int(this.ssrParams.w),
                  this.depthTex
                );
                this.$l.refractUV = this.$choice(
                  pb.greaterThan(this.hitInfo.w, 0),
                  this.hitInfo.xy,
                  this.screenUV
                );
                this.refraction = pb.textureSampleLevel(this.tex, this.refractUV, 0).rgb;
              } else {
                this.$l.refractionTexCoord = this.$choice(
                  pb.greaterThan(this.wPos.y, this.waterLevel),
                  this.screenUV,
                  this.displacedTexCoord
                );
                this.$l.refraction = pb.textureSampleLevel(this.tex, this.refractionTexCoord, 0).rgb;
                this.$l.reflectance = pb.textureSampleLevel(
                  this.reflectionTex,
                  pb.clamp(this.displacedTexCoord, pb.vec2(0.01), pb.vec2(0.99)),
                  0
                ).rgb;
              }
              this.refraction = pb.mul(this.refraction, this.getAbsorption(this.depth));
              this.$l.fresnelTerm = this.fresnel(
                this.myNormal,
                pb.normalize(pb.sub(this.cameraPos, this.surfacePoint))
              );
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
                this.$l.NoH = pb.clamp(pb.dot(this.myNormal, this.halfVec), 0, 1);
                this.$l.NoL = pb.clamp(pb.dot(this.myNormal, this.L), 0, 1);
                this.$l.VoH = pb.clamp(pb.dot(this.V, this.halfVec), 0, 1);
                this.$l.NoV = pb.clamp(pb.dot(this.myNormal, this.V), 0, 1);
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
                const irradiance = ctx.env.light.envLight.getIrradiance(this, this.myNormal);
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
          return pb.getGlobalScope()['waterShading'](worldPos, worldNormal, foamFactor);
        }
      );
      this._waterImpls[hash] = impl;
    }
    this._waterMesh.impl = impl;

    return this._waterMesh;
  }
}
