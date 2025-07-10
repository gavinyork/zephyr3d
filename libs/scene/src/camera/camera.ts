import type { CubeFace } from '@zephyr3d/base';
import { Plane } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { Matrix4x4, Frustum, Vector4, Vector3, Ray, halton23 } from '@zephyr3d/base';
import type { NodeClonable, NodeCloneMethod } from '../scene/scene_node';
import { SceneNode } from '../scene/scene_node';
import { Application, DRef } from '../app';
import type { Drawable, PickTarget } from '../render/drawable';
import type { AbstractDevice, BaseTexture } from '@zephyr3d/device';
import { Compositor } from '../posteffect/compositor';
import type { Scene } from '../scene/scene';
import type { BaseCameraController } from './base';
import type { OIT } from '../render/oit';
import { TAA } from '../posteffect/taa';
import { SSR } from '../posteffect/ssr';
import { Tonemap } from '../posteffect/tonemap';
import { FXAA } from '../posteffect/fxaa';
import { Bloom } from '../posteffect/bloom';
import { SAO } from '../posteffect/sao';
import { MotionBlur } from '../posteffect/motionblur';

/**
 * Camera pick result
 * @public
 */
export type PickResult = {
  distance: number;
  intersectedPoint: Vector3;
  drawable: Drawable;
  target: PickTarget;
};

/**
 * History data of the camera
 * @public
 */
export type CameraHistoryData = {
  prevColorTex: BaseTexture;
  prevMotionVectorTex: BaseTexture;
};

/**
 * The camera node class
 * @public
 */
export class Camera extends SceneNode implements NodeClonable<Camera> {
  /** @internal */
  private static _halton23 = halton23(16);
  /** @internal */
  private static _historyData: WeakMap<Camera, CameraHistoryData> = new WeakMap();
  /** @internal */
  protected _projMatrix: Matrix4x4;
  /** @internal */
  protected _invProjMatrix: Matrix4x4;
  /** @internal */
  protected _viewMatrix: Matrix4x4;
  /** @internal */
  protected _viewProjMatrix: Matrix4x4;
  /** @internal */
  protected _rotationMatrix: Matrix4x4;
  /** @internal */
  protected _invViewProjMatrix: Matrix4x4;
  /** @internal */
  protected _clipPlane: Plane;
  /** @internal */
  protected _controller: BaseCameraController;
  /** @internal */
  protected _frustum: Frustum;
  /** @internal */
  protected _frustumV: Frustum;
  /** @internal */
  protected _dirty: boolean;
  /** @internal */
  protected _viewport: number[];
  /** @internal */
  protected _scissor: number[];
  /** @internal */
  protected _clearColor: Vector4;
  /** @internal */
  protected _clipMask: number;
  /** @internal */
  protected _oit: DRef<OIT>;
  /** @internal */
  protected _depthPrePass: boolean;
  /** @internal */
  protected _commandBufferReuse: boolean;
  /** @internal */
  protected _HiZ: boolean;
  /** @internal */
  protected _toneMap: boolean;
  /** @internal */
  protected _postEffectTonemap: DRef<Tonemap>;
  /** @internal */
  protected _tonemapExposure: number;
  /** @internal */
  protected _motionBlur: boolean;
  /** @internal */
  protected _postEffectMotionBlur: DRef<MotionBlur>;
  /** @internal */
  protected _motionBlurStrength: number;
  /** @internal */
  protected _bloom: boolean;
  /** @internal */
  protected _postEffectBloom: DRef<Bloom>;
  /** @internal */
  protected _bloomMaxDownsampleLevels: number;
  /** @internal */
  protected _bloomDownsampleLimit: number;
  /** @internal */
  protected _bloomThreshold: number;
  /** @internal */
  protected _bloomThresholdKnee: number;
  /** @internal */
  protected _bloomIntensity: number;
  /** @internal */
  protected _FXAA: boolean;
  /** @internal */
  protected _postEffectFXAA: DRef<FXAA>;
  /** @internal */
  protected _TAA: boolean;
  /** @internal */
  protected _postEffectTAA: DRef<TAA>;
  /** @internal */
  protected _TAADebug: number;
  /** @internal */
  protected _TAABlendFactor: number;
  /** @internal */
  protected _SSR: boolean;
  /** @internal */
  protected _postEffectSSR: DRef<SSR>;
  /** @internal */
  protected _ssrParams: Vector4;
  /** @internal */
  protected _ssrMaxRoughness: number;
  /** @internal */
  protected _ssrRoughnessFactor: number;
  /** @internal */
  protected _ssrStride: number;
  /** @internal */
  protected _ssrCalcThickness: boolean;
  /** @internal */
  protected _ssrBlurriness: number;
  /** @internal */
  protected _ssrBlurDepthCutoff: number;
  /** @internal */
  protected _ssrBlurKernelSize: number;
  /** @internal */
  protected _ssrBlurStdDev: number;
  /** @internal */
  protected _SSAO: boolean;
  /** @internal */
  protected _postEffectSSAO: DRef<SAO>;
  /** @internal */
  protected _SSAOScale: number;
  /** @internal */
  protected _SSAOBias: number;
  /** @internal */
  protected _SSAORadius: number;
  /** @internal */
  protected _SSAOIntensity: number;
  /** @internal */
  protected _SSAOBlurDepthCutoff: number;
  /** @internal */
  protected _pickResultPromise: Promise<PickResult>;
  /** @internal */
  protected _pickResultResolve: (result: PickResult) => void;
  /** @internal */
  protected _pickPosX: number;
  /** @internal */
  protected _pickPosY: number;
  /** @internal */
  protected _pickResult: PickResult;
  /** @internal */
  protected _jitterValue: Vector2;
  /** @internal */
  protected _prevJitterValue: Vector2;
  /** @internal */
  protected _jitteredVPMatrix: Matrix4x4;
  /** @internal */
  protected _jitteredInvVPMatrix: Matrix4x4;
  /** @internal */
  protected _prevVPMatrix: Matrix4x4;
  /** @internal */
  protected _prevPosition: Vector3;
  /** @internal */
  protected _prevJitteredVPMatrix: Matrix4x4;
  /** @internal */
  protected _compositor: Compositor;
  /**
   * Creates a new camera node
   *
   * @param scene - The scene that the camera belongs to
   * @param projectionMatrix - Projection matrix for this camera
   */
  constructor(scene: Scene, projectionMatrix?: Matrix4x4) {
    super(scene);
    this._projMatrix = projectionMatrix || Matrix4x4.identity();
    this._invProjMatrix = Matrix4x4.invert(this._projMatrix);
    this._viewMatrix = Matrix4x4.identity();
    this._viewProjMatrix = Matrix4x4.identity();
    this._invViewProjMatrix = Matrix4x4.identity();
    this._clipPlane = null;
    this._dirty = true;
    this._controller = null;
    this._viewport = null;
    this._scissor = null;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clipMask = 0;
    this._frustum = null;
    this._frustumV = null;
    this._oit = new DRef();
    this._depthPrePass = false;
    this._HiZ = false;
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
    this._TAABlendFactor = 1 / 16;
    this._SSR = false;
    this._postEffectSSR = new DRef();
    this._ssrParams = new Vector4(100, 120, 0.5, 0);
    this._ssrMaxRoughness = 0.8;
    this._ssrRoughnessFactor = 1;
    this._ssrStride = 2;
    this._ssrCalcThickness = false;
    this._ssrBlurriness = 0.05;
    this._ssrBlurDepthCutoff = 2;
    this._ssrBlurKernelSize = 17;
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
  }
  clone(method: NodeCloneMethod, recursive: boolean): Camera {
    const other = new Camera(this.scene);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.clipPlane = other.clipPlane ? new Plane(other.clipPlane) : null;
    this.HiZ = other.HiZ;
    this.toneMap = other.toneMap;
    this.toneMapExposure = other.toneMapExposure;
    this.bloom = other.bloom;
    this.FXAA = other.FXAA;
    this.TAA = other.TAA;
    this.TAADebug = other.TAADebug;
    this.TAABlendFactor = other.TAABlendFactor;
    this.SSR = other.SSR;
    this.ssrMaxRoughness = other.ssrMaxRoughness;
    this.ssrRoughnessFactor = other.ssrRoughnessFactor;
    this.ssrStride = other.ssrStride;
    this.ssrMaxDistance = other.ssrMaxDistance;
    this.ssrIterations = other.ssrIterations;
    this.ssrThickness = other.ssrThickness;
    this.ssrCalcThickness = other.ssrCalcThickness;
    this.ssrBlurScale = other.ssrBlurScale;
    this.ssrBlurDepthCutoff = other.ssrBlurDepthCutoff;
    this.ssrBlurKernelSize = other.ssrBlurKernelSize;
    this.depthPrePass = other.depthPrePass;
    this.commandBufferReuse = other.commandBufferReuse;
    this.oit = other.oit;
    this.clipMask = other.clipMask;
    this.viewport = other.viewport;
    this.scissor = other.scissor;
    this.clearColor = other.clearColor;
    this.setProjectionMatrix(other.getProjectionMatrix());
  }
  /** Compositor */
  get compositor() {
    return this._compositor;
  }
  /** Clip plane in camera space */
  get clipPlane(): Plane {
    return this._clipPlane;
  }
  set clipPlane(plane: Plane) {
    this._clipPlane = plane;
    this._invalidate(false);
  }
  /**
   * Gets whether Hi-Z acceleration is enabled.
   * When enabled, it can significantly improve SSR performance with minimal quality impact.
   */
  get HiZ(): boolean {
    return this._HiZ;
  }
  set HiZ(val: boolean) {
    this._HiZ = !!val;
  }
  /**
   * Gets whether Tonemap is enabled.
   */
  get toneMap(): boolean {
    return this._toneMap;
  }
  set toneMap(val: boolean) {
    this._toneMap = !!val;
  }
  /**
   * Gets whether motion blur is enabled
   */
  get motionBlur(): boolean {
    return this._motionBlur;
  }
  set motionBlur(val: boolean) {
    this._motionBlur = !!val;
  }
  /** Motion blur strength */
  get motionBlurStrength(): number {
    return this._motionBlurStrength;
  }
  set motionBlurStrength(val: number) {
    this._motionBlurStrength = val;
    if (this._postEffectMotionBlur.get()) {
      this._postEffectMotionBlur.get().strength = this._motionBlurStrength;
    }
  }
  /**
   * Gets whether Bloom is enabled.
   */
  get bloom(): boolean {
    return this._bloom;
  }
  set bloom(val: boolean) {
    this._bloom = !!val;
  }
  /**
   * Maximum bloom downsample levels
   */
  get bloomMaxDownsampleLevels() {
    return this._bloomMaxDownsampleLevels;
  }
  set bloomMaxDownsampleLevels(val: number) {
    this._bloomMaxDownsampleLevels = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get().maxDownsampleLevel = val;
    }
  }
  /**
   * Bloom downsample limit
   */
  get bloomDownsampleLimit() {
    return this._bloomDownsampleLimit;
  }
  set bloomDownsampleLimit(val: number) {
    this._bloomDownsampleLimit = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get().downsampleLimit = val;
    }
  }
  /**
   * Bloom threshold
   */
  get bloomThreshold() {
    return this._bloomThreshold;
  }
  set bloomThreshold(val: number) {
    this._bloomThreshold = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get().threshold = val;
    }
  }
  /**
   * Bloom threshold knee
   */
  get bloomThresholdKnee() {
    return this._bloomThresholdKnee;
  }
  set bloomThresholdKnee(val: number) {
    this._bloomThresholdKnee = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get().thresholdKnee = val;
    }
  }
  /**
   * Bloom intensity
   */
  get bloomIntensity() {
    return this._bloomIntensity;
  }
  set bloomIntensity(val: number) {
    this._bloomIntensity = val;
    if (this._postEffectBloom.get()) {
      this._postEffectBloom.get().intensity = val;
    }
  }
  /**
   * Gets whether FXAA is enabled.
   */
  get FXAA(): boolean {
    return this._FXAA;
  }
  set FXAA(val: boolean) {
    this._FXAA = !!val;
  }
  /**
   * Tonemap exposure
   */
  get toneMapExposure(): number {
    return this._tonemapExposure;
  }
  set toneMapExposure(val: number) {
    this._tonemapExposure = val;
    if (this._postEffectTonemap.get()) {
      this._postEffectTonemap.get().exposure = val;
    }
  }
  /**
   * Gets whether TAA is enabled.
   */
  get TAA(): boolean {
    return this._TAA;
  }
  set TAA(val: boolean) {
    this._TAA = !!val;
  }
  /**
   * Gets the debug flag for TAA
   */
  get TAADebug(): number {
    return this._TAADebug;
  }
  set TAADebug(val: number) {
    this._TAADebug = val;
  }
  /**
   * Gets the blend factor for TAA
   */
  get TAABlendFactor(): number {
    return this._TAABlendFactor;
  }
  set TAABlendFactor(val: number) {
    this._TAABlendFactor = val;
  }
  /**
   * Gets whether Screen Space Reflections (SSR) is enabled.
   */
  get SSR(): boolean {
    return this._SSR;
  }
  set SSR(val: boolean) {
    this._SSR = !!val;
  }
  /**
   * Gets the maximum roughness value for screen space reflections.
   * Controls the cutoff point where surfaces are considered too rough for SSR.
   */
  get ssrMaxRoughness(): number {
    return this._ssrMaxRoughness;
  }
  set ssrMaxRoughness(val: number) {
    this._ssrMaxRoughness = val;
  }
  /**
   * Gets the roughness factor for SSR calculations.
   * Affects how surface roughness influences reflection clarity.
   */
  get ssrRoughnessFactor(): number {
    return this._ssrRoughnessFactor;
  }
  set ssrRoughnessFactor(val: number) {
    this._ssrRoughnessFactor = val;
  }
  /**
   * Gets the stride value for SSR ray marching.
   * Controls the step size during ray marching. Larger values improve performance but may miss details.
   */
  get ssrStride(): number {
    return this._ssrStride;
  }
  set ssrStride(val: number) {
    this._ssrStride = val;
  }
  /**
   * Gets the maximum distance for SSR ray marching.
   * Defines how far rays will travel when searching for reflection intersections.
   */
  get ssrMaxDistance(): number {
    return this._ssrParams.x;
  }
  set ssrMaxDistance(val: number) {
    this._ssrParams.x = val;
  }
  /**
   * Gets the number of iterations for SSR ray marching.
   * Higher values provide more accurate reflections but impact performance.
   */
  get ssrIterations(): number {
    return this._ssrParams.y;
  }
  set ssrIterations(val: number) {
    this._ssrParams.y = val;
  }
  /**
   * Gets the thickness value for SSR calculations.
   * Determines the thickness threshold for surfaces when calculating reflections.
   */
  get ssrThickness(): number {
    return this._ssrParams.z;
  }
  set ssrThickness(val: number) {
    this._ssrParams.z = val;
  }
  /**
   * Gets whether SSR should calculate thickness automatically.
   * When enabled, the system will dynamically compute surface thickness for reflections.
   */
  get ssrCalcThickness(): boolean {
    return this._ssrCalcThickness;
  }
  set ssrCalcThickness(val: boolean) {
    this._ssrCalcThickness = !!val;
  }
  /**
   * Gets the blur scale factor for SSR.
   * Controls the overall intensity of the blur effect applied to reflections.
   */
  get ssrBlurScale(): number {
    return this._ssrBlurriness;
  }
  set ssrBlurScale(val: number) {
    this._ssrBlurriness = val;
  }
  /**
   * Gets the depth cutoff value for SSR blur.
   * Determines at what depth difference the blur effect should be reduced or eliminated.
   */
  get ssrBlurDepthCutoff(): number {
    return this._ssrBlurDepthCutoff;
  }
  set ssrBlurDepthCutoff(val: number) {
    this._ssrBlurDepthCutoff = val;
  }
  /**
   * Gets the kernel size for the SSR blur effect.
   * Defines the size of the blur kernel. Larger values create softer, more spread-out blur.
   */
  get ssrBlurKernelSize(): number {
    return this._ssrBlurKernelSize;
  }
  set ssrBlurKernelSize(val: number) {
    this._ssrBlurKernelSize = val;
  }
  /**
   * Gets the standard deviation for the SSR Gaussian blur.
   * Controls the distribution of the blur effect. Higher values create more pronounced blur.
   */
  get ssrBlurStdDev(): number {
    return this._ssrBlurStdDev;
  }
  set ssrBlurStdDev(val: number) {
    this._ssrBlurStdDev = val;
  }
  /** @internal */
  get ssrParams(): Vector4 {
    return this._ssrParams;
  }
  /**
   * Gets whether SSAO is enabled.
   */
  get SSAO(): boolean {
    return this._SSAO;
  }
  set SSAO(val: boolean) {
    this._SSAO = !!val;
  }
  /** SSAO scale */
  get SSAOScale() {
    return this._SSAOScale;
  }
  set SSAOScale(val: number) {
    this._SSAOScale = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get().scale = val;
    }
  }
  /** SSAO bias */
  get SSAOBias() {
    return this._SSAOBias;
  }
  set SSAOBias(val: number) {
    this._SSAOBias = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get().bias = val;
    }
  }
  /** SSAO radius */
  get SSAORadius() {
    return this._SSAORadius;
  }
  set SSAORadius(val: number) {
    this._SSAORadius = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get().radius = val;
    }
  }
  /** SSAO intensity */
  get SSAOIntensity() {
    return this._SSAOIntensity;
  }
  set SSAOIntensity(val: number) {
    this._SSAOIntensity = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get().intensity = val;
    }
  }
  /** SSAO depth cutoff */
  get SSAOBlurDepthCutoff() {
    return this._SSAOBlurDepthCutoff;
  }
  set SSAOBlurDepthCutoff(val: number) {
    this._SSAOBlurDepthCutoff = val;
    if (this._postEffectSSAO.get()) {
      this._postEffectSSAO.get().blurDepthCutoff = val;
    }
  }
  /** Whether to perform a depth pass */
  get depthPrePass(): boolean {
    return this._depthPrePass;
  }
  set depthPrePass(val: boolean) {
    this._depthPrePass = !!val;
  }
  /** Whether to allow command buffer reuse optimization */
  get commandBufferReuse(): boolean {
    return this._commandBufferReuse;
  }
  set commandBufferReuse(val: boolean) {
    this._commandBufferReuse = !!val;
  }
  /** OIT */
  get oit(): OIT {
    return this._oit.get();
  }
  set oit(val: OIT) {
    this._oit.set(val);
  }
  /** Clip plane mask */
  get clipMask(): number {
    return this._clipMask;
  }
  set clipMask(val: number) {
    this._clipMask = val;
  }
  /** Viewport used for rendering, if null, use full framebuffer size */
  get viewport(): number[] {
    return this._viewport ? [...this._viewport] : null;
  }
  set viewport(rect: number[]) {
    this._viewport = rect?.slice() ?? null;
  }
  /** Scissor rectangle used for rendering, if null, use viewport value */
  get scissor(): number[] {
    return this._scissor ? [...this._scissor] : null;
  }
  set scissor(rect: number[]) {
    this._scissor = rect?.slice() ?? null;
  }
  /** Color value used to clear color buffer before rendering, if null, color buffer will not be cleared */
  get clearColor(): Vector4 {
    return this._clearColor;
  }
  set clearColor(val: Vector4) {
    if (!val) {
      this._clearColor = null;
    } else {
      this._clearColor.set(val);
    }
  }
  /**
   * Handle input events
   * @param ev - input event object
   * @param type - event type, default to ev.type
   * @returns Boolean value indicates whether the event was handled.
   */
  handleEvent(ev: Event, type?: string): boolean {
    let handled = false;
    if (this._controller) {
      type = type ?? ev.type;
      if (type === 'pointerdown') {
        handled = this._controller.onMouseDown(ev as PointerEvent);
      } else if (type === 'pointerup') {
        handled = this._controller.onMouseUp(ev as PointerEvent);
      } else if (type === 'pointermove') {
        handled = this._controller.onMouseMove(ev as PointerEvent);
      } else if (type === 'wheel') {
        handled = this._controller.onMouseWheel(ev as WheelEvent);
      } else if (type === 'keydown') {
        handled = this._controller.onKeyDown(ev as KeyboardEvent);
      } else if (type === 'keyup') {
        handled = this._controller.onKeyUp(ev as KeyboardEvent);
      }
      if (handled) {
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
  constructRay(x: number, y: number): Ray {
    const width = this.viewport ? this.viewport[2] : Application.instance.device.getViewport().width;
    const height = this.viewport ? this.viewport[3] : Application.instance.device.getViewport().height;
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
  lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
    return this.setLocalTransform(Matrix4x4.lookAt(eye, target, up));
  }
  /**
   * Place the camera to look at a given cube face at a given camera position
   * @param face - The cube face to look at
   * @param position - The camera position
   * @returns self
   */
  lookAtCubeFace(face: CubeFace, position?: Vector3): this {
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
  setPerspective(fovY: number, aspect: number, zNear: number, zFar: number): this {
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
  setOrtho(left: number, right: number, bottom: number, top: number, near: number, far: number): this {
    this._projMatrix.ortho(left, right, bottom, top, near, far);
    Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
    this._invalidate(true);
    return this;
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4): void {
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
  getProjectionMatrix(): Matrix4x4 {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    return this._projMatrix;
  }
  /**
   * Gets the inverse projection matrix of the camera
   * @returns The projection matrix
   */
  getInvProjectionMatrix(): Matrix4x4 {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    return this._invProjMatrix;
  }
  getRotationMatrix(): Matrix4x4 {
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
  get viewMatrix(): Matrix4x4 {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    return this._viewMatrix;
  }
  get viewProjectionMatrix(): Matrix4x4 {
    if (this._dirty) {
      this._dirty = false;
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
  get invViewProjectionMatrix(): Matrix4x4 {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    return this._invViewProjMatrix;
  }
  /** Gets the frustum of the camera */
  get frustum(): Frustum {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    return this._frustum;
  }
  get frustumViewSpace(): Frustum {
    if (this._dirty) {
      this._dirty = false;
      this._compute();
    }
    if (!this._frustumV) {
      this._frustumV = new Frustum(this._projMatrix);
    }
    return this._frustumV;
  }
  /** The camera controller  */
  get controller(): BaseCameraController {
    return this._controller || null;
  }
  set controller(controller: BaseCameraController) {
    this.setController(controller);
  }
  /** {@inheritDoc SceneNode.isCamera} */
  isCamera(): this is Camera {
    return true;
  }
  /** Gets the near clip plane of the camera */
  getNearPlane(): number {
    return this.getProjectionMatrix().getNearPlane();
  }
  /** Gets the far clip plane of the camera */
  getFarPlane(): number {
    return this.getProjectionMatrix().getFarPlane();
  }
  /** Gets the vertical field of view of the camera */
  getFOV(): number {
    return this.getProjectionMatrix().getFov();
  }
  /** Gets the tangent of half of the vertical field of view */
  getTanHalfFovy(): number {
    return this.getProjectionMatrix().getTanHalfFov();
  }
  /** Gets the aspect ratio */
  getAspect(): number {
    return this.getProjectionMatrix().getAspect();
  }
  /** Returns true if the camera is perspective */
  isPerspective(): boolean {
    return this.getProjectionMatrix().isPerspective();
  }
  /** Returns true if the camera is orthographic */
  isOrtho(): boolean {
    return this.getProjectionMatrix().isOrtho();
  }
  /**
   * Gets the camera history data which is used in temporal reprojection
   * @returns Camera history data
   */
  getHistoryData(): CameraHistoryData {
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
        Application.instance.device.pool.releaseTexture(data.prevColorTex);
      }
      if (data.prevMotionVectorTex) {
        Application.instance.device.pool.releaseTexture(data.prevMotionVectorTex);
      }
      Camera._historyData.delete(this);
    }
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
  }
  /** @internal */
  private updatePostProcessing(device: AbstractDevice) {
    this._compositor.clear();
    if (this.SSR) {
      if (!this._postEffectSSR.get()) {
        this._postEffectSSR.set(new SSR());
      }
      this._compositor.appendPostEffect(this._postEffectSSR.get());
    } else {
      this._postEffectSSR.dispose();
    }
    if (this.SSAO) {
      if (!this._postEffectSSAO.get()) {
        const ssao = new SAO();
        ssao.scale = this._SSAOScale;
        ssao.bias = this._SSAOBias;
        ssao.radius = this._SSAORadius;
        ssao.intensity = this._SSAOIntensity;
        ssao.blurDepthCutoff = this._SSAOBlurDepthCutoff;
        this._postEffectSSAO.set(ssao);
      }
      this._compositor.appendPostEffect(this._postEffectSSAO.get());
    } else {
      this._postEffectSSAO.dispose();
    }
    if (this.TAA && device.type !== 'webgl') {
      if (!this._postEffectTAA.get()) {
        this._postEffectTAA.set(new TAA());
      }
      this._compositor.appendPostEffect(this._postEffectTAA.get());
    } else {
      this._postEffectTAA.dispose();
    }
    if (this.motionBlur && device.type !== 'webgl') {
      if (!this._postEffectMotionBlur.get()) {
        this._postEffectMotionBlur.set(new MotionBlur());
        this._postEffectMotionBlur.get().strength = this._motionBlurStrength;
      }
      this._compositor.appendPostEffect(this._postEffectMotionBlur.get());
    } else {
      this._postEffectMotionBlur.dispose();
    }
    if (this.toneMap) {
      if (!this._postEffectTonemap.get()) {
        this._postEffectTonemap.set(new Tonemap());
        this._postEffectTonemap.get().exposure = this._tonemapExposure;
      }
      this._compositor.appendPostEffect(this._postEffectTonemap.get());
    } else {
      this._postEffectTonemap.dispose();
    }
    if (this.FXAA) {
      if (!this._postEffectFXAA.get()) {
        this._postEffectFXAA.set(new FXAA());
      }
      this._compositor.appendPostEffect(this._postEffectFXAA.get());
    } else {
      this._postEffectFXAA.dispose();
    }
    if (this.bloom) {
      if (!this._postEffectBloom.get()) {
        const bloom = new Bloom();
        bloom.maxDownsampleLevel = this._bloomMaxDownsampleLevels;
        bloom.downsampleLimit = this._bloomDownsampleLimit;
        bloom.threshold = this._bloomThreshold;
        bloom.thresholdKnee = this._bloomThresholdKnee;
        bloom.intensity = this._bloomIntensity;
        this._postEffectBloom.set(bloom);
      }
      this._compositor.appendPostEffect(this._postEffectBloom.get());
    } else {
      this._postEffectBloom.dispose();
    }
  }
  /**
   * Renders a scene
   * @param scene - The scene to be rendered
   * @param compositor - Compositor instance that will be used to apply postprocess effects
   */
  render(scene: Scene) {
    const device = Application.instance.device;
    this.updatePostProcessing(device);
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
    scene.getRenderer().setClearColor(this._clearColor);
    scene.getRenderer().renderScene(scene, this);
    device.popDeviceStates();
    if (useMotionVector) {
      this._prevJitteredVPMatrix.set(this._jitteredVPMatrix);
      this._prevJitterValue.set(this._jitterValue);
      this._prevVPMatrix.set(this.viewProjectionMatrix);
      this._prevPosition = this.getWorldPosition();
    }
    scene.dispatchEvent('endrender', scene, this, this._compositor);
  }
  async pickAsync(posX: number, posY: number): Promise<PickResult> {
    this._pickPosX = posX;
    this._pickPosY = posY;
    if (!this._pickResultPromise) {
      this._pickResultPromise = new Promise<PickResult>((resolve) => {
        this._pickResultResolve = (result: PickResult) => {
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
  get jitteredVPMatrix() {
    return this._jitteredVPMatrix;
  }
  /** @internal */
  get jitteredInvVPMatrix() {
    return this._jitteredInvVPMatrix;
  }
  /** @internal */
  get jitterValue() {
    return this._jitterValue;
  }
  /** @internal */
  get prevJitteredVPMatrix() {
    return this._prevJitteredVPMatrix;
  }
  /** @internal */
  get prevJitterValue() {
    return this._prevJitterValue;
  }
  /** @internal */
  get prevVPMatrix() {
    return this._prevVPMatrix;
  }
  /** @internal */
  get prevPosition() {
    return this._prevPosition;
  }
  /** @internal */
  private setController(controller: BaseCameraController): this {
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
  /** {@inheritdoc SceneNode.dispose} */
  dispose() {
    this.setController(null);
    this.clearHistoryData();
    this._projMatrix = null;
    this._viewMatrix = null;
    this._viewProjMatrix = null;
    this._postEffectBloom.dispose();
    this._postEffectFXAA.dispose();
    this._postEffectMotionBlur.dispose();
    this._postEffectSSAO.dispose();
    this._postEffectSSR.dispose();
    this._postEffectTAA.dispose();
    this._postEffectTonemap.dispose();
    this._oit.dispose();
    super.dispose();
  }
}
