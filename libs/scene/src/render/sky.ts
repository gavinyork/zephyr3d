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
import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, DRef, objectKeys, Vector3 } from '@zephyr3d/base';
import { CubeFace, DEPTH_COMPARE_DEFAULT, DEPTH_COMPARE_FARTHER, DEPTH_FARTHEST, Matrix4x4, Vector2, Vector4 } from '@zephyr3d/base';
import { Primitive } from './primitive';
import { BoxShape } from '../shapes';
import type { Camera } from '../camera/camera';
import { prefilterCubemap } from '../utility/pmrem';
import type { DirectionalLight } from '../scene';
import type { BaseTexture, GPUDataBuffer, Texture2D } from '@zephyr3d/device';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  TextureCube,
  TextureFormat,
  VertexLayout
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import { ShaderHelper } from '../material/shader/helper';
import { PHYSICAL_BAKE_EXPOSURE } from '../utility/physical';
import { fetchSampler } from '../utility/misc';
import { CubemapSHProjector } from '../utility/shprojector';
import { Fog, uniformSphereSamples } from '../values';
import type { HeightFogParams } from '../shaders/fog';
import {
  calculateFog,
  getDefaultHeightFogParams,
  getHeightFogParamsStruct,
  MAX_FOG_HEIGHT
} from '../shaders/fog';
import { getDevice, getEngine } from '../app/api';
import { drawFullscreenQuad } from './fullscreenquad';
import { panoramaToCubemap } from '../utility/panorama';
import { PerspectiveCamera } from '../camera';

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
export type SkyType = 'image' | 'skybox' | 'scatter' | 'none';

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
  /**
   * @internal
   *
   * The atmospheric scattering model predates photometric lighting and was authored around a
   * sun input of 10. This normalization maps the physical daylight reference (100,000 lux at
   * Sunny 16, whose camera exposure is 1 / 38,400) onto that model reference: 10 / (100000 / 38400).
   */
  static readonly PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE = 3.84;
  /**
   * @internal
   * Fixed exposure the physical sky bake is stored at. See {@link PHYSICAL_BAKE_EXPOSURE}.
   */
  static readonly PHYSICAL_BAKE_EXPOSURE = PHYSICAL_BAKE_EXPOSURE;
  /**
   * @internal
   *
   * Reference-exposure anchor previously used to lift authored fog colors into photometric space.
   *
   * @deprecated Physical fog now derives its luminance from `EnvLightWrapper.intensity`, mirroring
   * Filament, which scales fog color by `iblLuminance`. Retained only because it documents the
   * Sunny-16 equivalence: 38,400 = 1 / exposure(f/16, 1/125s, ISO 100).
   */
  static readonly FOG_PHYSICAL_LUMINANCE = 38400;
  private static readonly _skyCamera = (() => {
    return new PerspectiveCamera(null, Math.PI * 0.5, 1, 20, 1);
  })();
  private static transmittanceLutProgram: Nullable<GPUProgram> = null;
  private static multiScatteringLutProgram: Nullable<GPUProgram> = null;
  private static skyViewLutProgram: Nullable<GPUProgram> = null;
  private static APLutProgram: Nullable<GPUProgram> = null;
  private static readonly _programSky: Partial<Record<SkyType, GPUProgram>> = {};
  private static _programDistantLight: Nullable<GPUProgram> = null;
  private static _programFog: Nullable<GPUProgram> = null;
  private static _programFogNoDepth: Nullable<GPUProgram> = null;
  private static _vertexLayout: Nullable<VertexLayout> = null;
  private static _primitiveSky: Nullable<Primitive> = null;
  private static _primitiveDistantLight: Nullable<Primitive> = null;
  private static _renderStatesSky: Nullable<RenderStateSet> = null;
  private static _renderStatesSkyNoDepthTest: Nullable<RenderStateSet> = null;
  private static _renderStatesFog: Nullable<RenderStateSet> = null;
  private static _renderStatesFogScatter: Nullable<RenderStateSet> = null;
  private static _renderStatesDistantLight: Nullable<RenderStateSet> = null;
  private static _defaultSkyImage: DRef<Texture2D> = new DRef();
  private _skyType: SkyType;
  private readonly _skyColor: Vector4;
  private readonly _skyImage: DRef<Texture2D>;
  private _bakedSkyboxDirty: boolean;
  private _bakedSkyboxTextureSize: number;
  private _skyboxTextureSize: number;
  private readonly _skyboxTexture: DRef<TextureCube>;
  private readonly _bakedSkyboxTexture: DRef<TextureCube>;
  private readonly _bakedSkyboxFrameBuffer: DRef<FrameBuffer>;
  private readonly _radianceMap: DRef<TextureCube>;
  private readonly _radianceFrameBuffer: DRef<FrameBuffer>;
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  private readonly _irradianceSHFB: DRef<FrameBuffer>;
  private readonly _skyDistantLightLut: DRef<FrameBuffer>;
  private readonly _irradianceFrameBuffer: DRef<FrameBuffer>;
  private readonly _radianceMapWidth: number;
  private readonly _atmosphereParams: AtmosphereParams;
  private _atmosphereExposure: number;
  private _fogType: FogType;
  private readonly _heightFogParams: HeightFogParams;
  private _cloudy: number;
  private _cloudIntensity: number;
  private _debugAerialPerspective: number;
  private readonly _wind: Vector2;
  private readonly _skyboxRotation: Vector3;
  private _skyWorldMatrix: Matrix4x4;
  private readonly _lastSunDir: Vector3;
  private readonly _lastSunColor: Vector4;
  private _panoramaAsset: string;
  private readonly _shProjector: CubemapSHProjector;
  private readonly _shWindowWeights: Vector3;
  private _radianceConvSamples: number;
  private _irradianceConvSamples: number;
  private readonly _bindgroupDistantLight: Nullable<DRef<BindGroup>> = null;
  private _bindgroupSky: Partial<Record<SkyType, DRef<BindGroup>>> = {};
  private readonly _bindgroupFog: Nullable<DRef<BindGroup>> = null;
  private readonly _bindgroupFogNoDepth: Nullable<DRef<BindGroup>> = null;
  private _format: Nullable<TextureFormat>;
  /**
   * @internal Scale lifting the authored 0..1 height-fog colors into the pre-exposed space for the
   * current frame (1 in legacy, `EnvLightWrapper.intensity * cameraExposure` in physical).
   */
  private _fogLuminanceScale: number;
  /**
   * @internal Ratio converting the fog shader's atmosphere-derived LUT samples from the fixed bake
   * exposure to the live one (1 in legacy).
   */
  private _fogPreExposure: number;
  /**
   * Creates an instance of SkyRenderer
   */
  constructor() {
    super();
    this._skyType = 'scatter';
    this._skyColor = new Vector4(0, 0, 0, 1);
    this._skyImage = new DRef();
    this._skyboxTexture = new DRef();
    this._skyboxTextureSize = 1024;
    this._bakedSkyboxTexture = new DRef();
    this._bakedSkyboxFrameBuffer = new DRef();
    this._bakedSkyboxDirty = true;
    this._bakedSkyboxTextureSize = 256;
    this._radianceMap = new DRef();
    this._radianceFrameBuffer = new DRef();
    this._radianceMapWidth = 128;
    this._irradianceSH = new DRef();
    this._irradianceSHFB = new DRef();
    this._skyDistantLightLut = new DRef();
    this._irradianceFrameBuffer = new DRef();
    this._atmosphereParams = getDefaultAtmosphereParams();
    this._atmosphereExposure = 1;
    this._debugAerialPerspective = 0;
    this._fogType = 'height_fog';
    this._heightFogParams = getDefaultHeightFogParams();
    this._cloudy = 0.45;
    this._cloudIntensity = 15;
    this._wind = new Vector2(0, 0);
    this._skyboxRotation = new Vector3(0, 0, 0);
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
    this._bindgroupFogNoDepth = new DRef();
    this._format = null;
    this._fogLuminanceScale = 1;
    this._fogPreExposure = 1;
  }
  /** @internal */
  getHash(_ctx: DrawContext) {
    return `${this.skyType}:${this.fogType}`;
  }
  /**
   * Gets the preferred environment texture format.
   */
  get envTextureFormat() {
    if (!this._format) {
      const texCaps = getDevice().getDeviceCaps().textureCaps;
      this._format = texCaps.getTextureFormatInfo('rg11b10uf')?.renderable
        ? 'rg11b10uf'
        : texCaps.supportHalfFloatColorBuffer && texCaps.supportLinearHalfFloatTexture
          ? 'rgba16f'
          : 'rgba32f';
    }
    return this._format;
  }
  /** Which type of the sky should be rendered */
  get skyType() {
    return this._skyType;
  }
  set skyType(val) {
    if (val !== this._skyType) {
      this._skyType = val;
      this.invalidate();
    }
  }
  /** @internal */
  get panoramaTextureAsset() {
    return this._panoramaAsset;
  }
  /** @internal */
  set panoramaTextureAsset(id: string) {
    if (id !== this._panoramaAsset) {
      this._panoramaAsset = id ?? '';
      if (!this._panoramaAsset) {
        this.skyboxTexture = null;
        return;
      }
      this._updateSkyboxTexture();
    }
  }
  /** @internal */
  get skyboxTextureSize() {
    return this._skyboxTextureSize;
  }
  /** @internal */
  set skyboxTextureSize(size: number) {
    if (size !== this._skyboxTextureSize) {
      this._skyboxTextureSize = size;
      this._updateSkyboxTexture();
    }
  }
  /** Baked sky texture */
  getBakedSkyTexture(ctx: DrawContext) {
    if (this._bakedSkyboxDirty) {
      this.update(ctx);
    }
    return this._bakedSkyboxTexture.get()!;
  }
  /**
   * The color used when sky type is `image`
   */
  get skyColor(): Immutable<Vector4> {
    return this._skyColor;
  }
  set skyColor(val: Immutable<Vector4>) {
    if (!val.equalsTo(this._skyColor)) {
      this._skyColor.set(val);
      this.invalidate();
    }
  }
  /**
   * The image used when sky type is `image`
   */
  get skyImage() {
    return this._skyImage.get();
  }
  set skyImage(texture) {
    if (texture !== this._skyImage.get()) {
      this._skyImage.set(texture);
      this.invalidate();
    }
  }
  /**
   * Window weights for SH projection
   */
  get shWindowWeights(): Immutable<Vector3> {
    return this._shWindowWeights;
  }
  set shWindowWeights(weights: Immutable<Vector3>) {
    this._shWindowWeights.set(weights);
    this.invalidate();
  }
  /**
   * Sample count for radiance convolution
   */
  get radianceConvSamples() {
    return this._radianceConvSamples;
  }
  set radianceConvSamples(val) {
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
  set irradianceConvSamples(val) {
    if (val !== this._irradianceConvSamples) {
      this._irradianceConvSamples = val;
      this.invalidate();
    }
  }
  /** Aerial perspective density */
  get aerialPerspectiveDistance() {
    return this._atmosphereParams.apDistance;
  }
  set aerialPerspectiveDistance(val) {
    if (val !== this._atmosphereParams.apDistance) {
      this._atmosphereParams.apDistance = val;
      this.invalidate();
    }
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
  set cameraHeightScale(val) {
    if (val !== this._atmosphereParams.cameraHeightScale) {
      this._atmosphereParams.cameraHeightScale = val;
      this.invalidate();
    }
  }
  /** Height fog color */
  get heightFogColor(): Immutable<Vector3> {
    return this._heightFogParams.parameter1.xyz();
  }
  set heightFogColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._heightFogParams.parameter1.xyz())) {
      this._heightFogParams.parameter1.set(val);
      this.invalidate();
    }
  }
  /** Height fog density */
  get heightFogDensity() {
    return this._heightFogParams.parameter2.x;
  }
  set heightFogDensity(val) {
    if (val !== this._heightFogParams.parameter2.x) {
      this._heightFogParams.parameter2.x = val;
      this.invalidate();
    }
  }
  /** Height fog falloff */
  get heightFogFalloff() {
    return this._heightFogParams.parameter1.w;
  }
  set heightFogFalloff(val) {
    if (val !== this._heightFogParams.parameter1.w) {
      this._heightFogParams.parameter1.w = val;
      this.invalidate();
    }
  }
  /** Height fog start height */
  get heightFogStartHeight() {
    return this._heightFogParams.parameter2.y;
  }
  set heightFogStartHeight(val) {
    if (val !== this._heightFogParams.parameter2.y) {
      this._heightFogParams.parameter2.y = val;
      this.invalidate();
    }
  }
  /** Height fog start distance */
  get heightFogStartDistance() {
    return this._heightFogParams.parameter2.z;
  }
  set heightFogStartDistance(val) {
    if (val !== this._heightFogParams.parameter2.z) {
      this._heightFogParams.parameter2.z = val;
      this.invalidate();
    }
  }
  /** Height fog end distance */
  get heightFogEndDistance() {
    return this._heightFogParams.parameter2.w;
  }
  set heightFogEndDistance(val) {
    if (val !== this._heightFogParams.parameter2.w) {
      this._heightFogParams.parameter2.w = val;
      this.invalidate();
    }
  }
  /** Height fog maximum opacity */
  get heightFogMaxOpacity() {
    return this._heightFogParams.parameter3.x;
  }
  set heightFogMaxOpacity(val) {
    if (val !== this._heightFogParams.parameter3.x) {
      this._heightFogParams.parameter3.x = val;
      this.invalidate();
    }
  }
  /** Height fog atmosphere contribution strength */
  get heightFogAtmosphereContribution() {
    return this._heightFogParams.parameter3.y;
  }
  set heightFogAtmosphereContribution(val) {
    if (val !== this._heightFogParams.parameter3.y) {
      this._heightFogParams.parameter3.y = val;
      this.invalidate();
    }
  }
  /** Height fog directional exponent */
  get heightFogDirExponent() {
    return this._heightFogParams.parameter3.w;
  }
  set heightFogDirExponent(val) {
    if (val !== this._heightFogParams.parameter3.w) {
      this._heightFogParams.parameter3.w = val;
      this.invalidate();
    }
  }
  /** Height fog directional inscattering color */
  get heightFogDirColor(): Immutable<Vector3> {
    return this._heightFogParams.parameter4.xyz();
  }
  set heightFogDirColor(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._heightFogParams.parameter4.xyz())) {
      this._heightFogParams.parameter4.set(val);
      this.invalidate();
    }
  }
  /**
   * Light density of the sky.
   *
   * @remarks
   * This value controls how much cloud should be rendered when the sky type is scatter.
   * Typically, the value should be in the range of 0 to 1.
   */
  get cloudy() {
    return this._cloudy;
  }
  set cloudy(val) {
    if (val !== this._cloudy && this._skyType === 'scatter') {
      this._cloudy = val;
      this.invalidate();
    }
  }
  /**
   * Intensity of the sky color
   */
  get cloudIntensity() {
    return this._cloudIntensity;
  }
  set cloudIntensity(val) {
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
  get wind(): Immutable<Vector2> {
    return this._wind;
  }
  set wind(val: Immutable<Vector2>) {
    this._wind.set(val);
  }
  /**
   * Radiance map of the sky.
   */
  get radianceMap() {
    if (!this._radianceMap.get()) {
      this._radianceMap.set(getDevice().createCubeTexture(this.envTextureFormat, this._radianceMapWidth)!);
      this._radianceMap.get()!.name = 'SkyRadianceMap';
    }
    return this._radianceMap.get()!;
  }
  /**
   * Radiance map of the sky reused for sheen.
   *
   * @remarks
   * Dynamic sky is smooth enough that the GGX-prefiltered radiance map is a practical approximation for sheen.
   */
  get sheenRadianceMap() {
    return this.radianceMap;
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
      this._radianceFrameBuffer.set(getDevice().createFrameBuffer([this.radianceMap], null));
    }
    return this._radianceFrameBuffer.get();
  }
  /**
   * Irradiance SH coeffecients buffer
   */
  get irradianceSH() {
    if (!this._irradianceSH.get()) {
      const buffer = getDevice().createBuffer(4 * 4 * 9, { usage: 'uniform' })!;
      this._irradianceSH.set(buffer);
    }
    return this._irradianceSH.get()!;
  }
  /**
   * Irradiance SH coeffecients texture
   */
  get irradianceSHFB() {
    if (!this._irradianceSHFB.get()) {
      const device = getDevice();
      const texCaps = device.getDeviceCaps().textureCaps;
      const format =
        !device.getDeviceCaps().framebufferCaps.supportFloatBlending && texCaps.supportHalfFloatColorBuffer
          ? 'rgba16f'
          : 'rgba32f';
      const texture = device.createTexture2D(format, 3, 3, {
        mipmapping: false
      })!;
      this._irradianceSHFB.set(device.createFrameBuffer([texture], null));
    }
    return this._irradianceSHFB.get()!;
  }
  /**
   * Cube texture for skybox.
   */
  get skyboxTexture() {
    return this._skyboxTexture.get();
  }
  set skyboxTexture(tex) {
    if (tex !== this.skyboxTexture) {
      this._skyboxTexture.set(tex);
      if (this._skyType === 'skybox') {
        this.invalidate();
      }
    }
  }
  /**
   * Additional euler rotation (in degrees) applied to skybox.
   */
  get skyboxRotation(): Immutable<Vector3> {
    return this._skyboxRotation;
  }
  set skyboxRotation(val: Immutable<Vector3>) {
    if (!val.equalsTo(this._skyboxRotation)) {
      this._skyboxRotation.set(val);
      if (this._skyType === 'skybox') {
        this.invalidate();
      }
    }
  }
  /** @internal */
  get skyWorldMatrix(): Immutable<Matrix4x4> {
    return this._skyWorldMatrix;
  }
  /** @internal */
  set skyWorldMatrix(val: Immutable<Matrix4x4>) {
    val = val ?? defaultSkyWorldMatrix;
    if (!val.equalsTo(this._skyWorldMatrix)) {
      this._skyWorldMatrix = val;
      this.invalidate();
    }
  }
  /** @internal */
  get mappedFogType() {
    return fogTypeMap[this._fogType];
  }
  /** Current fog type */
  get fogType() {
    return this._fogType;
  }
  set fogType(val) {
    if (val !== this._fogType) {
      this._fogType = val;
      this.invalidate();
    }
  }
  /** @internal */
  get aerialPerspectiveDebug() {
    return this._debugAerialPerspective;
  }
  /** @internal */
  set aerialPerspectiveDebug(val) {
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
    return this._skyDistantLightLut.get()!.getColorAttachments()[0] as Texture2D;
  }
  update(ctx: DrawContext) {
    // Latch the fog scales for this frame. The bake path (updateBakedSkyMap) uses the sky camera
    // whose scene is null, so it cannot read lightingMode itself; both bake and main pass run after
    // update(), so caching them here keeps them consistent.
    // The fog shader mixes two differently-scaled sources, so it needs both factors:
    //  - the atmosphere-derived LUTs (distant sky, aerial perspective) are stored at the fixed bake
    //    exposure, so they convert with the bake-to-live ratio;
    //  - the authored 0..1 fog colors are lifted by the environment intensity (lux) -- the same
    //    anchor the sky and IBL use, mirroring Filament's `fogColor *= iblLuminance` -- and then
    //    take the plain camera pre-exposure.
    // Legacy leaves both at 1 so its authored colors are untouched.
    this._fogPreExposure = SkyRenderer.getBakeToPreExposedScale(ctx);
    this._fogLuminanceScale =
      ctx.scene.lightingMode === 'physical'
        ? ctx.scene.env.light.intensity * ShaderHelper.getPreExposure(ctx)
        : 1;
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
      const tex = ctx.device.createTexture2D(this.envTextureFormat, 1, 1, { mipmapping: false })!;
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
      // updateBakedSkyMap derives the IBL (specular prefilter + irradiance SH) from the fog-free
      // cubemap internally, before compositing fog. The distant-light LUT is re-baked here against
      // the fogged cubemap to preserve the pre-refactor fog shading appearance.
      this.updateBakedSkyMap(ctx);
      this.renderSkyDistantLut(ctx, this._bakedSkyboxTexture.get()!);
    }
    const newSunLight = oldSunLight
      ? Vector3.mul(ctx.sunLight!.color.xyz(), this.sunTransmittance(ctx.sunLight!))
      : Vector3.zero();
    if (oldSunLight) {
      ctx.sunLight!.setColor(newSunLight);
    }
    // Update height fog parameters
    if (this._fogType === 'height_fog') {
      const cameraY = Math.min(
        this._heightFogParams.parameter2.y + MAX_FOG_HEIGHT,
        ctx.camera.getWorldPosition().y
      );
      const p = Math.max(
        -125,
        Math.min(126, -this._heightFogParams.parameter1.w * (cameraY - this._heightFogParams.parameter2.y))
      );
      this._heightFogParams.parameter3.z = this._heightFogParams.parameter2.x * Math.pow(2, p);
      // The legacy directional fog term expects a display-relative 0..1 light color. It cannot be
      // mixed directly with photometric illuminance; physical fog instead receives its radiance
      // from the distant-sky integration below.
      if (ctx.scene.lightingMode === 'physical') {
        this._heightFogParams.lightColor.setXYZ(0, 0, 0);
      } else {
        this._heightFogParams.lightColor.set(newSunLight);
      }
      this._heightFogParams.lightDir.set(SkyRenderer._getSunDir(ctx.sunLight));
    }
    return oldSunLight;
  }
  renderAtmosphereLUTs(ctx: DrawContext) {
    this._atmosphereParams.lightDir.set(SkyRenderer._getSunDir(ctx.sunLight));
    this._atmosphereParams.lightColor.set(SkyRenderer._getSunColor(ctx.sunLight));
    // Physical: the sun input is photometric (lux), normalized onto the model's authored reference
    // and stored at the fixed PHYSICAL_BAKE_EXPOSURE rather than the live camera exposure. That
    // keeps the cached IBL bake exposure-independent while staying inside the environment cubemap's
    // limited float range -- raw luminance would overflow it to Inf. Consumers rescale to the live
    // exposure via getBakeToPreExposedScale().
    this._atmosphereParams.lightColor.w *=
      this._atmosphereExposure *
      (ctx.scene.lightingMode === 'physical'
        ? SkyRenderer.PHYSICAL_ATMOSPHERE_LUMINANCE_SCALE * SkyRenderer.PHYSICAL_BAKE_EXPOSURE
        : 1);
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
    this._bindgroupDistantLight!.get()!.setTexture('skybox', skybox, fetchSampler('clamp_linear_nomip'));
    this._bindgroupDistantLight!.get()!.setValue('physical', ctx.scene.lightingMode === 'physical' ? 1 : 0);
    ctx.device.setBindGroup(0, this._bindgroupDistantLight!.get()!);
    SkyRenderer._primitiveDistantLight!.draw();
    ctx.device.popDeviceStates();
  }
  updateBakedSkyMap(ctx: DrawContext) {
    const device = ctx.device;
    const tex =
      this._bakedSkyboxTexture.get() && this._bakedSkyboxTexture.get()!.width === this._bakedSkyboxTextureSize
        ? this._bakedSkyboxTexture.get()!
        : device.createCubeTexture(this.envTextureFormat, this._bakedSkyboxTextureSize, {
            mipmapping: false
          })!;
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
      this._bakedSkyboxFrameBuffer.get()!.setColorAttachmentCubeFace(0, face);
      // Direct sunlight is represented by the scene's directional sun light. Keep the analytic
      // sun disk out of both diffuse and specular IBL to avoid baking that direct contribution a
      // second time. Atmospheric scattering and clouds remain in the cubemap.
      this._renderSky(camera, false, false, this._getSkyBakeLuminanceScale(ctx));
    }
    device.popDeviceStates();

    this.renderSkyDistantLut(ctx, tex);

    // Publish the texture reference before deriving IBL so _updateIBLFromBakedSky reads the
    // current cubemap.
    this._bakedSkyboxTexture.set(tex);

    // Derive the IBL from the fog-free cubemap. Height fog is a view/position-dependent participating
    // medium applied per-pixel in screen space (see lightpass renderFog); baking it into the distant
    // environment probe would both double-count it against that screen-space pass and wrongly lift the
    // lower hemisphere (ground direction) from the atmosphere's dark value to a bright fog color. The
    // same reasoning that keeps the sun disk out of the IBL applies to fog, for diffuse and specular alike.
    this._updateIBLFromBakedSky(ctx, tex);

    // Composite fog into the cubemap afterwards. This copy is only used as the visible skybox
    // background (UNIFORM_NAME_BAKED_SKY_MAP), where the fogged distant sky is desired.
    device.pushDeviceStates();
    device.setFramebuffer(this._bakedSkyboxFrameBuffer.get());
    for (const face of [CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ]) {
      camera.lookAtCubeFace(face);
      this._bakedSkyboxFrameBuffer.get()!.setColorAttachmentCubeFace(0, face);
      this.renderFog(camera);
    }
    device.popDeviceStates();

    device.setRenderStates(saveRenderStates);
  }
  /**
   * @internal
   * Updates the scene's IBL (GGX-prefiltered specular radiance map + irradiance SH) from the given
   * cubemap, provided the scene environment light is still driven by this dynamic sky. Must be called
   * with the fog-free cubemap so height fog does not leak into the environment lighting.
   */
  private _updateIBLFromBakedSky(ctx: DrawContext, skybox: TextureCube) {
    if (
      ctx.scene.env.light.radianceMap &&
      (ctx.scene.env.light.radianceMap === this.radianceMap ||
        (this._irradianceSH.get() && ctx.scene.env.light.irradianceSH === this.irradianceSH) ||
        (this._irradianceSHFB.get() && ctx.scene.env.light.irradianceSHFB === this.irradianceSHFB))
    ) {
      prefilterCubemap(skybox, 'ggx', this.radianceFramebuffer!, this._radianceConvSamples);
      ctx.scene.env.light.sheenRadianceMap = this.radianceMap;
      this._shProjector.projectCubemapToTexture(skybox, this.irradianceSHFB);
      ctx.scene.env.light.irradianceSHFB = this.irradianceSHFB;
      ctx.scene.env.light.irradianceSH = null;
      ctx.scene.env.light.irradianceWindow = this._shWindowWeights;
    }
  }
  renderUberFog(camera: Camera, depthTexture: Nullable<BaseTexture>) {
    const device = getDevice();
    const fogProgram = depthTexture ? SkyRenderer._programFog : SkyRenderer._programFogNoDepth;
    const renderStates = SkyRenderer._renderStatesFog;
    const bindgroup = depthTexture ? this._bindgroupFog!.get()! : this._bindgroupFogNoDepth!.get()!;
    if (depthTexture) {
      bindgroup.setTexture('depthTex', depthTexture, fetchSampler('clamp_nearest_nomip'));
    }
    bindgroup.setTexture(
      'skyDistantLightLut',
      this._skyDistantLightLut.get()!.getColorAttachments()[0],
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
    bindgroup.setValue('heightFogParams', this._getUploadHeightFogParams());
    device.setProgram(fogProgram);
    device.setBindGroup(0, bindgroup);
    device.setVertexLayout(SkyRenderer._vertexLayout);
    device.setRenderStates(renderStates);
    device.draw('triangle-strip', 0, 4);
  }
  /**
   * @internal
   * Height-fog upload params with the authored base/directional colors lifted into the pre-exposed
   * physical space when physical lighting is active, plus the pre-exposure the shader applies to its
   * atmosphere-derived LUT samples. Legacy returns the stored params untouched so its upload stays
   * byte-identical. Stored authored values are never mutated.
   */
  private _getUploadHeightFogParams() {
    const scale = this._fogLuminanceScale;
    const p = this._heightFogParams;
    if (scale === 1 && this._fogPreExposure === 1) {
      return p;
    }
    const p1 = p.parameter1;
    const p4 = p.parameter4;
    return {
      ...p,
      parameter1: new Vector4(p1.x * scale, p1.y * scale, p1.z * scale, p1.w),
      parameter4: new Vector4(p4.x * scale, p4.y * scale, p4.z * scale, p4.w),
      preExposure: this._fogPreExposure
    };
  }
  /** @internal */
  renderFog(camera: Camera) {
    const device = getDevice();
    const currentFramebuffer = device.getFramebuffer();
    const depthBuffer = currentFramebuffer?.getDepthAttachment() ?? null;
    const colorBuffer = currentFramebuffer?.getColorAttachments()[0] ?? null;
    const fogFramebuffer =
      depthBuffer && colorBuffer
        ? device.pool.fetchTemporalFramebuffer(false, 0, 0, colorBuffer, null, false)
        : null;
    if (fogFramebuffer) {
      const vp = device.getViewport();
      const scissor = device.getScissor();
      device.pushDeviceStates();
      device.setFramebuffer(fogFramebuffer);
      device.setViewport(vp);
      device.setScissor(scissor);
    }
    const savedRenderStates = device.getRenderStates();
    this._prepareSkyBox(device);
    this.renderUberFog(camera, depthBuffer);
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
    device.setRenderStates(savedRenderStates);
    if (fogFramebuffer) {
      device.popDeviceStates();
      device.pool.releaseFrameBuffer(fogFramebuffer);
    }
  }
  /** @internal */
  private _beginSingleColorPass(withDepth: boolean) {
    const device = getDevice();
    const currentFramebuffer = device.getFramebuffer();
    const colorBuffer = currentFramebuffer?.getColorAttachments()[0] ?? null;
    const depthBuffer = withDepth ? (currentFramebuffer?.getDepthAttachment() ?? null) : null;
    if (!currentFramebuffer || currentFramebuffer.getColorAttachments().length <= 1 || !colorBuffer) {
      return null;
    }
    const framebuffer = device.pool.fetchTemporalFramebuffer(false, 0, 0, colorBuffer, depthBuffer, false);
    const vp = device.getViewport();
    const scissor = device.getScissor();
    device.pushDeviceStates();
    device.setFramebuffer(framebuffer);
    device.setViewport(vp);
    device.setScissor(scissor);
    return framebuffer;
  }
  /** @internal */
  private _endSingleColorPass(framebuffer: Nullable<FrameBuffer>) {
    if (!framebuffer) {
      return;
    }
    const device = getDevice();
    device.popDeviceStates();
    device.pool.releaseFrameBuffer(framebuffer);
  }
  /** @internal */
  renderSky(ctx: DrawContext) {
    let skyCamera = ctx.camera;
    if (!skyCamera.isPerspective()) {
      skyCamera = SkyRenderer._skyCamera;
      ctx.camera.worldMatrix.decompose(null, skyCamera.rotation, null);
    }
    const framebuffer = this._beginSingleColorPass(true);
    try {
      this._renderSky(skyCamera, true, true, this._getSkyScreenLuminanceScale(ctx));
    } finally {
      this._endSingleColorPass(framebuffer);
    }
  }
  /** Disposes resources of this SkyRenderer */
  protected onDispose() {
    super.onDispose();
    this._skyboxTexture.dispose();
    this._bakedSkyboxTexture.dispose();
    this._bakedSkyboxFrameBuffer.dispose();
    this._radianceMap.dispose();
    this._radianceFrameBuffer.dispose();
    this._irradianceSH.dispose();
    this._irradianceSHFB.dispose();
    this._irradianceFrameBuffer.dispose();
    this._shProjector.dispose();
    if (this._skyDistantLightLut.get()) {
      this._skyDistantLightLut.get()!.getColorAttachments()[0].dispose();
      this._skyDistantLightLut.dispose();
    }
    this._bindgroupDistantLight!.dispose();
    for (const k of objectKeys(this._bindgroupSky)) {
      this._bindgroupSky[k]?.dispose();
    }
    this._bindgroupSky = {};
    this._bindgroupFog!.dispose();
    this._bindgroupFogNoDepth!.dispose();
  }
  /** @internal */
  private _updateSkyboxTexture() {
    if (this._panoramaAsset) {
      getEngine()
        .resourceManager.fetchTexture<Texture2D>(this._panoramaAsset, { linearColorSpace: true })
        .then((tex) => {
          if (!tex.isTexture2D()) {
            console.error(`Invalid panorama texture asset: ${this._panoramaAsset}`);
          } else {
            const skyboxTexture = getDevice().createCubeTexture(
              this.envTextureFormat,
              this._skyboxTextureSize,
              {
                mipmapping: false
              }
            )!;
            panoramaToCubemap(tex, skyboxTexture);
            skyboxTexture.name = 'SkyboxTexture';
            this.skyboxTexture = skyboxTexture;
          }
        })
        .catch((err) => {
          console.error(`Load asset failed: ${this._panoramaAsset}: ${err}`);
        });
    }
  }
  /** @internal */
  private _renderSky(camera: Camera, depthTest: boolean, includeSunDisk: boolean, luminanceScale = 1) {
    const device = getDevice();
    const savedRenderStates = device.getRenderStates();
    this._prepareSkyBox(device);
    if (this._skyType === 'scatter') {
      // The atmosphere LUTs already hold physical luminance, so only the caller's exposure applies.
      this._drawScattering(camera, depthTest, includeSunDisk, luminanceScale);
    } else if (this._skyType === 'skybox' && this.skyboxTexture) {
      this._drawSkybox(camera, depthTest, luminanceScale);
    } else {
      this._drawSkyColor(camera, depthTest, luminanceScale);
    }
    device.setRenderStates(savedRenderStates);
  }
  /**
   * @internal
   *
   * Converts a value stored at {@link PHYSICAL_BAKE_EXPOSURE} into the live pre-exposed space.
   *
   * @remarks
   * Everything derived from the cached sky bake (the IBL, the distant-light LUT, the visible baked
   * skybox) is stored at the fixed reference exposure. Multiplying by this ratio yields the same
   * result as if the live camera exposure had been baked in, without invalidating the cache when
   * the camera stops down. Returns 1 in legacy.
   */
  static getBakeToPreExposedScale(ctx: DrawContext) {
    return ctx.scene.lightingMode === 'physical'
      ? ShaderHelper.getPreExposure(ctx) / SkyRenderer.PHYSICAL_BAKE_EXPOSURE
      : 1;
  }
  /**
   * @internal
   *
   * Scale that normalizes a sky into the IBL bake's storage space.
   *
   * @remarks
   * An authored 0..1 `skybox` / `image` is treated as an emitter of `EnvLightWrapper.intensity` lux.
   * The scattering atmosphere needs no lift: its LUTs already carry photometric sun illuminance.
   *
   * Both are then scaled to {@link PHYSICAL_BAKE_EXPOSURE}. The bake is cached and only invalidated
   * by sun changes, so it must be exposure-independent; storing it at raw photometric magnitude
   * would overflow the environment cubemap's float range (see {@link PHYSICAL_BAKE_EXPOSURE}).
   *
   * Returns 1 in legacy so its bake stays byte-identical.
   */
  private _getSkyBakeLuminanceScale(ctx: DrawContext) {
    if (ctx.scene.lightingMode !== 'physical') {
      return 1;
    }
    // scatter already includes the bake exposure via renderAtmosphereLUTs().
    return this._skyType === 'scatter'
      ? 1
      : ctx.scene.env.light.intensity * SkyRenderer.PHYSICAL_BAKE_EXPOSURE;
  }
  /**
   * @internal
   *
   * On-screen sky scale: the bake-time normalization converted from the stored reference exposure
   * to the live one, so the visible sky lands in the same pre-exposed space as every lit surface.
   */
  private _getSkyScreenLuminanceScale(ctx: DrawContext) {
    return this._getSkyBakeLuminanceScale(ctx) * SkyRenderer.getBakeToPreExposedScale(ctx);
  }
  /** @internal */
  private _drawSkyColor(camera: Camera, depthTest: boolean, luminanceScale: number) {
    const device = getDevice();
    const bindgroup = this._bindgroupSky.image!.get()!;
    bindgroup.setValue('color', this._skyColor);
    bindgroup.setValue('luminanceScale', luminanceScale);
    bindgroup.setTexture(
      'texture',
      this._skyImage.get() ?? SkyRenderer._defaultSkyImage.get()!,
      fetchSampler('clamp_linear_nomip')
    );
    bindgroup.setValue('flip', device.getFramebuffer() && device.type === 'webgpu' ? -1 : 1);
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(SkyRenderer._programSky.image!);
    device.setBindGroup(0, bindgroup);
    drawFullscreenQuad(depthTest ? SkyRenderer._renderStatesSky! : SkyRenderer._renderStatesSkyNoDepthTest!);
  }
  /** @internal */
  private _drawSkybox(camera: Camera, depthTest: boolean, luminanceScale: number) {
    const device = getDevice();
    const bindgroup = this._bindgroupSky.skybox!.get()!;
    bindgroup.setTexture('skyCubeMap', this.skyboxTexture!, fetchSampler('clamp_linear_nomip'));
    bindgroup.setValue('luminanceScale', luminanceScale);
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    device.setProgram(SkyRenderer._programSky.skybox!);
    device.setBindGroup(0, bindgroup);
    device.setRenderStates(
      depthTest ? SkyRenderer._renderStatesSky : SkyRenderer._renderStatesSkyNoDepthTest
    );
    SkyRenderer._primitiveSky!.draw();
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
  private _drawScattering(
    camera: Camera,
    depthTest: boolean,
    includeSunDisk: boolean,
    luminanceScale: number
  ) {
    const device = getDevice();
    const tLut = getTransmittanceLut();
    const skyLut = getSkyViewLut();
    //const apLut = ScatteringLut.getAerialPerspectiveLut(alpha, 8000);
    const program = SkyRenderer._programSky.scatter!;
    const bindgroup = this._bindgroupSky.scatter!.get()!;
    bindgroup.setValue(
      'flip',
      device.getFramebuffer() && device.type === 'webgpu' ? new Vector4(1, -1, 1, 1) : new Vector4(1, 1, 1, 1)
    );
    bindgroup.setValue('params', this._atmosphereParams);
    bindgroup.setValue('viewProjMatrix', camera.viewProjectionMatrix);
    bindgroup.setValue('worldMatrix', this._skyWorldMatrix);
    bindgroup.setValue('cameraPos', camera.getWorldPosition());
    bindgroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
    bindgroup.setValue('includeSunDisk', includeSunDisk ? 1 : 0);
    bindgroup.setValue('luminanceScale', luminanceScale);
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
    SkyRenderer._primitiveSky!.draw();
  }
  /** @internal */
  private _prepareSkyBox(device: AbstractDevice) {
    SkyRenderer._createAtmosphereLUTPrograms(device);
    if (!SkyRenderer._defaultSkyImage.get()) {
      const texture = device.createTexture2D('rgba8unorm', 1, 1, { mipmapping: false })!;
      texture.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
      SkyRenderer._defaultSkyImage.set(texture);
    }
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
          this.physical = pb.int().uniform(0);
          pb.main(function () {
            this.$l.sunColor = pb.vec4();
            // Height-fog in-scattering is lit by the sky hemisphere. The old full-sphere average
            // is retained verbatim in legacy mode; in physical mode, mirror lower samples into the
            // upper hemisphere so a dark ground/lower sky cannot turn the horizon into a black band.
            this.$l.sampleDirection = this.$choice(
              pb.notEqual(this.physical, 0),
              pb.vec3(this.$inputs.vector.x, pb.abs(this.$inputs.vector.y), this.$inputs.vector.z),
              this.$inputs.vector
            );
            this.$l.skyColor = pb.textureSampleLevel(this.skybox, this.sampleDirection, 0).rgb;
            this.$outputs.color = pb.vec4(pb.mul(this.skyColor, 1 / 64), 1);
          });
        }
      })!;
      SkyRenderer._programDistantLight.name = '@SkyDistantLight';
    }
    if (!this._bindgroupDistantLight!.get()) {
      this._bindgroupDistantLight!.set(
        device.createBindGroup(SkyRenderer._programDistantLight.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._programFog) {
      SkyRenderer._programFog = SkyRenderer._createFogProgram(device, false);
    }
    if (!SkyRenderer._programFogNoDepth) {
      SkyRenderer._programFogNoDepth = SkyRenderer._createFogProgram(device, true);
    }
    if (!this._bindgroupFog!.get()) {
      this._bindgroupFog!.set(device.createBindGroup(SkyRenderer._programFog.bindGroupLayouts[0]));
    }
    if (!this._bindgroupFogNoDepth!.get()) {
      this._bindgroupFogNoDepth!.set(
        device.createBindGroup(SkyRenderer._programFogNoDepth.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._programSky.image) {
      SkyRenderer._programSky.image = device.buildRenderProgram({
        label: 'ImageSky',
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          this.flip = pb.int().uniform(0);
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type !== 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.color = pb.vec4().uniform(0);
          this.texture = pb.tex2D().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.luminanceScale = pb.float().uniform(0);
          pb.main(function () {
            this.$l.sampleColor = pb.textureSampleLevel(this.texture, this.$inputs.uv, 0);
            // luminanceScale is 1 in legacy and for the IBL bake; on screen in physical mode it
            // carries the environment intensity (lux) pre-multiplied by the camera exposure.
            this.$l.outColor = pb.mul(this.sampleColor, this.color, this.luminanceScale);
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.outColor.rgb, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.outColor.rgb), 1);
            });
          });
        }
      })!;
      SkyRenderer._programSky.image.name = '@SkyImage';
    }
    if (!this._bindgroupSky.image) {
      this._bindgroupSky.image = new DRef(
        device.createBindGroup(SkyRenderer._programSky.image.bindGroupLayouts[0])
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
            this.$builtins.position.z = ShaderHelper.farthestClipZ(this, this.$builtins.position.w);
          });
        },
        fragment(pb) {
          this.$outputs.outColor = pb.vec4();
          this.skyCubeMap = pb.texCube().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.luminanceScale = pb.float().uniform(0);
          pb.main(function () {
            this.$l.texCoord = pb.normalize(this.$inputs.texCoord);
            // luminanceScale is 1 in legacy and for the IBL bake; on screen in physical mode it
            // carries the environment intensity (lux) pre-multiplied by the camera exposure.
            this.$l.color = pb.mul(
              pb.textureSampleLevel(this.skyCubeMap, this.texCoord, 0).rgb,
              this.luminanceScale
            );
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.color, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
            });
          });
        }
      })!;
      SkyRenderer._programSky.skybox.name = '@SkySkybox';
    }
    if (!this._bindgroupSky.skybox) {
      this._bindgroupSky.skybox = new DRef(
        device.createBindGroup(SkyRenderer._programSky.skybox.bindGroupLayouts[0])
      );
    }
    if (!SkyRenderer._renderStatesSky) {
      SkyRenderer._renderStatesSky = device.createRenderStateSet();
      SkyRenderer._renderStatesSky.useDepthState().enableTest(true).enableWrite(false).setCompareFunc(DEPTH_COMPARE_DEFAULT);
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
        .setCompareFunc(DEPTH_COMPARE_FARTHER);
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
            )!
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
  private static _createFogProgram(device: AbstractDevice, noDepth: boolean) {
    const program = device.buildRenderProgram({
      label: 'Fog',
      vertex(pb) {
        this.rt = pb.int().uniform(0);
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
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
        if (!noDepth) {
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        }
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
          this.$l.depthValue = noDepth
            ? pb.float(DEPTH_FARTHEST)
            : pb.textureSample(this.depthTex, this.$inputs.uv).r;
          this.$l.clipSpacePos = pb.vec4(
            pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)),
            ShaderHelper.deviceDepthToClipZ(this, this.depthValue),
            1
          );
          this.$l.hPos = pb.mul(this.invProjViewMatrix, this.clipSpacePos);
          this.$l.worldPos = pb.div(this.$l.hPos, this.$l.hPos.w).xyz;
          this.$l.isSky = ShaderHelper.isFarthestDepth(this, this.$l.depthValue);
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
    })!;
    program.name = noDepth ? '@FogNoDepth' : '@Fog';
    return program;
  }
  /** @internal */
  private static _getSunDir(sunLight?: Nullable<DirectionalLight>) {
    // TODO: reduce GC
    return sunLight?.directionAndCutoff.xyz().scaleBy(-1) ?? ShaderHelper.defaultSunDir;
  }
  /** @internal */
  private static _getSunColor(sunLight?: Nullable<DirectionalLight>) {
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
    const program = device.buildRenderProgram({
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
          this.$builtins.position.z = ShaderHelper.farthestClipZ(this, this.$builtins.position.w);
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        this.tLut = pb.tex2D().uniform(0);
        this.skyLut = pb.tex2D().uniform(0);
        this.params = getAtmosphereParamsStruct(pb)().uniform(0);
        this.includeSunDisk = pb.int().uniform(0);
        if (cloud) {
          this.cloudy = pb.float().uniform(0);
          this.cloudIntensity = pb.float().uniform(0);
          this.time = pb.float().uniform(0);
          this.velocity = pb.vec2().uniform(0);
        }
        this.srgbOut = pb.int().uniform(0);
        this.luminanceScale = pb.float().uniform(0);
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
            this.includeSunDisk,
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
          // 1 for legacy and for the IBL bake; the camera pre-exposure when drawn on screen.
          this.color = pb.mul(this.color, this.luminanceScale);
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.outColor = pb.vec4(this.color, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color), 1);
          });
        });
      }
    })!;
    program.name = cloud ? '@SkyScatterCloud' : '@SkyScatter';
    return program;
  }
}
