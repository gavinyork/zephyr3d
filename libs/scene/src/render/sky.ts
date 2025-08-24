import { Application } from '../app/app';
import { linearToGamma } from '../shaders/misc';
import type { AtmosphereParams } from '../shaders';
import {
  getDefaultAtmosphereParams,
  getAerialPerspectiveLut,
  getAtmosphereParamsStruct,
  getSkyViewLut,
  getTransmittanceLut,
  renderAtmosphereLUTs,
  skyBox,
  smoothNoise3D,
  createTransmittanceLutProgram,
  createMultiScatteringLutProgram,
  createSkyViewLutProgram,
  createAPLutProgram,
  atmosphereLUTRendered
} from '../shaders';
import { Disposable, DRef, Quaternion, Vector3 } from '@zephyr3d/base';
import { CubeFace, Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { Primitive } from './primitive';
import { BoxShape } from '../shapes';
import { Camera } from '../camera/camera';
import { prefilterCubemap } from '../utility/pmrem';
import type { DirectionalLight } from '../scene';
import type { BaseTexture, GPUDataBuffer, Texture2D } from '@zephyr3d/device';
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
import { CubemapSHProjector } from '../utility/shprojector';
import { Fog, uniformSphereSamples } from '../values';
import type { HeightFogParams } from '../shaders/fog';
import { calculateFog, getDefaultHeightFogParams, getHeightFogParamsStruct } from '../shaders/fog';

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
export type SkyType = 'color' | 'skybox' | 'scatter' | 'none';

/**
 * Type of fog
 * @public
 */
export type FogType = 'height_fog' | 'none';

const fogTypeMap: Record<FogType, number> = {
  height_fog: Fog.FOG_TYPE_HEIGHT,
  none: Fog.FOG_TYPE_NONE
};

const defaultSkyWorldMatrix = Matrix4x4.identity();

/**
 * The sky renderer
 * @public
 */
export class SkyRenderer extends Disposable {
  private static readonly _skyCamera = (() => {
    const camera = new Camera(null);
    camera.setPerspective(Math.PI / 2, 1, 1, 20);
    return camera;
  })();
  private static transmittanceLutProgram: GPUProgram = null;
  private static multiScatteringLutProgram: GPUProgram = null;
  private static skyViewLutProgram: GPUProgram = null;
  private static APLutProgram: GPUProgram = null;
  private static readonly _programSky: Partial<Record<SkyType, GPUProgram>> = {};
  private static _programDistantLight: GPUProgram = null;
  private static _programFog: GPUProgram = null;
  private static _vertexLayout: VertexLayout = null;
  private static _primitiveSky: Primitive = null;
  private static _primitiveDistantLight: Primitive = null;
  private static _renderStatesSky: RenderStateSet = null;
  private static _renderStatesSkyNoDepthTest: RenderStateSet = null;
  private static _renderStatesFog: RenderStateSet = null;
  private static _renderStatesFogScatter: RenderStateSet = null;
  private static _renderStatesDistantLight: RenderStateSet = null;
  private _skyType: SkyType;
  private readonly _skyColor: Vector4;
  private _bakedSkyboxDirty: boolean;
  private readonly _scatterSkyboxTextureWidth: number;
  private readonly _skyboxTexture: DRef<TextureCube>;
  private readonly _bakedSkyboxTexture: DRef<TextureCube>;
  private readonly _bakedSkyboxFrameBuffer: DRef<FrameBuffer>;
  private readonly _radianceMap: DRef<TextureCube>;
  private readonly _radianceFrameBuffer: DRef<FrameBuffer>;
  private readonly _irradianceMap: DRef<TextureCube>;
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  private readonly _irradianceSHFB: DRef<FrameBuffer>;
  private readonly _skyDistantLightLut: DRef<FrameBuffer>;
  private readonly _irradianceFrameBuffer: DRef<FrameBuffer>;
  private readonly _radianceMapWidth: number;
  private readonly _irradianceMapWidth: number;
  private readonly _atmosphereParams: AtmosphereParams;
  private _atmosphereExposure: number;
  private _fogType: FogType;
  private readonly _heightFogParams: HeightFogParams;
  private _cloudy: number;
  private _cloudIntensity: number;
  private _debugAerialPerspective: number;
  private readonly _wind: Vector2;
  private _skyWorldMatrix: Matrix4x4;
  private readonly _lastSunDir: Vector3;
  private readonly _lastSunColor: Vector4;
  private _panoramaAsset: string;
  private readonly _shProjector: CubemapSHProjector;
  private readonly _shWindowWeights: Vector3;
  private _radianceConvSamples: number;
  private _irradianceConvSamples: number;
  private readonly _bindgroupDistantLight: DRef<BindGroup> = null;
  private _bindgroupSky: Partial<Record<SkyType, DRef<BindGroup>>> = {};
  private readonly _bindgroupFog: DRef<BindGroup> = null;
  /**
   * Creates an instance of SkyRenderer
   */
  constructor() {
    super();
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
    this._irradianceSH = new DRef();
    this._irradianceSHFB = new DRef();
    this._skyDistantLightLut = new DRef();
    this._irradianceFrameBuffer = new DRef();
    this._irradianceMapWidth = 64;
    this._atmosphereParams = getDefaultAtmosphereParams();
    this._atmosphereExposure = 1;
    this._debugAerialPerspective = 0;
    this._fogType = 'none';
    this._heightFogParams = getDefaultHeightFogParams();
    this._cloudy = 0.45;
    this._cloudIntensity = 15;
    this._wind = new Vector2(0, 0);
    this._skyWorldMatrix = defaultSkyWorldMatrix;
    this._lastSunDir = SkyRenderer._getSunDir(null);
    this._lastSunColor = SkyRenderer._getSunColor(null);
    this._panoramaAsset = '';
    this._shProjector = new CubemapSHProjector(10000);
    this._shWindowWeights = new Vector3(1, 0.8, 0.6);
    this._radianceConvSamples = 64;
    this._irradianceConvSamples = 256;
    this._bindgroupDistantLight = new DRef();
    this._bindgroupSky = {};
    this._bindgroupFog = new DRef();
  }
  /** @internal */
  getHash(_ctx: DrawContext): string {
    return `${this.skyType}:${this.fogType}`;
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
  /** Baked sky texture */
  getBakedSkyTexture(ctx: DrawContext): TextureCube {
    if (this._bakedSkyboxDirty) {
      this.update(ctx);
    }
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
    if (val !== this._atmosphereExposure) {
      this._atmosphereExposure = val;
      this.invalidate();
    }
  }
  /** Aerial perspective density */
  get cameraHeightScale() {
    return this._atmosphereParams.cameraHeightScale;
  }
  set cameraHeightScale(val: number) {
    if (val !== this._atmosphereParams.cameraHeightScale) {
      this._atmosphereParams.cameraHeightScale = val;
      this.invalidate();
    }
  }
  /** Height fog color */
  get heightFogColor() {
    return this._heightFogParams.parameter1.xyz();
  }
  set heightFogColor(val: Vector3) {
    this._heightFogParams.parameter1.set(val);
  }
  /** Height fog density */
  get heightFogDensity() {
    return this._heightFogParams.parameter2.x;
  }
  set heightFogDensity(val: number) {
    this._heightFogParams.parameter2.x = val;
  }
  /** Height fog falloff */
  get heightFogFalloff() {
    return this._heightFogParams.parameter1.w;
  }
  set heightFogFalloff(val: number) {
    this._heightFogParams.parameter1.w = val;
  }
  /** Height fog start height */
  get heightFogStartHeight() {
    return this._heightFogParams.parameter2.y;
  }
  set heightFogStartHeight(val: number) {
    this._heightFogParams.parameter2.y = val;
  }
  /** Height fog start distance */
  get heightFogStartDistance() {
    return this._heightFogParams.parameter2.z;
  }
  set heightFogStartDistance(val: number) {
    this._heightFogParams.parameter2.z = val;
  }
  /** Height fog maximum opacity */
  get heightFogMaxOpacity() {
    return this._heightFogParams.parameter3.x;
  }
  set heightFogMaxOpacity(val: number) {
    this._heightFogParams.parameter3.x = val;
  }
  /** Height fog atmosphere contribution strength */
  get heightFogAtmosphereContribution() {
    return this._heightFogParams.parameter3.y;
  }
  set heightFogAtmosphereContribution(val: number) {
    this._heightFogParams.parameter3.y = val;
  }
  /** Height fog directional exponent */
  get heightFogDirExponent() {
    return this._heightFogParams.parameter3.w;
  }
  set heightFogDirExponent(val: number) {
    this._heightFogParams.parameter3.w = val;
  }
  /** Height fog directional inscattering color */
  get heightFogDirColor() {
    return this._heightFogParams.parameter4.xyz();
  }
  set heightFogDirColor(val: Vector3) {
    this._heightFogParams.parameter4.set(val);
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
  get atmosphereParams() {
    return this._atmosphereParams;
  }
  /** @internal */
  get heightFogParams() {
    return this._heightFogParams;
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
  /**
   * Irradiance SH coeffecients buffer
   */
  get irradianceSH(): GPUDataBuffer {
    if (!this._irradianceSH.get()) {
      const buffer = Application.instance.device.createBuffer(4 * 4 * 9, { usage: 'uniform' });
      this._irradianceSH.set(buffer);
    }
    return this._irradianceSH.get();
  }
  /**
   * Irradiance SH coeffecients texture
   */
  get irradianceSHFB(): FrameBuffer {
    if (!this._irradianceSHFB.get()) {
      const device = Application.instance.device;
      const texture = device.createTexture2D(
        device.getDeviceCaps().framebufferCaps.supportFloatBlending ? 'rgba32f' : 'rgba16f',
        3,
        3,
        {
          samplerOptions: { mipFilter: 'none' }
        }
      );
      this._irradianceSHFB.set(device.createFrameBuffer([texture], null));
    }
    return this._irradianceSHFB.get();
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
  /** @internal */
  get aerialPerspectiveDebug() {
    return this._debugAerialPerspective;
  }
  set aerialPerspectiveDebug(val: number) {
    this._debugAerialPerspective = val;
  }
  /** @internal */
  get fogPresents() {
    return this._skyType === 'scatter' || this._fogType !== 'none';
  }
  /**
   * Force the radiance map and irradiance map to be regenerated.
   */
  invalidate() {
    this._bakedSkyboxDirty = true;
  }
  /** @internal */
  drawScatteredFog(_ctx: DrawContext) {
    return this.skyType === 'scatter';
  }
  /** @internal */
  getAerialPerspectiveLUT(_ctx: DrawContext) {
    return getAerialPerspectiveLut();
  }
  /** @internal */
  getSkyDistantLightLUT(_ctx: DrawContext) {
    return this._skyDistantLightLut.get().getColorAttachments()[0] as Texture2D;
  }
  update(ctx: DrawContext) {
    const useScatter = this._skyType === 'scatter';
    if (useScatter || !atmosphereLUTRendered()) {
      this.renderAtmosphereLUTs(ctx);
    }
    const oldSunLight = ctx.sunLight && useScatter ? ctx.sunLight.color : null;
    const sunDir = SkyRenderer._getSunDir(ctx.sunLight);
    const sunColor = SkyRenderer._getSunColor(ctx.sunLight);
    if (this._skyType === 'scatter' && (this._wind.x !== 0 || this._wind.y !== 0)) {
      this._bakedSkyboxDirty = true;
    }
    if (!this._skyDistantLightLut.get()) {
      const tex = ctx.device.createTexture2D(
        ctx.device.getDeviceCaps().framebufferCaps.supportFloatBlending ? 'rgba32f' : 'rgba16f',
        1,
        1,
        { samplerOptions: { mipFilter: 'none' } }
      );
      tex.name = 'DistantSkyLut';
      this._skyDistantLightLut.set(ctx.device.createFrameBuffer([tex], null));
      this._bakedSkyboxDirty = true;
    }
    if (!sunDir.equalsTo(this._lastSunDir) || !sunColor.equalsTo(this._lastSunColor)) {
      this._lastSunDir.set(sunDir);
      this._lastSunColor.set(sunColor);
      this._bakedSkyboxDirty = true;
    }
    if (this._bakedSkyboxDirty) {
      this._bakedSkyboxDirty = false;
      this.updateBakedSkyMap();
      this.renderSkyDistantLut(ctx, this._bakedSkyboxTexture.get());
      if (
        ctx.scene.env.light.radianceMap &&
        (ctx.scene.env.light.radianceMap === this.radianceMap ||
          ctx.scene.env.light.irradianceMap === this.irradianceMap ||
          (this._irradianceSH.get() && ctx.scene.env.light.irradianceSH === this.irradianceSH) ||
          (this._irradianceSHFB.get() && ctx.scene.env.light.irradianceSHFB === this.irradianceSHFB))
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
        if (ctx.device.type === 'webgl' || !ctx.device.getDeviceCaps().framebufferCaps.supportFloatBlending) {
          this._shProjector.projectCubemapToTexture(
            this.irradianceFramebuffer.getColorAttachments()[0] as TextureCube,
            this.irradianceSHFB
          );
        } else {
          this._shProjector.projectCubemap(
            this.irradianceFramebuffer.getColorAttachments()[0] as TextureCube,
            this.irradianceSH
          );
        }
        ctx.scene.env.light.irradianceSH = this.irradianceSH;
        ctx.scene.env.light.irradianceWindow = this._shWindowWeights;
      }
    }
    const newSunLight = oldSunLight
      ? Vector3.mul(ctx.sunLight.color.xyz(), this.sunTransmittance(ctx.sunLight))
      : Vector3.zero();
    if (oldSunLight) {
      ctx.sunLight.setColor(newSunLight);
    }
    // Update height fog parameters
    if (this._fogType === 'height_fog') {
      const cameraY = Math.min(
        this._heightFogParams.parameter2.y + this._heightFogParams.parameter2.w,
        ctx.camera.getWorldPosition().y
      );
      const p = Math.max(
        -125,
        Math.min(126, -this._heightFogParams.parameter1.w * (cameraY - this._heightFogParams.parameter2.y))
      );
      this._heightFogParams.parameter3.z = this._heightFogParams.parameter2.x * Math.pow(2, p);
      this._heightFogParams.lightColor.set(newSunLight);
      this._heightFogParams.lightDir.set(SkyRenderer._getSunDir(ctx.sunLight));
    }
    return oldSunLight;
  }
  renderAtmosphereLUTs(ctx: DrawContext) {
    this._atmosphereParams.lightDir.set(SkyRenderer._getSunDir(ctx.sunLight));
    this._atmosphereParams.lightColor.set(SkyRenderer._getSunColor(ctx.sunLight));
    this._atmosphereParams.lightColor.w *= this._atmosphereExposure;
    this._atmosphereParams.cameraAspect = ctx.camera.getAspect();
    this._atmosphereParams.cameraWorldMatrix.set(ctx.camera.worldMatrix);
    renderAtmosphereLUTs(this._atmosphereParams);
  }
  renderSkyDistantLut(ctx: DrawContext, skybox: TextureCube) {
    this._prepareSkyBox(ctx.device);
    ctx.device.pushDeviceStates();
    ctx.device.setRenderStates(SkyRenderer._renderStatesDistantLight);
    ctx.device.setProgram(SkyRenderer._programDistantLight);
    ctx.device.setFramebuffer(this._skyDistantLightLut.get());
    ctx.device.clearFrameBuffer(new Vector4(0, 0, 0, 1), null, null);
    this._bindgroupDistantLight.get().setTexture('skybox', skybox, fetchSampler('clamp_linear_nomip'));
    ctx.device.setBindGroup(0, this._bindgroupDistantLight.get());
    SkyRenderer._primitiveDistantLight.draw();
    ctx.device.popDeviceStates();
  }
  updateBakedSkyMap() {
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
        this._renderSky(camera, false);
      }
      device.popDeviceStates();
      device.setRenderStates(saveRenderStates);
      this._bakedSkyboxTexture.set(tex);
    }
  }
  renderUberFog(ctx: DrawContext, depthTexture: BaseTexture) {
    const camera = ctx.camera;
    const device = ctx.device;
    const fogProgram = SkyRenderer._programFog;
    const renderStates = SkyRenderer._renderStatesFog;
    const bindgroup = this._bindgroupFog.get();
    bindgroup.setTexture('depthTex', depthTexture, fetchSampler('clamp_nearest_nomip'));
    bindgroup.setTexture(
      'skyDistantLightLut',
      this._skyDistantLightLut.get().getColorAttachments()[0],
      fetchSampler('clamp_nearest_nomip')
    );
    bindgroup.setTexture('apLut', getAerialPerspectiveLut(), fetchSampler('clamp_linear_nomip'));
    bindgroup.setValue('rt', device.getFramebuffer() ? 1 : 0);
    bindgroup.setValue('invProjViewMatrix', camera.invViewProjectionMatrix);
    bindgroup.setValue('cameraNearFar', new Vector2(camera.getNearPlane(), camera.getFarPlane()));
    bindgroup.setValue('cameraPosition', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setValue('withAerialPerspective', this.skyType === 'scatter' ? 1 : 0);
    bindgroup.setValue('fogType', this.mappedFogType);
    bindgroup.setValue('atmosphereParams', this._atmosphereParams);
    bindgroup.setValue('heightFogParams', this._heightFogParams);
    device.setProgram(fogProgram);
    device.setBindGroup(0, bindgroup);
    device.setVertexLayout(SkyRenderer._vertexLayout);
    device.setRenderStates(renderStates);
    device.draw('triangle-strip', 0, 4);
  }
  /** @internal */
  renderFog(ctx: DrawContext) {
    const currentFramebuffer = ctx.device.getFramebuffer();
    const depthBuffer = currentFramebuffer?.getDepthAttachment() ?? null;
    const colorBuffer = currentFramebuffer?.getColorAttachments()[0] ?? null;
    const fogFramebuffer =
      depthBuffer && colorBuffer
        ? ctx.device.pool.fetchTemporalFramebuffer(false, 0, 0, colorBuffer, null, false)
        : null;
    if (fogFramebuffer) {
      const vp = ctx.device.getViewport();
      const scissor = ctx.device.getScissor();
      ctx.device.pushDeviceStates();
      ctx.device.setFramebuffer(fogFramebuffer);
      ctx.device.setViewport(vp);
      ctx.device.setScissor(scissor);
    }
    const savedRenderStates = ctx.device.getRenderStates();
    this._prepareSkyBox(ctx.device);
    this.renderUberFog(ctx, depthBuffer);
    /*
    if (this._skyType === 'scatter') {
      this.renderAtmosphericFog(ctx, depthBuffer);
    }
    */
    /*
    if (this._fogType === 'height_fog') {
      this.renderHeightFog(ctx, depthBuffer);
    }
    */
    ctx.device.setRenderStates(savedRenderStates);
    if (fogFramebuffer) {
      ctx.device.popDeviceStates();
      ctx.device.pool.releaseFrameBuffer(fogFramebuffer);
    }
  }
  /** @internal */
  renderSky(ctx: DrawContext) {
    let skyCamera = ctx.camera;
    if (!skyCamera.isPerspective()) {
      skyCamera = SkyRenderer._skyCamera;
      ctx.camera.worldMatrix.decompose(null, skyCamera.rotation, null);
    }
    this._renderSky(skyCamera, true);
  }
  /** Disposes resources of this SkyRenderer */
  protected onDispose() {
    super.onDispose();
    this._skyboxTexture.dispose();
    this._bakedSkyboxTexture.dispose();
    this._bakedSkyboxFrameBuffer.dispose();
    this._radianceMap.dispose();
    this._radianceFrameBuffer.dispose();
    this._irradianceMap.dispose();
    this._irradianceSH.dispose();
    this._irradianceSHFB.dispose();
    this._irradianceFrameBuffer.dispose();
    this._shProjector.dispose();
    if (this._skyDistantLightLut.get()) {
      this._skyDistantLightLut.get().getColorAttachments()[0].dispose();
      this._skyDistantLightLut.dispose();
    }
    this._bindgroupDistantLight.dispose();
    for (const k in this._bindgroupSky) {
      this._bindgroupSky[k].dispose();
    }
    this._bindgroupSky = {};
    this._bindgroupFog.dispose();
  }
  /** @internal */
  private _renderSky(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const savedRenderStates = device.getRenderStates();
    this._prepareSkyBox(device);
    if (this._skyType === 'scatter') {
      this._drawScattering(camera, depthTest);
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
    const bindgroup = this._bindgroupSky.color.get();
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
    const bindgroup = this._bindgroupSky.skybox.get();
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
  sunTransmittance(sunLight: DirectionalLight): Vector3 {
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
  private _drawScattering(camera: Camera, depthTest: boolean) {
    const device = Application.instance.device;
    const tLut = getTransmittanceLut();
    const skyLut = getSkyViewLut();
    //const apLut = ScatteringLut.getAerialPerspectiveLut(alpha, 8000);
    const program = SkyRenderer._programSky.scatter;
    const bindgroup = this._bindgroupSky.scatter.get();
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
    bindgroup.setValue('cloudy', this._cloudy);
    bindgroup.setValue('cloudIntensity', this._cloudIntensity);
    bindgroup.setValue('time', device.frameInfo.elapsedOverall * 0.001);
    bindgroup.setValue('velocity', this._wind);
    device.setProgram(program);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(
      depthTest ? SkyRenderer._renderStatesSky : SkyRenderer._renderStatesSkyNoDepthTest
    );
    SkyRenderer._primitiveSky.draw();
  }
  /** @internal */
  private _prepareSkyBox(device: AbstractDevice) {
    SkyRenderer._createAtmosphereLUTPrograms(device);
    if (!SkyRenderer._programDistantLight) {
      SkyRenderer._programDistantLight = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.vector = pb.vec3().attrib('position');
          pb.main(function () {
            this.$outputs.vector = this.$inputs.vector;
            this.$builtins.position = pb.vec4(0, 0, 0, 1);
            if (pb.getDevice().type !== 'webgpu') {
              this.$builtins.pointSize = 1;
            }
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          this.skybox = pb.texCube().uniform(0);
          pb.main(function () {
            this.$l.sunColor = pb.vec4();
            this.$l.skyColor = pb.textureSampleLevel(this.skybox, this.$inputs.vector, 0).rgb;
            this.$outputs.color = pb.vec4(pb.mul(this.skyColor, 1 / 32 /*1 / 64*/), 1);
          });
        }
      });
    }
    if (!this._bindgroupDistantLight.get()) {
      this._bindgroupDistantLight.set(
        device.createBindGroup(SkyRenderer._programDistantLight.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._programFog) {
      SkyRenderer._programFog = device.buildRenderProgram({
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
          const AtmosphereParams = getAtmosphereParamsStruct(pb);
          const HeightFogParams = getHeightFogParamsStruct(pb);
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.apLut = pb.tex2D().uniform(0);
          this.skyDistantLightLut = pb.tex2D().uniform(0);
          this.invProjViewMatrix = pb.mat4().uniform(0);
          this.cameraNearFar = pb.vec2().uniform(0);
          this.cameraPosition = pb.vec3().uniform(0);
          this.withAerialPerspective = pb.int().uniform(0);
          this.fogType = pb.int().uniform(0);
          this.atmosphereParams = AtmosphereParams().uniform(0);
          this.heightFogParams = HeightFogParams().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.main(function () {
            this.$l.depthValue = pb.textureSample(this.depthTex, this.$inputs.uv).r;
            this.$l.clipSpacePos = pb.vec4(
              pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
              pb.sub(pb.mul(this.depthValue, 2), 1),
              1
            );
            this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
            this.$l.worldPos = pb.div(this.$l.hPos, this.$l.hPos.w).xyz;
            this.$l.isSky = pb.equal(this.$l.depthValue, 1);
            this.$l.color = calculateFog(
              this,
              this.withAerialPerspective,
              this.fogType,
              this.atmosphereParams,
              this.heightFogParams,
              this.$inputs.uv,
              this.isSky,
              this.cameraPosition,
              this.worldPos,
              0,
              this.apLut,
              this.skyDistantLightLut
            );
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = this.color;
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color.rgb), this.color.a);
            });
          });
        }
      });
    }
    if (!this._bindgroupFog.get()) {
      this._bindgroupFog.set(device.createBindGroup(SkyRenderer._programFog.bindGroupLayouts[0]));
    }
    if (!SkyRenderer._programSky.color) {
      SkyRenderer._programSky.color = device.buildRenderProgram({
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
    }
    if (!this._bindgroupSky.color) {
      this._bindgroupSky.color = new DRef(
        device.createBindGroup(SkyRenderer._programSky.color.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._programSky.scatter) {
      SkyRenderer._programSky.scatter = SkyRenderer._createScatterProgram(device, true);
    }
    if (!this._bindgroupSky.scatter) {
      this._bindgroupSky.scatter = new DRef(
        device.createBindGroup(SkyRenderer._programSky.scatter.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._programSky.skybox) {
      SkyRenderer._programSky.skybox = device.buildRenderProgram({
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
    }
    if (!this._bindgroupSky.skybox) {
      this._bindgroupSky.skybox = new DRef(
        device.createBindGroup(SkyRenderer._programSky.skybox.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._renderStatesSky) {
      SkyRenderer._renderStatesSky = device.createRenderStateSet();
      SkyRenderer._renderStatesSky.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('le');
      SkyRenderer._renderStatesSky.useRasterizerState().setCullMode('none');
    }
    if (!SkyRenderer._renderStatesSkyNoDepthTest) {
      SkyRenderer._renderStatesSkyNoDepthTest = device.createRenderStateSet();
      SkyRenderer._renderStatesSkyNoDepthTest.useDepthState().enableTest(false).enableWrite(false);
      SkyRenderer._renderStatesSkyNoDepthTest.useRasterizerState().setCullMode('none');
    }
    if (!SkyRenderer._renderStatesFog) {
      SkyRenderer._renderStatesFog = device.createRenderStateSet();
      SkyRenderer._renderStatesFog.useRasterizerState().setCullMode('none');
      SkyRenderer._renderStatesFog.useBlendingState().enable(true).setBlendFunc('one', 'src-alpha');
      SkyRenderer._renderStatesFog.useDepthState().enableTest(false).enableWrite(false);
    }
    if (!SkyRenderer._renderStatesFogScatter) {
      SkyRenderer._renderStatesFogScatter = device.createRenderStateSet();
      SkyRenderer._renderStatesFogScatter.useRasterizerState().setCullMode('none');
      SkyRenderer._renderStatesFogScatter.useBlendingState().enable(true).setBlendFunc('one', 'src-alpha');
      SkyRenderer._renderStatesFogScatter
        .useDepthState()
        .enableTest(true)
        .enableWrite(false)
        .setCompareFunc('gt');
    }
    if (!SkyRenderer._renderStatesDistantLight) {
      SkyRenderer._renderStatesDistantLight = device.createRenderStateSet();
      SkyRenderer._renderStatesDistantLight.useDepthState().enableTest(false).enableWrite(false);
      SkyRenderer._renderStatesDistantLight
        .useBlendingState()
        .enable(true)
        .setBlendEquation('add', 'add')
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('zero', 'one');
      SkyRenderer._renderStatesDistantLight.useRasterizerState().setCullMode('none');
    }
    if (!SkyRenderer._vertexLayout) {
      SkyRenderer._vertexLayout = device.createVertexLayout({
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
    if (!SkyRenderer._primitiveSky) {
      SkyRenderer._primitiveSky = new BoxShape({ size: 8 });
    }
    if (!SkyRenderer._primitiveDistantLight) {
      const data = new Float32Array(uniformSphereSamples.length * 3);
      let i = 0;
      for (const v of uniformSphereSamples) {
        data[i++] = v.x;
        data[i++] = v.y;
        data[i++] = v.z;
      }
      SkyRenderer._primitiveDistantLight = new Primitive();
      SkyRenderer._primitiveDistantLight.createAndSetVertexBuffer('position_f32x3', data);
      SkyRenderer._primitiveDistantLight.indexCount = uniformSphereSamples.length;
      SkyRenderer._primitiveDistantLight.indexStart = 0;
      SkyRenderer._primitiveDistantLight.primitiveType = 'point-list';
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
  private static _createAtmosphereLUTPrograms(device: AbstractDevice) {
    if (!this.transmittanceLutProgram) {
      this.transmittanceLutProgram = createTransmittanceLutProgram(device);
    }
    if (!this.multiScatteringLutProgram) {
      this.multiScatteringLutProgram = createMultiScatteringLutProgram(device);
    }
    if (!this.skyViewLutProgram) {
      this.skyViewLutProgram = createSkyViewLutProgram(device);
    }
    if (!this.APLutProgram) {
      this.APLutProgram = createAPLutProgram(device);
    }
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
          // Calculate sky color
          this.$l.sunColor = pb.vec4();
          this.$l.skyColor = skyBox(
            this,
            this.params,
            this.sunColor,
            this.$inputs.worldDirection,
            pb.float(0.01),
            this.tLut,
            this.skyLut
          ).rgb;

          this.$l.rayDir = pb.normalize(this.$inputs.worldDirection);
          this.$l.sunDir = this.params.lightDir;
          // ad-hoc
          this.$l.sunIntensity = pb.sqrt(pb.max(0, pb.mul(this.sunDir.y, this.rayDir.y)));

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
