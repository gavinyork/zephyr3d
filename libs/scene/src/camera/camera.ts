import type { CubeFace, Immutable, Nullable, Plane } from '@zephyr3d/base';
import {
  DEPTH_CLEAR_VALUE,
  DRef,
  Vector2,
  Matrix4x4,
  Frustum,
  Vector4,
  Vector3,
  Ray,
  halton23
} from '@zephyr3d/base';
import { SceneNode } from '../scene/scene_node';
import type { Drawable, PickTarget } from '../render/drawable';
import type { BaseTexture } from '@zephyr3d/device';
import { Compositor } from '../posteffect/compositor';
import type { Scene } from '../scene/scene';
import type {
  BaseCameraController,
  IBaseEvent,
  IControllerKeydownEvent,
  IControllerKeyupEvent,
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent
} from './base';
import type { OIT } from '../render/oit';
import { TAA } from '../posteffect/taa';
import { SSGI } from '../posteffect/ssgi';
import { SSR } from '../posteffect/ssr';
import { SSS } from '../posteffect/sss';
import { SkinSSS } from '../posteffect/skinsss';
import { Tonemap } from '../posteffect/tonemap';
import { FXAA } from '../posteffect/fxaa';
import { Bloom } from '../posteffect/bloom';
import { SAO } from '../posteffect/sao';
import { MotionBlur } from '../posteffect/motionblur';
import { ColorAdjust } from '../posteffect/coloradjust';
import { getDevice } from '../app/api';
import type { ScreenConfig } from '../app/screen';
import { ScreenAdapter } from '../app/screen';
import { ABufferOIT } from '../render/abuffer_oit';
import { WeightedBlendedOIT } from '../render/weightedblended_oit';
import { DualDepthPeelingOIT } from '../render/dualdepthpeeling_oit';
import type { HistoryResourceManager } from '../render';
import type { FrameGraphContext, RenderPipeline } from '../render';
import { RGHistoryResources } from '../render/rendergraph/history_resources';
import { calculateEV100, calculatePhysicalExposure } from '../utility/physical';
import type { LightingMode } from '../utility/physical';

/**
 * Result of a camera picking operation.
 *
 * Used by GPU/CPU picking flows to report what was intersected.
 *
 * @public
 */
export type PickResult = {
  /** Distance from ray origin to intersection point (world units). */
  distance: number;
  /** Intersection point in world space. */
  intersectedPoint: Vector3;
  /** The intersected drawable, if known. */
  drawable: Drawable;
  /** Logical pick target information. */
  target: PickTarget;
};

/**
 * Temporal history resources used by reprojection (TAA, motion blur).
 *
 * @public
 */
export type CameraHistoryData = {
  prevColorTex: Nullable<BaseTexture>;
  prevMotionVectorTex: Nullable<BaseTexture>;
  prevSSRReflectTex: Nullable<BaseTexture>;
  prevSSRMotionVectorTex: Nullable<BaseTexture>;
};

/**
 * Camera render path mode.
 * @public
 */
export type RenderPath = 'forward';
/**
 * Camera Order-Independent Transparency mode.
 * @public
 */
export type CameraOITMode = 'none' | 'weighted' | 'abuffer' | 'dual-depth';
/**
 * Subsurface Scattering debug visualization modes (implementation-defined).
 * @public
 */
export type SSSDebugView =
  | 'none'
  | 'scatter_mask'
  | 'scatter_softness'
  | 'scatter_radius'
  | 'scatter_falloff'
  | 'profile_energy'
  | 'profile_transmission'
  | 'profile_boundary'
  | 'diffuse'
  | 'blur'
  | 'screen_thinness'
  | 'thin_transmission_mask'
  | 'thin_lighting'
  | 'transmission_shadow';
/**
 * Subsurface Scattering quality presets that resolve multiple internal settings for convenience.
 * @public
 */
export type SSSQualityPreset = 'quality' | 'balanced' | 'performance';
/**
 * Resolved Subsurface Scattering settings after applying the quality preset. These are the actual settings used by the SSS post effect.
 * @public
 */
export type SSSResolvedSettings = {
  halfRes: boolean;
  blurKernelSize: number;
  blurStdDev: number;
  blurDepthCutoff: number;
  normalCutoff: number;
};

/** Screen Space Global Illumination quality preset. @public */
export type SSGIQualityPreset = 'quality' | 'balanced' | 'performance' | 'custom';

/** Resolved trace and denoise settings used by the SSGI post effect. @public */
export type SSGIResolvedSettings = {
  halfRes: boolean;
  raysPerPixel: number;
  maxSteps: number;
  denoisePasses: number;
};

const SSGI_QUALITY_PRESET_SETTINGS: Record<Exclude<SSGIQualityPreset, 'custom'>, SSGIResolvedSettings> = {
  quality: { halfRes: false, raysPerPixel: 2, maxSteps: 64, denoisePasses: 3 },
  balanced: { halfRes: true, raysPerPixel: 1, maxSteps: 48, denoisePasses: 2 },
  performance: { halfRes: true, raysPerPixel: 1, maxSteps: 24, denoisePasses: 1 }
};

type SSSDefaultSettings = {
  blurScale: number;
  strength: number;
  transmissionStrength: number;
  transmissionPower: number;
  multiScatter: number;
};

const SSS_DEFAULT_SETTINGS: SSSDefaultSettings = {
  blurScale: 11,
  strength: 0.65,
  transmissionStrength: 0.18,
  transmissionPower: 2.1,
  multiScatter: 0.08
};

const SSS_QUALITY_PRESET_SETTINGS: Record<SSSQualityPreset, SSSResolvedSettings> = {
  quality: {
    halfRes: false,
    blurKernelSize: 11,
    blurStdDev: 3.5,
    blurDepthCutoff: 0.24,
    normalCutoff: 0.82
  },
  balanced: {
    halfRes: false,
    blurKernelSize: 9,
    blurStdDev: 3,
    blurDepthCutoff: 0.26,
    normalCutoff: 0.78
  },
  performance: {
    halfRes: true,
    blurKernelSize: 7,
    blurStdDev: 2.4,
    blurDepthCutoff: 0.32,
    normalCutoff: 0.72
  }
};

/**
 * A renderable camera node that manages view/projection math, frusta,
 * input control, picking, and a post-processing chain via a compositor.
 *
 * Key features:
 * - Maintains projection, view, VP, and inverse VP matrices and lazily recomputes them when invalidated.
 * - Provides world- and view-space frusta for culling and clipping.
 * - Supports perspective and orthographic projections.
 * - Integrates with post effects (Tonemap, FXAA, TAA, Bloom, SSR, SSS, SSAO, Motion Blur) through an internal `Compositor`.
 * - Handles temporal jitter and history state when TAA or motion blur are enabled.
 * - Emits picking rays from screen coordinates and supports async GPU picking.
 * - Optional controller integration for user input handling.
 *
 * Performance notes:
 * - Matrices/frusta are computed on demand and cached until invalidation.
 * - Temporal jitter and history are set up only when required by enabled features and device support.
 *
 * @public
 */
export class Camera extends SceneNode {
  /** @internal Halton 2-3 sequence used for TAA jittering. */
  private static readonly _halton23 = halton23(16);
  /** @internal Per-camera history resources. */
  private static readonly _historyData: WeakMap<Camera, CameraHistoryData> = new WeakMap();
  /** @internal Per-camera history resource manager. */
  private static readonly _historyResourceManager: WeakMap<Camera, HistoryResourceManager> = new WeakMap();
  /** @internal Screen adapter for this camera */
  protected _screenAdapter: ScreenAdapter;
  /** @internal Whether the camera is adapted */
  protected _adapted: boolean;
  /** @internal Adapted viewport */
  protected _adaptedViewport: Nullable<number[]>;
  /** @internal Adapted relative viewport */
  protected _adaptedRelativeViewport: Nullable<number[]>;
  /** @internal RenderTarget version */
  protected _adaptedVersion: number;
  /** @internal Projection matrix. */
  protected _projMatrix: Matrix4x4;
  /** @internal Inverse projection matrix. */
  protected _invProjMatrix: Matrix4x4;
  /** @internal View matrix (world -\> camera). */
  protected _viewMatrix: Matrix4x4;
  /** @internal View-projection matrix. */
  protected _viewProjMatrix: Matrix4x4;
  /** @internal Inverse view-projection matrix. */
  protected _invViewProjMatrix: Matrix4x4;
  /** @internal Framebuffer clear color, disabled when null. Default is null */
  protected _clearColor: Vector4;
  /** @internal Framebuffer depth clear value, disabled when null. Default is 1 */
  protected _clearDepth: number;
  /** @internal Framebuffer stencil clear value, disabled when null. Default is 0 */
  protected _clearStencil: number;
  /** @internal Optional clip plane in camera space. */
  protected _clipPlane: Nullable<Plane>;
  /** @internal Camera controller (input). */
  protected _controller: Nullable<BaseCameraController>;
  /** @internal World-space frustum (from VP). */
  protected _frustum: Nullable<Frustum>;
  /** @internal View-space frustum (from P). */
  protected _frustumV: Nullable<Frustum>;
  /** @internal Dirty flag indicating derived matrices/frusta need recompute. */
  protected _dirty: boolean;
  /** @internal Viewport [x, y, w, h]; null uses full framebuffer. */
  protected _viewport: Nullable<number[]>;
  /** @internal Scissor rectangle [x, y, w, h]; null uses viewport. */
  protected _scissor: Nullable<number[]>;
  /** @internal Clip plane mask for custom clipping schemes. */
  protected _clipMask: number;
  /** @internal Order-Independent Transparency reference. */
  protected _oit: DRef<OIT>;
  /** @internal OIT algorithm selection mode. */
  protected _oitMode: CameraOITMode;
  /** @internal ABuffer OIT layer budget. */
  protected _oitABufferLayers: number;
  /** @internal Dual depth peeling OIT peel iteration count. */
  protected _oitDualDepthPeels: number;
  /** @internal Whether to perform a depth pre-pass. */
  protected _depthPrePass: boolean;
  /** @internal Render path selection for scene renderer. */
  protected _renderPath: RenderPath;
  /** @internal Whether command buffers may be reused for optimization. */
  protected _commandBufferReuse: boolean;
  /** @internal Hi-Z acceleration enable (primarily for SSR). */
  protected _HiZ: boolean;
  /** @internal Screen-space shadow mask enable (Forward+ deferred shadows). */
  protected _screenSpaceShadowMask: boolean;
  /** @internal If true, a float point backbuffer will be used. The default value is true */
  protected _HDR: boolean;
  /** @internal Tonemap enable flag (via post effect). */
  protected _toneMap: boolean;
  /** @internal Tonemap post effect reference. */
  protected _postEffectTonemap: DRef<Tonemap>;
  /** @internal Tonemap exposure. */
  protected _tonemapExposure: number;
  /** @internal Lens aperture expressed as an f-number. */
  protected _aperture: number;
  /** @internal Shutter-open time in seconds. */
  protected _shutterSpeed: number;
  /** @internal Sensor sensitivity. */
  protected _ISO: number;
  /** @internal Exposure compensation in stops. */
  protected _exposureCompensation: number;
  /** @internal Lighting mode currently reflected by the post effect ordering. */
  protected _postProcessingLightingMode: Nullable<LightingMode>;
  /** @internal Motion blur enable flag (via post effect). */
  protected _motionBlur: boolean;
  /** @internal Motion blur post effect reference. */
  protected _postEffectMotionBlur: DRef<MotionBlur>;
  /** @internal Motion blur strength. */
  protected _motionBlurStrength: number;
  /** @internal Bloom enable flag (via post effect). */
  protected _bloom: boolean;
  /** @internal Bloom post effect reference. */
  protected _postEffectBloom: DRef<Bloom>;
  /** @internal Bloom downsample level cap. */
  protected _bloomMaxDownsampleLevels: number;
  /** @internal Bloom downsample resolution limit. */
  protected _bloomDownsampleLimit: number;
  /** @internal Bloom threshold. */
  protected _bloomThreshold: number;
  /** @internal Bloom threshold knee (soft thresholding). */
  protected _bloomThresholdKnee: number;
  /** @internal Bloom intensity. */
  protected _bloomIntensity: number;
  /** @internal Color adjustment enable flag (via post effect). */
  protected _colorAdjustEnabled: boolean;
  /** @internal Color adjustment post effect reference. */
  protected _postEffectColorAdjust: DRef<ColorAdjust>;
  /** @internal Color adjustment saturation. */
  protected _colorAdjustSaturation: number;
  /** @internal Color adjustment contrast. */
  protected _colorAdjustContrast: number;
  /** @internal Color adjustment hue (degrees). */
  protected _colorAdjustHue: number;
  /** @internal Color adjustment sharpen amount. */
  protected _colorAdjustSharpen: number;

  /** @internal FXAA enable flag (via post effect). */
  protected _FXAA: boolean;
  /** @internal FXAA post effect reference. */
  protected _postEffectFXAA: DRef<FXAA>;

  /** @internal TAA enable flag (via post effect). */
  protected _TAA: boolean;
  /** @internal TAA post effect reference. */
  protected _postEffectTAA: DRef<TAA>;
  /** @internal TAA debug mode (implementation-defined). */
  protected _TAADebug: number;
  /** @internal Cascaded shadow debug visualization flag. */
  protected _shadowDebugCascades: boolean;

  /** @internal SSR enable flag (via post effect). */
  protected _SSR: boolean;
  /** @internal SSR post effect reference. */
  protected _postEffectSSR: DRef<SSR>;
  /** @internal SSR parameter vector: (maxDistance, iterations, thickness, reserved). */
  protected _ssrParams: Vector4;
  /** @internal SSR roughness cutoff; above this SSR is suppressed. */
  protected _ssrMaxRoughness: number;
  /** @internal SSR roughness factor scaling. */
  protected _ssrRoughnessFactor: number;
  /** @internal SSR stride for ray marching. */
  protected _ssrStride: number;
  /** @internal Whether SSR thickness is computed automatically. */
  protected _ssrCalcThickness: boolean;
  /** @internal SSR blur scale. */
  protected _ssrBlurriness: number;
  /** @internal SSR blur depth cutoff. */
  protected _ssrBlurDepthCutoff: number;
  /** @internal SSR blur kernel size. */
  protected _ssrBlurKernelSize: number;
  /** @internal SSR Gaussian blur standard deviation. */
  protected _ssrBlurStdDev: number;
  /** @internal Whether SSR temporal accumulation is enabled. */
  protected _ssrTemporal: boolean;
  /** @internal SSR temporal blending weight in [0, 1]. */
  protected _ssrTemporalWeight: number;
  /** @internal SSGI enable flag (via post effect). */
  protected _SSGI: boolean;
  /** @internal SSGI post effect reference. */
  protected _postEffectSSGI: DRef<SSGI>;
  /** @internal SSGI quality preset. */
  protected _ssgiQualityPreset: SSGIQualityPreset;
  /** @internal Resolved SSGI trace/denoise settings. */
  protected _ssgiResolvedSettings: SSGIResolvedSettings;
  /** @internal SSGI irradiance composite strength. */
  protected _ssgiIntensity: number;
  /** @internal Strength of the ambient occlusion traced alongside SSGI. */
  protected _ssgiAOIntensity: number;
  /** @internal Contrast curve of the SSGI ambient occlusion. */
  protected _ssgiAOPower: number;
  /** @internal Fraction of environment irradiance removed by an occluding hit. */
  protected _ssgiSkyOcclusion: number;
  /** @internal Maximum view-space ray distance. */
  protected _ssgiMaxDistance: number;
  /** @internal Ray hit thickness. */
  protected _ssgiThickness: number;
  /** @internal Linear trace stride. */
  protected _ssgiStride: number;
  /** @internal Firefly clamp applied to sampled radiance. */
  protected _ssgiMaxRayIntensity: number;
  /** @internal Whether SSGI temporal accumulation is enabled. */
  protected _ssgiTemporal: boolean;
  /** @internal Weight of valid reprojected irradiance. */
  protected _ssgiTemporalWeight: number;
  /** @internal Maximum linear-depth delta in scene units accepted by reprojection. */
  protected _ssgiDepthReject: number;
  /** @internal Minimum normal dot product accepted by reprojection. */
  protected _ssgiNormalReject: number;
  /** @internal SSS enable flag (via post effect). */
  protected _SSS: boolean;
  /** @internal SSS post effect reference. */
  protected _postEffectSSS: DRef<SSS>;
  /** @internal SSS blur scale in pixels per authored width unit. */
  protected _sssBlurScale: number;
  /** @internal High-level preset that resolves SSS blur quality controls. */
  protected _sssQualityPreset: SSSQualityPreset;
  /** @internal SSS composite strength. */
  protected _sssStrength: number;
  /** @internal SSS thin-shell transmission strength. */
  protected _sssTransmissionStrength: number;
  /** @internal SSS thin-shell transmission exponent. */
  protected _sssTransmissionPower: number;
  /** @internal SSS multi-scatter energy compensation. */
  protected _sssMultiScatter: number;
  /** @internal Cached runtime SSS settings after applying the quality preset. */
  protected _sssResolvedSettings: SSSResolvedSettings;
  /** @internal SSS debug visualization mode. */
  protected _sssDebugView: SSSDebugView;
  /** @internal Skin SSS enable flag (via post effect). */
  protected _skinSSS: boolean;
  /** @internal Skin SSS post effect reference. */
  protected _postEffectSkinSSS: DRef<SkinSSS>;
  /** @internal Skin SSS final blend strength. */
  protected _skinSSSStrength: number;
  /** @internal Skin SSS mask opacity bias. */
  protected _skinSSSOpacity: number;
  /** @internal Skin SSS blur tap spacing in pixels. */
  protected _skinSSSSampleStep: number;
  /** @internal Skin SSS depth rejection scale. */
  protected _skinSSSDepthScale: number;
  /** @internal Skin SSS blurred multiplier boost. */
  protected _skinSSSColorBoost: number;
  /** @internal SSAO enable flag (via post effect). */
  protected _SSAO: boolean;
  /** @internal SSAO post effect reference. */
  protected _postEffectSSAO: DRef<SAO>;
  /** @internal SSAO scale (sampling radius multiplier). */
  protected _SSAOScale: number;
  /** @internal SSAO bias (self-shadowing reduction). */
  protected _SSAOBias: number;
  /** @internal SSAO sample radius. */
  protected _SSAORadius: number;
  /** @internal SSAO intensity. */
  protected _SSAOIntensity: number;
  /** @internal SSAO blur depth cutoff. */
  protected _SSAOBlurDepthCutoff: number;

  /** @internal Pending GPU-pick promise (one-shot). */
  protected _pickResultPromise: Nullable<Promise<Nullable<PickResult>>>;
  /** @internal Resolver for the pending pick promise. */
  protected _pickResultResolve: Nullable<(result: Nullable<PickResult>) => void>;
  /** @internal Last pick X position (viewport-relative). */
  protected _pickPosX: number;
  /** @internal Last pick Y position (viewport-relative). */
  protected _pickPosY: number;
  /** @internal Last resolved pick result (optional cache). */
  protected _pickResult: Nullable<PickResult>;

  /** @internal Current jitter value in clip space (x, y). */
  protected _jitterValue: Vector2;
  /** @internal Previous frame’s jitter value. */
  protected _prevJitterValue: Nullable<Vector2>;
  /** @internal Current jittered VP matrix. */
  protected _jitteredVPMatrix: Matrix4x4;
  /** @internal Inverse of the current jittered VP matrix. */
  protected _jitteredInvVPMatrix: Matrix4x4;
  /** @internal Previous frame’s non-jittered VP matrix. */
  protected _prevVPMatrix: Nullable<Matrix4x4>;
  /** @internal Previous frame’s camera world position. */
  protected _prevPosition: Nullable<Vector3>;
  /** @internal Previous frame’s jittered VP matrix. */
  protected _prevJitteredVPMatrix: Nullable<Matrix4x4>;
  /** @internal Post-processing compositor attached to this camera. */
  protected _compositor: Compositor;
  /** @internal Pointer interaction rectangle in css pixels (relative to canvas) */
  protected _interactionRect: Nullable<[left: number, top: number, width: number, height: number]>;
  /** @internal captured by which mouse button (-1 if not captured) */
  protected _capturedButton: number;
  /**
   * Creates a new camera node.
   *
   * Initializes projection/view matrices, temporal fields, controller linkage, and
   * builds the default post-processing pipeline on the internal compositor.
   *
   * @param scene - The scene that owns this camera.
   * @param projectionMatrix - Optional projection matrix to initialize with.
   */
  constructor(scene: Nullable<Scene>, projectionMatrix?: Matrix4x4) {
    super(scene);
    this._projMatrix = projectionMatrix || Matrix4x4.identity();
    this._invProjMatrix = Matrix4x4.invert(this._projMatrix);
    this._viewMatrix = Matrix4x4.identity();
    this._viewProjMatrix = Matrix4x4.identity();
    this._invViewProjMatrix = Matrix4x4.identity();
    this._clipPlane = null;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clearDepth = DEPTH_CLEAR_VALUE;
    this._clearStencil = 0;
    this._dirty = true;
    this._controller = null;
    this._viewport = null;
    this._adaptedViewport = null;
    this._adaptedRelativeViewport = null;
    this._adaptedVersion = 0;
    this._scissor = null;
    this._clipMask = 0;
    this._frustum = null;
    this._frustumV = null;
    this._oit = new DRef();
    this._oitMode = 'none';
    this._oitABufferLayers = 20;
    this._oitDualDepthPeels = 8;
    this._depthPrePass = false;
    this._renderPath = 'forward';
    this._screenAdapter = new ScreenAdapter();
    this._adapted = false;
    this._HiZ = false;
    this._screenSpaceShadowMask = true;
    this._HDR = true;
    this._toneMap = true;
    this._postEffectTonemap = new DRef();
    this._tonemapExposure = 1;
    this._aperture = 16;
    this._shutterSpeed = 1 / 125;
    this._ISO = 100;
    this._exposureCompensation = 0;
    this._postProcessingLightingMode = null;
    this._motionBlur = false;
    this._postEffectMotionBlur = new DRef();
    this._motionBlurStrength = 1;
    this._bloom = false;
    this._postEffectBloom = new DRef();
    this._bloomMaxDownsampleLevels = 4;
    this._bloomDownsampleLimit = 32;
    this._bloomThreshold = 0.8;
    this._bloomThresholdKnee = 0;
    this._bloomIntensity = 1;
    this._colorAdjustEnabled = false;
    this._postEffectColorAdjust = new DRef();
    this._colorAdjustSaturation = 1;
    this._colorAdjustContrast = 1;
    this._colorAdjustHue = 0;
    this._colorAdjustSharpen = 0;
    this._FXAA = false;
    this._postEffectFXAA = new DRef();
    this._TAA = false;
    this._postEffectTAA = new DRef();
    this._TAADebug = 0;
    this._shadowDebugCascades = false;
    this._SSR = false;
    this._postEffectSSR = new DRef();
    this._ssrParams = new Vector4(64, 96, 0.9, 0);
    this._ssrMaxRoughness = 0.55;
    this._ssrRoughnessFactor = 1;
    this._ssrStride = 1;
    this._ssrCalcThickness = false;
    this._ssrBlurriness = 0.008;
    this._ssrBlurDepthCutoff = 2;
    this._ssrBlurKernelSize = 5;
    this._ssrBlurStdDev = 4;
    this._ssrTemporal = true;
    this._ssrTemporalWeight = 0.85;
    this._SSGI = false;
    this._postEffectSSGI = new DRef();
    this._ssgiQualityPreset = 'quality';
    const defaultSSGIQualityPreset = SSGI_QUALITY_PRESET_SETTINGS.quality;
    this._ssgiResolvedSettings = { ...defaultSSGIQualityPreset };
    this._ssgiIntensity = 0.7;
    this._ssgiAOIntensity = 0.8;
    this._ssgiAOPower = 1;
    this._ssgiSkyOcclusion = 1;
    this._ssgiMaxDistance = 32;
    this._ssgiThickness = 0.5;
    this._ssgiStride = 1;
    this._ssgiMaxRayIntensity = 10;
    this._ssgiTemporal = true;
    this._ssgiTemporalWeight = 0.94;
    this._ssgiDepthReject = 0.5;
    this._ssgiNormalReject = 0.75;
    this._SSS = false;
    this._postEffectSSS = new DRef();
    this._sssBlurScale = SSS_DEFAULT_SETTINGS.blurScale;
    this._sssQualityPreset = 'balanced';
    this._sssStrength = SSS_DEFAULT_SETTINGS.strength;
    this._sssTransmissionStrength = SSS_DEFAULT_SETTINGS.transmissionStrength;
    this._sssTransmissionPower = SSS_DEFAULT_SETTINGS.transmissionPower;
    this._sssMultiScatter = SSS_DEFAULT_SETTINGS.multiScatter;
    const defaultSSSQualityPreset = SSS_QUALITY_PRESET_SETTINGS.balanced;
    this._sssResolvedSettings = {
      halfRes: defaultSSSQualityPreset.halfRes,
      blurKernelSize: defaultSSSQualityPreset.blurKernelSize,
      blurStdDev: defaultSSSQualityPreset.blurStdDev,
      blurDepthCutoff: defaultSSSQualityPreset.blurDepthCutoff,
      normalCutoff: defaultSSSQualityPreset.normalCutoff
    };
    this.updateSSSResolvedSettings();
    this._sssDebugView = 'none';
    this._skinSSS = false;
    this._postEffectSkinSSS = new DRef();
    this._skinSSSStrength = 1;
    this._skinSSSOpacity = 0.18;
    this._skinSSSSampleStep = 2;
    this._skinSSSDepthScale = 80;
    this._skinSSSColorBoost = 1;
    this._SSAO = false;
    this._postEffectSSAO = new DRef();
    this._SSAOScale = 10;
    this._SSAOBias = 1;
    this._SSAOIntensity = 0.025;
    this._SSAORadius = 100;
    this._SSAOBlurDepthCutoff = 2;
    this._pickResult = null;
    this._commandBufferReuse = true;
    this._jitteredVPMatrix = new Matrix4x4();
    this._jitteredInvVPMatrix = new Matrix4x4();
    this._jitterValue = new Vector2(0, 0);
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
    this._pickResultPromise = null;
    this._pickResultResolve = null;
    this._pickPosX = 0;
    this._pickPosY = 0;
    this._compositor = new Compositor();
    this._capturedButton = -1;
    this._interactionRect = null;
    this.updatePostProcessing();
    if (scene && !scene.mainCamera) {
      scene.mainCamera = this;
    }
  }
  /**
   * The compositor that owns and runs the camera's post-processing chain.
   */
  get compositor() {
    return this._compositor;
  }
  /**
   * Pointer interaction rectangle in css pixels (relative to canvas)
   */
  get interactionRect() {
    return this._interactionRect;
  }
  set interactionRect(rect) {
    this._interactionRect = rect;
  }
  /**
   * Framebuffer clear color, or `null` to disable.
   */
  get clearColor() {
    return this._clearColor;
  }
  set clearColor(v) {
    this._clearColor = v?.clone() ?? null;
  }
  /**
   * Framebuffer stencil clear value, disabled when null. Default is 0.
   */
  get clearDepth() {
    return this._clearDepth;
  }
  set clearDepth(v) {
    this._clearDepth = v;
  }
  /**
   * Framebuffer stencil clear value, disabled when null. Default is 0.
   */
  get clearStencil() {
    return this._clearStencil;
  }
  set clearStencil(v) {
    this._clearStencil = v;
  }
  /**
   * Whether Hi-Z acceleration is enabled.
   *
   * Often improves SSR performance with little quality impact when supported.
   */
  get HiZ() {
    return this._HiZ;
  }
  set HiZ(val) {
    this._HiZ = !!val;
  }
  /**
   * Whether the screen-space shadow mask is enabled.
   *
   * When enabled, shadow-casting lights are lit through the clustered pass and
   * sample a pre-rendered screen-space shadow mask instead of each casting an
   * additional full-scene additive light pass. Requires the depth prepass
   * (always on in Forward+).
   */
  get screenSpaceShadowMask() {
    return this._screenSpaceShadowMask;
  }
  set screenSpaceShadowMask(val) {
    this._screenSpaceShadowMask = !!val;
  }
  /**
   * Render path used by the scene renderer.
   */
  get renderPath() {
    return this._renderPath;
  }
  set renderPath(_val: RenderPath) {
    this._renderPath = 'forward';
  }
  /**
   * Whether HDR backbuffer is enabled.
   *
   * Tonemap should be disabled when not using HDR backbuffer.
   */
  get HDR() {
    return this._HDR;
  }
  set HDR(val) {
    this._HDR = !!val;
  }
  /**
   * Whether tonemapping is enabled via the post effect.
   */
  get toneMap() {
    return this._postEffectTonemap.get()!.enabled;
  }
  set toneMap(val) {
    this._postEffectTonemap.get()!.enabled = !!val;
  }
  /**
   * Whether motion blur is enabled via the post effect.
   */
  get motionBlur() {
    return this._postEffectMotionBlur.get()!.enabled;
  }
  set motionBlur(val) {
    this._postEffectMotionBlur.get()!.enabled = !!val;
  }
  /** Motion blur strength */
  get motionBlurStrength() {
    return this._motionBlurStrength;
  }
  set motionBlurStrength(val) {
    this._motionBlurStrength = val;
    if (this._postEffectMotionBlur.get()) {
      this._postEffectMotionBlur.get()!.strength = this._motionBlurStrength;
    }
  }
  /**
   * Gets whether Bloom is enabled.
   */
  get bloom() {
    return this._postEffectBloom.get()!.enabled;
  }
  set bloom(val) {
    this._postEffectBloom.get()!.enabled = !!val;
  }
  /**
   * Maximum bloom downsample levels
   */
  get bloomMaxDownsampleLevels() {
    return this._bloomMaxDownsampleLevels;
  }
  set bloomMaxDownsampleLevels(val) {
    this._bloomMaxDownsampleLevels = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get()!.maxDownsampleLevel = val;
    }
  }
  /**
   * Bloom downsample limit
   */
  get bloomDownsampleLimit() {
    return this._bloomDownsampleLimit;
  }
  set bloomDownsampleLimit(val) {
    this._bloomDownsampleLimit = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get()!.downsampleLimit = val;
    }
  }
  /**
   * Bloom threshold
   */
  get bloomThreshold() {
    return this._bloomThreshold;
  }
  set bloomThreshold(val) {
    this._bloomThreshold = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get()!.threshold = val;
    }
  }
  /**
   * Bloom threshold knee
   */
  get bloomThresholdKnee() {
    return this._bloomThresholdKnee;
  }
  set bloomThresholdKnee(val) {
    this._bloomThresholdKnee = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get()!.thresholdKnee = val;
    }
  }
  /**
   * Bloom intensity
   */
  get bloomIntensity() {
    return this._bloomIntensity;
  }
  set bloomIntensity(val) {
    this._bloomIntensity = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get()!.intensity = val;
    }
  }
  /** Whether color adjustment is enabled. */
  get colorAdjust() {
    return this._postEffectColorAdjust.get()!.enabled;
  }
  set colorAdjust(val) {
    this._postEffectColorAdjust.get()!.enabled = !!val;
  }
  /** Color adjustment saturation, 1 means unchanged. */
  get colorAdjustSaturation() {
    return this._colorAdjustSaturation;
  }
  set colorAdjustSaturation(val) {
    this._colorAdjustSaturation = val;
    if (this._postEffectColorAdjust.get()) {
      this._postEffectColorAdjust.get()!.saturation = val;
    }
  }
  /** Color adjustment contrast, 1 means unchanged. */
  get colorAdjustContrast() {
    return this._colorAdjustContrast;
  }
  set colorAdjustContrast(val) {
    this._colorAdjustContrast = val;
    if (this._postEffectColorAdjust.get()) {
      this._postEffectColorAdjust.get()!.contrast = val;
    }
  }
  /** Color adjustment hue in degrees. */
  get colorAdjustHue() {
    return this._colorAdjustHue;
  }
  set colorAdjustHue(val) {
    this._colorAdjustHue = val;
    if (this._postEffectColorAdjust.get()) {
      this._postEffectColorAdjust.get()!.hue = val;
    }
  }
  /** Color adjustment sharpen amount, 0 means disabled. */
  get colorAdjustSharpen() {
    return this._colorAdjustSharpen;
  }
  set colorAdjustSharpen(val) {
    this._colorAdjustSharpen = val;
    if (this._postEffectColorAdjust.get()) {
      this._postEffectColorAdjust.get()!.sharpen = val;
    }
  }
  /**
   * Gets whether FXAA is enabled.
   */
  get FXAA() {
    return this._postEffectFXAA.get()!.enabled;
  }
  set FXAA(val) {
    this._postEffectFXAA.get()!.enabled = !!val;
  }
  /**
   * Tonemap exposure
   */
  get toneMapExposure() {
    return this._tonemapExposure;
  }
  set toneMapExposure(val) {
    // syncPostProcessingMode() re-uploads the resolved exposure every frame, so this only needs to
    // record the authored value. Legacy scenes read it back verbatim; physical scenes ignore it.
    this._tonemapExposure = val;
  }
  /** Lens aperture as an f-number. */
  get aperture() {
    return this._aperture;
  }
  set aperture(val: number) {
    this._aperture = Math.max(0.0001, val);
  }
  /** Shutter-open time in seconds. */
  get shutterSpeed() {
    return this._shutterSpeed;
  }
  set shutterSpeed(val: number) {
    this._shutterSpeed = Math.max(0.000001, val);
  }
  /** Sensor sensitivity in ISO units. */
  get ISO() {
    return this._ISO;
  }
  set ISO(val: number) {
    this._ISO = Math.max(0.0001, val);
  }
  /** Exposure compensation in stops (EV). */
  get exposureCompensation() {
    return this._exposureCompensation;
  }
  set exposureCompensation(val: number) {
    this._exposureCompensation = val;
  }
  /** Photographic EV100 calculated from aperture, shutter time and ISO. */
  get EV100() {
    return calculateEV100(this._aperture, this._shutterSpeed, this._ISO);
  }
  /** Scene-linear physical exposure multiplier, including exposure compensation. */
  get exposure() {
    return calculatePhysicalExposure(
      this._aperture,
      this._shutterSpeed,
      this._ISO,
      this._exposureCompensation
    );
  }
  /**
   * Gets whether TAA is enabled.
   */
  get TAA() {
    return this._postEffectTAA.get()!.enabled;
  }
  set TAA(val) {
    this._postEffectTAA.get()!.enabled = !!val;
  }
  /**
   * Gets the debug flag for TAA
   */
  get TAADebug() {
    return this._TAADebug;
  }
  set TAADebug(val) {
    this._TAADebug = val;
  }
  /**
   * Enables cascade debug visualization for directional shadows.
   */
  get shadowDebugCascades() {
    return this._shadowDebugCascades;
  }
  set shadowDebugCascades(val) {
    this._shadowDebugCascades = !!val;
  }
  /**
   * Gets whether Screen Space Reflections (SSR) is enabled.
   */
  get SSR() {
    return this._postEffectSSR.get()!.enabled;
  }
  set SSR(val) {
    this._postEffectSSR.get()!.enabled = !!val;
  }
  /** Gets whether Screen Space Global Illumination is enabled for this camera. */
  get SSGI() {
    return this._postEffectSSGI.get()!.enabled;
  }
  set SSGI(val) {
    const next = !!val;
    if (next !== this._postEffectSSGI.get()!.enabled) {
      this._postEffectSSGI.get()!.enabled = next;
      this.invalidateSSGIHistory();
    }
  }
  /** High-level SSGI trace and denoise quality preset. */
  get ssgiQualityPreset() {
    return this._ssgiQualityPreset;
  }
  set ssgiQualityPreset(val: SSGIQualityPreset) {
    const next = Camera.resolveSSGIQualityPreset(val);
    if (next !== this._ssgiQualityPreset) {
      this._ssgiQualityPreset = next;
      if (next !== 'custom') {
        this._ssgiResolvedSettings = { ...SSGI_QUALITY_PRESET_SETTINGS[next] };
      }
      this.invalidateSSGIHistory();
    }
  }
  /** Resolved trace and denoise settings for the current SSGI preset. */
  get ssgiResolvedSettings(): Readonly<SSGIResolvedSettings> {
    return this._ssgiResolvedSettings;
  }
  /** Whether the custom SSGI trace runs at half resolution. */
  get ssgiHalfResolution() {
    return this._ssgiResolvedSettings.halfRes;
  }
  set ssgiHalfResolution(val) {
    this.updateSSGICustomSettings({ halfRes: !!val });
  }
  /** Number of diffuse rays traced per pixel by the custom SSGI preset. */
  get ssgiRaysPerPixel() {
    return this._ssgiResolvedSettings.raysPerPixel;
  }
  set ssgiRaysPerPixel(val) {
    this.updateSSGICustomSettings({
      raysPerPixel: Math.max(1, Math.min(4, Math.round(val ?? 1)))
    });
  }
  /** Maximum screen-space ray-march iterations used by the custom SSGI preset. */
  get ssgiMaxSteps() {
    return this._ssgiResolvedSettings.maxSteps;
  }
  set ssgiMaxSteps(val) {
    this.updateSSGICustomSettings({
      maxSteps: Math.max(1, Math.min(256, Math.round(val ?? 1)))
    });
  }
  /** Number of cross-bilateral a-trous passes used by the custom SSGI preset. */
  get ssgiDenoisePasses() {
    return this._ssgiResolvedSettings.denoisePasses;
  }
  set ssgiDenoisePasses(val) {
    this.updateSSGICustomSettings({
      denoisePasses: Math.max(0, Math.min(5, Math.round(val ?? 0)))
    });
  }
  /** SSGI diffuse irradiance multiplier. */
  get ssgiIntensity() {
    return this._ssgiIntensity;
  }
  set ssgiIntensity(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._ssgiIntensity) {
      this._ssgiIntensity = next;
      this.invalidateSSGIHistory();
    }
  }
  /**
   * How much environment irradiance an occluding hit removes, in [0, 1].
   *
   * A screen-space ray that hits geometry blocks the sky for that direction. At 1
   * the environment contribution is removed in full, which is what produces sky
   * occlusion in interiors and corners; lower values dim the sky less than the
   * geometry implies, for art direction or to compensate for the hemisphere a
   * screen-space trace cannot see. Only the removal is scaled — bounce light
   * measured at the hit is always kept, so lowering this brightens without ever
   * discarding indirect light. {@link Camera.ssgiIntensity} still bounds how dark
   * the result can get, so full occlusion also needs an intensity of 1.
   */
  get ssgiSkyOcclusion() {
    return this._ssgiSkyOcclusion;
  }
  set ssgiSkyOcclusion(val) {
    const next = Math.max(0, Math.min(1, val ?? 0));
    if (next !== this._ssgiSkyOcclusion) {
      this._ssgiSkyOcclusion = next;
      this.invalidateSSGIHistory();
    }
  }
  /**
   * How strongly the ambient occlusion traced alongside SSGI darkens the scene,
   * in [0, 1]. 0 disables the composite entirely.
   *
   * The occlusion comes from the same rays that produce the irradiance, at no
   * extra trace cost, and is multiplied into the final opaque color — the same
   * semantics the standalone {@link SAO} post effect applies. **Enabling both at
   * once therefore darkens twice.** Its range is the SSGI trace range
   * ({@link Camera.ssgiMaxDistance}), so this is long-range occlusion rather than
   * the small-radius contact darkening a dedicated AO pass produces.
   *
   * Defaults to 0.8 rather than 1: SSGI irradiance already has sky occlusion
   * subtracted, so diffuse is partly occluded before this multiply is applied.
   */
  get ssgiAOIntensity() {
    return this._ssgiAOIntensity;
  }
  set ssgiAOIntensity(val) {
    this._ssgiAOIntensity = Math.max(0, Math.min(1, val ?? 0));
  }
  /**
   * Contrast curve applied to the SSGI ambient occlusion before it is composited.
   *
   * Values above 1 deepen the occluded regions, below 1 lift them. Purely an art
   * direction control on an already-traced quantity.
   */
  get ssgiAOPower() {
    return this._ssgiAOPower;
  }
  set ssgiAOPower(val) {
    this._ssgiAOPower = Math.max(0.01, val ?? 1);
  }
  /** Maximum SSGI ray length in view-space units. */
  get ssgiMaxDistance() {
    return this._ssgiMaxDistance;
  }
  set ssgiMaxDistance(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._ssgiMaxDistance) {
      this._ssgiMaxDistance = next;
      this.invalidateSSGIHistory();
    }
  }
  /** Depth thickness used by screen-space ray intersection tests. */
  get ssgiThickness() {
    return this._ssgiThickness;
  }
  set ssgiThickness(val) {
    const next = Math.max(0.0001, val ?? 0.0001);
    if (next !== this._ssgiThickness) {
      this._ssgiThickness = next;
      this.invalidateSSGIHistory();
    }
  }
  /** Pixel stride used by the WebGL linear ray marcher. */
  get ssgiStride() {
    return this._ssgiStride;
  }
  set ssgiStride(val) {
    const next = Math.max(1, Math.round(val ?? 1));
    if (next !== this._ssgiStride) {
      this._ssgiStride = next;
      this.invalidateSSGIHistory();
    }
  }
  /** Maximum per-ray radiance before temporal accumulation (firefly clamp). */
  get ssgiMaxRayIntensity() {
    return this._ssgiMaxRayIntensity;
  }
  set ssgiMaxRayIntensity(val) {
    const next = Math.max(0, val ?? 0);
    if (next !== this._ssgiMaxRayIntensity) {
      this._ssgiMaxRayIntensity = next;
      this.invalidateSSGIHistory();
    }
  }
  /** Whether WebGPU SSGI temporal accumulation is enabled. */
  get ssgiTemporal() {
    return this._ssgiTemporal;
  }
  set ssgiTemporal(val) {
    const next = !!val;
    if (next !== this._ssgiTemporal) {
      this._ssgiTemporal = next;
      this.invalidateSSGIHistory();
    }
  }
  /** Weight assigned to valid reprojected SSGI history. */
  get ssgiTemporalWeight() {
    return this._ssgiTemporalWeight;
  }
  set ssgiTemporalWeight(val) {
    this._ssgiTemporalWeight = Math.max(0, Math.min(1, val ?? 0));
  }
  /** Relative linear-depth rejection threshold for SSGI reprojection. */
  get ssgiDepthReject() {
    return this._ssgiDepthReject;
  }
  set ssgiDepthReject(val) {
    this._ssgiDepthReject = Math.max(0, val ?? 0);
  }
  /** Minimum world-normal dot product accepted by SSGI reprojection. */
  get ssgiNormalReject() {
    return this._ssgiNormalReject;
  }
  set ssgiNormalReject(val) {
    this._ssgiNormalReject = Math.max(-1, Math.min(1, val ?? 0));
  }
  /**
   * Gets the maximum roughness value for screen space reflections.
   * Controls the cutoff point where surfaces are considered too rough for SSR.
   */
  get ssrMaxRoughness() {
    return this._ssrMaxRoughness;
  }
  set ssrMaxRoughness(val) {
    this._ssrMaxRoughness = val;
  }
  /**
   * Gets the roughness factor for SSR calculations.
   * Affects how surface roughness influences reflection clarity.
   */
  get ssrRoughnessFactor() {
    return this._ssrRoughnessFactor;
  }
  set ssrRoughnessFactor(val) {
    this._ssrRoughnessFactor = val;
  }
  /**
   * Gets the stride value for SSR ray marching.
   * Controls the step size during ray marching. Larger values improve performance but may miss details.
   */
  get ssrStride() {
    return this._ssrStride;
  }
  set ssrStride(val) {
    this._ssrStride = val;
  }
  /**
   * Gets the maximum distance for SSR ray marching.
   * Defines how far rays will travel when searching for reflection intersections.
   */
  get ssrMaxDistance() {
    return this._ssrParams.x;
  }
  set ssrMaxDistance(val) {
    this._ssrParams.x = val;
  }
  /**
   * Gets the number of iterations for SSR ray marching.
   * Higher values provide more accurate reflections but impact performance.
   */
  get ssrIterations() {
    return this._ssrParams.y;
  }
  set ssrIterations(val) {
    this._ssrParams.y = val;
  }
  /**
   * Gets the thickness value for SSR calculations.
   * Determines the thickness threshold for surfaces when calculating reflections.
   */
  get ssrThickness() {
    return this._ssrParams.z;
  }
  set ssrThickness(val) {
    this._ssrParams.z = val;
  }
  /**
   * Gets whether SSR should calculate thickness automatically.
   * When enabled, the system will dynamically compute surface thickness for reflections.
   */
  get ssrCalcThickness() {
    return this._ssrCalcThickness;
  }
  set ssrCalcThickness(val) {
    this._ssrCalcThickness = !!val;
  }
  /**
   * Gets the blur scale factor for SSR.
   * Controls the overall intensity of the blur effect applied to reflections.
   */
  get ssrBlurScale() {
    return this._ssrBlurriness;
  }
  set ssrBlurScale(val) {
    this._ssrBlurriness = val;
  }
  /**
   * Gets the depth cutoff value for SSR blur.
   * Determines at what depth difference the blur effect should be reduced or eliminated.
   */
  get ssrBlurDepthCutoff() {
    return this._ssrBlurDepthCutoff;
  }
  set ssrBlurDepthCutoff(val) {
    this._ssrBlurDepthCutoff = val;
  }
  /**
   * Gets the kernel size for the SSR blur effect.
   * Defines the size of the blur kernel. Larger values create softer, more spread-out blur.
   */
  get ssrBlurKernelSize() {
    return this._ssrBlurKernelSize;
  }
  set ssrBlurKernelSize(val) {
    this._ssrBlurKernelSize = val;
  }
  /**
   * Gets the standard deviation for the SSR Gaussian blur.
   * Controls the distribution of the blur effect. Higher values create more pronounced blur.
   */
  get ssrBlurStdDev() {
    return this._ssrBlurStdDev;
  }
  set ssrBlurStdDev(val) {
    this._ssrBlurStdDev = val;
  }
  /**
   * Gets whether SSR temporal accumulation is enabled.
   */
  get ssrTemporal() {
    return this._ssrTemporal;
  }
  set ssrTemporal(val) {
    this._ssrTemporal = !!val;
  }
  /**
   * Gets SSR temporal blending weight in [0, 1].
   * Higher values rely more on reprojected history.
   */
  get ssrTemporalWeight() {
    return this._ssrTemporalWeight;
  }
  set ssrTemporalWeight(val) {
    this._ssrTemporalWeight = Math.max(0, Math.min(1, val ?? 0));
  }
  /**
   * Gets whether Screen Space Subsurface Scattering (SSS) is enabled.
   */
  get SSS() {
    return this._postEffectSSS.get()!.enabled;
  }
  set SSS(val) {
    this._postEffectSSS.get()!.enabled = !!val;
  }
  /** Global blur scale for screen-space SSS. */
  get sssBlurScale() {
    return this._sssBlurScale;
  }
  set sssBlurScale(val) {
    this._sssBlurScale = Math.max(0, val ?? 0);
  }
  /**
   * High-level quality preset for SSS blur controls.
   *
   * This is the primary user-facing SSS quality control and only affects
   * the blur sampling quality/performance tradeoff, not the authored look.
   */
  get sssQualityPreset() {
    return this._sssQualityPreset;
  }
  set sssQualityPreset(val: SSSQualityPreset) {
    const next = Camera.resolveSSSQualityPreset(val);
    if (next !== this._sssQualityPreset) {
      this._sssQualityPreset = next;
      this.updateSSSResolvedSettings();
    }
  }
  /** Final SSS composite strength. */
  get sssStrength() {
    return this._sssStrength;
  }
  set sssStrength(val) {
    this._sssStrength = Math.max(0, val ?? 0);
  }
  /** Thin-shell transmission strength. */
  get sssTransmissionStrength() {
    return this._sssTransmissionStrength;
  }
  set sssTransmissionStrength(val) {
    this._sssTransmissionStrength = Math.max(0, val ?? 0);
  }
  /** Thin-shell transmission exponent. */
  get sssTransmissionPower() {
    return this._sssTransmissionPower;
  }
  set sssTransmissionPower(val) {
    this._sssTransmissionPower = Math.max(0.1, val ?? 0.1);
  }
  /** Multi-scatter energy compensation factor. */
  get sssMultiScatter() {
    return this._sssMultiScatter;
  }
  set sssMultiScatter(val) {
    this._sssMultiScatter = Math.max(0, val ?? 0);
  }
  /** Resolved SSS blur settings after applying the quality preset. */
  get sssResolvedSettings(): Readonly<SSSResolvedSettings> {
    return this._sssResolvedSettings;
  }
  /** Debug visualization for screen-space SSS buffers. */
  get sssDebugView() {
    return this._sssDebugView;
  }
  set sssDebugView(val: SSSDebugView) {
    this._sssDebugView = val ?? 'none';
  }
  /** Gets whether the dedicated Skin SSS post effect is enabled. */
  get skinSSS() {
    return this._postEffectSkinSSS.get()!.enabled;
  }
  set skinSSS(val) {
    this._postEffectSkinSSS.get()!.enabled = !!val;
  }
  /** Final blend strength for the dedicated Skin SSS post effect. */
  get skinSSSStrength() {
    return this._skinSSSStrength;
  }
  set skinSSSStrength(val) {
    this._skinSSSStrength = Math.max(0, val ?? 0);
    if (this._postEffectSkinSSS.get()) {
      this._postEffectSkinSSS.get()!.strength = this._skinSSSStrength;
    }
  }
  /** Bias subtracted from the blurred skin mask before compositing. */
  get skinSSSOpacity() {
    return this._skinSSSOpacity;
  }
  set skinSSSOpacity(val) {
    this._skinSSSOpacity = Math.max(0, Math.min(1, val ?? 0));
    if (this._postEffectSkinSSS.get()) {
      this._postEffectSkinSSS.get()!.opacity = this._skinSSSOpacity;
    }
  }
  /** Pixel spacing between blur taps. The reference shader uses 2. */
  get skinSSSSampleStep() {
    return this._skinSSSSampleStep;
  }
  set skinSSSSampleStep(val) {
    this._skinSSSSampleStep = Math.max(0.25, val ?? 0.25);
    if (this._postEffectSkinSSS.get()) {
      this._postEffectSkinSSS.get()!.sampleStep = this._skinSSSSampleStep;
    }
  }
  /** Depth rejection scale. The reference shader uses 80. */
  get skinSSSDepthScale() {
    return this._skinSSSDepthScale;
  }
  set skinSSSDepthScale(val) {
    this._skinSSSDepthScale = Math.max(0, val ?? 0);
    if (this._postEffectSkinSSS.get()) {
      this._postEffectSkinSSS.get()!.depthScale = this._skinSSSDepthScale;
    }
  }
  /** Multiplier applied to the blurred skin lighting multiplier before compositing. */
  get skinSSSColorBoost() {
    return this._skinSSSColorBoost;
  }
  set skinSSSColorBoost(val) {
    this._skinSSSColorBoost = Math.max(0, val ?? 0);
    if (this._postEffectSkinSSS.get()) {
      this._postEffectSkinSSS.get()!.colorBoost = this._skinSSSColorBoost;
    }
  }
  /** @internal */
  get ssrParams(): Immutable<Vector4> {
    return this._ssrParams;
  }
  /**
   * Gets whether SSAO is enabled.
   */
  get SSAO() {
    return this._postEffectSSAO.get()!.enabled;
  }
  set SSAO(val) {
    this._postEffectSSAO.get()!.enabled = !!val;
  }
  /** SSAO scale */
  get SSAOScale() {
    return this._SSAOScale;
  }
  set SSAOScale(val) {
    this._SSAOScale = val;
    if (this._postEffectSSAO.get()!) {
      this._postEffectSSAO.get()!.scale = val;
    }
  }
  /** SSAO bias */
  get SSAOBias() {
    return this._SSAOBias;
  }
  set SSAOBias(val) {
    this._SSAOBias = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get()!.bias = val;
    }
  }
  /** SSAO radius */
  get SSAORadius() {
    return this._SSAORadius;
  }
  set SSAORadius(val) {
    this._SSAORadius = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get()!.radius = val;
    }
  }
  /** SSAO intensity */
  get SSAOIntensity() {
    return this._SSAOIntensity;
  }
  set SSAOIntensity(val) {
    this._SSAOIntensity = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get()!.intensity = val;
    }
  }
  /** SSAO depth cutoff */
  get SSAOBlurDepthCutoff() {
    return this._SSAOBlurDepthCutoff;
  }
  set SSAOBlurDepthCutoff(val) {
    this._SSAOBlurDepthCutoff = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get()!.blurDepthCutoff = val;
    }
  }
  /** Whether to perform a depth pass */
  get depthPrePass() {
    return this._depthPrePass;
  }
  set depthPrePass(val) {
    this._depthPrePass = !!val;
  }
  /** Whether to allow command buffer reuse optimization */
  get commandBufferReuse() {
    return this._commandBufferReuse;
  }
  set commandBufferReuse(val) {
    this._commandBufferReuse = !!val;
  }
  /** Whether this camera is adapted to screen settins */
  get adapted() {
    return this._adapted;
  }
  set adapted(val) {
    if (val !== this._adapted) {
      this._adapted = !!val;
      this._adaptedViewport = null;
      this._adaptedRelativeViewport = null;
      this._invalidate(true);
    }
  }
  /** OIT */
  get oit() {
    return this._oit.get();
  }
  set oit(val) {
    this._oit.set(val);
    const inferredMode = this.inferOITMode(val);
    if (inferredMode) {
      this._oitMode = inferredMode;
    }
  }
  /** OIT mode */
  get oitMode() {
    return this._oitMode;
  }
  set oitMode(val: CameraOITMode) {
    const mode = val ?? 'none';
    if (mode !== this._oitMode) {
      this._oitMode = mode;
      this._oit.set(this.createOITForMode(mode));
    }
  }
  /** ABuffer OIT layer budget. */
  get oitABufferLayers() {
    return this._oitABufferLayers;
  }
  set oitABufferLayers(val: number) {
    const layers = Math.max(1, Math.floor(val || 0));
    if (layers !== this._oitABufferLayers) {
      this._oitABufferLayers = layers;
      if (this._oitMode === 'abuffer') {
        this._oit.set(this.createOITForMode('abuffer'));
      }
    }
  }
  /** Dual depth peeling OIT peel iteration count. */
  get oitDualDepthPeels() {
    return this._oitDualDepthPeels;
  }
  set oitDualDepthPeels(val: number) {
    const peels = Math.max(1, Math.floor(val || 0));
    if (peels !== this._oitDualDepthPeels) {
      this._oitDualDepthPeels = peels;
      // Peel count only drives the per-frame pass loop, so update the live
      // instance in place instead of rebuilding it.
      const oit = this._oit.get();
      if (oit instanceof DualDepthPeelingOIT) {
        oit.numPeels = peels;
      }
    }
  }
  /** Clip plane mask */
  get clipMask() {
    return this._clipMask;
  }
  set clipMask(val) {
    this._clipMask = val;
  }
  /** Viewport used for rendering, if null, use full framebuffer size */
  get viewport(): Nullable<Immutable<number[]>> {
    if (this._adapted) {
      if (!this._adaptedViewport) {
        this._adaptedViewport = this.calcAdaptedViewport(this._adaptedViewport);
      }
      return this._adaptedViewport;
    }
    return this._viewport;
  }
  set viewport(rect: Nullable<Immutable<number[]>>) {
    this._viewport = rect?.slice() ?? null;
  }
  /** Scissor rectangle used for rendering, if null, use viewport value */
  get scissor(): Nullable<Immutable<number[]>> {
    return this._adapted ? this.viewport : this._scissor;
  }
  set scissor(rect: Nullable<Immutable<number[]>>) {
    this._scissor = rect?.slice() ?? null;
  }
  get relativeViewport(): Nullable<Immutable<number[]>> {
    if (this._adapted) {
      if (!this._adaptedRelativeViewport) {
        this._adaptedRelativeViewport = this.calcRelativeAdaptedViewport(this._adaptedRelativeViewport);
      }
      return this._adaptedRelativeViewport;
    }
    return this._viewport;
  }
  /**
   * Screen configuration used for adapting the camera viewport
   */
  get screenConfig(): Immutable<ScreenConfig> {
    return this._screenAdapter.config;
  }
  set screenConfig(config: Immutable<ScreenConfig>) {
    this._screenAdapter.config = config;
  }
  /**
   * Screen viewport used for adapting the camera viewport
   */
  get screenViewport(): Nullable<Immutable<number[]>> {
    return this._screenAdapter.viewport;
  }
  set screenViewport(viewport: Nullable<Immutable<number[]>>) {
    this._screenAdapter.viewport = viewport;
  }
  /**
   * Handle input events
   * @param ev - input event object
   * @param type - event type, default to ev.type
   * @returns Boolean value indicates whether the event was handled.
   */
  handleEvent<T extends IBaseEvent<any>>(ev: T, type?: string) {
    let handled = false;
    if (this._controller) {
      if (
        this._capturedButton < 0 &&
        (ev instanceof PointerEvent || ev instanceof WheelEvent) &&
        !this.posInViewport(ev.offsetX, ev.offsetY)
      ) {
        return false;
      }
      type = type ?? ev.type;
      if (type === 'pointerdown') {
        if (this._capturedButton < 0) {
          this._capturedButton = (ev as unknown as IControllerPointerDownEvent).button;
        }
        handled = this._controller.onMouseDown(ev as unknown as IControllerPointerDownEvent);
      } else if (type === 'pointerup') {
        handled = this._controller.onMouseUp(ev as unknown as IControllerPointerUpEvent);
        if (this._capturedButton === (ev as unknown as IControllerPointerUpEvent).button) {
          this._capturedButton = -1;
        }
      } else if (type === 'pointermove') {
        handled = this._controller.onMouseMove(ev as unknown as IControllerPointerMoveEvent);
      } else if (type === 'wheel') {
        handled = this._controller.onMouseWheel(ev as unknown as IControllerWheelEvent);
      } else if (type === 'keydown') {
        handled = this._controller.onKeyDown(ev as unknown as IControllerKeydownEvent);
      } else if (type === 'keyup') {
        handled = this._controller.onKeyUp(ev as unknown as IControllerKeyupEvent);
      }
      if (handled && ev.preventDefault) {
        ev.preventDefault();
      }
    }
    return handled;
  }
  /**
   * Constructs a ray based on the given screen coordinates.
   *
   * @param x - The x-component of the screen coordinates, relative to the top-left corner of the viewport.
   * @param y - The y-component of the screen coordinates, relative to the top-left corner of the viewport.
   * @returns The ray originating from the camera position and passing through the given screen coordinates.
   */
  constructRay(x: number, y: number) {
    const width = this.viewport ? this.viewport[2] : getDevice().getViewport().width;
    const height = this.viewport ? this.viewport[3] : getDevice().getViewport().height;
    const ndcX = (2 * x) / width - 1;
    const ndcY = 1 - (2 * y) / height;
    const nearClip = new Vector4(ndcX, ndcY, -1, 1);
    const farClip = new Vector4(ndcX, ndcY, 1, 1);
    const nearWorld = this.invViewProjectionMatrix.transform(nearClip);
    const farWorld = this.invViewProjectionMatrix.transform(farClip);
    if (this.isPerspective()) {
      nearWorld.scaleBy(1 / nearWorld.w);
      farWorld.scaleBy(1 / farWorld.w);
    }
    const vEye = this.isPerspective() ? this.getWorldPosition() : nearWorld.xyz();
    const vDir = Vector3.sub(farWorld.xyz(), vEye).inplaceNormalize();
    return new Ray(vEye, vDir);
  }
  /**
   * Place the camera by specifying the camera position and the target point
   * @param eye - The camera position
   * @param target - The target point to look at
   * @param up - The up vector
   * @returns self
   */
  lookAt(eye: Vector3, target: Vector3, up: Vector3) {
    return this.setLocalTransform(Matrix4x4.lookAt(eye, target, up));
  }
  /**
   * Place the camera to look at a given cube face at a given camera position
   * @param face - The cube face to look at
   * @param position - The camera position
   * @returns self
   */
  lookAtCubeFace(face: CubeFace, position?: Vector3) {
    return this.setLocalTransform(Matrix4x4.lookAtCubeFace(face, position ?? this.position));
  }
  /**
   * Setup a perspective projection matrix for the camera
   * @param fovY - The vertical field of view in radians.
   * @param aspect - The aspect ratio
   * @param zNear - The near clip plane
   * @param zFar - The far clip plane
   * @returns self
   */
  setPerspective(fovY: number, aspect: number, zNear: number, zFar: number) {
    this._projMatrix.perspective(fovY, aspect, zNear, zFar);
    Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
    this._invalidate(true);
    return this;
  }
  /**
   * Setup a orthogonal projection matrix for the camera
   * @param left - Left bound of the frustum
   * @param right - Right bound of the frustum
   * @param bottom - Bottom bound of the frustum
   * @param top - Top bound of the frustum
   * @param near - Near bound of the frustum.
   * @param far - Far bound of the frustum.
   * @returns self
   */
  setOrtho(left: number, right: number, bottom: number, top: number, near: number, far: number) {
    this._projMatrix.ortho(left, right, bottom, top, near, far);
    Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
    this._invalidate(true);
    return this;
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4) {
    if (matrix && matrix !== this._projMatrix) {
      this._projMatrix = matrix;
      Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
      this._invalidate(true);
    }
  }
  /**
   * Gets the projection matrix of the camera
   * @returns The projection matrix
   */
  getProjectionMatrix(): Immutable<Matrix4x4> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._projMatrix;
  }
  /**
   * Gets the inverse projection matrix of the camera
   * @returns The projection matrix
   */
  getInvProjectionMatrix(): Immutable<Matrix4x4> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._invProjMatrix;
  }
  getRotationMatrix() {
    const rotationMatrix = new Matrix4x4();
    this.worldMatrix.decompose(null, rotationMatrix, null);
    const xAxis = rotationMatrix.getRow(0).xyz().scaleBy(-1);
    const yAxis = rotationMatrix.getRow(1).xyz();
    const zAxis = rotationMatrix.getRow(2).xyz().scaleBy(-1);
    rotationMatrix.setRow(0, new Vector4(xAxis.x, xAxis.y, xAxis.z, 0));
    rotationMatrix.setRow(1, new Vector4(yAxis.x, yAxis.y, yAxis.z, 0));
    rotationMatrix.setRow(2, new Vector4(zAxis.x, zAxis.y, zAxis.z, 0));
    return rotationMatrix;
  }
  /**
   * View matrix of the camera
   *
   * @remarks
   * Camera's view matrix will transform a point from the world space to the camera space
   */
  get viewMatrix(): Immutable<Matrix4x4> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._viewMatrix;
  }
  get viewProjectionMatrix(): Immutable<Matrix4x4> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._viewProjMatrix;
  }
  /**
   * The inverse-view-projection matrix of the camera
   *
   * @remarks
   * The inverse-view-projection matrix transforms a point from the clip space to the camera space
   */
  get invViewProjectionMatrix(): Immutable<Matrix4x4> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._invViewProjMatrix;
  }
  /** Gets the frustum of the camera */
  get frustum(): Immutable<Frustum> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    return this._frustum!;
  }
  get frustumViewSpace(): Immutable<Frustum> {
    if (this.dirtyCheck()) {
      this._compute();
    }
    if (!this._frustumV) {
      this._frustumV = new Frustum(this._projMatrix);
    }
    return this._frustumV!;
  }
  /** The camera controller  */
  get controller() {
    return this._controller;
  }
  set controller(controller) {
    this.setController(controller);
  }
  /** {@inheritDoc SceneNode.isCamera} */
  isCamera(): this is Camera {
    return true;
  }
  /** Gets the near clip plane of the camera */
  getNearPlane() {
    return this.getProjectionMatrix().getNearPlane();
  }
  /** Gets the far clip plane of the camera */
  getFarPlane() {
    return this.getProjectionMatrix().getFarPlane();
  }
  /** Gets the vertical field of view of the camera */
  getFOV() {
    return this.getProjectionMatrix().getFov();
  }
  /** Gets the tangent of half of the vertical field of view */
  getTanHalfFovy() {
    return this.getProjectionMatrix().getTanHalfFov();
  }
  /** Gets the aspect ratio */
  getAspect() {
    return this.getProjectionMatrix().getAspect();
  }
  /** Returns true if the camera is perspective */
  isPerspective() {
    return this.getProjectionMatrix().isPerspective();
  }
  /** Returns true if the camera is orthographic */
  isOrtho() {
    return this.getProjectionMatrix().isOrtho();
  }
  /**
   * Gets the camera history data which is used in temporal reprojection
   * @returns Camera history data
   */
  getHistoryData() {
    let data = Camera._historyData.get(this);
    if (!data) {
      data = {
        prevColorTex: null,
        prevMotionVectorTex: null,
        prevSSRReflectTex: null,
        prevSSRMotionVectorTex: null
      };
      Camera._historyData.set(this, data);
    }
    return data;
  }
  /**
   * Clears the camera history data which is used in temporal reprojection
   */
  clearHistoryData() {
    const data = Camera._historyData.get(this);
    if (data) {
      if (data.prevColorTex) {
        getDevice().pool.releaseTexture(data.prevColorTex);
      }
      if (data.prevMotionVectorTex) {
        getDevice().pool.releaseTexture(data.prevMotionVectorTex);
      }
      if (data.prevSSRReflectTex) {
        getDevice().pool.releaseTexture(data.prevSSRReflectTex);
      }
      if (data.prevSSRMotionVectorTex) {
        getDevice().pool.releaseTexture(data.prevSSRMotionVectorTex);
      }
      Camera._historyData.delete(this);
    }
    const historyResourceManager = Camera._historyResourceManager.get(this);
    if (historyResourceManager) {
      historyResourceManager.dispose();
      Camera._historyResourceManager.delete(this);
    }
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
  }
  /** @internal */
  private updatePostProcessing() {
    this._compositor.clear();
    if (!this._postEffectSSGI.get()) {
      const ssgi = new SSGI();
      ssgi.enabled = false;
      this._postEffectSSGI.set(ssgi);
      // SSGI resolves opaque linear HDR before SSR, transparency and AA.
      this._compositor.appendPostEffect(ssgi);
    }
    if (!this._postEffectSSR.get()) {
      const ssr = new SSR();
      ssr.enabled = false;
      this._postEffectSSR.set(ssr);
      this._compositor.appendPostEffect(ssr);
    }
    if (!this._postEffectSSS.get()) {
      const sss = new SSS();
      sss.enabled = false;
      this._postEffectSSS.set(sss);
      this._compositor.appendPostEffect(sss);
    }
    if (!this._postEffectSkinSSS.get()) {
      const skinSSS = new SkinSSS();
      skinSSS.enabled = false;
      skinSSS.strength = this._skinSSSStrength;
      skinSSS.opacity = this._skinSSSOpacity;
      skinSSS.sampleStep = this._skinSSSSampleStep;
      skinSSS.depthScale = this._skinSSSDepthScale;
      skinSSS.colorBoost = this._skinSSSColorBoost;
      this._postEffectSkinSSS.set(skinSSS);
      this._compositor.appendPostEffect(skinSSS);
    }
    if (!this._postEffectSSAO.get()) {
      const ssao = new SAO();
      ssao.enabled = false;
      ssao.scale = this._SSAOScale;
      ssao.bias = this._SSAOBias;
      ssao.radius = this._SSAORadius;
      ssao.intensity = this._SSAOIntensity;
      ssao.blurDepthCutoff = this._SSAOBlurDepthCutoff;
      this._postEffectSSAO.set(ssao);
      this._compositor.appendPostEffect(ssao);
    }
    if (!this._postEffectTAA.get()) {
      const taa = new TAA();
      taa.enabled = false;
      this._postEffectTAA.set(taa);
      this._compositor.appendPostEffect(taa);
    }
    if (!this._postEffectMotionBlur.get()) {
      const motionBlur = new MotionBlur();
      motionBlur.enabled = false;
      motionBlur.strength = this._motionBlurStrength;
      this._postEffectMotionBlur.set(motionBlur);
      this._compositor.appendPostEffect(motionBlur);
    }
    if (!this._postEffectTonemap.get()) {
      const tonemap = new Tonemap();
      tonemap.enabled = true;
      tonemap.exposure = this._tonemapExposure;
      this._postEffectTonemap.set(tonemap);
      this._compositor.appendPostEffect(tonemap);
    }
    if (!this._postEffectColorAdjust.get()) {
      const colorAdjust = new ColorAdjust();
      colorAdjust.enabled = false;
      colorAdjust.saturation = this._colorAdjustSaturation;
      colorAdjust.contrast = this._colorAdjustContrast;
      colorAdjust.hue = this._colorAdjustHue;
      colorAdjust.sharpen = this._colorAdjustSharpen;
      this._postEffectColorAdjust.set(colorAdjust);
      this._compositor.appendPostEffect(colorAdjust);
    }
    if (!this._postEffectFXAA.get()) {
      const fxaa = new FXAA();
      fxaa.enabled = false;
      this._postEffectFXAA.set(fxaa);
      this._compositor.appendPostEffect(fxaa);
    }
    if (!this._postEffectBloom.get()) {
      const bloom = new Bloom();
      bloom.enabled = false;
      bloom.maxDownsampleLevel = this._bloomMaxDownsampleLevels;
      bloom.downsampleLimit = this._bloomDownsampleLimit;
      bloom.threshold = this._bloomThreshold;
      bloom.thresholdKnee = this._bloomThresholdKnee;
      bloom.intensity = this._bloomIntensity;
      this._postEffectBloom.set(bloom);
      this._compositor.appendPostEffect(bloom);
    }
  }

  /** @internal */
  private syncPostProcessingMode(scene: Scene) {
    const tonemap = this._postEffectTonemap.get()!;
    // Physical lighting pre-exposes every light quantity on the CPU (see ShaderHelper.getPreExposure),
    // so the HDR buffer already sits near 1.0 and tonemapping only applies the ACES curve. Legacy
    // keeps its plain exposure multiplier.
    const usePhysicalExposure = scene.lightingMode === 'physical';
    tonemap.exposure = usePhysicalExposure ? 1 : this._tonemapExposure;
    const bloom = this._postEffectBloom.get()!;
    if (this._postProcessingLightingMode !== scene.lightingMode) {
      // SSGI histories contain scene-linear radiance. Never reuse them across lighting unit models.
      this.invalidateSSGIHistory();
      if (scene.lightingMode === 'physical') {
        this._compositor.movePostEffectBefore(bloom, tonemap);
      } else {
        this._compositor.movePostEffectAfter(bloom, this._postEffectFXAA.get()!);
      }
      this._postProcessingLightingMode = scene.lightingMode;
    }
  }

  private static resolveSSSQualityPreset(val: SSSQualityPreset) {
    switch (val) {
      case 'quality':
      case 'balanced':
      case 'performance':
        return val;
      default:
        return 'balanced';
    }
  }

  private static resolveSSGIQualityPreset(val: SSGIQualityPreset) {
    switch (val) {
      case 'quality':
      case 'balanced':
      case 'performance':
      case 'custom':
        return val;
      default:
        return 'quality';
    }
  }

  private updateSSGICustomSettings(settings: Partial<SSGIResolvedSettings>) {
    const next = { ...this._ssgiResolvedSettings, ...settings };
    if (
      this._ssgiQualityPreset !== 'custom' ||
      next.halfRes !== this._ssgiResolvedSettings.halfRes ||
      next.raysPerPixel !== this._ssgiResolvedSettings.raysPerPixel ||
      next.maxSteps !== this._ssgiResolvedSettings.maxSteps ||
      next.denoisePasses !== this._ssgiResolvedSettings.denoisePasses
    ) {
      this._ssgiQualityPreset = 'custom';
      this._ssgiResolvedSettings = next;
      this.invalidateSSGIHistory();
    }
  }

  /** @internal Invalidate only the histories owned by SSGI. */
  private invalidateSSGIHistory() {
    const history = Camera._historyResourceManager.get(this);
    history?.invalidate(RGHistoryResources.SSGI_SCENE_COLOR);
    history?.invalidate(RGHistoryResources.SSGI_IRRADIANCE);
    history?.invalidate(RGHistoryResources.SSGI_SURFACE);
    history?.invalidate(RGHistoryResources.SSGI_MOMENTS);
    history?.invalidate(RGHistoryResources.SSGI_AO);
  }

  private updateSSSResolvedSettings() {
    const source = SSS_QUALITY_PRESET_SETTINGS[this._sssQualityPreset];
    this._sssResolvedSettings.halfRes = source.halfRes;
    this._sssResolvedSettings.blurKernelSize = source.blurKernelSize;
    this._sssResolvedSettings.blurStdDev = source.blurStdDev;
    this._sssResolvedSettings.blurDepthCutoff = source.blurDepthCutoff;
    this._sssResolvedSettings.normalCutoff = source.normalCutoff;
  }
  /**
   * Renders a scene
   * @param scene - The scene to be rendered
   * @param compositor - Compositor instance that will be used to apply postprocess effects
   */
  render(scene: Scene) {
    const device = getDevice();
    this.syncPostProcessingMode(scene);
    scene.dispatchEvent('startrender', scene, this, this._compositor);
    device.pushDeviceStates();
    device.reverseVertexWindingOrder(false);
    scene.getRenderer().renderScene(scene, this);
    device.popDeviceStates();
    scene.dispatchEvent('endrender', scene, this, this._compositor);
  }
  /** Prepare current/previous camera transforms used by a motion-vector pass. @internal */
  prepareMotionVectorFrame(useTAA: boolean, width: number, height: number): void {
    const device = getDevice();
    if (useTAA) {
      const halton = Camera._halton23[device.frameInfo.frameCounter % Camera._halton23.length];
      this._jitterValue.setXY((halton[0] * 2) / width, (halton[1] * 2) / height);
    } else {
      this._jitterValue.setXY(0, 0);
    }
    this._jitteredVPMatrix.set(this.getProjectionMatrix());
    this._jitteredVPMatrix[8] += this._jitterValue.x;
    this._jitteredVPMatrix[9] += this._jitterValue.y;
    this._jitteredVPMatrix.multiplyRight(this.viewMatrix);
    Matrix4x4.invert(this._jitteredVPMatrix, this._jitteredInvVPMatrix);
    if (!this._prevJitteredVPMatrix) {
      this._prevJitteredVPMatrix = new Matrix4x4();
      this._prevJitteredVPMatrix.set(this._jitteredVPMatrix);
      this._prevJitterValue = new Vector2(this._jitterValue);
    }
    if (!this._prevVPMatrix) {
      this._prevVPMatrix = new Matrix4x4();
      this._prevVPMatrix.set(this.viewProjectionMatrix);
      this._prevPosition = this.getWorldPosition();
    }
  }
  /** Commit camera transforms after a motion-vector frame completes. @internal */
  commitMotionVectorFrame(): void {
    this._prevJitteredVPMatrix!.set(this._jitteredVPMatrix);
    this._prevJitterValue!.set(this._jitterValue);
    this._prevVPMatrix!.set(this.viewProjectionMatrix);
    this._prevPosition = this.getWorldPosition();
  }
  /** Clear temporal camera transforms when motion vectors are not in use. @internal */
  clearMotionVectorFrame(): void {
    this._jitterValue.setXY(0, 0);
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
    this._jitteredInvVPMatrix.set(this.invViewProjectionMatrix);
  }
  async pickAsync(posX: number, posY: number) {
    this._pickPosX = posX;
    this._pickPosY = posY;
    if (!this._pickResultPromise) {
      this._pickResultPromise = new Promise<Nullable<PickResult>>((resolve) => {
        this._pickResultResolve = (result: Nullable<PickResult>) => {
          resolve(result);
          this._pickResultPromise = null;
          this._pickResultResolve = null;
        };
      });
    }
    return this._pickResultPromise;
  }
  /** @internal */
  getPickResultResolveFunc() {
    return this._pickResultResolve;
  }
  /** @internal */
  getPickPosX() {
    return this._pickPosX;
  }
  /** @internal */
  getPickPosY() {
    return this._pickPosY;
  }
  /**
   * Updates the controller state
   */
  updateController() {
    this._controller?.update();
  }
  /**
   * Reset the controller
   */
  resetController() {
    this._controller?.reset();
  }
  /** @internal */
  get jitteredVPMatrix(): Immutable<Matrix4x4> {
    return this._jitteredVPMatrix;
  }
  /** @internal */
  get jitteredInvVPMatrix(): Immutable<Matrix4x4> {
    return this._jitteredInvVPMatrix;
  }
  /** @internal */
  get jitterValue(): Immutable<Vector2> {
    return this._jitterValue;
  }
  /** @internal */
  get prevJitteredVPMatrix(): Nullable<Immutable<Matrix4x4>> {
    return this._prevJitteredVPMatrix;
  }
  /** @internal */
  get prevJitterValue(): Nullable<Immutable<Vector2>> {
    return this._prevJitterValue;
  }
  /** @internal */
  get prevVPMatrix(): Nullable<Immutable<Matrix4x4>> {
    return this._prevVPMatrix;
  }
  /** @internal */
  get prevPosition(): Nullable<Immutable<Vector3>> {
    return this._prevPosition;
  }
  /**
   * Gets the camera history resource manager for temporal effects.
   */
  getHistoryResourceManager(): Nullable<HistoryResourceManager> {
    return Camera._historyResourceManager.get(this) ?? null;
  }
  /**
   * Sets the camera history resource manager for temporal effects.
   *
   * @internal
   */
  setHistoryResourceManager(manager: HistoryResourceManager): void {
    const current = Camera._historyResourceManager.get(this);
    if (current && current !== manager) {
      current.dispose();
    }
    Camera._historyResourceManager.set(this, manager);
  }
  /** @internal */
  private _renderPipeline: Nullable<RenderPipeline<FrameGraphContext>> = null;
  /**
   * The render pipeline that assembles this camera's frame graph. When null
   * (the default), the shared default Forward+ pipeline is used. Assign a
   * customized pipeline to override rendering for this camera only, e.g.
   * `camera.renderPipeline = createForwardPlusPipeline().insertAfter('SkyPass', myModule)`.
   */
  get renderPipeline(): Nullable<RenderPipeline<FrameGraphContext>> {
    return this._renderPipeline;
  }
  set renderPipeline(pipeline: Nullable<RenderPipeline<FrameGraphContext>>) {
    this._renderPipeline = pipeline;
  }
  /** @internal */
  private setController(controller: Nullable<BaseCameraController>) {
    if (this._controller !== controller) {
      if (controller && controller._getCamera() && controller._getCamera() !== this) {
        throw new Error(
          'Camera.setController failed: one camera controller object cannot be assigned to multiple camera'
        );
      }
      this._controller?._setCamera(null);
      this._controller = controller;
      this._controller?._setCamera(this);
    }
    return this;
  }
  /** @internal */
  protected _invalidate(projectMatrixChanged: boolean) {
    this._dirty = true;
    if (projectMatrixChanged) {
      this._frustumV = null;
    }
  }
  /** @internal */
  protected _compute() {
    this._computeProj();
    Matrix4x4.invertAffine(this.worldMatrix, this._viewMatrix);
    Matrix4x4.multiply(this._projMatrix, this._viewMatrix, this._viewProjMatrix);
    Matrix4x4.invert(this._viewProjMatrix, this._invViewProjMatrix);
    if (!this._frustum) {
      this._frustum = new Frustum(this._viewProjMatrix);
    } else {
      this._frustum.initWithMatrix(this._viewProjMatrix);
    }
  }
  /** @internal */
  protected _computeProj() {}
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean) {
    super._onTransformChanged(invalidateLocal);
    this._invalidate(false);
  }
  /** {@inheritdoc SceneNode.onDispose} */
  protected onDispose() {
    super.onDispose();
    this.setController(null);
    this.clearHistoryData();
    this._postEffectBloom.dispose();
    this._postEffectFXAA.dispose();
    this._postEffectMotionBlur.dispose();
    this._postEffectSSAO.dispose();
    this._postEffectSSS.dispose();
    this._postEffectSkinSSS.dispose();
    this._postEffectSSGI.dispose();
    this._postEffectSSR.dispose();
    this._postEffectTAA.dispose();
    this._postEffectTonemap.dispose();
    this._postEffectColorAdjust.dispose();
    this._oit.dispose();
  }
  /** @internal */
  private createOITForMode(mode: CameraOITMode): OIT | null {
    if (mode === 'abuffer') {
      return new ABufferOIT(this._oitABufferLayers);
    }
    if (mode === 'weighted') {
      return new WeightedBlendedOIT();
    }
    if (mode === 'dual-depth') {
      return new DualDepthPeelingOIT(this._oitDualDepthPeels);
    }
    return null;
  }
  /** @internal */
  private inferOITMode(oit: Nullable<OIT>): Nullable<CameraOITMode> {
    if (!oit) {
      return 'none';
    }
    const type = oit.getType();
    if (type === ABufferOIT.type) {
      return 'abuffer';
    }
    if (type === WeightedBlendedOIT.type) {
      return 'weighted';
    }
    if (type === DualDepthPeelingOIT.type) {
      return 'dual-depth';
    }
    return null;
  }
  /** @internal */
  private posInViewport(x: number, y: number) {
    let rect = this._interactionRect;
    if (!rect && this.viewport) {
      const cvs = getDevice().canvas;
      const vp = this.viewport;
      const vp_x = vp[0];
      const vp_y = cvs.clientHeight - vp[1] - vp[3];
      const vp_w = vp[2];
      const vp_h = vp[3];
      rect = [vp_x, vp_y, vp_w, vp_h];
    }
    if (!rect) {
      return true;
    }
    x -= rect[0];
    y -= rect[1];
    return x >= 0 && x < rect[2] && y >= 0 && y < rect[3];
  }
  /** @internal */
  private dirtyCheck() {
    if (this._adapted) {
      const version = this._screenAdapter.version;
      if (this._adaptedVersion !== version) {
        this._dirty = true;
        this._adaptedViewport = null;
        this._adaptedRelativeViewport = null;
        this._adaptedVersion = version;
      }
    }
    if (this._dirty) {
      this._dirty = false;
      return true;
    }
    return false;
  }
  /** @internal */
  private calcAdaptedViewport(outViewport?: Nullable<number[]>): number[] {
    outViewport = outViewport ?? [];
    const transform = this._screenAdapter.transform;
    outViewport[0] = transform.croppedViewport.x;
    outViewport[1] = transform.croppedViewport.y;
    outViewport[2] = transform.croppedViewport.width;
    outViewport[3] = transform.croppedViewport.height;
    return outViewport;
  }
  /** @internal */
  private calcRelativeAdaptedViewport(outViewport?: Nullable<number[]>): number[] {
    outViewport = outViewport ?? [];
    const transform = this._screenAdapter.transform;
    outViewport[0] = transform.croppedViewport.x - transform.viewportX;
    outViewport[1] = transform.croppedViewport.y - transform.viewportY;
    outViewport[2] = transform.croppedViewport.width;
    outViewport[3] = transform.croppedViewport.height;
    return outViewport;
  }
  /** @internal */
  protected calcAdaptedOrthographicProjection(
    nearClip: number,
    farClip: number,
    outMatrix?: Matrix4x4
  ): Matrix4x4 {
    const matrix = outMatrix ?? new Matrix4x4();
    const transform = this._screenAdapter.transform;
    const scaleX = this._screenAdapter.config.designWidth / transform.viewportWidth;
    const scaleY = this._screenAdapter.config.designHeight / transform.viewportHeight;
    const left = -transform.croppedViewport.width * scaleX * 0.5;
    const right = -left;
    const bottom = transform.croppedViewport.height * scaleY * 0.5;
    const top = -bottom;
    return matrix.ortho(left, right, bottom, top, nearClip, farClip);
  }
  /** @internal */
  protected calcAdaptedPerspectiveProjection(
    fov: number,
    nearClip: number,
    farClip: number,
    outMatrix?: Matrix4x4
  ): Matrix4x4 {
    const matrix = outMatrix ?? new Matrix4x4();
    const transform = this._screenAdapter.transform;
    const aspect = transform.viewportHeight !== 0 ? transform.viewportWidth / transform.viewportHeight : 1;
    const h = nearClip * Math.tan(fov * 0.5);
    const w = h * aspect;
    let left = -w + (2 * w * (transform.croppedViewport.x - transform.viewportX)) / transform.viewportWidth;
    let right =
      w -
      (2 *
        w *
        (transform.viewportX +
          transform.viewportWidth -
          transform.croppedViewport.x -
          transform.croppedViewport.width)) /
        transform.viewportWidth;
    let bottom =
      -h + (2 * w * (transform.croppedViewport.y - transform.viewportY)) / transform.viewportHeight;
    let top =
      h -
      (2 *
        h *
        (transform.viewportY +
          transform.viewportHeight -
          transform.croppedViewport.y -
          transform.croppedViewport.height)) /
        transform.viewportHeight;
    return matrix.frustum(left, right, bottom, top, nearClip, farClip);
  }
}
