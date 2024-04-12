import type { CubeFace, Vector3, Plane } from '@zephyr3d/base';
import { Matrix4x4, Frustum, Vector4 } from '@zephyr3d/base';
import { SceneNode } from '../scene/scene_node';
import { Application } from '../app';
import { SceneRenderer } from '../render';
import type { FrameBuffer } from '@zephyr3d/device';
import type { Compositor } from '../posteffect';
import type { Scene } from '../scene/scene';
import type { BaseCameraController } from './base';
import type { RenderLogger } from '../logger/logger';
import type { OIT } from '../render/oit';

export type OITType = 'none'|'weighted-blended';

/**
 * The camera node class
 * @public
 */
export class Camera extends SceneNode {
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
  /**
   * Creates a new camera node
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
  }
  /** Clip plane in camera space */
  get clipPlane(): Plane {
    return this._clipPlane;
  }
  set clipPlane(plane: Plane) {
    this._clipPlane = plane;
    this._invalidate(false);
  }
  /** Whether draw depth pass */
  get depthPrePass(): boolean {
    return this._depthPrePass;
  }
  set depthPrePass(val: boolean) {
    this._depthPrePass = !!val;
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
  /**
   * Renders a scene
   * @param scene - The scene to be rendered
   * @param compositor - Compositor instance that will be used to apply postprocess effects
   */
  render(scene: Scene, compositor?: Compositor, logger?: RenderLogger) {
    const device = Application.instance.device;
    device.pushDeviceStates();
    device.reverseVertexWindingOrder(false);
    device.setFramebuffer(this._framebuffer);
    SceneRenderer.setClearColor(this._clearColor);
    SceneRenderer.renderScene(scene, this, compositor, logger);
    device.popDeviceStates();
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
    this._projMatrix = null;
    this._viewMatrix = null;
    this._viewProjMatrix = null;
  }
}
