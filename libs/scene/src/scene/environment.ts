import type { Vector4 } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { ObservableVector4 } from '@zephyr3d/base';
import type { DrawContext, EnvironmentLighting, EnvLightType } from '../render';
import { EnvShIBL } from '../render';
import { EnvConstantAmbient, EnvHemisphericAmbient, EnvIBL } from '../render';
import { SkyRenderer } from '../render/sky';
import type { GPUDataBuffer, TextureCube } from '@zephyr3d/device';
import { DRef } from '../app';

/**
 * Wrapper for environmant lighting
 * @public
 */
export class EnvLightWrapper {
  private _envLight: EnvironmentLighting;
  private readonly _ambientColor: ObservableVector4;
  private readonly _ambientDown: ObservableVector4;
  private readonly _ambientUp: ObservableVector4;
  private readonly _radianceMap: DRef<TextureCube>;
  private readonly _irradianceMap: DRef<TextureCube>;
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  private readonly _irradianceWindow: Vector3;
  private _strength: number;
  /** @internal */
  constructor() {
    this._envLight = new EnvIBL();
    this._ambientColor = new ObservableVector4(0.2, 0.2, 0.2, 1);
    this._ambientColor.callback = () => {
      if (this.type === 'constant') {
        (this._envLight as EnvConstantAmbient).ambientColor.set(this._ambientColor);
      }
    };
    this._ambientDown = new ObservableVector4(0.2, 0.2, 0.2, 1);
    this._ambientDown.callback = () => {
      if (this.type === 'hemisphere') {
        (this._envLight as EnvHemisphericAmbient).ambientDown.set(this._ambientDown);
      }
    };
    this._ambientUp = new ObservableVector4(0.3, 0.5, 0.8, 1);
    this._ambientUp.callback = () => {
      if (this.type === 'hemisphere') {
        (this._envLight as EnvHemisphericAmbient).ambientUp.set(this._ambientUp);
      }
    };
    this._radianceMap = new DRef();
    this._irradianceMap = new DRef();
    this._irradianceSH = new DRef();
    this._irradianceWindow = new Vector3();
    this._strength = 1;
  }
  /** @internal */
  dispose() {
    this._envLight?.dispose();
    this._radianceMap.dispose();
    this._irradianceMap.dispose();
    this._irradianceSH.dispose();
  }
  /** @internal */
  getHash(ctx?: DrawContext): string {
    return !ctx || ctx.drawEnvLight
      ? `${this.type}:${this._envLight.hasRadiance() ? '1' : '0'}:${
          this._envLight.hasIrradiance() ? '1' : '0'
        }`
      : 'none';
  }
  /** @internal */
  get envLight(): EnvironmentLighting {
    return this._envLight;
  }
  /** The strength of environment lighting */
  get strength(): number {
    return this._strength;
  }
  set strength(val: number) {
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
  get radianceMap(): TextureCube {
    return this._radianceMap.get();
  }
  set radianceMap(tex: TextureCube) {
    this._radianceMap.set(tex);
    if (this.type === 'ibl' || this.type === 'ibl-sh') {
      (this._envLight as EnvIBL | EnvShIBL).radianceMap = this.radianceMap;
    }
  }
  /** Irradiance map for environment light type ibl */
  get irradianceMap(): TextureCube {
    return this._irradianceMap.get();
  }
  set irradianceMap(tex: TextureCube) {
    this._irradianceMap.set(tex);
    if (this.type === 'ibl') {
      (this._envLight as EnvIBL).irradianceMap = this.irradianceMap;
    }
  }
  /** Irradiance SH for environment light type ibl-sh */
  get irradianceSH(): GPUDataBuffer {
    return this._irradianceSH.get();
  }
  set irradianceSH(value: GPUDataBuffer) {
    this._irradianceSH.set(value);
    if (this.type === 'ibl-sh') {
      (this._envLight as EnvShIBL).irradianceSH = this.irradianceSH;
    }
  }
  /** Irradiance SH window for environment light type ibl-sh */
  get irradianceWindow(): Vector3 {
    return this._irradianceWindow;
  }
  set irradianceWindow(value: Vector3) {
    this._irradianceWindow.set(value);
    if (this.type === 'ibl-sh') {
      (this._envLight as EnvShIBL).irradianceWindow = this._irradianceWindow;
    }
  }
  /** The environment light type */
  get type(): EnvLightType {
    return this._envLight?.getType() ?? 'none';
  }
  set type(val: EnvLightType) {
    switch (val) {
      case 'none':
        this._envLight = null;
        break;
      case 'ibl':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvIBL(this.radianceMap, this.irradianceMap);
        }
        (this._envLight as EnvIBL).radianceMap = this.radianceMap;
        (this._envLight as EnvIBL).irradianceMap = this.irradianceMap;
        break;
      case 'ibl-sh':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvShIBL(this.radianceMap, this.irradianceSH);
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
}

/**
 * Environment of scene
 * @public
 */
export class Environment {
  private readonly _sky: SkyRenderer;
  private readonly _light: EnvLightWrapper;
  /** @internal */
  constructor() {
    this._sky = new SkyRenderer();
    this._light = new EnvLightWrapper();
  }
  /** The sky renderer */
  get sky(): SkyRenderer {
    return this._sky;
  }
  /** The environment lighting renderer */
  get light(): EnvLightWrapper {
    return this._light;
  }
  /** @internal */
  getHash(ctx: DrawContext) {
    return `${this.light?.getHash(ctx)}:${this._sky?.getHash(ctx)}`;
  }
  /** @internal */
  needSceneDepthTexture(): boolean {
    return this._sky.fogType !== 'none';
  }
  /** @internal */
  dispose() {
    this._sky.dispose();
    this._light.dispose();
  }
}
