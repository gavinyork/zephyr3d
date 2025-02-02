import { Camera } from './camera';
import type { Scene } from '../scene/scene';
import type { Matrix4x4 } from '@zephyr3d/base';
import { NodeClonable, NodeCloneMethod } from '../scene';

/**
 * Perspective camera class
 * @public
 */
export class PerspectiveCamera extends Camera implements NodeClonable<PerspectiveCamera> {
  /** @internal */
  private _near: number;
  private _far: number;
  private _fovY: number;
  private _aspect: number;
  private _window: number[];
  /**
   * Creates an instance of PerspectiveCamera
   * @param scene - The scene that the camera belongs to.
   * @param fovY - A radian value indicates the field of view in Y axis
   * @param aspect - Aspect ratio of the perspective transform
   * @param near - The near clip plane
   * @param far - The far clip plane
   */
  constructor(scene: Scene, fovY = Math.PI / 3, aspect = 1, near = 1, far = 1000) {
    super(scene);
    this._fovY = fovY;
    this._aspect = aspect;
    this._near = near;
    this._far = far;
    this._window = null;
    this._invalidate(true);
  }
  clone(method: NodeCloneMethod, recursive: boolean): PerspectiveCamera {
    const other = new PerspectiveCamera(this.scene);
    other.copyFrom(this, method, recursive);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod, recursive: boolean): void {
    super.copyFrom(other, method, recursive);
    this.window = other.window;
    this.near = other.near;
    this.far = other.far;
    this.fovY = other.fovY;
    this.aspect = other.aspect;
  }
  /** Sub-window of the frustum */
  get window(): number[] {
    return this._window;
  }
  set window(val: number[]) {
    this._window = val?.slice() ?? null;
    this._invalidate(true);
  }
  /** The near clip plane */
  get near(): number {
    return this._near;
  }
  set near(val: number) {
    if (val !== this._near) {
      this._near = val;
      this._invalidate(true);
    }
  }
  /** The far clip plane */
  get far(): number {
    return this._far;
  }
  set far(val: number) {
    if (val !== this._far) {
      this._far = val;
      this._invalidate(true);
    }
  }
  /** Radian value indicates the field of view in Y axis */
  get fovY(): number {
    return this._fovY;
  }
  set fovY(val: number) {
    if (val !== this._fovY) {
      this._fovY = val;
      this._invalidate(true);
    }
  }
  /** Aspect ratio of the perspective transform */
  get aspect(): number {
    return this._aspect;
  }
  set aspect(val: number) {
    if (val !== this._aspect) {
      this._aspect = val;
      this._invalidate(true);
    }
  }
  /**
   * {@inheritDoc Camera.setPerspective}
   */
  setPerspective(fovY: number, aspect: number, zNear: number, zFar: number): this {
    this._aspect = aspect;
    this._fovY = fovY;
    this._near = zNear;
    this._far = zFar;
    this._invalidate(true);
    return this;
  }
  /**
   * Not valid for PerspectiveCamera
   *
   * @remarks
   * This method is only valid for {@link Camera} class or {@link OrthoCamera} class.
   */
  setOrtho(left: number, right: number, bottom: number, top: number, near: number, far: number): this {
    throw new Error(`setOrtho() not allowed on PerspectiveCamera`);
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4): void {
    if (matrix && matrix !== this._projMatrix && matrix.isPerspective()) {
      this._aspect = matrix.getAspect();
      this._fovY = matrix.getFov();
      this._near = matrix.getNearPlane();
      this._far = matrix.getFarPlane();
      this._invalidate(true);
    } else {
      throw new Error(
        `PerspectiveCamera.setProjectionMatrix(): param is not a perspective projection matrix`
      );
    }
  }
  /** @internal */
  protected _computeProj(): void {
    const h = this._near * Math.tan(this._fovY * 0.5);
    const w = h * this._aspect;
    let left = -w;
    let right = w;
    let top = h;
    let bottom = -h;
    if (this._window) {
      const width = right - left;
      const height = top - bottom;
      left += width * this._window[0];
      bottom += height * this._window[1];
      right = left + width * this._window[2];
      top = bottom + height * this._window[3];
    }
    this._projMatrix.frustum(left, right, bottom, top, this._near, this._far);
    //this._projMatrix.perspective(this._fovY, this._aspect, this._near, this._far);
  }
  /** @internal */
  getPickResultResolveFunc() {
    return this._pickResultResolve;
  }
}
