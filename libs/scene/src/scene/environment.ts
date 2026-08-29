import type { Immutable, Nullable, Vector4 } from '@zephyr3d/base';
import { Vector3, DRef, Disposable } from '@zephyr3d/base';
import { ObservableVector4 } from '@zephyr3d/base';
import type { DrawContext, EnvironmentLighting } from '../render';
import { EnvShIBL } from '../render';
import { EnvConstantAmbient, EnvHemisphericAmbient } from '../render';
import { SkyRenderer } from '../render/sky';
import type { FrameBuffer, GPUDataBuffer, TextureCube } from '@zephyr3d/device';

/**
 * Wrapper for environmant lighting
 * @public
 */
export class EnvLightWrapper extends Disposable {
  private _envLight: Nullable<EnvironmentLighting>;
  private readonly _ambientColor: ObservableVector4;
  private readonly _ambientDown: ObservableVector4;
  private readonly _ambientUp: ObservableVector4;
  private readonly _radianceMap: DRef<TextureCube>;
  private readonly _sheenRadianceMap: DRef<TextureCube>;
  private readonly _irradianceMap: DRef<TextureCube>;
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  private readonly _irradianceSHFB: DRef<FrameBuffer>;
  private readonly _irradianceWindow: Vector3;
  private _strength: number;
  private _intensity: number;
  private _specularStrength: number;
  /** @internal Invalidates the owning Environment's cached sky bake. */
  private _invalidateBake: Nullable<() => void>;
  /** @internal */
  constructor() {
    super();
    this._envLight = new EnvShIBL();
    this._ambientColor = new ObservableVector4(0.2, 0.2, 0.2, 1).setCallback(() => {
      if (this.type === 'constant') {
        (this._envLight as EnvConstantAmbient).ambientColor.set(this._ambientColor);
      }
    });
    this._ambientDown = new ObservableVector4(0.2, 0.2, 0.2, 1).setCallback(() => {
      if (this.type === 'hemisphere') {
        (this._envLight as EnvHemisphericAmbient).ambientDown.set(this._ambientDown);
      }
    });
    this._ambientUp = new ObservableVector4(0.3, 0.5, 0.8, 1).setCallback(() => {
      if (this.type === 'hemisphere') {
        (this._envLight as EnvHemisphericAmbient).ambientUp.set(this._ambientUp);
      }
    });
    this._radianceMap = new DRef();
    this._sheenRadianceMap = new DRef();
    this._irradianceMap = new DRef();
    this._irradianceSH = new DRef();
    this._irradianceSHFB = new DRef();
    this._irradianceWindow = new Vector3();
    this._strength = 1;
    // Filament's IndirectLight default intensity, in lux.
    this._intensity = 30000;
    this._specularStrength = 1;
    this._invalidateBake = null;
  }
  /**
   * @internal
   * Registers the owning {@link Environment}'s sky-bake invalidator, so photometric properties that
   * are only applied at bake time can force a re-bake when they change.
   */
  setBakeInvalidator(invalidate: Nullable<() => void>) {
    this._invalidateBake = invalidate;
  }
  /** @internal */
  getHash(ctx?: DrawContext) {
    const irradianceSource =
      this.type === 'ibl'
        ? this._irradianceSHFB.get()
          ? 'fb'
          : this._irradianceSH.get()
            ? 'buf'
            : 'none'
        : 'na';
    const ssgiHistory =
      !!ctx?.SSGI &&
      !!ctx.SSGIIrradianceHistoryTexture &&
      !!ctx.SSGISurfaceHistoryTexture &&
      (ctx.device.type === 'webgl' || !!ctx.motionVectorTexture);
    return !ctx || ctx.drawEnvLight
      ? `${this.type}:${this._envLight!.hasRadiance() ? '1' : '0'}:${
          this._envLight!.hasSheenRadiance() ? '1' : '0'
        }:${this._envLight!.hasIrradiance() ? '1' : '0'}:${irradianceSource}:ssgi${ssgiHistory ? '1' : '0'}`
      : 'none';
  }
  /** @internal */
  get envLight() {
    return this._envLight!;
  }
  /**
   * Multiplier on environment lighting, in both lighting modes.
   *
   * @remarks
   * In physical mode this is the per-frame dimmer for the IBL. The photometric {@link intensity}
   * only reaches the image through the cached sky bake -- and a `scatter` sky ignores it entirely,
   * taking its brightness from the sun -- so this is the control that always responds. 0 turns
   * environment lighting off.
   */
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = val;
  }
  /**
   * Physical environment light intensity, in lux.
   *
   * @remarks
   * Mirrors Filament's `IndirectLight::Builder::intensity`: the illuminance a unit (0..1)
   * environment texture value represents. Applied when the sky is baked, so changing it re-bakes.
   *
   * Only affects authored skies (`skybox`, `image`). A `scatter` sky derives its luminance from the
   * sun's illuminance, so this value never enters its bake -- use {@link strength} to dim that.
   *
   * Used only when the owning scene enables physical lighting; legacy uses {@link strength}.
   * Default 30,000 lux matches Filament's default (roughly an overcast-to-hazy sky).
   */
  get intensity() {
    return this._intensity;
  }
  set intensity(val) {
    const intensity = Math.max(0, val);
    if (intensity !== this._intensity) {
      this._intensity = intensity;
      // Authored skies are lifted by this value when baked, so the cached cubemap is stale now.
      // A scatter sky ignores it (its brightness comes from the sun), but re-baking is harmless.
      this._invalidateBake?.();
    }
  }
  /**
   * Physical environment light intensity in lux.
   *
   * @deprecated Renamed to {@link intensity} to match the photometric unit it carries.
   */
  get radianceScale() {
    return this._intensity;
  }
  set radianceScale(val) {
    this.intensity = val;
  }
  /** The strength of environment specular lighting */
  get specularStrength() {
    return this._specularStrength;
  }
  set specularStrength(val) {
    this._specularStrength = val;
  }
  /** Ambient light color for environment light type constant */
  get ambientColor(): Vector4 {
    return this._ambientColor;
  }
  set ambientColor(val: Vector4) {
    this._ambientColor.set(val);
  }
  /** Up color for environment light type hemisphere */
  get ambientUp(): Vector4 {
    return this._ambientUp;
  }
  set ambientUp(val: Vector4) {
    this._ambientUp.set(val);
  }
  /** Down color for environment light type hemisphere */
  get ambientDown(): Vector4 {
    return this._ambientDown;
  }
  set ambientDown(val: Vector4) {
    this._ambientDown.set(val);
  }
  /** Radiance map for environment light type ibl */
  get radianceMap() {
    return this._radianceMap.get();
  }
  set radianceMap(tex) {
    this._radianceMap.set(tex);
    if (this.type === 'ibl') {
      (this._envLight as EnvShIBL).radianceMap = this.radianceMap;
    }
  }
  /** Charlie-filtered sheen radiance map for environment light type ibl */
  get sheenRadianceMap() {
    return this._sheenRadianceMap.get();
  }
  set sheenRadianceMap(tex) {
    this._sheenRadianceMap.set(tex);
    if (this.type === 'ibl') {
      (this._envLight as EnvShIBL).sheenRadianceMap = this.sheenRadianceMap;
    }
  }
  /** Irradiance SH buffer for environment light type ibl */
  get irradianceSH() {
    return this._irradianceSH.get();
  }
  set irradianceSH(value) {
    this._irradianceSH.set(value);
    if (this.type === 'ibl') {
      (this._envLight as EnvShIBL).irradianceSH = this.irradianceSH;
    }
  }
  /** Irradiance SH texture for environment light type ibl */
  get irradianceSHFB() {
    return this._irradianceSHFB.get();
  }
  set irradianceSHFB(value) {
    this._irradianceSHFB.set(value);
    if (this.type === 'ibl') {
      (this._envLight as EnvShIBL).irradianceSHFB = this.irradianceSHFB;
    }
  }
  /** Irradiance SH window for environment light type ibl */
  get irradianceWindow(): Immutable<Vector3> {
    return this._irradianceWindow;
  }
  set irradianceWindow(value: Immutable<Vector3>) {
    this._irradianceWindow.set(value);
    if (this.type === 'ibl') {
      (this._envLight as EnvShIBL).irradianceWindow = this._irradianceWindow;
    }
  }
  /** The environment light type */
  get type() {
    return this._envLight?.getType() ?? 'none';
  }
  set type(val) {
    switch (val) {
      case 'none':
        this._envLight = null;
        break;
      case 'ibl':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvShIBL(
            this.radianceMap!,
            this.irradianceSH!,
            this.irradianceSHFB!,
            this.sheenRadianceMap!
          );
        }
        (this._envLight as EnvShIBL).radianceMap = this.radianceMap;
        (this._envLight as EnvShIBL).sheenRadianceMap = this.sheenRadianceMap;
        (this._envLight as EnvShIBL).irradianceSH = this.irradianceSH;
        (this._envLight as EnvShIBL).irradianceSHFB = this.irradianceSHFB;
        (this._envLight as EnvShIBL).irradianceWindow = this.irradianceWindow;
        break;
      case 'constant':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvConstantAmbient(this._ambientColor);
        }
        break;
      case 'hemisphere':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvHemisphericAmbient(this._ambientUp, this._ambientDown);
        }
        break;
      default:
        break;
    }
  }
  /** Disposes the environment lighting wrapper */
  protected onDispose() {
    super.onDispose();
    this._envLight?.dispose();
    this._radianceMap.dispose();
    this._sheenRadianceMap.dispose();
    this._irradianceMap.dispose();
    this._irradianceSHFB.dispose();
    this._irradianceSH.dispose();
  }
}

/**
 * Environment of scene
 * @public
 */
export class Environment extends Disposable {
  private readonly _sky: SkyRenderer;
  private readonly _light: EnvLightWrapper;
  /** @internal */
  constructor() {
    super();
    this._sky = new SkyRenderer();
    this._light = new EnvLightWrapper();
    // The physical `intensity` only reaches the image through the cached sky bake, so changing it
    // has to re-bake; otherwise the cubemap keeps the value it was baked with.
    this._light.setBakeInvalidator(() => this._sky.invalidate());
  }
  /** The sky renderer */
  get sky() {
    return this._sky;
  }
  /** The environment lighting renderer */
  get light() {
    return this._light;
  }
  /** @internal */
  getHash(ctx: DrawContext) {
    return `${this.light?.getHash(ctx)}:${this._sky?.getHash(ctx)}`;
  }
  /** @internal */
  needSceneDepthTexture() {
    return this._sky.fogType !== 'none';
  }
  /** Disposes the environment object */
  protected onDispose() {
    super.onDispose();
    this._sky.dispose();
    this._light.dispose();
  }
}
