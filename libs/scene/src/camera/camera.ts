import type { CubeFace, Immutable, Nullable, Plane } from '@zephyr3d/base';
import { DRef, Vector2, Matrix4x4, Frustum, Vector4, Vector3, Ray, halton23 } from '@zephyr3d/base';
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
import { SSR } from '../posteffect/ssr';
import { Tonemap } from '../posteffect/tonemap';
import { FXAA } from '../posteffect/fxaa';
import { Bloom } from '../posteffect/bloom';
import { SAO } from '../posteffect/sao';
import { MotionBlur } from '../posteffect/motionblur';
import { getDevice } from '../app/api';
import type { RenderTarget } from '../render/rendertarget';
import { ScreenRenderTarget } from '../render/screenrendertarget';

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
};

/**
 * A renderable camera node that manages view/projection math, frusta,
 * input control, picking, and a post-processing chain via a compositor.
 *
 * Key features:
 * - Maintains projection, view, VP, and inverse VP matrices and lazily recomputes them when invalidated.
 * - Provides world- and view-space frusta for culling and clipping.
 * - Supports perspective and orthographic projections.
 * - Integrates with post effects (Tonemap, FXAA, TAA, Bloom, SSR, SSAO, Motion Blur) through an internal `Compositor`.
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
  /** @internal Viewport for render target */
  protected _renderTargetViewport: Nullable<number[]>;
  /** @internal RenderTarget for this camera */
  protected _renderTarget: Nullable<RenderTarget>;
  /** @internal RenderTarget version */
  protected _renderTargetVersion: number;
  /** @internal Scissor rectangle [x, y, w, h]; null uses viewport. */
  protected _scissor: Nullable<number[]>;
  /** @internal Clip plane mask for custom clipping schemes. */
  protected _clipMask: number;
  /** @internal Order-Independent Transparency reference. */
  protected _oit: DRef<OIT>;
  /** @internal */
  protected _adapted: boolean;
  /** @internal Whether to perform a depth pre-pass. */
  protected _depthPrePass: boolean;
  /** @internal Whether command buffers may be reused for optimization. */
  protected _commandBufferReuse: boolean;
  /** @internal Hi-Z acceleration enable (primarily for SSR). */
  protected _HiZ: boolean;
  /** @internal If true, a float point backbuffer will be used. The default value is true */
  protected _HDR: boolean;
  /** @internal Tonemap enable flag (via post effect). */
  protected _toneMap: boolean;
  /** @internal Tonemap post effect reference. */
  protected _postEffectTonemap: DRef<Tonemap>;
  /** @internal Tonemap exposure. */
  protected _tonemapExposure: number;
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
    this._renderTarget = null;
    this._projMatrix = projectionMatrix || Matrix4x4.identity();
    this._invProjMatrix = Matrix4x4.invert(this._projMatrix);
    this._viewMatrix = Matrix4x4.identity();
    this._viewProjMatrix = Matrix4x4.identity();
    this._invViewProjMatrix = Matrix4x4.identity();
    this._clipPlane = null;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clearDepth = 1;
    this._clearStencil = 0;
    this._dirty = true;
    this._controller = null;
    this._viewport = null;
    this._renderTargetViewport = null;
    this._renderTargetVersion = 0;
    this._scissor = null;
    this._clipMask = 0;
    this._frustum = null;
    this._frustumV = null;
    this._oit = new DRef();
    this._depthPrePass = false;
    this._adapted = false;
    this._HiZ = false;
    this._HDR = true;
    this._toneMap = true;
    this._postEffectTonemap = new DRef();
    this._tonemapExposure = 1;
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
    this._FXAA = false;
    this._postEffectFXAA = new DRef();
    this._TAA = false;
    this._postEffectTAA = new DRef();
    this._TAADebug = 0;
    this._SSR = false;
    this._postEffectSSR = new DRef();
    this._ssrParams = new Vector4(100, 120, 0.5, 0);
    this._ssrMaxRoughness = 0.8;
    this._ssrRoughnessFactor = 1;
    this._ssrStride = 2;
    this._ssrCalcThickness = false;
    this._ssrBlurriness = 0.01;
    this._ssrBlurDepthCutoff = 2;
    this._ssrBlurKernelSize = 10;
    this._ssrBlurStdDev = 10;
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
   * Whether to use screen settings for this camera's render target.
   */
  get useScreenSettings() {
    return !!this._renderTarget;
  }
  set useScreenSettings(val: boolean) {
    this._renderTarget = val ? new ScreenRenderTarget() : null;
    this._invalidate(true);
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
    this._tonemapExposure = val;
    if (this._postEffectTonemap.get()) {
      this._postEffectTonemap.get()!.exposure = val;
    }
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
   * Gets whether Screen Space Reflections (SSR) is enabled.
   */
  get SSR() {
    return this._postEffectSSR.get()!.enabled;
  }
  set SSR(val) {
    this._postEffectSSR.get()!.enabled = !!val;
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
    this._adapted = !!val;
  }
  /** OIT */
  get oit() {
    return this._oit.get();
  }
  set oit(val) {
    this._oit.set(val);
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
    if (this._renderTarget) {
      this._renderTargetViewport = this._renderTarget.calcViewport(this._renderTargetViewport);
    }
    return this._renderTarget ? this._renderTargetViewport : this._viewport;
  }
  set viewport(rect: Nullable<Immutable<number[]>>) {
    this._viewport = rect?.slice() ?? null;
  }
  /** Scissor rectangle used for rendering, if null, use viewport value */
  get scissor(): Nullable<Immutable<number[]>> {
    return this._scissor;
  }
  set scissor(rect: Nullable<Immutable<number[]>>) {
    this._scissor = rect?.slice() ?? null;
  }
  get relativeViewport(): Nullable<Immutable<number[]>> {
    if (this._renderTarget) {
      return this._renderTarget.calcRelativeViewport();
    }
    return this._viewport;
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
    const nearClip = new Vector4(ndcX, ndcY, 0, 1);
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
        prevMotionVectorTex: null
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
      Camera._historyData.delete(this);
    }
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
  }
  /** @internal */
  private updatePostProcessing() {
    this._compositor.clear();
    if (!this._postEffectSSR.get()) {
      const ssr = new SSR();
      ssr.enabled = false;
      this._postEffectSSR.set(ssr);
      this._compositor.appendPostEffect(ssr);
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
  /**
   * Renders a scene
   * @param scene - The scene to be rendered
   * @param compositor - Compositor instance that will be used to apply postprocess effects
   */
  render(scene: Scene) {
    const device = getDevice();
    //this.updatePostProcessing(device);
    const useMotionVector = (this.TAA || this.motionBlur) && device.type !== 'webgl';
    const useTAA = useMotionVector && this.TAA;
    scene.dispatchEvent('startrender', scene, this, this._compositor);
    if (useMotionVector) {
      const width = device.getDrawingBufferWidth();
      const height = device.getDrawingBufferHeight();
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
    } else {
      this._jitterValue.setXY(0, 0);
      this._prevVPMatrix = null;
      this._prevPosition = null;
      this._prevJitteredVPMatrix = null;
      this._prevJitterValue = null;
      this._jitteredInvVPMatrix.set(this.invViewProjectionMatrix);
    }
    device.pushDeviceStates();
    device.reverseVertexWindingOrder(false);
    scene.getRenderer().renderScene(scene, this);
    device.popDeviceStates();
    if (useMotionVector) {
      this._prevJitteredVPMatrix!.set(this._jitteredVPMatrix);
      this._prevJitterValue!.set(this._jitterValue);
      this._prevVPMatrix!.set(this.viewProjectionMatrix);
      this._prevPosition = this.getWorldPosition();
    }
    scene.dispatchEvent('endrender', scene, this, this._compositor);
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
    this._postEffectSSR.dispose();
    this._postEffectTAA.dispose();
    this._postEffectTonemap.dispose();
    this._oit.dispose();
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
    if (this._renderTarget) {
      const version = this._renderTarget.getVersion();
      if (this._renderTargetVersion !== version) {
        this._dirty = true;
        this._renderTargetVersion = version;
      }
    }
    if (this._dirty) {
      this._dirty = false;
      return true;
    }
    return false;
  }
}
