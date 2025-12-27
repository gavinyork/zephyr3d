import type { Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Vector3 } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type {
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder,
  TextureCube
} from '@zephyr3d/device';
import { fetchSampler } from '../utility/misc';
import { getDevice } from '../app/api';

/**
 * Environment light type
 * @public
 */
export type EnvLightType = 'ibl' | 'hemisphere' | 'constant' | 'none';

/**
 * Base class for any kind of environment light
 * @public
 */
export abstract class EnvironmentLighting extends Disposable {
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
  abstract getRadiance(
    scope: PBInsideFunctionScope,
    refl: PBShaderExp,
    roughness: PBShaderExp
  ): Nullable<PBShaderExp>;
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
  public static readonly UNIFORM_NAME_IBL_IRRADIANCE_WINDOW = 'zIBLIrradianceWindow';
  /** @internal */
  private readonly _radianceMap: DRef<TextureCube>;
  /** @internal */
  private readonly _irradianceSH: DRef<GPUDataBuffer>;
  /** @internal */
  private readonly _irradianceSHFB: DRef<FrameBuffer>;
  /** @internal */
  private _irraidanceWindow: Vector3;
  /**
   * Creates an instance of EnvIBL
   * @param radianceMap - The radiance map
   * @param irradianceSH - The irradiance SH
   */
  constructor(radianceMap?: TextureCube, irradianceSH?: GPUDataBuffer, irradianceSHFB?: FrameBuffer) {
    super();
    this._radianceMap = new DRef(radianceMap || null);
    this._irradianceSH = new DRef(irradianceSH || null);
    this._irradianceSHFB = new DRef(irradianceSHFB || null);
    this._irraidanceWindow = new Vector3();
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType(): EnvLightType {
    return 'ibl';
  }
  /** The radiance map */
  get radianceMap() {
    return this._radianceMap.get();
  }
  set radianceMap(tex) {
    this._radianceMap.set(tex);
  }
  /** The irradiance sh coeffecients */
  get irradianceSH() {
    return this._irradianceSH.get();
  }
  set irradianceSH(value) {
    this._irradianceSH.set(value);
  }
  /** The irradiance sh coeffecients */
  get irradianceSHFB() {
    return this._irradianceSHFB.get();
  }
  set irradianceSHFB(value) {
    this._irradianceSHFB.set(value);
  }
  /** The irradiance sh window */
  get irradianceWindow(): Vector3 {
    return this._irraidanceWindow;
  }
  set irradianceWindow(val: Vector3) {
    this._irraidanceWindow = val;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder): void {
    if (pb.shaderKind === 'fragment') {
      if (this.radianceMap) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP] = pb.texCube().uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD] = pb.float().uniform(0);
      }
      if (getDevice().type === 'webgl' || !getDevice().getDeviceCaps().framebufferCaps.supportFloatBlending) {
        if (this.irradianceSHFB) {
          pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.tex2D().uniform(0);
          pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
        }
      } else {
        if (this.irradianceSH) {
          pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.vec4[9]().uniformBuffer(0);
          pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
        }
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
    if (getDevice().type === 'webgl' || !getDevice().getDeviceCaps().framebufferCaps.supportFloatBlending) {
      if (this.irradianceSHFB) {
        bg.setTexture(
          EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH,
          this.irradianceSHFB.getColorAttachments()[0],
          fetchSampler('clamp_nearest_nomip')
        );
        bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW, this.irradianceWindow);
      }
    } else {
      if (this.irradianceSH) {
        bg.setBuffer(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH, this.irradianceSH);
        bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW, this.irradianceWindow);
      }
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    return getDevice().getDeviceCaps().shaderCaps.supportShaderTextureLod
      ? pb.textureSampleLevel(
          scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP],
          refl,
          pb.mul(roughness, scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD])
        ).rgb
      : pb.textureSample(scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP], refl).rgb;
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
      this.$l.window = this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW];
      if (getDevice().type === 'webgl' || !getDevice().getDeviceCaps().framebufferCaps.supportFloatBlending) {
        this.$l.c = pb.mul(
          pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(0.5 / 3, 0.5 / 3), 0)
            .rgb,
          this.Z_sh_Y0(this.v),
          this.window.x
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(1.5 / 3, 0.5 / 3), 0)
              .rgb,
            this.Z_sh_Y1(this.v),
            this.window.y
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(2.5 / 3, 0.5 / 3), 0)
              .rgb,
            this.Z_sh_Y2(this.v),
            this.window.y
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(0.5 / 3, 1.5 / 3), 0)
              .rgb,
            this.Z_sh_Y3(this.v),
            this.window.y
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(1.5 / 3, 1.5 / 3), 0)
              .rgb,
            this.Z_sh_Y4(this.v),
            this.window.z
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(2.5 / 3, 1.5 / 3), 0)
              .rgb,
            this.Z_sh_Y5(this.v),
            this.window.z
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(0.5 / 3, 2.5 / 3), 0)
              .rgb,
            this.Z_sh_Y6(this.v),
            this.window.z
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(1.5 / 3, 2.5 / 3), 0)
              .rgb,
            this.Z_sh_Y7(this.v),
            this.window.z
          )
        );
        this.c = pb.add(
          this.c,
          pb.mul(
            pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH], pb.vec2(2.5 / 3, 2.5 / 3), 0)
              .rgb,
            this.Z_sh_Y8(this.v),
            this.window.z
          )
        );
      } else {
        this.$l.c = pb.mul(
          this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][0].xyz,
          this.Z_sh_Y0(this.v),
          this.window.x
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][1].xyz, this.Z_sh_Y1(this.v), this.window.y)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][2].xyz, this.Z_sh_Y2(this.v), this.window.y)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][3].xyz, this.Z_sh_Y3(this.v), this.window.y)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][4].xyz, this.Z_sh_Y4(this.v), this.window.z)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][5].xyz, this.Z_sh_Y5(this.v), this.window.z)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][6].xyz, this.Z_sh_Y6(this.v), this.window.z)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][7].xyz, this.Z_sh_Y7(this.v), this.window.z)
        );
        this.c = pb.add(
          this.c,
          pb.mul(this[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH][8].xyz, this.Z_sh_Y8(this.v), this.window.z)
        );
      }
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
  /**
   * Disposes the object and releases all GPU resources
   * @override
   */
  protected onDispose() {
    super.onDispose();
    this._radianceMap.dispose();
    this._irradianceSH.dispose();
    this._irradianceSHFB.dispose();
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
  private readonly _ambientColor: Vector4;
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
  getRadiance(
    _scope: PBInsideFunctionScope,
    _refl: PBShaderExp,
    _roughness: PBShaderExp
  ): Nullable<PBShaderExp> {
    return null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, _normal: PBShaderExp): PBShaderExp {
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
  private readonly _ambientUp: Vector4;
  /** @internal */
  private readonly _ambientDown: Vector4;
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
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, _roughness: PBShaderExp): PBShaderExp {
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
