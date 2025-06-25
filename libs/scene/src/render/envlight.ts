import type { Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  TextureCube
} from '@zephyr3d/device';
import { Application } from '../app/app';
import { DRef } from '../app';

/**
 * Environment light type
 * @public
 */
export type EnvLightType = 'ibl' | 'ibl-sh' | 'hemisphere' | 'constant' | 'none';

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
   * @param refl - Reflection vector
   * @param roughness - Surface roughness
   *
   * @returns The radiance for the fragment
   */
  abstract getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp;
  /**
   * Get irradiance for a fragment
   *
   * @param scope - The shader scope
   * @param normal - surface normal
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
   * Dispose this object
   */
  dispose() {}
}

/**
 * IBL with SH based environment lighting
 * @public
 */
export class EnvShIBL extends EnvironmentLighting {
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP = 'zIBLRadianceMap';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD = 'zIBLRadianceMapMaxLOD';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_IRRADIANCE_SH = 'zIBLIrradianceSH';
  /** @internal */
  private _radianceMap: DRef<TextureCube>;
  /** @internal */
  private _irradianceSH: Float32Array;
  /**
   * Creates an instance of EnvIBL
   * @param radianceMap - The radiance map
   * @param irradianceSH - The irradiance SH
   */
  constructor(radianceMap?: TextureCube, irradianceSH?: (Vector4 | Vector3)[] | Float32Array) {
    super();
    this._radianceMap = new DRef(radianceMap || null);
    if (!irradianceSH) {
      this._irradianceSH = null;
    } else {
      this._irradianceSH = new Float32Array(9 * 4);
      if (irradianceSH instanceof Float32Array) {
        if (irradianceSH.length !== 9 * 4) {
          throw new Error(`3rd order SH coefficients expected`);
        }
        this._irradianceSH.set(irradianceSH);
      } else {
        if (irradianceSH.length !== 9) {
          throw new Error(`3rd order SH coefficients expected`);
        }
        for (let i = 0; i < 9; i++) {
          this._irradianceSH[i * 4 + 0] = irradianceSH[i].x;
          this._irradianceSH[i * 4 + 1] = irradianceSH[i].y;
          this._irradianceSH[i * 4 + 2] = irradianceSH[i].z;
        }
      }
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'ibl-sh';
  }
  /**
   * {@inheritDoc EnvironmentLighting.dispose}
   * @override
   */
  dispose() {
    this._radianceMap.dispose();
  }
  /** The radiance map */
  get radianceMap(): TextureCube {
    return this._radianceMap.get();
  }
  set radianceMap(tex: TextureCube) {
    this._radianceMap.set(tex);
  }
  /** The irradiance sh coeffecients */
  get irradianceSH(): Float32Array {
    return this._irradianceSH;
  }
  set irradianceSH(value: Float32Array) {
    if (value && value.length < 36) {
      throw new Error(`3rd order SH coefficients expected`);
    }
    this._irradianceSH = value;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      if (this._radianceMap) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP] = pb.texCube().uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD] = pb.float().uniform(0);
      }
      if (this._irradianceSH) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.vec4[9]().uniform(0);
      }
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    if (this.radianceMap) {
      bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD, this.radianceMap.mipLevelCount - 1);
      bg.setTexture(EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP, this.radianceMap);
    }
    if (this._irradianceSH) {
      bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH, this._irradianceSH);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return Application.instance.device.getDeviceCaps().shaderCaps.supportShaderTextureLod
      ? pb.textureSampleLevel(
          scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP],
          refl,
          pb.mul(roughness, scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD])
        ).rgb
      : pb.textureSample(scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP], refl).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    pb.func('Z_sh_Y0', [pb.vec3('v')], function () {
      this.$return(0.2820947917);
    });
    pb.func('Z_sh_Y1', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.y, -0.4886025119));
    });
    pb.func('Z_sh_Y2', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.z, 0.4886025119));
    });
    pb.func('Z_sh_Y3', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.x, -0.4886025119));
    });
    pb.func('Z_sh_Y4', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.x, this.v.y, 1.0925484306));
    });
    pb.func('Z_sh_Y5', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.y, this.v.z, -1.0925484306));
    });
    pb.func('Z_sh_Y6', [pb.vec3('v')], function () {
      this.$return(pb.mul(pb.sub(pb.mul(this.v.z, this.v.z, 3), 1), 0.3153915652));
    });
    pb.func('Z_sh_Y7', [pb.vec3('v')], function () {
      this.$return(pb.mul(this.v.x, this.v.z, -1.0925484306));
    });
    pb.func('Z_sh_Y8', [pb.vec3('v')], function () {
      this.$return(pb.mul(pb.sub(pb.mul(this.v.x, this.v.x), pb.mul(this.v.y, this.v.y)), 0.5462742153));
    });
    pb.func('Z_sh_eval', [pb.vec3('v')], function () {
      this.$l.c = pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][0].xyz, this.Z_sh_Y0(this.v));
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][1].xyz, this.Z_sh_Y1(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][2].xyz, this.Z_sh_Y2(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][3].xyz, this.Z_sh_Y3(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][4].xyz, this.Z_sh_Y4(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][5].xyz, this.Z_sh_Y5(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][6].xyz, this.Z_sh_Y6(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][7].xyz, this.Z_sh_Y7(this.v))
      );
      this.c = pb.add(
        this.c,
        pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][8].xyz, this.Z_sh_Y8(this.v))
      );
      this.$return(this.c);
    });
    return pb.getGlobalScope().Z_sh_eval(normal);
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
    return !!this._irradianceSH;
  }
}

/**
 * IBL based environment lighting
 * @public
 */
export class EnvIBL extends EnvironmentLighting {
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP = 'zIBLRadianceMap';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD = 'zIBLRadianceMapMaxLOD';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_IRRADIANCE_MAP = 'zIBLIrradianceMap';
  /** @internal */
  private _radianceMap: DRef<TextureCube>;
  /** @internal */
  private _irradianceMap: DRef<TextureCube>;
  /**
   * Creates an instance of EnvIBL
   * @param radianceMap - The radiance map
   * @param irradianceMap - The irradiance map
   */
  constructor(radianceMap?: TextureCube, irradianceMap?: TextureCube) {
    super();
    this._radianceMap = new DRef(radianceMap);
    this._irradianceMap = new DRef(irradianceMap);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'ibl';
  }
  /**
   * {@inheritDoc EnvironmentLighting.dispose}
   * @override
   */
  dispose() {
    this._radianceMap.dispose();
    this._irradianceMap.dispose();
  }
  /** The radiance map */
  get radianceMap(): TextureCube {
    return this._radianceMap.get();
  }
  set radianceMap(tex: TextureCube) {
    this._radianceMap.set(tex);
  }
  /** The irradiance map */
  get irradianceMap(): TextureCube {
    return this._irradianceMap.get();
  }
  set irradianceMap(tex: TextureCube) {
    this._irradianceMap.set(tex);
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      if (this._radianceMap.get()) {
        pb.getGlobalScope()[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP] = pb.texCube().uniform(0);
        pb.getGlobalScope()[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD] = pb.float().uniform(0);
      }
      if (this._irradianceMap.get()) {
        pb.getGlobalScope()[EnvIBL.UNIFORM_NAME_IBL_IRRADIANCE_MAP] = pb.texCube().uniform(0);
      }
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    if (this._radianceMap.get()) {
      bg.setValue(EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD, this.radianceMap.mipLevelCount - 1);
      bg.setTexture(EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP, this.radianceMap);
    }
    if (this._irradianceMap.get()) {
      bg.setTexture(EnvIBL.UNIFORM_NAME_IBL_IRRADIANCE_MAP, this.irradianceMap);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return Application.instance.device.getDeviceCaps().shaderCaps.supportShaderTextureLod
      ? pb.textureSampleLevel(
          scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP],
          refl,
          pb.mul(roughness, scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD])
        ).rgb
      : pb.textureSample(scope[EnvIBL.UNIFORM_NAME_IBL_RADIANCE_MAP], refl).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return pb.textureSampleLevel(scope[EnvIBL.UNIFORM_NAME_IBL_IRRADIANCE_MAP], normal, 0).rgb;
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
}

/**
 * Constant ambient light
 * @public
 */
export class EnvConstantAmbient extends EnvironmentLighting {
  /** @internal */
  public static readonly UNIFORM_NAME_CONSTANT_AMBIENT = 'zConstantAmbient';
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
      pb.getGlobalScope()[EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT] = pb.vec4().uniform(0);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    bg.setValue(EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT, this._ambientColor);
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
    return scope[EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT].rgb;
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
}

/**
 * Hemispheric ambient light
 * @public
 */
export class EnvHemisphericAmbient extends EnvironmentLighting {
  /** @internal */
  public static readonly UNIFORM_NAME_AMBIENT_UP = 'zHemisphericAmbientUp';
  /** @internal */
  public static readonly UNIFORM_NAME_AMBIENT_DOWN = 'zHemisphericAmbientDown';
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
      pb.getGlobalScope()[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP] = pb.vec4().uniform(0);
      pb.getGlobalScope()[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN] = pb.vec4().uniform(0);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup): void {
    bg.setValue(EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP, this._ambientUp);
    bg.setValue(EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN, this._ambientDown);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const factor = pb.add(pb.mul(refl.y, 0.5), 0.5);
    return pb.mix(
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN],
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP],
      factor
    ).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const factor = pb.add(pb.mul(normal.y, 0.5), 0.5);
    return pb.mix(
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN],
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP],
      factor
    ).rgb;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance(): boolean {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance(): boolean {
    return true;
  }
}
