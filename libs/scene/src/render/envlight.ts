import type { Immutable, Nullable } from '@zephyr3d/base';
import { Disposable, DRef, Matrix4x4, REVERSE_Z, Vector2, Vector3 } from '@zephyr3d/base';
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
import { fetchSampler, getSamplerOptions } from '../utility/misc';
import { getDevice } from '../app/api';
import type { DrawContext } from './drawable';
import { getProbeVolumeForDraw } from './gi/probe_volume';
import { declareProbeUniforms, sampleProbeIrradiance } from '../shaders/probes';

/**
 * Depth-proportional term of the SSGI history rejection tolerance. fp16 storage of
 * `linearDepth * cameraFar` has ~4.9e-4 relative error; this keeps ~4x headroom
 * while staying far below a real disocclusion's depth step.
 *
 * @internal
 */
const SSGI_DEPTH_TOLERANCE_RELATIVE = 2e-3;

/**
 * Multiple of the scaled tolerance at which history is dropped outright. Inside it
 * the depth term is a smooth `exp(-d/tol)` weight (~0.05 at 3x), so the cutoff
 * does not staircase.
 *
 * @internal
 */
const SSGI_DEPTH_GATE_SCALE = 3;

/**
 * Clamp distance, in texels, at which history repair reaches its widest radius.
 * Clamp travel measures how unrelated the surviving history is, so it scales the
 * repair radius rather than gating repair off.
 *
 * @internal
 */
const SSGI_REPAIR_WIDE_CLAMP_TEXELS = 8;

/**
 * Repair tap radius in texels, from an interior hole to a camera-edge one. Narrow
 * taps keep detail; wide taps average the surviving edge strip into a smooth
 * estimate instead of copying single texels into streaks.
 *
 * @internal
 */
const SSGI_REPAIR_MIN_RADIUS_TEXELS = 1;
const SSGI_REPAIR_MAX_RADIUS_TEXELS = 16;

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
  abstract initShaderBindings(pb: ProgramBuilder, ctx?: DrawContext): void;
  /**
   * Updates the uniform values
   * @param bg - The bind group to be updated
   */
  abstract updateBindGroup(bg: BindGroup, ctx?: DrawContext): void;
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
   * Get Charlie-filtered sheen radiance for a fragment
   *
   * @param scope - The shader scope
   * @param refl - Reflection vector
   * @param roughness - Sheen roughness
   *
   * @returns The sheen radiance for the fragment
   */
  abstract getSheenRadiance(
    scope: PBInsideFunctionScope,
    refl: PBShaderExp,
    roughness: PBShaderExp
  ): Nullable<PBShaderExp>;
  /**
   * Get irradiance for a fragment
   *
   * @remarks
   * With a draw context: the final diffuse environment lighting (sky irradiance times
   * the environment strength, replaced by probe GI where covered and refined by SSGI
   * history); callers must not scale it again. Without one: raw unscaled sky irradiance.
   *
   * @param scope - The shader scope
   * @param normal - surface normal
   * @param ctx - Draw context of the material shading the fragment, if any
   *
   * @returns The irradiance for the fragment
   */
  abstract getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx?: DrawContext): PBShaderExp;
  /**
   * Returns whether this environment lighting supports reflective light
   */
  abstract hasRadiance(): boolean;
  /**
   * Returns whether this environment lighting supports sheen reflective light
   */
  abstract hasSheenRadiance(): boolean;
  /**
   * Returns whether this environment lighting supports diffuse light
   */
  abstract hasIrradiance(): boolean;
  /**
   * Declares the scene's probe volume where the draw reads it (see
   * {@link getProbeVolumeForDraw}); call from `initShaderBindings` in the fragment stage.
   * @internal
   */
  protected initProbeBindings(pb: ProgramBuilder, ctx?: DrawContext) {
    if (pb.shaderKind === 'fragment' && getProbeVolumeForDraw(ctx)) {
      declareProbeUniforms(pb.getGlobalScope(), 0);
    }
  }
  /** Binds what {@link EnvironmentLighting.initProbeBindings} declared. @internal */
  protected updateProbeBindGroup(bg: BindGroup, ctx?: DrawContext) {
    getProbeVolumeForDraw(ctx)?.applyBindGroup(bg);
  }
  /**
   * Specular occlusion from the probe volume's sky visibility. 1 where probes
   * do not cover the fragment or without a `worldPos` varying.
   * @internal
   */
  getSkySpecularOcclusion(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    NoV: PBShaderExp,
    roughness: PBShaderExp,
    ctx?: DrawContext
  ): PBShaderExp {
    const pb = scope.$builder;
    if (!getProbeVolumeForDraw(ctx)) {
      return pb.float(1);
    }
    const global = pb.getGlobalScope();
    const worldPos = global.$inputs.worldPos as PBShaderExp | undefined;
    if (!worldPos) {
      return pb.float(1);
    }
    const funcName = 'Z_envSkySpecularOcclusion';
    pb.func(funcName, [pb.vec3('n'), pb.vec3('p'), pb.float('NoV'), pb.float('roughness')], function () {
      this.$l.sky = sampleProbeIrradiance(
        this,
        this.p,
        this.n,
        pb.sub(this.camera.position.xyz, this.p),
        'sky'
      );
      this.$l.vis = pb.mix(pb.float(1), this.sky.r, this.sky.a);
      this.$l.r2 = pb.mul(this.roughness, this.roughness);
      this.$return(pb.clamp(pb.add(pb.sub(pb.pow(pb.add(this.NoV, this.vis), this.r2), 1), this.vis), 0, 1));
    });
    return global[funcName](normal, worldPos, NoV, roughness) as PBShaderExp;
  }
  /**
   * Turns raw sky irradiance into material shading irradiance: scaled by the environment
   * strength, then replaced by probe GI where covered (probes are not scaled again).
   * Needs the `worldPos` varying; returns the raw irradiance without a draw context.
   * @internal
   */
  protected applyProbes(
    scope: PBInsideFunctionScope,
    normal: PBShaderExp,
    ctx: Nullable<DrawContext>,
    irradiance: PBShaderExp
  ) {
    const pb = scope.$builder;
    if (!ctx) {
      return irradiance;
    }
    // The light uniforms of the material's light pass; see ShaderHelper.getEnvLightStrength
    const sky = pb.mul(irradiance, scope.light.envLightStrength) as PBShaderExp;
    if (!getProbeVolumeForDraw(ctx)) {
      return sky;
    }
    const global = pb.getGlobalScope();
    const worldPos = global.$inputs.worldPos as PBShaderExp | undefined;
    if (!worldPos) {
      return sky;
    }
    const funcName = 'Z_envIrradianceWithProbes';
    pb.func(funcName, [pb.vec3('n'), pb.vec3('p'), pb.vec3('env')], function () {
      this.$l.probe = sampleProbeIrradiance(this, this.p, this.n, pb.sub(this.camera.position.xyz, this.p));
      this.$return(pb.mix(this.env, this.probe.rgb, this.probe.a));
    });
    return global[funcName](normal, worldPos, sky) as PBShaderExp;
  }
}

/**
 * IBL with SH based environment lighting
 * @public
 */
export class EnvShIBL extends EnvironmentLighting {
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP = 'zIBLRadianceMap';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_SHEEN_RADIANCE_MAP = 'zIBLSheenRadianceMap';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD = 'zIBLRadianceMapMaxLOD';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_IRRADIANCE_SH = 'zIBLIrradianceSH';
  /** @internal */
  public static readonly UNIFORM_NAME_IBL_IRRADIANCE_WINDOW = 'zIBLIrradianceWindow';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_IRRADIANCE = 'zSSGIPreviousIrradiance';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_SURFACE = 'zSSGIPreviousSurface';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_CURRENT_DEPTH = 'zSSGICurrentDepth';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_MOTION = 'zSSGICurrentMotion';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_TARGET_SIZE = 'zSSGITargetSize';
  /** @internal */
  public static readonly UNIFORM_NAME_SSGI_REPROJECTION = 'zSSGIReprojection';
  /**
   * Current view space -> previous-frame clip space. @internal
   */
  public static readonly UNIFORM_NAME_SSGI_VIEW_TO_PREV_CLIP = 'zSSGIViewToPrevClip';
  /** Unprojects a screen-space sample back into current view space. @internal */
  public static readonly UNIFORM_NAME_SSGI_INV_PROJECTION = 'zSSGIInvProjection';
  /** Scratch for the view -> previous clip composition. @internal */
  private static readonly _viewToPrevClip = new Matrix4x4();
  /** @internal */
  private readonly _radianceMap: DRef<TextureCube>;
  /** @internal */
  private readonly _sheenRadianceMap: DRef<TextureCube>;
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
  constructor(
    radianceMap?: TextureCube,
    irradianceSH?: GPUDataBuffer,
    irradianceSHFB?: FrameBuffer,
    sheenRadianceMap?: TextureCube
  ) {
    super();
    this._radianceMap = new DRef(radianceMap || null);
    this._sheenRadianceMap = new DRef(sheenRadianceMap || null);
    this._irradianceSH = new DRef(irradianceSH || null);
    this._irradianceSHFB = new DRef(irradianceSHFB || null);
    this._irraidanceWindow = new Vector3();
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType() {
    return 'ibl' as const;
  }
  /** The radiance map */
  get radianceMap() {
    return this._radianceMap.get();
  }
  set radianceMap(tex) {
    this._radianceMap.set(tex);
  }
  /** The Charlie-filtered sheen radiance map */
  get sheenRadianceMap() {
    return this._sheenRadianceMap.get();
  }
  set sheenRadianceMap(tex) {
    this._sheenRadianceMap.set(tex);
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
  get irradianceWindow() {
    return this._irraidanceWindow;
  }
  set irradianceWindow(val) {
    this._irraidanceWindow = val;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder, ctx?: DrawContext) {
    if (pb.shaderKind === 'fragment') {
      if (this.radianceMap) {
        // Prefiltered radiance cube: mipmap chain indexed by roughness
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP] = pb
          .texCube()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear'));
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD] = pb.float().uniform(0);
      }
      if (this.sheenRadianceMap) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_SHEEN_RADIANCE_MAP] = pb
          .texCube()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear'));
      }
      if (this.irradianceSHFB) {
        const tex = pb.tex2D();
        const formatInfo = getDevice()
          .getDeviceCaps()
          .textureCaps.getTextureFormatInfo(this.irradianceSHFB.getColorAttachments()[0].format);
        if (formatInfo && !formatInfo.filterable) {
          tex.sampleType('unfilterable-float');
        }
        // SH coefficients are read at texel centers; nearest sampling is exact
        tex.withSampler(getSamplerOptions('clamp_nearest_nomip'));
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = tex.uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
      } else if (this.irradianceSH) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH] = pb.vec4[9]().uniformBuffer(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW] = pb.vec3().uniform(0);
      }
      if (EnvShIBL.hasSSGIHistory(ctx)) {
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_linear_nomip'));
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_SURFACE] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_nearest_nomip'));
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_CURRENT_DEPTH] = pb
          .tex2D()
          .uniform(0)
          .withSampler(getSamplerOptions('clamp_nearest_nomip'));
        if (ctx?.motionVectorTexture) {
          pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_MOTION] = pb
            .tex2D()
            .uniform(0)
            .withSampler(getSamplerOptions('clamp_nearest_nomip'));
        }
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE] = pb.vec2().uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_REPROJECTION] = pb.vec4().uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_VIEW_TO_PREV_CLIP] = pb.mat4().uniform(0);
        pb.getGlobalScope()[EnvShIBL.UNIFORM_NAME_SSGI_INV_PROJECTION] = pb.mat4().uniform(0);
      }
      this.initProbeBindings(pb, ctx);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup, ctx?: DrawContext) {
    if (this.radianceMap) {
      bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD, this.radianceMap.mipLevelCount - 1);
      bg.setTexture(EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP, this.radianceMap);
    }
    if (this.sheenRadianceMap) {
      bg.setTexture(EnvShIBL.UNIFORM_NAME_IBL_SHEEN_RADIANCE_MAP, this.sheenRadianceMap);
    }
    if (this.irradianceSHFB) {
      bg.setTexture(
        EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH,
        this.irradianceSHFB.getColorAttachments()[0],
        fetchSampler('clamp_nearest_nomip')
      );
      bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW, this.irradianceWindow);
    } else if (this.irradianceSH) {
      bg.setBuffer(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_SH, this.irradianceSH);
      bg.setValue(EnvShIBL.UNIFORM_NAME_IBL_IRRADIANCE_WINDOW, this.irradianceWindow);
    }
    if (EnvShIBL.hasSSGIHistory(ctx)) {
      bg.setTexture(
        EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE,
        ctx!.SSGIIrradianceHistoryTexture!,
        fetchSampler('clamp_linear_nomip')
      );
      bg.setTexture(
        EnvShIBL.UNIFORM_NAME_SSGI_SURFACE,
        ctx!.SSGISurfaceHistoryTexture!,
        fetchSampler('clamp_nearest_nomip')
      );
      bg.setTexture(
        EnvShIBL.UNIFORM_NAME_SSGI_CURRENT_DEPTH,
        ctx!.linearDepthTexture!,
        fetchSampler('clamp_nearest_nomip')
      );
      if (ctx!.motionVectorTexture) {
        bg.setTexture(
          EnvShIBL.UNIFORM_NAME_SSGI_MOTION,
          ctx!.motionVectorTexture,
          fetchSampler('clamp_nearest_nomip')
        );
      }
      bg.setValue(EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE, new Vector2(ctx!.renderWidth, ctx!.renderHeight));
      bg.setValue(
        EnvShIBL.UNIFORM_NAME_SSGI_REPROJECTION,
        new Vector4(
          ctx!.camera.ssgiDepthReject,
          ctx!.camera.ssgiNormalReject,
          ctx!.camera.getFarPlane(),
          ctx!.camera.getNearPlane()
        )
      );
      // View -> world -> previous clip; without a previous VP the current one makes the depth term a no-op.
      const prevVP = ctx!.camera.prevVPMatrix ?? ctx!.camera.viewProjectionMatrix;
      Matrix4x4.multiply(prevVP as Matrix4x4, ctx!.camera.worldMatrix as Matrix4x4, EnvShIBL._viewToPrevClip);
      bg.setValue(EnvShIBL.UNIFORM_NAME_SSGI_VIEW_TO_PREV_CLIP, EnvShIBL._viewToPrevClip);
      bg.setValue(EnvShIBL.UNIFORM_NAME_SSGI_INV_PROJECTION, ctx!.camera.getInvProjectionMatrix());
    }
    this.updateProbeBindGroup(bg, ctx);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp) {
    const pb = scope.$builder;
    return getDevice().getDeviceCaps().shaderCaps.supportShaderTextureLod
      ? (pb.textureSampleLevel(
          scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP],
          refl,
          pb.mul(roughness, scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD])
        ).rgb as PBShaderExp)
      : (pb.textureSample(scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP], refl).rgb as PBShaderExp);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getSheenRadiance}
   * @override
   */
  getSheenRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp) {
    const pb = scope.$builder;
    return getDevice().getDeviceCaps().shaderCaps.supportShaderTextureLod
      ? (pb.textureSampleLevel(
          scope[EnvShIBL.UNIFORM_NAME_IBL_SHEEN_RADIANCE_MAP],
          refl,
          pb.mul(roughness, scope[EnvShIBL.UNIFORM_NAME_IBL_RADIANCE_MAP_MAX_LOD])
        ).rgb as PBShaderExp)
      : (pb.textureSample(scope[EnvShIBL.UNIFORM_NAME_IBL_SHEEN_RADIANCE_MAP], refl).rgb as PBShaderExp);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx?: DrawContext) {
    const pb = scope.$builder;
    const that = this;
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
      if (that.irradianceSHFB) {
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
    const iblIrradiance = this.applyProbes(
      scope,
      normal,
      ctx ?? null,
      pb.getGlobalScope().Z_sh_eval(normal) as PBShaderExp
    );
    if (!EnvShIBL.hasSSGIHistory(ctx)) {
      return iblIrradiance;
    }
    const useMotionReprojection = !!ctx?.motionVectorTexture;
    pb.func('Z_ssgi_reprojectIrradiance', [pb.vec3('currentNormal'), pb.vec3('ibl')], function () {
      this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this[EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE]);
      if (useMotionReprojection) {
        this.$l.motion = pb.textureSampleLevel(this[EnvShIBL.UNIFORM_NAME_SSGI_MOTION], this.uv, 0).xy;
        this.$l.previousUV = pb.sub(this.uv, this.motion);
        this.$l.motionValid = pb.not(pb.any(pb.greaterThanEqual(pb.abs(this.motion), pb.vec2(5e4))));
      } else {
        this.$l.previousUV = this.uv;
        this.$l.motionValid = pb.bool(true);
      }
      this.$l.params = this[EnvShIBL.UNIFORM_NAME_SSGI_REPROJECTION];
      // Already in the history's units: scaled by the environment strength, probes in place
      this.$l.fallback = this.ibl;
      this.$l.normalizedCurrentNormal = pb.normalize(this.currentNormal);
      this.$l.depthTolerance = pb.max(this.params.x, 1e-4);
      this.$l.texelSize = pb.div(pb.vec2(1), this[EnvShIBL.UNIFORM_NAME_SSGI_TARGET_SIZE]);
      this.$l.halfTexel = pb.mul(this.texelSize, 0.5);
      this.$l.maxUV = pb.sub(pb.vec2(1), this.halfTexel);
      this.$l.previousUVInBounds = pb.and(
        this.motionValid,
        pb.all(pb.greaterThanEqual(this.previousUV, pb.vec2(0))),
        pb.all(pb.lessThanEqual(this.previousUV, pb.vec2(1)))
      );
      this.$l.previousSampleUV = pb.clamp(this.previousUV, this.halfTexel, this.maxUV);
      this.$l.previousSurface = pb.textureSampleLevel(
        this[EnvShIBL.UNIFORM_NAME_SSGI_SURFACE],
        this.previousSampleUV,
        0
      );
      this.$l.previousNormal = pb.normalize(pb.sub(pb.mul(this.previousSurface.rgb, 2), pb.vec3(1)));
      this.$l.currentDepthSample = pb.textureSampleLevel(
        this[EnvShIBL.UNIFORM_NAME_SSGI_CURRENT_DEPTH],
        this.uv,
        0
      );
      this.$l.currentDepth = pb.mul(this.currentDepthSample.r, this.params.z);
      // History Z is in the previous frame's view space; compare via view -> previous
      // clip (`clip.w` = positive view distance) to avoid edge staircases under rotation.
      this.$l.ndc = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
      this.$l.nearPlaneRay = pb.mul(
        this[EnvShIBL.UNIFORM_NAME_SSGI_INV_PROJECTION],
        pb.vec4(this.ndc, REVERSE_Z ? 1 : -1, 1)
      );
      // Unprojecting near-plane NDC depth lands at view z = -near; scale by depth/near.
      this.$l.viewPos = pb.mul(
        pb.div(this.nearPlaneRay.xyz, this.nearPlaneRay.w),
        pb.div(this.currentDepth, pb.max(this.params.w, 1e-6))
      );
      this.$l.expectedPreviousDepth = pb.mul(
        this[EnvShIBL.UNIFORM_NAME_SSGI_VIEW_TO_PREV_CLIP],
        pb.vec4(this.viewPos, 1)
      ).w;
      this.$l.depthDelta = pb.abs(pb.sub(this.previousSurface.a, this.expectedPreviousDepth));
      // fp16 storage error scales with depth, so the tolerance has to as well.
      this.$l.scaledDepthTolerance = pb.add(
        this.depthTolerance,
        pb.mul(this.currentDepth, SSGI_DEPTH_TOLERANCE_RELATIVE)
      );
      this.$l.depthWeight = pb.exp(pb.neg(pb.div(this.depthDelta, this.scaledDepthTolerance)));
      this.$l.depthValid = pb.lessThanEqual(
        this.depthDelta,
        pb.mul(this.scaledDepthTolerance, SSGI_DEPTH_GATE_SCALE)
      );
      this.$l.normalValid = pb.greaterThanEqual(
        pb.dot(this.normalizedCurrentNormal, this.previousNormal),
        this.params.y
      );
      this.$l.previousIrradiance = pb.textureSampleLevel(
        this[EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE],
        this.previousSampleUV,
        0
      );
      this.$l.previousAlpha = pb.clamp(this.previousIrradiance.a, 0, 1);
      this.$l.exactHistoryValid = pb.and(
        this.previousUVInBounds,
        this.depthValid,
        this.normalValid,
        pb.greaterThan(this.previousAlpha, 1e-4)
      );
      this.$if(this.exactHistoryValid, function () {
        // Depth-weighted confidence ramps the gate boundary instead of stepping it.
        this.$l.exactConfidence = pb.mul(this.previousAlpha, this.depthWeight);
        this.$if(pb.greaterThan(this.exactConfidence, 1e-4), function () {
          this.$return(pb.mix(this.fallback, this.previousIrradiance.rgb, this.exactConfidence));
        });
      });

      // Repair disoccluded/off-screen history from nearby samples before falling back to
      // IBL: taps around the clamped reprojection, plus current UV for invalid motion.
      this.$l.repairCenter = this.$choice(
        this.motionValid,
        this.previousSampleUV,
        pb.clamp(this.uv, this.halfTexel, this.maxUV)
      );
      // Clamp travel back onto the screen: zero for interior holes, large for geometry
      // rotating in, where the edge texel is the same surface but unrelated irradiance.
      // It drives the tap radius, trading streaks for blur.
      this.$l.repairClampTexels = pb.div(
        pb.length(pb.sub(this.previousSampleUV, this.previousUV)),
        pb.max(pb.min(this.texelSize.x, this.texelSize.y), 1e-8)
      );
      // Widen taps with clamp travel; only while motion vectors are usable.
      this.$l.repairRadius = pb.mix(
        pb.float(SSGI_REPAIR_MIN_RADIUS_TEXELS),
        pb.float(SSGI_REPAIR_MAX_RADIUS_TEXELS),
        this.$choice(
          this.motionValid,
          pb.smoothStep(0, SSGI_REPAIR_WIDE_CLAMP_TEXELS, this.repairClampTexels),
          pb.float(0)
        )
      );
      // Wide taps straddle real depth variation: loosen the depth gate with the radius
      // and rely on the strict normal term.
      this.$l.repairDepthTolerance = pb.mul(
        this.scaledDepthTolerance,
        SSGI_DEPTH_GATE_SCALE,
        pb.add(1, this.repairRadius)
      );
      this.$l.repairSum = pb.vec3(0);
      this.$l.repairWeight = pb.float(0);
      // Full ring: four wide axis-aligned taps paint directional artifacts.
      const repairSamples = [
        { currentUV: false, x: 0, y: 0, kernel: 1 },
        { currentUV: false, x: -1, y: 0, kernel: 0.7 },
        { currentUV: false, x: 1, y: 0, kernel: 0.7 },
        { currentUV: false, x: 0, y: -1, kernel: 0.7 },
        { currentUV: false, x: 0, y: 1, kernel: 0.7 },
        { currentUV: false, x: -0.7071, y: -0.7071, kernel: 0.5 },
        { currentUV: false, x: 0.7071, y: -0.7071, kernel: 0.5 },
        { currentUV: false, x: -0.7071, y: 0.7071, kernel: 0.5 },
        { currentUV: false, x: 0.7071, y: 0.7071, kernel: 0.5 },
        { currentUV: true, x: 0, y: 0, kernel: 0.5 }
      ];
      for (let i = 0; i < repairSamples.length; i++) {
        const sample = repairSamples[i];
        const baseUV = sample.currentUV ? this.uv : this.repairCenter;
        this.$l[`repairUV${i}`] = pb.add(
          baseUV,
          pb.mul(this.texelSize, pb.vec2(sample.x, sample.y), this.repairRadius)
        );
        this.$l[`repairUVValid${i}`] = pb.and(
          pb.all(pb.greaterThanEqual(this[`repairUV${i}`], this.halfTexel)),
          pb.all(pb.lessThanEqual(this[`repairUV${i}`], this.maxUV))
        );
        this.$l[`repairSurface${i}`] = pb.textureSampleLevel(
          this[EnvShIBL.UNIFORM_NAME_SSGI_SURFACE],
          pb.clamp(this[`repairUV${i}`], this.halfTexel, this.maxUV),
          0
        );
        this.$l[`repairNormal${i}`] = pb.normalize(
          pb.sub(pb.mul(this[`repairSurface${i}`].rgb, 2), pb.vec3(1))
        );
        // Compared against the reprojected depth: taps sample the previous frame's surface.
        this.$l[`repairDepthDelta${i}`] = pb.abs(
          pb.sub(this[`repairSurface${i}`].a, this.expectedPreviousDepth)
        );
        this.$l[`repairNormalDot${i}`] = pb.dot(this.normalizedCurrentNormal, this[`repairNormal${i}`]);
        this.$l[`repairSurfaceValid${i}`] = pb.and(
          this[`repairUVValid${i}`],
          pb.lessThanEqual(this[`repairDepthDelta${i}`], this.repairDepthTolerance),
          pb.greaterThanEqual(this[`repairNormalDot${i}`], this.params.y)
        );
        this.$l[`repairIrradiance${i}`] = pb.textureSampleLevel(
          this[EnvShIBL.UNIFORM_NAME_SSGI_IRRADIANCE],
          pb.clamp(this[`repairUV${i}`], this.halfTexel, this.maxUV),
          0
        );
        // Same widening as the hard gate above.
        this.$l[`repairDepthWeight${i}`] = pb.exp(
          pb.neg(pb.div(this[`repairDepthDelta${i}`], this.repairDepthTolerance))
        );
        this.$l[`repairNormalWeight${i}`] = pb.pow(pb.max(0, this[`repairNormalDot${i}`]), 8);
        this.$l[`repairSampleWeight${i}`] = pb.mul(
          pb.float(this[`repairSurfaceValid${i}`]),
          pb.clamp(this[`repairIrradiance${i}`].a, 0, 1),
          this[`repairDepthWeight${i}`],
          this[`repairNormalWeight${i}`],
          // The screen-stationary tap only covers unusable motion vectors; otherwise it
          // leaves a stationary ghost.
          sample.currentUV ? pb.float(pb.not(this.motionValid)) : pb.float(1),
          sample.kernel
        );
        this.repairSum = pb.add(
          this.repairSum,
          pb.mul(this[`repairIrradiance${i}`].rgb, this[`repairSampleWeight${i}`])
        );
        this.repairWeight = pb.add(this.repairWeight, this[`repairSampleWeight${i}`]);
      }
      this.$if(pb.greaterThan(this.repairWeight, 1e-4), function () {
        this.$l.repairedIrradiance = pb.div(this.repairSum, this.repairWeight);
        // Repaired samples are intentionally capped below full confidence so
        // newly traced irradiance replaces the extrapolation on following frames.
        this.$l.repairConfidence = pb.mul(pb.clamp(this.repairWeight, 0, 1), 0.85);
        this.$return(pb.mix(this.fallback, this.repairedIrradiance, this.repairConfidence));
      });
      this.$return(this.fallback);
    });
    return scope.Z_ssgi_reprojectIrradiance(normal, iblIrradiance) as PBShaderExp;
  }

  /** Whether all textures required by the lighting reprojection are scoped. @internal */
  static hasSSGIHistory(ctx?: DrawContext) {
    return !!(
      ctx?.SSGI &&
      ctx.SSGIIrradianceHistoryTexture &&
      ctx.SSGISurfaceHistoryTexture &&
      ctx.motionVectorTexture &&
      ctx.linearDepthTexture
    );
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance() {
    return !!this._radianceMap.get();
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasSheenRadiance}
   * @override
   */
  hasSheenRadiance() {
    return !!this._sheenRadianceMap.get();
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance() {
    return !!this._irradianceSH.get() || !!this._irradianceSHFB.get();
  }
  /**
   * Disposes the object and releases all GPU resources
   * @override
   */
  protected onDispose() {
    super.onDispose();
    this._radianceMap.dispose();
    this._sheenRadianceMap.dispose();
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
  get ambientColor(): Immutable<Vector4> {
    return this._ambientColor;
  }
  set ambientColor(ambientColor: Immutable<Vector4>) {
    if (ambientColor) {
      this._ambientColor.set(ambientColor);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType() {
    return 'constant' as const;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder, ctx?: DrawContext) {
    if (pb.shaderKind === 'fragment') {
      pb.getGlobalScope()[EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT] = pb.vec4().uniform(0);
      this.initProbeBindings(pb, ctx);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup, ctx?: DrawContext) {
    bg.setValue(EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT, this._ambientColor);
    this.updateProbeBindGroup(bg, ctx);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   *
   * @remarks
   * A uniform environment prefilters to itself, so radiance is the ambient color. It
   * must be present: at grazing angles specular takes the diffuse energy, else silhouettes go black.
   */
  getRadiance(scope: PBInsideFunctionScope, _refl: PBShaderExp, _roughness: PBShaderExp) {
    return scope[EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT].rgb as PBShaderExp;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getSheenRadiance}
   * @override
   */
  getSheenRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp) {
    return this.getRadiance(scope, refl, roughness);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx?: DrawContext) {
    return this.applyProbes(
      scope,
      normal,
      ctx ?? null,
      scope[EnvConstantAmbient.UNIFORM_NAME_CONSTANT_AMBIENT].rgb as PBShaderExp
    );
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance() {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasSheenRadiance}
   * @override
   */
  hasSheenRadiance() {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance() {
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
  get ambientUp(): Immutable<Vector4> {
    return this._ambientUp;
  }
  set ambientUp(color: Immutable<Vector4>) {
    if (color) {
      this._ambientUp.set(color);
    }
  }
  /** The downside ambient color */
  get ambientDown(): Immutable<Vector4> {
    return this._ambientDown;
  }
  set ambientDown(color: Immutable<Vector4>) {
    if (color) {
      this._ambientDown.set(color);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType() {
    return 'hemisphere' as const;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder, ctx?: DrawContext) {
    if (pb.shaderKind === 'fragment') {
      pb.getGlobalScope()[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP] = pb.vec4().uniform(0);
      pb.getGlobalScope()[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN] = pb.vec4().uniform(0);
      this.initProbeBindings(pb, ctx);
    }
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup, ctx?: DrawContext) {
    bg.setValue(EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP, this._ambientUp);
    bg.setValue(EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN, this._ambientDown);
    this.updateProbeBindGroup(bg, ctx);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, _roughness: PBShaderExp) {
    const pb = scope.$builder;
    const factor = pb.add(pb.mul(refl.y, 0.5), 0.5);
    return pb.mix(
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN],
      scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP],
      factor
    ).rgb as PBShaderExp;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getSheenRadiance}
   * @override
   */
  getSheenRadiance(scope: PBInsideFunctionScope, refl: PBShaderExp, roughness: PBShaderExp) {
    return this.getRadiance(scope, refl, roughness);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx?: DrawContext) {
    const pb = scope.$builder;
    const factor = pb.add(pb.mul(normal.y, 0.5), 0.5);
    return this.applyProbes(
      scope,
      normal,
      ctx ?? null,
      pb.mix(
        scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_DOWN],
        scope[EnvHemisphericAmbient.UNIFORM_NAME_AMBIENT_UP],
        factor
      ).rgb as PBShaderExp
    );
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance() {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasSheenRadiance}
   * @override
   */
  hasSheenRadiance() {
    return true;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance() {
    return true;
  }
}

/**
 * Environment lighting for type `none`: no sky, only probe-volume GI over black,
 * since bounced scene light does not depend on the environment. Used only while
 * the probe volume is ready.
 * @internal
 */
export class EnvProbesOnly extends EnvironmentLighting {
  /**
   * {@inheritDoc EnvironmentLighting.getType}
   * @override
   */
  getType() {
    return 'none' as const;
  }
  /**
   * {@inheritDoc EnvironmentLighting.initShaderBindings}
   * @override
   */
  initShaderBindings(pb: ProgramBuilder, ctx?: DrawContext) {
    this.initProbeBindings(pb, ctx);
  }
  /**
   * {@inheritDoc EnvironmentLighting.updateBindGroup}
   * @override
   */
  updateBindGroup(bg: BindGroup, ctx?: DrawContext) {
    this.updateProbeBindGroup(bg, ctx);
  }
  /**
   * {@inheritDoc EnvironmentLighting.getRadiance}
   * @override
   */
  getRadiance(_scope: PBInsideFunctionScope, _refl: PBShaderExp, _roughness: PBShaderExp) {
    return null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getSheenRadiance}
   * @override
   */
  getSheenRadiance(_scope: PBInsideFunctionScope, _refl: PBShaderExp, _roughness: PBShaderExp) {
    return null;
  }
  /**
   * {@inheritDoc EnvironmentLighting.getIrradiance}
   * @override
   */
  getIrradiance(scope: PBInsideFunctionScope, normal: PBShaderExp, ctx?: DrawContext) {
    return this.applyProbes(scope, normal, ctx ?? null, scope.$builder.vec3(0));
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasRadiance}
   * @override
   */
  hasRadiance() {
    return false;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasSheenRadiance}
   * @override
   */
  hasSheenRadiance() {
    return false;
  }
  /**
   * {@inheritDoc EnvironmentLighting.hasIrradiance}
   * @override
   */
  hasIrradiance() {
    return true;
  }
}
