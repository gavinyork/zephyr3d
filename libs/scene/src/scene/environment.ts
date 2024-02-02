import { Vector4 } from "@zephyr3d/base";
import { DrawContext, EnvConstantAmbient, EnvHemisphericAmbient, EnvIBL, EnvironmentLighting, EnvLightType } from "../render";
import { SkyRenderer } from '../render/sky';
import type { TextureCube } from "@zephyr3d/device";

/**
 * Wrapper for environmant lighting
 * @public
 */
export class EnvLightWrapper {
  private _envLight: EnvironmentLighting;
  private _ambientColor: Vector4;
  private _ambientDown: Vector4;
  private _ambientUp: Vector4;
  private _radianceMap: TextureCube;
  private _irradianceMap: TextureCube;
  private _strength: number;
  /** @internal */
  constructor() {
    this._envLight = new EnvIBL();
    this._ambientColor = new Vector4(0.2, 0.2, 0.2, 1);
    this._ambientDown = new Vector4(0.2, 0.2, 0.2, 1);
    this._ambientUp = new Vector4(0.3, 0.5, 0.8, 1);
    this._radianceMap = null;
    this._irradianceMap = null;
    this._strength = 1;
  }
  /** @internal */
  getHash(ctx: DrawContext): string {
    return ctx.drawEnvLight ? `${this.type}:${this._envLight.hasRadiance() ? '1' : '0'}:${this._envLight.hasIrradiance() ? '1' : '0'}` : 'none';
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
    return this._ambientColor.clone();
  }
  set ambientColor(val: Vector4) {
    this._ambientColor.set(val);
    if (this.type === 'constant') {
      (this._envLight as EnvConstantAmbient).ambientColor = this._ambientColor;
    }
  }
  /** Up color for environment light type hemisphere */
  get ambientUp(): Vector4 {
    return this._ambientUp.clone();
  }
  set ambientUp(val: Vector4) {
    this._ambientUp.set(val);
    if (this.type === 'hemisphere') {
      (this._envLight as EnvHemisphericAmbient).ambientUp = this._ambientUp;
    }
  }
  /** Down color for environment light type hemisphere */
  get ambientDown(): Vector4 {
    return this._ambientDown.clone();
  }
  set ambientDown(val: Vector4) {
    this._ambientDown.set(val);
    if (this.type === 'hemisphere') {
      (this._envLight as EnvHemisphericAmbient).ambientDown = this._ambientDown;
    }
  }
  /** Radiance map for environment light type ibl */
  get radianceMap(): TextureCube {
    return this._radianceMap;
  }
  set radianceMap(tex: TextureCube) {
    this._radianceMap = tex ?? null;
    if (this.type === 'ibl') {
      (this._envLight as EnvIBL).radianceMap = this._radianceMap;
    }
  }
  /** Irradiance map for environment light type ibl */
  get irradianceMap(): TextureCube {
    return this._irradianceMap;
  }
  set irradianceMap(tex: TextureCube) {
    this._irradianceMap = tex ?? null;
    if (this.type === 'ibl') {
      (this._envLight as EnvIBL).irradianceMap = this._irradianceMap;
    }
  }
  /** The environment light type */
  get type(): EnvLightType {
    return this._envLight?.getType() ?? 'none';
  }
  set type(val: EnvLightType) {
    switch(val) {
      case 'none':
        this._envLight = null;
        break;
      case 'ibl':
        if (this._envLight?.getType() !== val) {
          this._envLight = new EnvIBL(this._radianceMap, this._irradianceMap);
        }
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
  private _sky: SkyRenderer;
  private _light: EnvLightWrapper;
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
}
