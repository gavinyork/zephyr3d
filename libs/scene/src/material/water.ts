import type {
  AbstractDevice,
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext, WaveGenerator } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { DRef, DWeakRef, Interpolator, Vector3, Vector4 } from '@zephyr3d/base';
import { Application } from '../app';
import { screenSpaceRayTracing_HiZ, screenSpaceRayTracing_Linear2D } from '../shaders/ssr';
import { fetchSampler } from '../utility/misc';
import { mixinLight } from './mixins/lit';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';

export class WaterMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  private static readonly _absorptionGrad = new Interpolator(
    'linear',
    'vec3',
    new Float32Array([0, 0.082, 0.318, 0.665, 1]),
    new Float32Array([1, 1, 1, 0.22, 0.87, 0.87, 0, 0.47, 0.49, 0, 0.275, 0.44, 0, 0, 0])
  );
  private static readonly _scatterGrad = new Interpolator(
    'linear',
    'vec3',
    new Float32Array([0, 0.15, 0.42, 1]),
    new Float32Array([0, 0, 0, 0.08, 0.41, 0.34, 0.13, 0.4, 0.45, 0.21, 0.5, 0.6])
  );
  private static readonly _defaultScatterRampTexture: DWeakRef<Texture2D> = new DWeakRef();
  private static readonly _defaultAbsorptionRampTexture: DWeakRef<Texture2D> = new DWeakRef();
  private static readonly _waveUpdateState: WeakMap<WaveGenerator, number> = new WeakMap();
  private readonly _region: Vector4;
  private _displace: number;
  private _depthMulti: number;
  private _refractionStrength: number;
  private readonly _scatterRampTexture: DRef<Texture2D>;
  private readonly _absorptionRampTexture: DRef<Texture2D>;
  private readonly _waveGenerator: DRef<WaveGenerator>;
  private _waveVersion: number;
  private readonly _clipmapInfo: Vector4;
  private readonly _clipmapGridInfo: Vector4;
  private readonly _ssrParams: Vector4;
  constructor() {
    super();
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapInfo = new Vector4();
    this._clipmapGridInfo = new Vector4();
    this._waveGenerator = new DRef();
    this._waveVersion = -1;
    this._ssrParams = new Vector4(1000, 160, 0.5, 2);
    this._scatterRampTexture = new DRef();
    this._absorptionRampTexture = new DRef();
    this._displace = 16;
    this._depthMulti = 0.1;
    this._refractionStrength = 0;
    this.cullMode = 'none';
    //this.TAADisabled = true;
  }
  dispose() {
    super.dispose();
    this._waveGenerator.dispose();
    this._scatterRampTexture.dispose();
    this._absorptionRampTexture.dispose();
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  get waveGenerator() {
    return this._waveGenerator.get();
  }
  set waveGenerator(waveGenerator: WaveGenerator) {
    if (this._waveGenerator.get() !== waveGenerator) {
      this._waveGenerator.set(waveGenerator);
      this._waveVersion = -1;
      this.optionChanged(true);
    }
  }
  get scatterRampTexture(): Texture2D {
    const tex = this._getScatterRampTexture(Application.instance.device);
    return tex === WaterMaterial._defaultScatterRampTexture.get() ? null : tex;
  }
  set scatterRampTexture(tex: Texture2D) {
    if (tex !== this.scatterRampTexture) {
      this._scatterRampTexture.set(tex);
      this.uniformChanged();
    }
  }
  get absorptionRampTexture(): Texture2D {
    const tex = this._getAbsorptionRampTexture(Application.instance.device);
    return tex === WaterMaterial._defaultAbsorptionRampTexture.get() ? null : tex;
  }
  set absorptionRampTexture(tex: Texture2D) {
    if (tex !== this.absorptionRampTexture) {
      this._absorptionRampTexture.set(tex);
      this.uniformChanged();
    }
  }
  get depthMulti(): number {
    return this._depthMulti;
  }
  set depthMulti(val: number) {
    if (val !== this._depthMulti) {
      this._depthMulti = val;
      this.uniformChanged();
    }
  }
  get displace(): number {
    return this._displace;
  }
  set displace(val: number) {
    if (val !== this._displace) {
      this._displace = val;
      this.uniformChanged();
    }
  }
  get refractionStrength(): number {
    return this._refractionStrength;
  }
  set refractionStrength(val: number) {
    if (val !== this._refractionStrength) {
      this._refractionStrength = val;
      this.uniformChanged();
    }
  }
  needSceneColor(): boolean {
    return true;
  }
  needSceneDepth(): boolean {
    return true;
  }
  protected _createHash(): string {
    return `${super._createHash()}:${this.waveGenerator?.getHash() ?? ''}`;
  }
  setClipmapInfo(rotation: number, scale: number, offsetX: number, offsetY: number) {
    this._clipmapInfo.setXYZW(rotation, scale, offsetX, offsetY);
    this.uniformChanged();
  }
  setClipmapGridInfo(gridScale: number, gridOffsetX: number, gridOffsetY: number) {
    if (
      this._clipmapGridInfo.x !== gridScale ||
      this._clipmapGridInfo.y !== gridOffsetX ||
      this._clipmapGridInfo.z !== gridOffsetY
    ) {
      this._clipmapGridInfo.setXYZW(gridScale, gridOffsetX, gridOffsetY, 0);
      this.uniformChanged();
    }
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return true;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.$inputs.clipmapInfo = pb.vec4().attrib('texCoord0');
    scope.clipmapGridInfo = pb.vec4().uniform(2);

    scope.$l.s = pb.sin(scope.$inputs.clipmapInfo.x);
    scope.$l.c = pb.cos(scope.$inputs.clipmapInfo.x);
    scope.$l.scale2 = pb.mul(scope.$inputs.clipmapInfo.y, scope.clipmapGridInfo.x);
    scope.$l.clipmapMatrix = pb.mat4(
      pb.mul(scope.c, scope.scale2),
      pb.mul(scope.s, scope.scale2),
      0,
      0,
      pb.neg(pb.mul(scope.s, scope.scale2)),
      pb.mul(scope.c, scope.scale2),
      0,
      0,
      0,
      0,
      1,
      0,
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.z, scope.clipmapGridInfo.x), scope.clipmapGridInfo.y),
      pb.sub(pb.mul(scope.$inputs.clipmapInfo.w, scope.clipmapGridInfo.x), scope.clipmapGridInfo.z),
      0,
      1
    );

    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    //scope.$l.level = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(0, 0, 0, 1)).y;
    scope.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz; // pb.vec3(scope.clipmapPos.x, scope.level, scope.clipmapPos.y);
    scope.worldNormal = pb.vec3(0, 1, 0);
    scope.worldPos = scope.clipmapWorldPos;
    this.waveGenerator?.calcVertexPositionAndNormal(
      scope,
      scope.clipmapWorldPos,
      scope.worldPos,
      scope.worldNormal
    );
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    scope.$outputs.worldNormal = scope.worldNormal;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    this.waveGenerator?.setupUniforms(scope, 2);
    scope.region = pb.vec4().uniform(2);
    if (this.needFragmentColor()) {
      scope.displace = pb.float().uniform(2);
      scope.depthMulti = pb.float().uniform(2);
      scope.refractionStrength = pb.float().uniform(2);
      scope.ssrParams = pb.vec4().uniform(2);
      scope.scatterRampTex = pb.tex2D().uniform(2);
      scope.absorptionRampTex = pb.tex2D().uniform(2);
    }
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.worldPos.xz, scope.region.xy)),
      pb.any(pb.greaterThan(scope.$inputs.worldPos.xz, scope.region.zw))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.$l.normal = this.waveGenerator
        ? this.waveGenerator.calcFragmentNormalAndFoam(
            scope,
            scope.$inputs.clipmapPos.xz,
            scope.$inputs.worldNormal
          )
        : pb.vec4(scope.$inputs.worldNormal, 0);
      scope.$l.outColor = pb.vec4(
        this.waterShading(scope, scope.$inputs.worldPos, scope.normal.xyz, scope.normal.w),
        1
      );
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(1),
          scope.outRoughness,
          scope.outColor
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  waterShading(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    worldNormal: PBShaderExp,
    foamFactor: PBShaderExp
  ) {
    const pb = scope.$builder;
    const that = this;
    pb.func('getAbsorption', [pb.float('depth')], function () {
      this.$l.c = pb.textureSampleLevel(
        this.absorptionRampTex,
        pb.vec2(pb.mul(this.depth, this.depthMulti), 0.5),
        0
      ).rgb;
      this.$return(pb.mul(this.c, this.c));
    });
    pb.func('getScattering', [pb.float('depth')], function () {
      this.$l.c = pb.textureSampleLevel(
        this.scatterRampTex,
        pb.vec2(pb.mul(this.depth, this.depthMulti), 0.5),
        0
      ).rgb;
      this.$return(pb.mul(this.c, this.c));
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
      'lightSpecular',
      [pb.vec3('lightDir'), pb.vec3('eyeVecNorm'), pb.vec3('normal'), pb.vec3('lightColor')],
      function () {
        this.$l.roughness = pb.float(0.04);
        this.$l.f0 = pb.vec3(0.02);
        this.$l.f90 = pb.vec3(1);
        this.$l.L = this.lightDir;
        this.$l.V = pb.neg(this.eyeVecNorm);
        this.$l.halfVec = pb.normalize(pb.add(this.L, this.V));
        this.$l.NoH = pb.clamp(pb.dot(this.normal, this.halfVec), 0, 1);
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.L), 0, 1);
        this.$l.specular = pb.vec3(0);
        this.$if(pb.greaterThan(this.NoL, 0), function () {
          this.$l.VoH = pb.clamp(pb.dot(this.V, this.halfVec), 0, 1);
          this.$l.NoV = pb.clamp(pb.dot(this.normal, this.V), 0, 1);
          this.$l.F = fresnelSchlick(this, this.VoH, this.f0, this.f90);
          this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
          this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
          this.$l.VIS = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
          this.specular = pb.mul(this.D, this.VIS, this.F, this.lightColor);
        });
        this.$return(this.specular);
      }
    );
    pb.func(
      'waterShading',
      [pb.vec3('worldPos'), pb.vec3('worldNormal'), pb.float('foamFactor')],
      function () {
        this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(this));
        this.$l.dist = pb.length(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.$l.normalScale = pb.clamp(pb.div(100, this.dist), 0, 1);
        this.$l.normal = pb.normalize(
          pb.mul(this.worldNormal, pb.vec3(this.normalScale, 1, this.normalScale))
        );
        this.$l.displacedTexCoord = pb.add(this.screenUV, pb.mul(this.normal.xz, this.displace));
        this.$l.wPos = ShaderHelper.samplePositionFromDepth(
          this,
          ShaderHelper.getLinearDepthTexture(this),
          this.screenUV,
          ShaderHelper.getInvViewProjectionMatrix(this),
          ShaderHelper.getCameraParams(this).xy
        );
        this.$l.eyeVec = pb.sub(this.worldPos.xyz, ShaderHelper.getCameraPosition(this));
        this.$l.eyeVecNorm = pb.normalize(this.eyeVec);
        this.$l.depth = pb.length(pb.sub(this.wPos.xyz, this.worldPos));
        this.$l.viewPos = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.worldPos, 1)).xyz;
        this.incidentVec = pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this)));
        this.reflectVecW = pb.reflect(this.incidentVec, this.normal);
        this.$l.reflectance = pb.vec3();
        this.$l.hitInfo = pb.vec4(0);
        this.$if(pb.greaterThan(this.reflectVecW.y, 0), function () {
          this.reflectVec = pb.mul(ShaderHelper.getViewMatrix(this), pb.vec4(this.reflectVecW, 0)).xyz;
          this.hitInfo = ShaderHelper.getHiZDepthTexture(this)
            ? screenSpaceRayTracing_HiZ(
                this,
                this.viewPos,
                this.reflectVec,
                ShaderHelper.getViewMatrix(this),
                ShaderHelper.getProjectionMatrix(this),
                ShaderHelper.getInvProjectionMatrix(this),
                ShaderHelper.getCameraParams(this).xy,
                pb.int(ShaderHelper.getHiZDepthTextureMipLevelCount(this)),
                this.ssrParams.y,
                this.ssrParams.z,
                pb.vec4(ShaderHelper.getRenderSize(this), ShaderHelper.getHiZDepthTextureSize(this)),
                ShaderHelper.getHiZDepthTexture(this)
              )
            : screenSpaceRayTracing_Linear2D(
                this,
                this.viewPos,
                this.reflectVec,
                ShaderHelper.getViewMatrix(this),
                ShaderHelper.getProjectionMatrix(this),
                ShaderHelper.getInvProjectionMatrix(this),
                ShaderHelper.getCameraParams(this).xy,
                this.ssrParams.x,
                this.ssrParams.y,
                this.ssrParams.z,
                this.ssrParams.w,
                pb.vec4(ShaderHelper.getRenderSize(this), ShaderHelper.getLinearDepthTextureSize(this)),
                ShaderHelper.getLinearDepthTexture(this)
              );
        });
        this.$l.refl = pb.reflect(
          pb.normalize(pb.sub(this.worldPos, ShaderHelper.getCameraPosition(this))),
          this.normal
        );
        this.refl.y = pb.max(this.refl.y, 0.1);
        this.reflectance = pb.mix(
          pb.textureSampleLevel(ShaderHelper.getBakedSkyTexture(this), this.refl, 0).rgb,
          pb.textureSampleLevel(ShaderHelper.getSceneColorTexture(this), this.hitInfo.xy, 0).rgb,
          this.hitInfo.w
        );
        this.$l.refractUV = this.displacedTexCoord;
        this.$l.displacedPos = ShaderHelper.samplePositionFromDepth(
          this,
          ShaderHelper.getLinearDepthTexture(this),
          this.refractUV,
          ShaderHelper.getInvProjectionMatrix(this),
          ShaderHelper.getCameraParams(this).xy
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
        });
        this.$l.refraction = pb.textureSampleLevel(
          ShaderHelper.getSceneColorTexture(this),
          this.refractUV,
          0
        ).rgb;
        this.refraction = pb.mul(this.refraction, this.getAbsorption(this.depth));
        this.$l.fresnelTerm = this.fresnel(this.normal, pb.neg(this.eyeVecNorm));
        this.$l.finalColor = pb.mix(
          pb.mix(this.refraction, this.reflectance, this.fresnelTerm),
          pb.vec3(1),
          this.foamFactor
        );
        that.forEachLight(this, function (type, posRange, dirCutoff, colorIntensity, shadow) {
          this.$l.lightAtten = that.calculateLightAttenuation(this, type, this.worldPos, posRange, dirCutoff);
          this.$l.lightDir = that.calculateLightDirection(this, type, this.worldPos, posRange, dirCutoff);
          this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
          this.$l.lightContrib = this.lightSpecular(
            this.lightDir,
            this.eyeVecNorm,
            this.normal,
            pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten)
          );
          if (shadow) {
            this.$l.shadow = pb.vec3(that.calculateShadow(this, this.worldPos, this.NoL));
            this.lightContrib = pb.mul(this.lightContrib, this.shadow);
          }
          this.finalColor = pb.add(this.finalColor, this.lightContrib);
        });
        if (that.needCalculateEnvLight()) {
          this.$l.irradiance = that.getEnvLightIrradiance(this, this.normal);
          this.$l.sss = pb.mul(this.getScattering(this.depth), this.irradiance);
          this.finalColor = pb.add(this.finalColor, this.sss);
        }
        this.$return(this.finalColor);
      }
    );
    return scope.waterShading(worldPos, worldNormal, foamFactor);
  }
  applyUniforms(bindGroup: BindGroup, ctx: DrawContext, needUpdate: boolean, pass: number): void {
    super.applyUniforms(bindGroup, ctx, needUpdate, pass);
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator && this._waveVersion !== waveGenerator.version) {
      waveGenerator.applyWaterBindGroup(bindGroup);
      this._waveVersion = waveGenerator.version;
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapGridInfo', this._clipmapGridInfo);
    bindGroup.setValue('region', this._region);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('displace', this._displace / ctx.renderWidth);
      bindGroup.setValue('depthMulti', this._depthMulti);
      bindGroup.setValue('refractionStrength', this._refractionStrength);
      bindGroup.setValue('ssrParams', this._ssrParams);
      bindGroup.setTexture(
        'scatterRampTex',
        this._getScatterRampTexture(ctx.device),
        fetchSampler('clamp_linear_nomip')
      );
      bindGroup.setTexture(
        'absorptionRampTex',
        this._getAbsorptionRampTexture(ctx.device),
        fetchSampler('clamp_linear_nomip')
      );
    }
    if (this.waveGenerator) {
      this.waveGenerator.applyWaterBindGroup(bindGroup);
    }
  }
  needUpdate() {
    return !!this._waveGenerator.get()?.needUpdate();
  }
  update(frameId: number, elapsed: number) {
    const waveGenerator = this._waveGenerator.get();
    if (waveGenerator) {
      const updateFrameId = WaterMaterial._waveUpdateState.get(waveGenerator);
      if (updateFrameId !== frameId) {
        waveGenerator.update(elapsed);
        WaterMaterial._waveUpdateState.set(waveGenerator, frameId);
      }
    }
  }
  private _getRampTexture(device: AbstractDevice, grad: Interpolator) {
    const width = 128;
    const height = 1;
    const texture = device.createTexture2D('rgba8unorm', width, height, {
      samplerOptions: { mipFilter: 'none' }
    });
    const numTexels = width * height;
    const data = new Uint8Array(numTexels * 4);
    const tmpcolor = new Vector3();
    for (let i = 0; i < numTexels; i++) {
      grad.interpolate((i % width) / width, tmpcolor);
      data[i * 4 + 0] = (tmpcolor.x * 255) >> 0;
      data[i * 4 + 1] = (tmpcolor.y * 255) >> 0;
      data[i * 4 + 2] = (tmpcolor.z * 255) >> 0;
      data[i * 4 + 3] = 255;
    }
    texture.update(data, 0, 0, width, height);
    return texture;
  }
  private _getScatterRampTexture(device: AbstractDevice) {
    if (!this._scatterRampTexture.get()) {
      if (!WaterMaterial._defaultScatterRampTexture.get()) {
        WaterMaterial._defaultScatterRampTexture.set(
          this._getRampTexture(device, WaterMaterial._scatterGrad)
        );
      }
      this._scatterRampTexture.set(WaterMaterial._defaultScatterRampTexture.get());
    }
    return this._scatterRampTexture.get();
  }
  private _getAbsorptionRampTexture(device: AbstractDevice) {
    if (!this._absorptionRampTexture.get()) {
      if (!WaterMaterial._defaultAbsorptionRampTexture.get()) {
        WaterMaterial._defaultAbsorptionRampTexture.set(
          this._getRampTexture(device, WaterMaterial._absorptionGrad)
        );
      }
      this._absorptionRampTexture.set(WaterMaterial._defaultAbsorptionRampTexture.get());
    }
    return this._absorptionRampTexture.get();
  }
}
