import type { CubeFace, Plane } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { Matrix4x4, Frustum, Vector4, Vector3, Ray, halton23 } from '@zephyr3d/base';
import { SceneNode } from '../scene/scene_node';
import { Application } from '../app';
import type { Drawable, PickTarget } from '../render';
import { SceneRenderer } from '../render';
import type { BaseTexture, FrameBuffer } from '@zephyr3d/device';
import type { Compositor } from '../posteffect';
import type { Scene } from '../scene/scene';
import type { BaseCameraController } from './base';
import type { OIT } from '../render/oit';

/**
 * Camera pick result
 * @public
 */
export type PickResult = {
  drawable: Drawable;
  target: PickTarget;
};

export type CameraHistoryData = {
  prevColorTex: BaseTexture;
  prevDepthTex: BaseTexture;
};

/**
 * The camera node class
 * @public
 */
export class Camera extends SceneNode {
  /** @internal */
  private static _halton23 = halton23(16);
  /** @internal */
  private static _historyData: WeakMap<Camera, CameraHistoryData> = new WeakMap();
  /** @internal */
  protected _projMatrix: Matrix4x4;
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
  protected _sampleCount: number;
  /** @internal */
  protected _framebuffer: FrameBuffer;
  /** @internal */
  protected _viewport: number[];
  /** @internal */
  protected _scissor: number[];
  /** @internal */
  protected _clearColor: Vector4;
  /** @internal */
  protected _clipMask: number;
  /** @internal */
  protected _oit: OIT;
  /** @internal */
  protected _depthPrePass: boolean;
  /** @internal */
  protected _commandBufferReuse: boolean;
  /** @internal */
  protected _HiZ: boolean;
  /** @internal */
  protected _SSR: boolean;
  /** @internal */
  protected _TAA: boolean;
  /** @internal */
  protected _TAADebug: number;
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
  protected _picking: boolean;
  /** @internal */
  protected _pickPosX: number;
  /** @internal */
  protected _pickPosY: number;
  /** @internal */
  protected _pickResultPromise: Promise<PickResult>;
  /** @internal */
  protected _pickResult: PickResult;
  /** @internal */
  protected _jitterValue: Vector2;
  /** @internal */
  protected _prevJitterValue: Vector2;
  /** @internal */
  protected _jitteredVPMatrix: Matrix4x4;
  /** @internal */
  protected _prevVPMatrix: Matrix4x4;
  /** @internal */
  protected _prevPosition: Vector3;
  /** @internal */
  protected _prevJitteredVPMatrix: Matrix4x4;
  /**
   * Creates a new camera node
   *
   * @param scene - The scene that the camera belongs to
   * @param projectionMatrix - Projection matrix for this camera
   */
  constructor(scene: Scene, projectionMatrix?: Matrix4x4) {
    super(scene);
    this._projMatrix = projectionMatrix || Matrix4x4.identity();
    this._viewMatrix = Matrix4x4.identity();
    this._viewProjMatrix = Matrix4x4.identity();
    this._invViewProjMatrix = Matrix4x4.identity();
    this._clipPlane = null;
    this._dirty = true;
    this._controller = null;
    this._framebuffer = null;
    this._viewport = null;
    this._scissor = null;
    this._clearColor = new Vector4(0, 0, 0, 1);
    this._clipMask = 0;
    this._sampleCount = 1;
    this._frustum = null;
    this._frustumV = null;
    this._oit = null;
    this._depthPrePass = false;
    this._pickPosX = 0;
    this._pickPosY = 0;
    this._HiZ = false;
    this._SSR = false;
    this._TAA = false;
    this._TAADebug = 0;
    this._ssrParams = new Vector4(100, 120, 0.5, 0);
    this._ssrMaxRoughness = 0.8;
    this._ssrRoughnessFactor = 1;
    this._ssrStride = 2;
    this._ssrCalcThickness = false;
    this._ssrBlurriness = 0.05;
    this._ssrBlurDepthCutoff = 2;
    this._ssrBlurKernelSize = 17;
    this._ssrBlurStdDev = 10;
    this._pickResult = null;
    this._commandBufferReuse = true;
    this._jitteredVPMatrix = new Matrix4x4();
    this._jitterValue = new Vector2(0, 0);
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
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
  /** Whether GPU picking is enabled for this camera */
  get enablePicking(): boolean {
    return this._picking;
  }
  set enablePicking(enable: boolean) {
    this._picking = !!enable;
  }
  /** X coordinate for picking related to viewport  */
  get pickPosX(): number {
    return this._pickPosX;
  }
  set pickPosX(val: number) {
    this._pickPosX = val;
  }
  /** Y coordinate for picking related to viewport  */
  get pickPosY(): number {
    return this._pickPosY;
  }
  set pickPosY(val: number) {
    this._pickPosY = val;
  }
  /** Pick result */
  get pickResult(): PickResult {
    return this._pickResult;
  }
  set pickResult(val: PickResult) {
    this._pickResult = val;
  }
  /** @internal */
  get pickResultAsync(): Promise<PickResult> {
    return this._pickResultPromise;
  }
  set pickResultAsync(val: Promise<PickResult>) {
    this._pickResultPromise = val;
  }
  /**
   * Sample count for MSAA
   *
   * @remarks
   * If greater than one, force the scene to be rendered using multisampled framebuffer
   */
  get sampleCount(): number {
    return this._sampleCount;
  }
  set sampleCount(val: number) {
    if (val !== 1 && val !== 4) {
      console.error(`Invalid sample count: ${val}`);
    } else {
      this._sampleCount = val;
    }
  }
  /** OIT */
  get oit(): OIT {
    return this._oit;
  }
  set oit(val: OIT) {
    this._oit = val;
  }
  /** Clip plane mask */
  get clipMask(): number {
    return this._clipMask;
  }
  set clipMask(val: number) {
    this._clipMask = val;
  }
  /** Framebuffer object into which the scene will be rendered */
  get framebuffer(): FrameBuffer {
    return this._framebuffer;
  }
  set framebuffer(fb: FrameBuffer) {
    this._framebuffer = fb ?? null;
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
    const vClip = new Vector4((2 * x) / width - 1, 1 - (2 * y) / height, 1, 1);
    const vWorld = this.invViewProjectionMatrix.transform(vClip);
    vWorld.scaleBy(1 / vWorld.w);
    const vEye = this.getWorldPosition();
    const vDir = Vector3.sub(vWorld.xyz(), vEye).inplaceNormalize();
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
    this._invalidate(true);
    return this;
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4): void {
    if (matrix && matrix !== this._projMatrix) {
      this._projMatrix.set(matrix);
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
    return this._projMatrix.getNearPlane();
  }
  /** Gets the far clip plane of the camera */
  getFarPlane(): number {
    return this._projMatrix.getFarPlane();
  }
  /** Gets the vertical field of view of the camera */
  getFOV(): number {
    return this._projMatrix.getFov();
  }
  /** Gets the tangent of half of the vertical field of view */
  getTanHalfFovy(): number {
    return this._projMatrix.getTanHalfFov();
  }
  /** Gets the aspect ratio */
  getAspect(): number {
    return this._projMatrix.getAspect();
  }
  /** Returns true if the camera is perspective */
  isPerspective(): boolean {
    return this._projMatrix.isPerspective();
  }
  /** Returns true if the camera is orthographic */
  isOrtho(): boolean {
    return this._projMatrix.isOrtho();
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
        prevDepthTex: null
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
      if (data.prevDepthTex) {
        Application.instance.device.pool.releaseTexture(data.prevDepthTex);
      }
      Camera._historyData.delete(this);
    }
    this._prevVPMatrix = null;
    this._prevPosition = null;
    this._prevJitteredVPMatrix = null;
    this._prevJitterValue = null;
  }
  /**
   * Renders a scene
   * @param scene - The scene to be rendered
   * @param compositor - Compositor instance that will be used to apply postprocess effects
   */
  render(scene: Scene, compositor?: Compositor) {
    const device = Application.instance.device;
    const useTAA = device.type !== 'webgl' && this._TAA;
    if (useTAA) {
      const width = device.getDrawingBufferWidth();
      const height = device.getDrawingBufferHeight();
      const halton = Camera._halton23[device.frameInfo.frameCounter % Camera._halton23.length];
      this._jitterValue.setXY((halton[0] * 1) / width, (halton[1] * 1) / height);
      this._jitteredVPMatrix.set(this.getProjectionMatrix());
      this._jitteredVPMatrix[8] += this._jitterValue.x;
      this._jitteredVPMatrix[9] += this._jitterValue.y;
      this._jitteredVPMatrix.multiplyRight(this.viewMatrix);
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
      this._prevVPMatrix = null;
      this._prevPosition = null;
      this._prevJitteredVPMatrix = null;
      this._prevJitterValue = null;
    }
    device.pushDeviceStates();
    device.reverseVertexWindingOrder(false);
    device.setFramebuffer(this._framebuffer);
    SceneRenderer.setClearColor(this._clearColor);
    SceneRenderer.renderScene(scene, this, compositor);
    device.popDeviceStates();
    if (useTAA) {
      this._prevJitteredVPMatrix.set(this._jitteredVPMatrix);
      this._prevJitterValue.set(this._jitterValue);
      this._prevVPMatrix.set(this.viewProjectionMatrix);
      this._prevPosition = this.getWorldPosition();
    }
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
  }
}
