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
import { AbstractPostEffect } from './posteffect';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../shaders';
import { Interpolator, Matrix4x4, Plane, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { Camera } from '../camera';
import { CopyBlitter } from '../blitter';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';

/**
 * The post water effect
 * @public
 */
export class PostWater extends AbstractPostEffect {
  private _elevation: number;
  private _region: Vector4;
  private _gridScale: number;
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
  private _foamWidth: number;
  private _foamContrast: number;
  private _waterAlignment: number;
  private _waterWireframe: boolean;
  private _waterWind: Vector2;
  private _waveLength0: number;
  private _waveStrength0: number;
  private _waveCroppiness0: number;
  private _waveLength1: number;
  private _waveStrength1: number;
  private _waveCroppiness1: number;
  private _waveLength2: number;
  private _waveStrength2: number;
  private _waveCroppiness2: number;
  private _currentWaterMesh: WaterMesh;
  private _targetSize: Vector4;
  private _envMap: TextureCube;
  private _ssr: boolean;
  private _ssrParams: Vector4;
  private _waterMeshes: Record<string, WaterMesh>;
  /**
   * Creates an instance of PostWater.
   * @param elevation - Elevation of the water
   */
  constructor(elevation: number) {
    super();
    this._elevation = elevation ?? 0;
    this._region = new Vector4(-1000, -1000, 1000, 1000);
    this._gridScale = 1;
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
    this._foamWidth = 1.2;
    this._foamContrast = 7.2;
    this._waterWireframe = false;
    this._waterAlignment = 1;
    this._targetSize = new Vector4();
    this._waterWind = new Vector2(2, 2);
    this._waveLength0 = 400;
    this._waveStrength0 = 0.4;
    this._waveCroppiness0 = -1.5;
    this._waveLength1 = 100;
    this._waveStrength1 = 0.4;
    this._waveCroppiness1 = -1.2;
    this._waveLength2 = 15;
    this._waveStrength2 = 0.2;
    this._waveCroppiness2 = -0.5;
    this._currentWaterMesh = null;
    this._envMap = null;
    this._ssr = true;
    this._ssrParams = new Vector4(32, 80, 0.5, 6);
    this._waterMeshes = {};
  }
  get wireframe() {
    return this._waterWireframe;
  }
  set wireframe(val: boolean) {
    this._waterWireframe = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.wireframe = this._waterWireframe;
    }
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
    return this._waterAlignment;
  }
  set alignment(val: number) {
    this._waterAlignment = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.alignment = this._waterAlignment;
    }
  }
  get wind() {
    return this._waterWind;
  }
  set wind(val: Vector2) {
    this._waterWind.set(val);
  }
  get foamWidth() {
    return this._foamWidth;
  }
  set foamWidth(val: number) {
    this._foamWidth = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.foamWidth = this._foamWidth;
    }
  }
  get foamContrast() {
    return this._foamContrast;
  }
  set foamContrast(val: number) {
    this._foamContrast = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.foamContrast = this._foamContrast;
    }
  }
  get waveLength0() {
    return this._waveLength0;
  }
  set waveLength0(val: number) {
    this._waveLength0 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveLength(0, this._waveLength0);
    }
  }
  get waveStrength0() {
    return this._waveStrength0;
  }
  set waveStrength0(val: number) {
    this._waveStrength0 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveStrength(0, this._waveStrength0);
    }
  }
  get waveCroppiness0() {
    return this._waveCroppiness0;
  }
  set waveCroppiness0(val: number) {
    this._waveCroppiness0 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveCroppiness(0, this._waveCroppiness0);
    }
  }
  get waveLength1() {
    return this._waveLength1;
  }
  set waveLength1(val: number) {
    this._waveLength1 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveLength(1, this._waveLength1);
    }
  }
  get waveStrength1() {
    return this._waveStrength1;
  }
  set waveStrength1(val: number) {
    this._waveStrength1 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveStrength(1, this._waveStrength1);
    }
  }
  get waveCroppiness1() {
    return this._waveCroppiness1;
  }
  set waveCroppiness1(val: number) {
    this._waveCroppiness1 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveCroppiness(1, this._waveCroppiness1);
    }
  }
  get waveLength2() {
    return this._waveLength2;
  }
  set waveLength2(val: number) {
    this._waveLength2 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveLength(2, this._waveLength2);
    }
  }
  get waveStrength2() {
    return this._waveStrength2;
  }
  set waveStrength2(val: number) {
    this._waveStrength2 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveStrength(2, this._waveStrength2);
    }
  }
  get waveCroppiness2() {
    return this._waveCroppiness2;
  }
  set waveCroppiness2(val: number) {
    this._waveCroppiness2 = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.setWaveCroppiness(2, this._waveCroppiness2);
    }
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
    return this._elevation;
  }
  set elevation(val: number) {
    this._elevation = val;
  }
  /** Water boundary in world space ( minX, minZ, maxX, maxZ ) */
  get boundary(): Vector4 {
    return this._region;
  }
  set boundary(val: Vector4) {
    this._region.set(val);
    if (this._currentWaterMesh) {
      this._currentWaterMesh.regionMin.setXY(this._region.x, this._region.y);
      this._currentWaterMesh.regionMax.setXY(this._region.z, this._region.w);
    }
  }
  /** Water clipmap grid scale */
  get gridScale(): number {
    return this._gridScale;
  }
  set gridScale(val: number) {
    this._gridScale = val;
    if (this._currentWaterMesh) {
      this._currentWaterMesh.gridScale = this._gridScale;
    }
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
    if (!this._ssr) {
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
      const plane = new Plane(0, -1, 0, this._elevation);
      const clipPlane = new Plane(0, -1, 0, this._elevation - this._antiReflectanceLeak);
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
    waterMesh.regionMin.setXY(this._region.x, this._region.y);
    waterMesh.regionMax.setXY(this._region.z, this._region.w);
    waterMesh.wind = this._waterWind;
    if (waterMesh !== this._currentWaterMesh) {
      waterMesh.wireframe = this._waterWireframe;
      waterMesh.gridScale = this._gridScale;
      waterMesh.alignment = this._waterAlignment;
      waterMesh.foamWidth = this._foamWidth;
      waterMesh.foamContrast = this._foamContrast;
      waterMesh.setWaveLength(0, this._waveLength0);
      waterMesh.setWaveLength(1, this._waveLength1);
      waterMesh.setWaveLength(2, this._waveLength2);
      waterMesh.setWaveStrength(0, this._waveStrength0);
      waterMesh.setWaveStrength(1, this._waveStrength1);
      waterMesh.setWaveStrength(2, this._waveStrength2);
      waterMesh.setWaveCroppiness(0, this._waveCroppiness0);
      waterMesh.setWaveCroppiness(1, this._waveCroppiness1);
      waterMesh.setWaveCroppiness(2, this._waveCroppiness2);
      this._currentWaterMesh = waterMesh;
    }
    waterMesh.bindGroup.setTexture('tex', inputColorTexture);
    waterMesh.bindGroup.setTexture('depthTex', sceneDepthTexture);
    waterMesh.bindGroup.setTexture('rampTex', rampTex);
    if (this._ssr) {
      waterMesh.bindGroup.setTexture('envMap', this._envMap ?? ctx.scene.env.sky.bakedSkyTexture);
      waterMesh.bindGroup.setValue('ssrParams', this._ssrParams);
    } else {
      waterMesh.bindGroup.setTexture('reflectionTex', fbRefl.getColorAttachments()[0]);
    }
    waterMesh.bindGroup.setValue('invViewProj', ctx.camera.invViewProjectionMatrix);
    if (this._ssr) {
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
    waterMesh.bindGroup.setValue('waterLevel', this._elevation);
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
  private _getWaterMesh(ctx: DrawContext) {
    const ssr = ctx.device.type === 'webgl' ? false : this._ssr;
    const hash = `${ctx.sunLight ? 1 : 0}:${ctx.env.light.getHash(ctx)}:${ssr}`;
    let waterMesh = this._waterMeshes[hash];
    if (!waterMesh) {
      const device = ctx.device;
      waterMesh = new WaterMesh(device, {
        setupUniforms(scope: PBGlobalScope) {
          const pb = scope.$builder;
          if (pb.shaderKind === 'fragment') {
            scope.tex = pb.tex2D().uniform(0);
            scope.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
            scope.rampTex = pb.tex2D().uniform(0);
            if (ssr) {
              scope.envMap = pb.texCube().uniform(0);
              scope.ssrParams = pb.vec4().uniform(0);
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
        shading(
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
          pb.func('getPosition', [pb.vec2('uv'), pb.mat4('mat')], function () {
            this.$l.depthValue = pb.textureSampleLevel(this.depthTex, this.uv, 0);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
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
          pb.func('getPositionWS', [pb.vec2('uv')], function () {
            this.$return(this.getPosition(this.uv, this.invViewProj));
          });
          pb.func('getPositionVS', [pb.vec2('uv')], function () {
            this.$return(this.getPosition(this.uv, this.invProjMatrix));
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
            'ssr',
            [
              pb.vec3('viewPos'),
              pb.vec3('viewNormal'),
              pb.float('maxDistance'),
              pb.float('iteration'),
              pb.float('thickness'),
              pb.int('binarySearchSteps')
            ],
            function () {
              this.$l.normalizedViewPos = pb.normalize(this.viewPos);
              this.$l.reflectVec = pb.reflect(this.normalizedViewPos, this.viewNormal);
              this.$l.viewPosEnd = pb.add(this.viewPos, pb.mul(this.reflectVec, this.maxDistance));
              this.$l.fragStartH = pb.mul(this.projMatrix, pb.vec4(this.viewPos, 1));
              this.$l.fragStart = pb.mul(
                pb.add(pb.mul(pb.div(this.fragStartH.xy, this.fragStartH.w), 0.5), pb.vec2(0.5)),
                this.targetSize.xy
              );
              this.$l.fragEndH = pb.mul(this.projMatrix, pb.vec4(this.viewPosEnd, 1));
              this.$l.fragEnd = pb.mul(
                pb.add(pb.mul(pb.div(this.fragEndH.xy, this.fragEndH.w), 0.5), pb.vec2(0.5)),
                this.targetSize.xy
              );
              this.$l.frag = this.fragStart.xy;
              this.$l.deltaX = pb.sub(this.fragEnd.x, this.fragStart.x);
              this.$l.deltaY = pb.sub(this.fragEnd.y, this.fragStart.y);
              this.$l.useX = this.$choice(
                pb.greaterThan(pb.abs(this.deltaX), pb.abs(this.deltaY)),
                pb.float(1),
                pb.float(0)
              );
              this.$l.delta = this.iteration;
              this.$l.increment = pb.div(pb.vec2(this.deltaX, this.deltaY), pb.max(this.delta, 0.001));
              this.$l.search0 = pb.float(0);
              this.$l.search1 = pb.float(0);
              this.$l.hit0 = pb.int(0);
              this.$l.hit1 = pb.int(0);
              this.$l.uv = pb.vec2(0);
              this.$l.depth = pb.float(0);
              this.$l.positionTo = pb.vec3(0);
              this.$for(pb.int('i'), 0, pb.int(this.delta), function () {
                this.frag = pb.add(this.frag, this.increment);
                this.uv = pb.div(this.frag, this.targetSize.xy);
                this.positionTo = this.getPositionVS(this.uv);
                this.search1 = pb.clamp(
                  pb.mix(
                    pb.div(pb.sub(this.frag.y, this.fragStart.y), this.deltaY),
                    pb.div(pb.sub(this.frag.x, this.fragStart.x), this.deltaX),
                    this.useX
                  ),
                  0,
                  1
                );
                this.$l.viewDistance = pb.div(
                  pb.mul(this.viewPos.z, this.viewPosEnd.z),
                  pb.mix(pb.neg(this.viewPosEnd.z), pb.neg(this.viewPos.z), this.search1)
                );
                this.depth = pb.add(this.viewDistance, this.positionTo.z);
                this.$if(
                  pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)),
                  function () {
                    this.hit0 = 1;
                    this.$break();
                  }
                ).$else(function () {
                  this.search0 = this.search1;
                });
              });
              this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
              this.$l.steps = pb.mul(this.binarySearchSteps, this.hit0);
              this.$for(pb.int('i'), 0, this.steps, function () {
                this.$l.frag = pb.mix(this.fragStart.xy, this.fragEnd.xy, this.search1);
                this.uv = pb.div(this.frag, this.targetSize.xy);
                this.positionTo = this.getPositionVS(this.uv);
                this.$l.viewDistance = pb.div(
                  pb.mul(this.viewPos.z, this.viewPosEnd.z),
                  pb.mix(pb.neg(this.viewPosEnd.z), pb.neg(this.viewPos.z), this.search1)
                );
                this.depth = pb.add(this.viewDistance, this.positionTo.z);
                this.$if(
                  pb.and(pb.greaterThan(this.depth, 0), pb.lessThan(this.depth, this.thickness)),
                  function () {
                    this.hit1 = 1;
                    this.search1 = pb.add(this.search0, pb.div(pb.sub(this.search1, this.search0), 2));
                  }
                ).$else(function () {
                  this.$l.tmp = this.search1;
                  this.search1 = pb.add(this.search1, pb.div(pb.sub(this.search1, this.search0), 2));
                  this.search0 = this.tmp;
                });
              });
              this.$l.vis = pb.mul(
                pb.float(this.hit1),
                pb.sub(1, pb.max(pb.dot(pb.neg(this.normalizedViewPos), this.reflectVec), 0)),
                pb.sub(1, pb.clamp(pb.div(this.depth, this.thickness), 0, 1)),

                pb.sub(
                  1,
                  pb.clamp(pb.div(pb.distance(this.positionTo, this.viewPos), this.maxDistance), 0, 1)
                ),

                this.$choice(
                  pb.or(pb.lessThan(this.uv.x, 0), pb.greaterThan(this.uv.x, 1)),
                  pb.float(0),
                  pb.float(1)
                ),
                this.$choice(
                  pb.or(pb.lessThan(this.uv.y, 0), pb.greaterThan(this.uv.y, 1)),
                  pb.float(0),
                  pb.float(1)
                )
              );
              this.vis = pb.clamp(this.vis, 0, 1);
              this.$return(pb.vec3(this.uv, this.vis));
            }
          );
          pb.func(
            'waterShading',
            [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor')],
            function () {
              this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.targetSize.xy);
              this.$l.dist = pb.length(pb.sub(this.worldPos, this.cameraPos));
              this.$l.normalScale = pb.pow(pb.clamp(pb.div(100, this.dist), 0, 1), 4);
              this.$l.myNormal = pb.normalize(
                pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
              );
              this.$l.displacedTexCoord = pb.add(this.screenUV, pb.mul(this.myNormal.xz, this.displace));
              this.$l.wPos = this.getPositionWS(this.displacedTexCoord);
              this.$l.eyeVec = pb.sub(this.wPos.xyz, this.cameraPos);
              this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
              this.$l.surfacePoint = this.worldPos;
              this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.surfacePoint));
              this.$l.wPosRefract = this.getPositionWS(this.displacedTexCoord);
              this.$l.refractionTexCoord = this.$choice(
                pb.greaterThan(this.wPos.y, this.waterLevel),
                this.screenUV,
                this.displacedTexCoord
              );
              this.$l.refraction = pb.textureSampleLevel(this.tex, this.refractionTexCoord, 0).rgb;
              this.refraction = pb.mul(this.refraction, this.getAbsorption(this.depth));
              if (ssr) {
                this.$l.viewPos = pb.mul(this.viewMatrix, pb.vec4(this.worldPos, 1)).xyz;
                this.$l.viewNormal = pb.mul(this.viewMatrix, pb.vec4(this.myNormal, 0)).xyz;
                this.$l.reflectance = pb.vec3();
                this.$l.hitInfo = this.ssr(
                  this.viewPos,
                  this.viewNormal,
                  this.ssrParams.x,
                  this.ssrParams.y,
                  this.ssrParams.z,
                  pb.int(this.ssrParams.w)
                );
                this.$if(pb.greaterThan(this.hitInfo.z, 0), function () {
                  /*
                  this.reflectance = pb.textureSampleLevel(this.tex, this.hitInfo.xy, 0).rgb;
                  */
                  this.reflectance = pb.mix(
                    this.refraction,
                    pb.textureSampleLevel(this.tex, this.hitInfo.xy, 0).rgb,
                    1 /*this.hitInfo.z*/
                  );
                }).$else(function () {
                  this.$l.refl = pb.reflect(
                    pb.normalize(pb.sub(this.surfacePoint, this.cameraPos)),
                    this.myNormal
                  );
                  this.reflectance = pb.textureSampleLevel(this.envMap, this.refl, 0).rgb;
                });
              } else {
                this.$l.reflectance = pb.textureSampleLevel(
                  this.reflectionTex,
                  pb.clamp(this.displacedTexCoord, pb.vec2(0.01), pb.vec2(0.99)),
                  0
                ).rgb;
              }
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
              //this.$return(pb.vec4(pb.vec3(this.wPos.z), 1));
              this.$return(pb.vec4(this.finalColor, 1));
            }
          );
          return pb.getGlobalScope()['waterShading'](worldPos, worldNormal, foamFactor);
        }
      });
      this._waterMeshes[hash] = waterMesh;
    }
    waterMesh.level = this._elevation;
    return waterMesh;
  }
}
