import { Vector4 } from '@zephyr3d/base';
import { BindGroup, PBInsideFunctionScope, PBShaderExp, ProgramBuilder, TextureCube } from '@zephyr3d/device';
import { Application } from '../app';

/**
 * Environment light type
 * @public
 */
export type EnvLightType = 'ibl'|'hemisphere'|'constant'|'none';


/**
 * Base class for any kind of environment light
 * @public
 */
export abstract class EnvironmentLighting {
  /**
   * The environment light type
   */
  abstract getType(): EnvLightType;
  /**
   * Initialize shader bindings
   * @param pb - The program builder
   */
  abstract initShaderBindings(pb: ProgramBuilder): void;
  /**
   * Updates the uniform values
   * @param bg - The bind group to be updated
   */
  abstract updateBindGroup(bg: BindGroup): void;
  /**
   * Get radiance for a fragment
   *
   * @param scope - The shader scope
   * @param surfaceData - surface data of the fragment
   *
   * @returns The radiance for the fragment
   */
  abstract getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp;
  /**
   * Get irradiance for a fragment
   *
   * @param scope - The shader scope
   * @param surfaceData - surface data of the fragment
   *
   * @returns The radiance for the fragment
   */
  abstract getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp;
  /**
   * Returns whether this environment lighting supports reflective light
   */
  abstract hasRadiance(): boolean;
  /**
   * Returns whether this environment lighting supports diffuse light
   */
  abstract hasIrradiance(): boolean;
   /**
   * Whether this is an instance of EnvIBL
   * @returns true if this is an instance of EnvIBL
   */
  isIBL(): this is EnvIBL {
    return false;
  }
  /**
   * Whether this is an instance of EnvConstantAmbient
   * @returns true if this is an instance of EnvConstantAmbient
   */
  isConstant(): this is EnvConstantAmbient {
    return false;
  }
  /**
   * Whether this is an instance of EnvHemisphericAmbient
   * @returns true if this is an instance of EnvHemisphericAmbient
   */
  isHemispheric(): this is EnvHemisphericAmbient {
    return false;
  }
}

/**
 * IBL based environment lighting
 * @public
 */
export class EnvIBL extends EnvironmentLighting {
  /** @internal */
  public static readonly USAGE_IBL_RADIANCE_MAP = 'usage_ibl_radiance_map';
  /** @internal */
  public static readonly USAGE_IBL_RADIANCE_MAP_MAX_LOD = 'usage_ibl_radiance_map_maxlod';
  /** @internal */
  public static readonly USAGE_IBL_IRRADIANCE_MAP = 'usage_ibl_irradiance_map';
  /** @internal */
  private _radianceMap: TextureCube;
  /** @internal */
  private _irradianceMap: TextureCube;
  /**
   * Creates an instance of EnvIBL
   * @param radianceMap - The radiance map
   * @param irradianceMap - The irradiance map
   */
  constructor(radianceMap?: TextureCube, irradianceMap?: TextureCube) {
    super();
    this._radianceMap = radianceMap || null;
    this._irradianceMap = irradianceMap || null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'ibl';
  }
  /** The radiance map */
  get radianceMap(): TextureCube {
    return this._radianceMap;
  }
  set radianceMap(tex: TextureCube) {
    this._radianceMap = tex;
  }
  /** The irradiance map */
  get irradianceMap(): TextureCube {
    return this._irradianceMap;
  }
  set irradianceMap(tex: TextureCube) {
    this._irradianceMap = tex;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      pb.getGlobalScope().iblRadianceMap = pb.texCube().uniform(0).tag(EnvIBL.USAGE_IBL_RADIANCE_MAP);
      pb.getGlobalScope().iblIrradianceMap = pb.texCube().uniform(0).tag(EnvIBL.USAGE_IBL_IRRADIANCE_MAP);
      pb.getGlobalScope().radianceMaxLod = pb.float('radianceMaxLod').uniform(0).tag(EnvIBL.USAGE_IBL_RADIANCE_MAP_MAX_LOD);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    if (this._radianceMap) {
      bg.setValue('radianceMaxLod', this._radianceMap.mipLevelCount - 1);
      bg.setTexture('iblRadianceMap', this._radianceMap);
    }
    if (this._irradianceMap) {
      bg.setTexture('iblIrradianceMap', this._irradianceMap);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return Application.instance.device.getDeviceCaps().shaderCaps.supportShaderTextureLod
    ? pb.textureSampleLevel(scope.iblRadianceMap, refl, pb.mul(roughness, scope.radianceMaxLod)).rgb
    : pb.textureSample(scope.iblRadianceMap, refl).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return pb.textureSampleLevel(scope.iblIrradianceMap, normal, 0).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance(): boolean {
    return !!this._radianceMap;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance(): boolean {
    return !!this._irradianceMap;
  }
  /**
   * {@inheritDoc EnvironmentLighting.isIBL}
   * @override
   */
  isIBL(): this is EnvIBL {
    return true;
  }
}

/**
 * Constant ambient light
 * @public
 */
export class EnvConstantAmbient extends EnvironmentLighting {
  /** @internal */
  public static readonly USAGE_CONSTANT_AMBIENT_LIGHTING = 'usage_env_constant_ambient';
  /** @internal */
  public static readonly funcNameGetAmbient = 'lib_getConstantAmbient';
  /** @internal */
  private _ambientColor: Vector4;
  /**
   * Creates an instance of EnvConstantAmbient
   * @param ambientColor - The ambient color
   */
  constructor(ambientColor?: Vector4) {
    super();
    this._ambientColor = ambientColor ? new Vector4(ambientColor) : new Vector4(0, 0, 0, 1);
  }
  /** The ambient color */
  get ambientColor(): Vector4 {
    return this._ambientColor;
  }
  set ambientColor(ambientColor: Vector4) {
    if (ambientColor) {
      this._ambientColor.set(ambientColor);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'constant';
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      pb.getGlobalScope().ambientLight = pb.vec4().uniform(0).tag(EnvConstantAmbient.USAGE_CONSTANT_AMBIENT_LIGHTING);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    bg.setValue('ambientLight', this._ambientColor);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    return null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    return scope.ambientLight.rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance(): boolean {
    return false;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance(): boolean {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.isConstant}
   * @override
   */
  isConstant(): this is EnvConstantAmbient {
    return true;
  }
}

/**
 * Hemispheric ambient light
 * @public
 */
 export class EnvHemisphericAmbient extends EnvironmentLighting {
  /** @internal */
  public static readonly USAGE_CONSTANT_AMBIENT_UP = 'usage_env_ambient_up';
  /** @internal */
  public static readonly USAGE_CONSTANT_AMBIENT_DOWN = 'usage_env_ambient_down';
  /** @internal */
  public static readonly funcNameGetAmbient = 'lib_getConstantAmbient';
  /** @internal */
  private _ambientUp: Vector4;
  /** @internal */
  private _ambientDown: Vector4;
  /**
   * Creates an instance of EnvConstantAmbient
   * @param ambientUp - The upside ambient color
   * @param ambientDown - The downside ambient color
   */
  constructor(ambientUp: Vector4, ambientDown: Vector4) {
    super();
    this._ambientUp = new Vector4(ambientUp);
    this._ambientDown = new Vector4(ambientDown);
  }
  /** The upside ambient color */
  get ambientUp(): Vector4 {
    return this._ambientUp;
  }
  set ambientUp(color: Vector4) {
    if (color) {
      this._ambientUp.set(color);
    }
  }
  /** The downside ambient color */
  get ambientDown(): Vector4 {
    return this._ambientDown;
  }
  set ambientDown(color: Vector4) {
    if (color) {
      this._ambientDown.set(color);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'hemisphere';
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      pb.getGlobalScope().ambientUp = pb.vec4().uniform(0).tag(EnvHemisphericAmbient.USAGE_CONSTANT_AMBIENT_UP);
      pb.getGlobalScope().ambientDown = pb.vec4().uniform(0).tag(EnvHemisphericAmbient.USAGE_CONSTANT_AMBIENT_DOWN);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    bg.setValue('ambientUp', this._ambientUp);
    bg.setValue('ambientDown', this._ambientDown);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    return null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const factor = pb.add(pb.mul(normal.y, 0.5), 0.5);
    return pb.mix(scope.ambientDown, scope.ambientUp, factor).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance(): boolean {
    return false;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance(): boolean {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.isHemispheric}
   * @override
   */
  isHemispheric(): this is EnvHemisphericAmbient {
    return true;
  }
}
