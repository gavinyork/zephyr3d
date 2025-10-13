import { Camera } from './camera';
import type { Scene } from '../scene/scene';
import { Matrix4x4 } from '@zephyr3d/base';

/**
 * Orthogonal camera class
 * @public
 */
export class OrthoCamera extends Camera {
  /** @internal */
  private _left: number;
  private _right: number;
  private _top: number;
  private _bottom: number;
  private _near: number;
  private _far: number;
  private _window: number[];
  /**
   * Creates an instance of PerspectiveCamera
   * @param scene - The scene that the camera belongs to.
   * @param fovY - A radian value indicates the field of view in Y axis
   * @param aspect - Aspect ratio of the perspective transform
   * @param nearPlane - The near clip plane
   * @param farPlane - The far clip plane
   */
  constructor(scene: Scene, left = -1, right = 1, bottom = -1, top = 1, near = -1, far = 1) {
    super(scene);
    this._left = left;
    this._right = right;
    this._bottom = bottom;
    this._top = top;
    this._near = near;
    this._far = far;
    this._window = null;
    this._invalidate(true);
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
  /** The left clip plane */
  get left(): number {
    return this._left;
  }
  set left(val: number) {
    if (val !== this._left) {
      this._left = val;
      this._invalidate(true);
    }
  }
  /** The right clip plane */
  get right(): number {
    return this._right;
  }
  set right(val: number) {
    if (val !== this._right) {
      this._right = val;
      this._invalidate(true);
    }
  }
  /** The top clip plane */
  get top(): number {
    return this._top;
  }
  set top(val: number) {
    if (val !== this._top) {
      this._top = val;
      this._invalidate(true);
    }
  }
  /** The bottom clip plane */
  get bottom(): number {
    return this._bottom;
  }
  set bottom(val: number) {
    if (val !== this._bottom) {
      this._bottom = val;
      this._invalidate(true);
    }
  }
  /**
   * Not valid for OrthoCamera
   *
   * @remarks
   * This method is only valid for {@link Camera} class or {@link PerspectiveCamera} class.
   */
  setPerspective(): this {
    throw new Error(`setPerspective() not allowed on OrthoCamera`);
  }
  /**
   * {@inheritDoc Camera.setOrtho}
   */
  setOrtho(left: number, right: number, bottom: number, top: number, near: number, far: number): this {
    this._left = left;
    this._right = right;
    this._bottom = bottom;
    this._top = top;
    this._near = near;
    this._far = far;
    this._invalidate(true);
    return this;
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4): void {
    if (matrix !== this._projMatrix) {
      if (matrix?.isOrtho()) {
        super.setProjectionMatrix(matrix);
        this._left = matrix.getLeftPlane();
        this._right = matrix.getRightPlane();
        this._near = matrix.getNearPlane();
        this._far = matrix.getFarPlane();
        this._top = matrix.getTopPlane();
        this._bottom = matrix.getBottomPlane();
      } else {
        throw new Error(`OrthoCamera.setProjectionMatrix(): param is not an orthogonal projection matrix`);
      }
    }
  }
  /** @internal */
  protected _computeProj(): void {
    let left = this._left;
    let right = this._right;
    let bottom = this._bottom;
    let top = this._top;
    if (this._window) {
      const width = right - left;
      const height = top - bottom;
      left += width * this._window[0];
      bottom += height * this._window[1];
      right = left + width * this._window[2];
      top = bottom + height * this._window[3];
    }
    this._projMatrix.ortho(left, right, bottom, top, this._near, this._far);
    Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
  }
}
