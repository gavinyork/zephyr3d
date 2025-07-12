import { Application } from '../app/app';
import { decodeNormalizedFloatFromRGBA, linearToGamma } from '../shaders/misc';
import type { AtmosphereParams } from '../shaders';
import {
  aerialPerspective,
  defaultAtmosphereParams,
  getAerialPerspectiveLut,
  getAtmosphereParamsStruct,
  getSkyViewLut,
  getTransmittanceLut,
  renderAtmosphereLUTs,
  skyBox,
  smoothNoise3D,
  transmittanceToSky
} from '../shaders';
import { Quaternion, Vector3 } from '@zephyr3d/base';
import { CubeFace, Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import type { Primitive } from './primitive';
import { BoxShape } from '../shapes';
import { Camera } from '../camera/camera';
import { prefilterCubemap } from '../utility/pmrem';
import type { DirectionalLight } from '../scene';
import {
  type AbstractDevice,
  type BindGroup,
  type FrameBuffer,
  type GPUProgram,
  type RenderStateSet,
  type TextureCube,
  type TextureFormat,
  type VertexLayout
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import { fetchSampler } from '../utility/misc';
import { DRef } from '../app';
import { CubemapSHProjector } from '../utility/shprojector';

/**
 * Type of sky
 *
 * @remarks
 * none - Sky will not be rendered
 * color - Sky will be rendered with a solid color.
 * skybox - Sky will be rendered as box using a preloaded cube texture.
 * scatter - Render dynamic sky with atmospheric scattering.
 *
 * @public
 */
export type SkyType = 'color' | 'skybox' | 'scatter' | 'scatter-nocloud' | 'none';

/**
 * Type of fog
 * @public
 */
export type FogType = 'linear' | 'exp' | 'exp2' | 'scatter' | 'none';

const fogTypeMap: Record<FogType, number> = {
  linear: ShaderHelper.FOG_TYPE_LINEAR,
  exp: ShaderHelper.FOG_TYPE_EXP,
  exp2: ShaderHelper.FOG_TYPE_EXP2,
  scatter: ShaderHelper.FOG_TYPE_SCATTER,
  none: ShaderHelper.FOG_TYPE_NONE
};

const defaultSkyWorldMatrix = Matrix4x4.identity();

/**
 * The sky renderer
 * @public
 */
export class SkyRenderer {
  private static _skyCamera = (() => {
    const camera = new Camera(null);
    camera.setPerspective(Math.PI / 2, 1, 1, 20);
    return camera;
  })();
  private static _programSky: Partial<Record<SkyType, GPUProgram>> = {};
  private static _bindgroupSky: Partial<Record<SkyType, BindGroup>> = {};
  private static _programFog: GPUProgram = null;
  private static _bindgroupFog: BindGroup = null;
  private static _programFogScatter: GPUProgram = null;
  private static _bindgroupFogScatter: BindGroup = null;
  private static _vertexLayout: VertexLayout = null;
  private static _primitiveSky: Primitive = null;
  private static _renderStatesSky: RenderStateSet = null;
  private static _renderStatesSkyNoDepthTest: RenderStateSet = null;
  private static _renderStatesFog: RenderStateSet = null;
  private static _renderStatesFogScatter: RenderStateSet = null;
  private _skyType: SkyType;
  private _skyColor: Vector4;
  private _bakedSkyboxDirty: boolean;
  private _scatterSkyboxTextureWidth: number;
  private _skyboxTexture: DRef<TextureCube>;
  private _bakedSkyboxTexture: DRef<TextureCube>;
  private _bakedSkyboxFrameBuffer: DRef<FrameBuffer>;
  private _radianceMap: DRef<TextureCube>;
  private _radianceFrameBuffer: DRef<FrameBuffer>;
  private _irradianceMap: DRef<TextureCube>;
  private _irradianceSH: Float32Array;
  private _irradianceFrameBuffer: DRef<FrameBuffer>;
  private _radianceMapWidth: number;
  private _irradianceMapWidth: number;
  private _atmosphereParams: AtmosphereParams;
  private _atmosphereExposure: number;
  private _fogType: FogType;
  private _fogColor: Vector4;
  private _fogParams: Vector4;
  private _cloudy: number;
  private _cloudIntensity: number;
  private _debugAerialPerspective: number;
  private _wind: Vector2;
  private _skyWorldMatrix: Matrix4x4;
  private _drawGround: boolean;
  private _lastSunDir: Vector3;
  private _lastSunColor: Vector4;
  private _panoramaAsset: string;
  private _shProjector: CubemapSHProjector;
  private _shWindowWeights: Vector3;
  private _radianceConvSamples: number;
  private _irradianceConvSamples: number;
  /**
   * Creates an instance of SkyRenderer
   */
  constructor() {
    this._skyType = 'scatter';
    this._skyColor = Vector4.zero();
    this._skyboxTexture = new DRef();
    this._bakedSkyboxTexture = new DRef();
    this._bakedSkyboxFrameBuffer = new DRef();
    this._bakedSkyboxDirty = true;
    this._scatterSkyboxTextureWidth = 256;
    this._radianceMap = new DRef();
    this._radianceFrameBuffer = new DRef();
    this._radianceMapWidth = 128;
    this._irradianceMap = new DRef();
    this._irradianceSH = new Float32Array(36);
    this._irradianceFrameBuffer = new DRef();
    this._irradianceMapWidth = 64;
    this._atmosphereParams = { ...defaultAtmosphereParams };
    this._atmosphereExposure = 1;
    this._debugAerialPerspective = 0;
    this._fogType = 'scatter';
    this._fogColor = Vector4.one();
    this._fogParams = new Vector4(1, 100, 50, 0.002);
    this._cloudy = 0.45;
    this._cloudIntensity = 15;
    this._wind = new Vector2(0, 0);
    this._drawGround = false;
    this._skyWorldMatrix = defaultSkyWorldMatrix;
    this._lastSunDir = SkyRenderer._getSunDir(null);
    this._lastSunColor = SkyRenderer._getSunColor(null);
    this._panoramaAsset = '';
    this._shProjector = new CubemapSHProjector(10000, true);
    this._shWindowWeights = new Vector3(1, 0.8, 0.6);
    this._radianceConvSamples = 64;
    this._irradianceConvSamples = 256;
  }
  /** @internal */
  dispose() {
    this._skyboxTexture.dispose();
    this._bakedSkyboxTexture.dispose();
    this._bakedSkyboxFrameBuffer.dispose();
    this._radianceMap.dispose();
    this._radianceFrameBuffer.dispose();
    this._irradianceMap.dispose();
    this._irradianceFrameBuffer.dispose();
  }
  /** @internal */
  getHash(ctx: DrawContext): string {
    return ctx.applyFog === 'scatter' ? '1' : ctx.applyFog ? '2' : '0';
  }
  /** Which type of the sky should be rendered */
  get skyType(): SkyType {
    return this._skyType;
  }
  set skyType(val: SkyType) {
    if (val !== this._skyType) {
      this._skyType = val;
      this.invalidate();
    }
  }
  /** @internal */
  get panoramaTextureAsset() {
    return this._panoramaAsset;
  }
  set panoramaTextureAsset(id: string) {
    this._panoramaAsset = id;
  }
  /** Whether ground should be rendered */
  get drawGround(): boolean {
    return this._drawGround;
  }
  set drawGround(val: boolean) {
    this._drawGround = !!val;
  }
  /** Baked sky texture */
  get bakedSkyTexture(): TextureCube {
    this.updateBakedSkyMap(this._lastSunDir, this._lastSunColor);
    return this._bakedSkyboxTexture.get();
  }
  /**
   * The solid sky color
   */
  get skyColor(): Vector4 {
    return this._skyColor;
  }
  set skyColor(val: Vector4) {
    if (!val.equalsTo(this._skyColor)) {
      this._skyColor.set(val);
      this.invalidate();
    }
  }
  /**
   * Window weights for SH projection
   */
  get shWindowWeights(): Vector3 {
    return this._shWindowWeights;
  }
  set shWindowWeights(weights: Vector3) {
    this._shWindowWeights.set(weights);
    this.invalidate();
  }
  /**
   * Sample count for radiance convolution
   */
  get radianceConvSamples() {
    return this._radianceConvSamples;
  }
  set radianceConvSamples(val: number) {
    if (val !== this._radianceConvSamples) {
      this._radianceConvSamples = val;
      this.invalidate();
    }
  }
  /**
   * Sample count for irradiance convolution
   */
  get irradianceConvSamples() {
    return this._irradianceConvSamples;
  }
  set irradianceConvSamples(val: number) {
    if (val !== this._irradianceConvSamples) {
      this._irradianceConvSamples = val;
      this.invalidate();
    }
  }
  /** Aerial perspective density */
  get aerialPerspectiveDistance() {
    return this._atmosphereParams.apDistance;
  }
  set aerialPerspectiveDistance(val: number) {
    this._atmosphereParams.apDistance = val;
  }
  /** Atmosphere exposure */
  get atmosphereExposure() {
    return this._atmosphereExposure;
  }
  set atmosphereExposure(val) {
    this._atmosphereExposure = val;
  }
  /** Aerial perspective density */
  get cameraHeightScale() {
    return this._atmosphereParams.cameraHeightScale;
  }
  set cameraHeightScale(val: number) {
    this._atmosphereParams.cameraHeightScale = val;
  }
  /**
   * Light density of the sky.
   *
   * @remarks
   * This value controls how much cloud should be rendered when the sky type is scatter.
   * Typically, the value should be in the range of 0 to 1.
   */
  get cloudy(): number {
    return this._cloudy;
  }
  set cloudy(val: number) {
    if (val !== this._cloudy && this._skyType === 'scatter') {
      this._cloudy = val;
      this.invalidate();
    }
  }
  /**
   * Intensity of the sky color
   */
  get cloudIntensity(): number {
    return this._cloudIntensity;
  }
  set cloudIntensity(val: number) {
    if (val !== this._cloudIntensity && this._skyType === 'scatter') {
      this._cloudIntensity = val;
      this.invalidate();
    }
  }
  /**
   * Wind velocity
   *
   * @remarks
   * This value affects the movement of the cloud
   */
  get wind(): Vector2 {
    return this._wind;
  }
  set wind(val: Vector2) {
    this._wind.set(val);
  }
  /**
   * Radiance map of the sky.
   */
  get radianceMap(): TextureCube {
    if (!this._radianceMap.get()) {
      this._radianceMap.set(Application.instance.device.createCubeTexture('rgba16f', this._radianceMapWidth));
      this._radianceMap.get().name = 'SkyRadianceMap';
    }
    return this._radianceMap.get();
  }
  /** @internal */
  get radianceFramebuffer() {
    if (!this._radianceFrameBuffer.get()) {
      this._radianceFrameBuffer.set(Application.instance.device.createFrameBuffer([this.radianceMap], null));
    }
    return this._radianceFrameBuffer.get();
  }
  /**
   * Irradiance map of the sky.
   */
  get irradianceMap(): TextureCube {
    if (!this._irradianceMap.get()) {
      this._irradianceMap.set(
        Application.instance.device.createCubeTexture('rgba16f', this._irradianceMapWidth, {
          samplerOptions: { mipFilter: 'none' }
        })
      );
      this._irradianceMap.get().name = 'SkyIrradianceMap';
    }
    return this._irradianceMap.get();
  }
  /** @internal */
  get irradianceFramebuffer() {
    if (!this._irradianceFrameBuffer.get()) {
      this._irradianceFrameBuffer.set(
        Application.instance.device.createFrameBuffer([this.irradianceMap], null)
      );
    }
    return this._irradianceFrameBuffer.get();
  }
  /**
   * Cube texture for skybox.
   */
  get skyboxTexture(): TextureCube {
    return this._skyboxTexture.get();
  }
  set skyboxTexture(tex: TextureCube) {
    if (tex !== this.skyboxTexture) {
      this._skyboxTexture.set(tex);
      if (this._skyType === 'skybox') {
        this.invalidate();
      }
    }
  }
  /** @internal */
  get skyWorldMatrix(): Matrix4x4 {
    return this._skyWorldMatrix;
  }
  set skyWorldMatrix(val: Matrix4x4) {
    val = val ?? defaultSkyWorldMatrix;
    if (val !== this._skyWorldMatrix) {
      this._skyWorldMatrix = val;
      this.invalidate();
    }
  }
  /** @internal */
  get mappedFogType(): number {
    return fogTypeMap[this._fogType];
  }
  /** Current fog type */
  get fogType(): FogType {
    return this._fogType;
  }
  set fogType(val: FogType) {
    this._fogType = val;
  }
  /** Start distance of linear fog */
  get fogStart(): number {
    return this._fogParams.x;
  }
  set fogStart(val: number) {
    this._fogParams.x = val;
  }
  /** End distance of linear fog */
  get fogEnd(): number {
    return this._fogParams.y;
  }
  set fogEnd(val: number) {
    this._fogParams.y = val;
  }
  /** Top distance of fog if fog type is not scatter */
  get fogTop(): number {
    return this._fogParams.z;
  }
  set fogTop(val: number) {
    this._fogParams.z = val;
  }
  /** Density of exp/exp2 fog */
  get fogDensity(): number {
    return this._fogParams.w;
  }
  set fogDensity(val: number) {
    this._fogParams.w = val;
  }
  /** The fog color if fog type is not scatter */
  get fogColor(): Vector4 {
    return this._fogColor;
  }
  set fogColor(val: Vector4) {
    this._fogColor.set(val);
  }
  /** @internal */
  get fogParams(): Vector4 {
    return this._fogParams;
  }
  set fogParams(val: Vector4) {
    this._fogParams.set(val);
  }
  /** @internal */
  get aerialPerspectiveDebug() {
    return this._debugAerialPerspective;
  }
  set aerialPerspectiveDebug(val: number) {
    this._debugAerialPerspective = val;
  }
  /**
   * Force the radiance map and irradiance map to be regenerated.
   */
  invalidate() {
    this._bakedSkyboxDirty = true;
  }
  /** @internal */
  drawScatteredFog(ctx: DrawContext) {
    return ctx.sunLight && this._fogType === 'scatter';
  }
  /** @internal */
  getAerialPerspectiveLUT(ctx: DrawContext) {
    if (this.drawScatteredFog(ctx)) {
      return getAerialPerspectiveLut();
    } else {
      return null;
    }
  }
  update(ctx: DrawContext) {
    const sunDir = SkyRenderer._getSunDir(ctx.sunLight);
    const sunColor = SkyRenderer._getSunColor(ctx.sunLight);
    if (this._skyType === 'scatter' && (this._wind.x !== 0 || this._wind.y !== 0)) {
      this._bakedSkyboxDirty = true;
    }
    if (!sunDir.equalsTo(this._lastSunDir) || !sunColor.equalsTo(this._lastSunColor)) {
      this._lastSunDir.set(sunDir);
      this._lastSunColor.set(sunColor);
      this._bakedSkyboxDirty = true;
    }
    if (this._bakedSkyboxDirty) {
      this._bakedSkyboxDirty = false;
      this.updateBakedSkyMap(sunDir, sunColor);
      if (true || ctx.scene.env.light.type === 'ibl' || ctx.scene.env.light.type === 'ibl-sh') {
        if (
          ctx.scene.env.light.radianceMap &&
          (ctx.scene.env.light.radianceMap === this.radianceMap ||
            ctx.scene.env.light.irradianceMap === this.irradianceMap ||
            ctx.scene.env.light.irradianceSH === this._irradianceSH)
        ) {
          prefilterCubemap(
            this._bakedSkyboxTexture.get(),
            'ggx',
            this.radianceFramebuffer,
            this._radianceConvSamples
          );
          prefilterCubemap(
            this._bakedSkyboxTexture.get(),
            'lambertian',
            this.irradianceFramebuffer,
            this._irradianceConvSamples
          );
          this._shProjector.shProject(
            this.irradianceFramebuffer.getColorAttachments()[0] as TextureCube,
            this._shWindowWeights,
            this._irradianceSH
          );
          ctx.scene.env.light.irradianceSH = this._irradianceSH;
        }
      }
    }
  }
  renderAtmosphereLUTs(ctx: DrawContext) {
    this._atmosphereParams.lightDir.set(SkyRenderer._getSunDir(ctx.sunLight));
    this._atmosphereParams.lightColor.set(SkyRenderer._getSunColor(ctx.sunLight));
    this._atmosphereParams.lightColor.w *= this._atmosphereExposure;
    this._atmosphereParams.cameraAspect = ctx.camera.getAspect();
    this._atmosphereParams.cameraWorldMatrix.set(ctx.camera.worldMatrix);
    renderAtmosphereLUTs(this._atmosphereParams);
  }
  updateBakedSkyMap(sunDir: Vector3, sunColor: Vector4) {
    if (this._skyType === 'skybox' && this.skyboxTexture) {
      this._bakedSkyboxTexture.set(this.skyboxTexture);
    } else {
      const device = Application.instance.device;
      const texCaps = device.getDeviceCaps().textureCaps;
      const format: TextureFormat =
        texCaps.supportHalfFloatColorBuffer && texCaps.supportLinearHalfFloatTexture
          ? 'rgba16f'
          : texCaps.supportFloatColorBuffer && texCaps.supportLinearFloatTexture
          ? 'rgba32f'
          : 'rgba8unorm';
      const tex =
        this._bakedSkyboxTexture.get() && this._bakedSkyboxTexture.get() !== this.skyboxTexture
          ? this._bakedSkyboxTexture.get()
          : device.createCubeTexture(format, this._scatterSkyboxTextureWidth, {
              samplerOptions: { mipFilter: 'none' }
            });
      tex.name = 'BakedSkyboxTexture';
      if (tex !== this._bakedSkyboxTexture.get()) {
        this._bakedSkyboxFrameBuffer.set(device.createFrameBuffer([tex], null));
      }
      const camera = SkyRenderer._skyCamera;
      const saveRenderStates = device.getRenderStates();
      device.pushDeviceStates();
      device.setFramebuffer(this._bakedSkyboxFrameBuffer.get());
      for (const face of [CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ]) {
        camera.lookAtCubeFace(face);
        this._bakedSkyboxFrameBuffer.get().setColorAttachmentCubeFace(0, face);
        this._renderSky(camera, false, true, true);
      }
      device.popDeviceStates();
      device.setRenderStates(saveRenderStates);
      this._bakedSkyboxTexture.set(tex);
    }
  }
  /** @internal */
  renderAtmosphericFog(ctx: DrawContext) {
    const camera = ctx.camera;
    const sceneDepthTexture = ctx.linearDepthTexture;
    const device = ctx.device;
    const fogProgram = SkyRenderer._programFogScatter;
    const renderStates = SkyRenderer._renderStatesFogScatter;
    const bindgroup = SkyRenderer._bindgroupFogScatter;
    bindgroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindgroup.setValue('rt', device.getFramebuffer() ? 1 : 0);
    bindgroup.setValue('invProjViewMatrix', camera.invViewProjectionMatrix);
    bindgroup.setValue('cameraNearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
    bindgroup.setValue('cameraPosition', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setTexture('apLut', getAerialPerspectiveLut(), fetchSampler('clamp_linear_nomip'));
    bindgroup.setValue(
      'sliceDist',
      this._atmosphereParams.apDistance / this._atmosphereParams.cameraHeightScale
    );
    bindgroup.setValue('params', this._atmosphereParams);
    bindgroup.setValue('debug', this._debugAerialPerspective);
    device.setProgram(fogProgram);
    device.setBindGroup(0, bindgroup);
    device.setVertexLayout(SkyRenderer._vertexLayout);
    device.setRenderStates(renderStates);
    device.draw('triangle-strip', 0, 4);
  }
  /** @internal */
  renderLegacyFog(ctx: DrawContext) {
    const sceneDepthTexture = ctx.linearDepthTexture;
    const camera = ctx.camera;
    const device = ctx.device;
    const bindgroup = SkyRenderer._bindgroupFog;
    bindgroup.setTexture('depthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindgroup.setValue('rt', device.getFramebuffer() ? 1 : 0);
    bindgroup.setValue('invProjViewMatrix', camera.invViewProjectionMatrix);
    bindgroup.setValue('cameraNearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
    bindgroup.setValue('cameraPosition', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setValue('fogType', this.mappedFogType);
    bindgroup.setValue('fogColor', this._fogColor);
    bindgroup.setValue('fogParams', this._fogParams);
    device.setProgram(SkyRenderer._programFog);
    device.setBindGroup(0, bindgroup);
    device.setVertexLayout(SkyRenderer._vertexLayout);
    device.setRenderStates(SkyRenderer._renderStatesFog);
    device.draw('triangle-strip', 0, 4);
  }
  /** @internal */
  renderFog(ctx: DrawContext) {
    const sceneDepthTexture = ctx.linearDepthTexture;
    if (!sceneDepthTexture) {
      return;
    }
    const device = ctx.device;
    const savedRenderStates = device.getRenderStates();
    SkyRenderer._prepareSkyBox(device);
    if (this._skyType === 'scatter') {
      this.renderAtmosphericFog(ctx);
    }
    if (this._fogType !== 'none' && this._fogType !== 'scatter') {
      this.renderLegacyFog(ctx);
    }
    device.setRenderStates(savedRenderStates);
  }
  /** @internal */
  renderSky(ctx: DrawContext) {
    let skyCamera = ctx.camera;
    if (!skyCamera.isPerspective()) {
      skyCamera = SkyRenderer._skyCamera;
      ctx.camera.worldMatrix.decompose(null, skyCamera.rotation, null);
    }
    this._renderSky(skyCamera, true, this._drawGround, this._skyType === 'scatter' && this._cloudy > 0);
  }
  /** @internal */
  private _renderSky(camera: Camera, depthTest: boolean, drawGround: boolean, drawCloud: boolean) {
    const device = Application.instance.device;
    const savedRenderStates = device.getRenderStates();
    SkyRenderer._prepareSkyBox(device);
    if (this._skyType === 'scatter') {
      this._drawScattering(camera, depthTest, drawGround, drawCloud);
    } else if (this._skyType === 'skybox' && this.skyboxTexture) {
      this._drawSkybox(camera, depthTest);
    } else {
      this._drawSkyColor(camera, depthTest);
    }
    device.setRenderStates(savedRenderStates);
  }
  /** @internal */
  private _drawSkyColor(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const bindgroup = SkyRenderer._bindgroupSky.color;
    const p = new Vector3();
    const s = new Vector3();
    const r = new Quaternion();
    camera.viewMatrix.decompose(s, r, p);
    camera.worldMatrix.decompose(s, r, p);
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('color', this._skyColor);
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(SkyRenderer._programSky.color);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(
      depthTest ? SkyRenderer._renderStatesSky : SkyRenderer._renderStatesSkyNoDepthTest
    );
    SkyRenderer._primitiveSky.draw();
  }
  /** @internal */
  private _drawSkybox(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const bindgroup = SkyRenderer._bindgroupSky.skybox;
    bindgroup.setTexture('skyCubeMap', this.skyboxTexture, fetchSampler('clamp_linear_nomip'));
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(SkyRenderer._programSky.skybox);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(
      depthTest ? SkyRenderer._renderStatesSky : SkyRenderer._renderStatesSkyNoDepthTest
    );
    SkyRenderer._primitiveSky.draw();
  }
  /** @internal */
  private _rayIntersectSphere(radius: number, rayStart: Vector3, rayDir: Vector3) {
    const OS = rayStart.magnitude;
    const SH = -Vector3.dot(rayStart, rayDir);
    const OH = Math.sqrt(Math.max(0, OS * OS - SH * SH));
    const PH = Math.sqrt(Math.max(0, radius * radius - OH * OH));
    if (OH > radius) {
      return -1;
    }
    const t1 = SH - PH;
    const t2 = SH + PH;
    return t1 < 0 ? t2 : t1;
  }
  /** @internal */
  sunTransmittance(sunLight: DirectionalLight) {
    const TRANSMITTANCE_SAMPLES = 32;
    const RAYLEIGH_SIGMA = [5.802, 13.558, 33.1];
    const MIE_SIGMA = 3.996;
    const MIE_ABSORPTION_SIGMA = 4.4;
    const OZONE_ABSORPTION_SIGMA = [0.65, 1.881, 0.085];
    function rayleighSc(params: AtmosphereParams, fH: number) {
      const sigma = new Vector3(RAYLEIGH_SIGMA[0] * 1e-6, RAYLEIGH_SIGMA[1] * 1e-6, RAYLEIGH_SIGMA[2] * 1e-6);
      const rho_h = Math.exp(-fH / params.rayleighScatteringHeight);
      return Vector3.scale(sigma, rho_h);
    }
    function mieSc(params: AtmosphereParams, fH: number) {
      const sigma = new Vector3(MIE_SIGMA * 1e-6, MIE_SIGMA * 1e-6, MIE_SIGMA * 1e-6);
      const rho_h = Math.exp(-(fH / params.mieScatteringHeight));
      return Vector3.scale(sigma, rho_h);
    }
    function mieAb(params: AtmosphereParams, fH: number) {
      const sigma = new Vector3(
        MIE_ABSORPTION_SIGMA * 1e-6,
        MIE_ABSORPTION_SIGMA * 1e-6,
        MIE_ABSORPTION_SIGMA * 1e-6
      );
      const rho_h = Math.exp(-(fH / params.mieScatteringHeight));
      return Vector3.scale(sigma, rho_h);
    }
    function ozoneAb(params: AtmosphereParams, fH: number) {
      const sigma = new Vector3(
        OZONE_ABSORPTION_SIGMA[0] * 1e-6,
        OZONE_ABSORPTION_SIGMA[1] * 1e-6,
        OZONE_ABSORPTION_SIGMA[2] * 1e-6
      );
      const rho_h = Math.max(0, 1 - (Math.abs(fH - params.ozoneCenter) * 0.5) / params.ozoneWidth);
      return Vector3.scale(sigma, rho_h);
    }
    const eyePos = new Vector3(
      0,
      this._atmosphereParams.plantRadius + this._atmosphereParams.cameraHeightScale,
      0
    );
    const lightDir = SkyRenderer._getSunDir(sunLight);
    const d = this._rayIntersectSphere(
      this._atmosphereParams.plantRadius + this._atmosphereParams.atmosphereHeight,
      eyePos,
      lightDir
    );
    if (d < 0) {
      return new Vector3(0, 0, 0);
    }
    const ds = d / TRANSMITTANCE_SAMPLES;
    const sum = new Vector3(0, 0, 0);
    const p = Vector3.combine(eyePos, lightDir, 1, ds * 0.5);
    for (let i = 0; i < TRANSMITTANCE_SAMPLES; i++) {
      const h = p.magnitude - this._atmosphereParams.plantRadius;
      const scattering = Vector3.add(rayleighSc(this._atmosphereParams, h), mieSc(this._atmosphereParams, h));
      const absorption = Vector3.add(ozoneAb(this._atmosphereParams, h), mieAb(this._atmosphereParams, h));
      const extinction = Vector3.add(scattering, absorption);
      Vector3.add(sum, Vector3.scale(extinction, ds), sum);
      Vector3.add(p, Vector3.scale(lightDir, ds), p);
    }
    return new Vector3(Math.exp(-sum.x), Math.exp(-sum.y), Math.exp(-sum.z));
  }
  /** @internal */
  private _drawScattering(camera: Camera, depthTest: boolean, drawGround: boolean, drawCloud: boolean) {
    const device = Application.instance.device;
    const tLut = getTransmittanceLut();
    const skyLut = getSkyViewLut();
    //const apLut = ScatteringLut.getAerialPerspectiveLut(alpha, 8000);
    const program = drawCloud ? SkyRenderer._programSky.scatter : SkyRenderer._programSky['scatter-nocloud'];
    const bindgroup = drawCloud
      ? SkyRenderer._bindgroupSky.scatter
      : SkyRenderer._bindgroupSky['scatter-nocloud'];
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('params', this._atmosphereParams);
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setTexture('tLut', tLut, fetchSampler('clamp_linear_nomip'));
    bindgroup.setTexture('skyLut', skyLut, fetchSampler('clamp_linear_nomip'));
    if (drawCloud) {
      bindgroup.setValue('cloudy', this._cloudy);
      bindgroup.setValue('cloudIntensity', this._cloudIntensity);
      bindgroup.setValue('time', device.frameInfo.elapsedOverall * 0.001);
      bindgroup.setValue('velocity', this._wind);
    }
    bindgroup.setValue('drawGround', drawGround ? 1 : 0);
    device.setProgram(program);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(
      depthTest ? SkyRenderer._renderStatesSky : SkyRenderer._renderStatesSkyNoDepthTest
    );
    SkyRenderer._primitiveSky.draw();
  }
  /** @internal */
  private static _prepareSkyBox(device: AbstractDevice) {
    if (!this._programFogScatter) {
      this._programFogScatter = device.buildRenderProgram({
        label: 'FogScatter',
        vertex(pb) {
          this.rt = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$if(pb.notEqual(this.rt, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            }
          });
        },
        fragment(pb) {
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.invProjViewMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.cameraPosition = pb.vec3().uniform(0);
          this.apLut = pb.tex2D().uniform(0);
          this.sliceDist = pb.float().uniform(0);
          this.params = getAtmosphereParamsStruct(pb)().uniform(0);
          this.debug = pb.int().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
            this.$l.nonLinearDepth = pb.div(
              pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
              pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
            );
            //this.$l.clipSpacePos = pb.vec4(pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)), this.nonLinearDepth, 1);
            this.$l.clipSpacePos = pb.vec4(
              pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
              pb.sub(pb.mul(this.nonLinearDepth, 2), 1),
              1
            );
            this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
            this.$l.hPos = pb.div(this.$l.hPos, this.$l.hPos.w);
            this.$l.debugValue = pb.vec4();
            this.$outputs.outColor = aerialPerspective(
              this,
              this.$inputs.uv,
              this.params,
              this.cameraPosition,
              this.hPos.xyz,
              this.sliceDist,
              pb.vec3(32, 32, 32),
              this.debugValue,
              this.apLut
            );
            this.$if(pb.equal(this.debug, 1), function () {
              this.$outputs.outColor.a = 1;
            })
              .$elseif(pb.equal(this.debug, 2), function () {
                this.$outputs.outColor = pb.vec4(pb.vec3(pb.sub(1, this.$outputs.outColor.a)), 1);
              })
              .$elseif(pb.equal(this.debug, 3), function () {
                this.$outputs.outColor = pb.vec4(pb.vec3(this.debugValue.r), 1);
              })
              .$elseif(pb.equal(this.debug, 4), function () {
                this.$outputs.outColor = pb.vec4(this.debugValue.zw, 0, 1);
              });
          });
        }
      });
      this._bindgroupFogScatter = device.createBindGroup(this._programFogScatter.bindGroupLayouts[0]);
    }
    if (!this._programFog) {
      this._programFog = device.buildRenderProgram({
        label: 'Fog',
        vertex(pb) {
          this.rt = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$if(pb.notEqual(this.rt, 0), function () {
                this.$builtins.position.y = pb.neg(this.$builtins.position.y);
              });
            }
          });
        },
        fragment(pb) {
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.invProjViewMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.cameraPosition = pb.vec3().uniform(0);
          this.fogType = pb.int().uniform(0);
          this.fogColor = pb.vec4().uniform(0);
          this.fogParams = pb.vec4().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv);
            if (device.type === 'webgl') {
              this.$l.linearDepth = decodeNormalizedFloatFromRGBA(this, this.depthValue);
            } else {
              this.$l.linearDepth = this.depthValue.r;
            }
            this.$l.nonLinearDepth = pb.div(
              pb.sub(pb.div(this.cameraNearFar.x, this.linearDepth), this.cameraNearFar.y),
              pb.sub(this.cameraNearFar.x, this.cameraNearFar.y)
            );
            //this.$l.clipSpacePos = pb.vec4(pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)), this.nonLinearDepth, 1);
            this.$l.clipSpacePos = pb.vec4(
              pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
              pb.sub(pb.mul(this.nonLinearDepth, 2), 1),
              1
            );
            this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
            this.$l.hPos = pb.div(this.$l.hPos, this.$l.hPos.w);
            this.$l.viewDir = pb.sub(this.hPos.xyz, this.cameraPosition);
            this.$l.fogFactor = ShaderHelper.computeFogFactor(
              this,
              this.viewDir,
              this.fogType,
              this.fogParams
            );
            this.$l.color = pb.mul(this.fogColor.rgb, this.fogFactor);
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color, this.fogFactor);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), this.fogFactor);
            });
          });
        }
      });
      this._bindgroupFog = device.createBindGroup(this._programFog.bindGroupLayouts[0]);
    }
    if (!this._programSky.color) {
      this._programSky.color = device.buildRenderProgram({
        label: 'SolidColorSky',
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.worldMatrix = pb.mat4().uniform(0);
          this.viewProjMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          pb.main(function () {
            this.$l.worldDirection = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz;
            this.$builtins.position = pb.mul(
              this.viewProjMatrix,
              pb.vec4(pb.add(this.worldDirection, this.cameraPos), 1)
            );
            this.$builtins.position.z = this.$builtins.position.w;
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.color = pb.vec4().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          pb.main(function () {
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color.rgb, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color.rgb), 1);
            });
          });
        }
      });
      this._bindgroupSky.color = device.createBindGroup(this._programSky.color.bindGroupLayouts[0]);
    }
    if (!this._programSky.scatter) {
      this._programSky.scatter = SkyRenderer._createScatterProgram(device, true);
      this._bindgroupSky.scatter = device.createBindGroup(this._programSky.scatter.bindGroupLayouts[0]);
    }
    if (!this._programSky['scatter-nocloud']) {
      this._programSky['scatter-nocloud'] = SkyRenderer._createScatterProgram(device, false);
      this._bindgroupSky['scatter-nocloud'] = device.createBindGroup(
        this._programSky['scatter-nocloud'].bindGroupLayouts[0]
      );
    }
    if (!this._programSky.skybox) {
      this._programSky.skybox = device.buildRenderProgram({
        label: 'SkyBoxSky',
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.$outputs.texCoord = pb.vec3();
          this.worldMatrix = pb.mat4().uniform(0);
          this.viewProjMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.flip = pb.vec4().uniform(0);
          pb.main(function () {
            this.$outputs.texCoord = this.$inputs.pos;
            this.$l.worldPos = pb.add(
              this.cameraPos,
              pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz
            );
            this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.worldPos, 1), this.flip);
            this.$builtins.position.z = this.$builtins.position.w;
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.skyCubeMap = pb.texCube().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          pb.main(function () {
            this.$l.texCoord = pb.normalize(this.$inputs.texCoord);
            this.$l.color = pb.textureSampleLevel(this.skyCubeMap, this.texCoord, 0).rgb;
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
            });
          });
        }
      });
      this._bindgroupSky.skybox = device.createBindGroup(this._programSky.skybox.bindGroupLayouts[0]);
    }
    if (!this._renderStatesSky) {
      this._renderStatesSky = device.createRenderStateSet();
      this._renderStatesSky.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('le');
      this._renderStatesSky.useRasterizerState().setCullMode('none');
    }
    if (!this._renderStatesSkyNoDepthTest) {
      this._renderStatesSkyNoDepthTest = device.createRenderStateSet();
      this._renderStatesSkyNoDepthTest.useDepthState().enableTest(false).enableWrite(false);
      this._renderStatesSkyNoDepthTest.useRasterizerState().setCullMode('none');
    }
    if (!this._renderStatesFog) {
      this._renderStatesFog = device.createRenderStateSet();
      this._renderStatesFog.useRasterizerState().setCullMode('none');
      this._renderStatesFog.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      this._renderStatesFog.useDepthState().enableTest(false).enableWrite(false);
    }
    if (!this._renderStatesFogScatter) {
      this._renderStatesFogScatter = device.createRenderStateSet();
      this._renderStatesFogScatter.useRasterizerState().setCullMode('none');
      this._renderStatesFogScatter.useBlendingState().enable(true).setBlendFunc('one', 'inv-src-alpha');
      this._renderStatesFogScatter.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('gt');
    }
    if (!this._vertexLayout) {
      this._vertexLayout = device.createVertexLayout({
        vertexBuffers: [
          {
            buffer: device.createVertexBuffer(
              'position_f32x2',
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
            )
          }
        ]
      });
    }
    if (!this._primitiveSky) {
      this._primitiveSky = new BoxShape({ size: 8 });
    }
  }
  /** @internal */
  private static _getSunDir(sunLight: DirectionalLight) {
    // TODO: reduce GC
    return sunLight?.directionAndCutoff.xyz().scaleBy(-1) ?? ShaderHelper.defaultSunDir;
  }
  /** @internal */
  private static _getSunColor(sunLight: DirectionalLight) {
    // TODO: reduce GC
    return sunLight?.diffuseAndIntensity ?? new Vector4(1, 1, 1, 10);
  }
  private static _createScatterProgram(device: AbstractDevice, cloud: boolean) {
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.worldMatrix = pb.mat4().uniform(0);
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.flip = pb.vec4().uniform(0);
        pb.main(function () {
          this.$outputs.worldDirection = pb.mul(this.worldMatrix, pb.vec4(this.$inputs.pos, 0)).xyz;
          this.$builtins.position = pb.mul(
            this.viewProjMatrix,
            pb.vec4(pb.add(this.$outputs.worldDirection, this.cameraPos), 1),
            this.flip
          );
          this.$builtins.position.z = this.$builtins.position.w;
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        this.tLut = pb.tex2D().uniform(0);
        this.skyLut = pb.tex2D().uniform(0);
        this.params = getAtmosphereParamsStruct(pb)().uniform(0);
        if (cloud) {
          this.cloudy = pb.float().uniform(0);
          this.cloudIntensity = pb.float().uniform(0);
          this.time = pb.float().uniform(0);
          this.velocity = pb.vec2().uniform(0);
        }
        this.drawGround = pb.int().uniform(0);
        this.srgbOut = pb.int().uniform(0);
        pb.func('noise', [pb.vec3('p'), pb.float('t')], function () {
          this.p2 = pb.mul(this.p, 0.25);
          this.f = pb.mul(smoothNoise3D(this, this.p2), 0.5);
          this.p2 = pb.mul(this.p2, 3.02);
          this.p2.y = pb.sub(this.p2.y, pb.mul(this.t, 0.02));
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.25));
          this.p2 = pb.mul(this.p2, 3.03);
          this.p2.y = pb.add(this.p2.y, pb.mul(this.t, 0.01));
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.125));
          this.p2 = pb.mul(this.p2, 3.02);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.0625));
          this.p2 = pb.mul(this.p2, 3.01);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.03125));
          this.p2 = pb.mul(this.p2, 3.01);
          this.f = pb.add(this.f, pb.mul(smoothNoise3D(this, this.p2), 0.015625));
          this.$return(this.f);
        });
        pb.main(function () {
          this.$l.rayDir = pb.normalize(this.$inputs.worldDirection);
          this.$l.sunDir = this.params.lightDir;
          // ad-hoc
          this.$l.sunIntensity = pb.sqrt(pb.max(0, pb.mul(this.sunDir.y, this.rayDir.y)));
          // sun color
          this.$l.sunTransmittance = transmittanceToSky(
            this,
            this.params,
            pb.vec3(0, pb.add(this.params.cameraHeightScale, this.params.plantRadius), 0),
            this.sunDir,
            this.tLut
          );
          this.$l.sunColor = pb.mul(this.params.lightColor, pb.vec4(this.sunTransmittance, 1));

          // compute cloud
          if (cloud) {
            this.$l.noiseValue = pb.float();
            this.$if(pb.lessThanEqual(this.rayDir.y, 0), function () {
              this.noiseValue = 0;
            }).$else(function () {
              this.$l.tMin = pb.div(3000, this.rayDir.y);
              this.$l.cloudPoint = pb.mul(this.rayDir, this.tMin);
              this.speed = pb.mul(pb.vec3(this.velocity.x, 0, this.velocity.y), this.time);
              this.$l.noiseScale = pb.float(4e-4);
              this.noiseValue = this.noise(
                pb.mul(pb.add(this.cloudPoint, this.speed), this.noiseScale),
                this.time
              );
              this.noiseValue = pb.add(this.noiseValue, this.cloudy);
              this.noiseValue = pb.smoothStep(1, pb.add(1, this.cloudy), this.noiseValue);
            });
            // use sun color as cloud color
            /*
            this.$l.sunColor = pb.mul(
              pb.textureSampleLevel(this.skyLut, viewDirToUV(this, this.sunDir), 0),
              this.sunIntensity
            );
            */
            this.$l.cloudColor = pb.mul(
              this.sunColor.rgb,
              this.sunIntensity,
              pb.mul(this.noiseValue, this.cloudIntensity)
            );
          }

          // Compute sky color
          this.$l.skyRayDir = this.$choice(
            pb.equal(this.drawGround, 0),
            pb.normalize(pb.vec3(this.rayDir.x, pb.max(0, this.rayDir.y), this.rayDir.z)),
            this.rayDir
          );
          this.$l.skyColor = skyBox(
            this,
            this.params,
            this.sunColor,
            this.$inputs.worldDirection,
            pb.float(0.01),
            this.skyLut
          ).rgb;
          if (cloud) {
            // blend
            this.$l.vfactor = pb.clamp(pb.div(pb.sub(this.rayDir.y, 0.01), pb.sub(0.03, 0.01)), 0, 1);
            this.$l.factor = pb.clamp(pb.mul(this.noiseValue, this.vfactor), 0, 1);
            this.$l.color = pb.mix(this.skyColor, this.cloudColor, this.factor);
          } else {
            this.$l.color = this.skyColor;
          }
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
          });
        });
      }
    });
  }
}
