import { Camera } from './camera';
import type { Scene } from '../scene/scene';
import type { Matrix4x4 } from '@zephyr3d/base';
import { NodeClonable, NodeCloneMethod } from '../scene';

/**
 * Orthogonal camera class
 * @public
 */
export class OrthoCamera extends Camera implements NodeClonable<OrthoCamera> {
  /** @internal */
  private _left: number;
  private _right: number;
  private _top: number;
  private _bottom: number;
  private _near: number;
  private _far: number;
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
    this._invalidate(true);
  }
  clone(method: NodeCloneMethod): OrthoCamera {
    const other = new OrthoCamera(this.scene);
    other.copyFrom(this, method);
    other.parent = this.parent;
    return other;
  }
  copyFrom(other: this, method: NodeCloneMethod): void {
    super.copyFrom(other, method);
    this.near = other.near;
    this.far = other.far;
    this.left = other.left;
    this.right = other.right;
    this.top = other.top;
    this.bottom = other.bottom;
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
    if (matrix && matrix !== this._projMatrix && matrix.isOrtho()) {
      this._left = matrix.getLeftPlane();
      this._right = matrix.getRightPlane();
      this._near = matrix.getNearPlane();
      this._far = matrix.getFarPlane();
      this._top = matrix.getTopPlane();
      this._bottom = matrix.getBottomPlane();
      this._invalidate(true);
    } else {
      throw new Error(`OrthoCamera.setProjectionMatrix(): param is not an orthogonal projection matrix`);
    }
  }
  /** @internal */
  protected _computeProj(): void {
    this._projMatrix.ortho(this._left, this._right, this._bottom, this._top, this._near, this._far);
  }
}
