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
  private readonly _irradianceMap: DRef<TextureCube>;
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  private readonly _irradianceSHFB: DRef<FrameBuffer>;
  private readonly _irradianceWindow: Vector3;
  private _strength: number;
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
    this._irradianceMap = new DRef();
    this._irradianceSH = new DRef();
    this._irradianceSHFB = new DRef();
    this._irradianceWindow = new Vector3();
    this._strength = 1;
  }
  /** @internal */
  getHash(ctx?: DrawContext) {
    return !ctx || ctx.drawEnvLight
      ? `${this.type}:${this._envLight!.hasRadiance() ? '1' : '0'}:${
          this._envLight!.hasIrradiance() ? '1' : '0'
        }`
      : 'none';
  }
  /** @internal */
  get envLight() {
    return this._envLight!;
  }
  /** The strength of environment lighting */
  get strength() {
    return this._strength;
  }
  set strength(val) {
    this._strength = val;
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
          this._envLight = new EnvShIBL(this.radianceMap!, this.irradianceSH!);
        }
        (this._envLight as EnvShIBL).radianceMap = this.radianceMap;
        (this._envLight as EnvShIBL).irradianceSH = this.irradianceSH;
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
