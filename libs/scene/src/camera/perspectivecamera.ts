import { Camera } from './camera';
import type { Scene } from '../scene/scene';
import type { Immutable, Nullable } from '@zephyr3d/base';
import { Matrix4x4 } from '@zephyr3d/base';
import { getDevice, getEngine } from '../app/api';
import { calculateVerticalFov } from '../utility/physical';
import type { CameraProjectionMode, CameraSensorFit } from '../utility/physical';

/**
 * Perspective camera class
 * @public
 */
export class PerspectiveCamera extends Camera {
  /** @internal */
  private _near: number;
  private _far: number;
  private _fovY: number;
  private _aspect: number;
  private _autoAspect: boolean;
  private _window: Nullable<number[]>;
  private _projectionMode: CameraProjectionMode;
  private _focalLengthMm: number;
  private _sensorWidthMm: number;
  private _sensorHeightMm: number;
  private _sensorFit: CameraSensorFit;
  /**
   * Creates an instance of PerspectiveCamera
   * @param scene - The scene that the camera belongs to.
   * @param fovY - A radian value indicates the field of view in Y axis
   * @param aspect - Aspect ratio of the perspective transform
   * @param near - The near clip plane
   * @param far - The far clip plane
   */
  constructor(scene: Nullable<Scene>, fovY = Math.PI / 3, near = 1, far = 1000, aspect = 1) {
    super(scene);
    this._fovY = fovY;
    this._aspect = aspect;
    this._near = near;
    this._far = far;
    this._autoAspect = true;
    this._window = null;
    this._projectionMode = 'fov';
    this._focalLengthMm = 50;
    this._sensorWidthMm = 36;
    this._sensorHeightMm = 24;
    this._sensorFit = 'horizontal';
    this._invalidate(true);
  }
  /** Perspective projection parameterization. */
  get projectionMode() {
    return this._projectionMode;
  }
  set projectionMode(val: CameraProjectionMode) {
    const mode = val === 'physical' ? 'physical' : 'fov';
    if (mode !== this._projectionMode) {
      this._projectionMode = mode;
      this._invalidate(true);
    }
  }
  /** Physical focal length in millimeters. */
  get focalLengthMm() {
    return this._focalLengthMm;
  }
  set focalLengthMm(val: number) {
    const focalLength = Math.max(0.0001, val);
    if (focalLength !== this._focalLengthMm) {
      this._focalLengthMm = focalLength;
      this._invalidate(true);
    }
  }
  /** Physical sensor width in millimeters. */
  get sensorWidthMm() {
    return this._sensorWidthMm;
  }
  set sensorWidthMm(val: number) {
    const width = Math.max(0.0001, val);
    if (width !== this._sensorWidthMm) {
      this._sensorWidthMm = width;
      this._invalidate(true);
    }
  }
  /** Physical sensor height in millimeters. */
  get sensorHeightMm() {
    return this._sensorHeightMm;
  }
  set sensorHeightMm(val: number) {
    const height = Math.max(0.0001, val);
    if (height !== this._sensorHeightMm) {
      this._sensorHeightMm = height;
      this._invalidate(true);
    }
  }
  /** Sensor dimension kept fixed while fitting the viewport aspect ratio. */
  get sensorFit() {
    return this._sensorFit;
  }
  set sensorFit(val: CameraSensorFit) {
    const fit = val === 'vertical' ? 'vertical' : 'horizontal';
    if (fit !== this._sensorFit) {
      this._sensorFit = fit;
      this._invalidate(true);
    }
  }
  /** Effective vertical field of view used by the projection matrix. */
  get effectiveFovY() {
    return this._projectionMode === 'physical'
      ? calculateVerticalFov(
          this._focalLengthMm,
          this._sensorWidthMm,
          this._sensorHeightMm,
          this._aspect,
          this._sensorFit
        )
      : this._fovY;
  }
  /** Sub-window of the frustum */
  get window(): Nullable<Immutable<number[]>> {
    return this._window;
  }
  set window(val: Nullable<number[]>) {
    this._window = val?.slice() ?? null;
    this._invalidate(true);
  }
  /** Automatically calculate aspect ratio before render according to current viewport */
  get autoAspect() {
    return this._autoAspect;
  }
  set autoAspect(val) {
    this._autoAspect = !!val;
  }
  /** The near clip plane */
  get near() {
    return this._near;
  }
  set near(val) {
    if (val !== this._near) {
      this._near = val;
      this._invalidate(true);
    }
  }
  /** The far clip plane */
  get far() {
    return this._far;
  }
  set far(val) {
    if (val !== this._far) {
      this._far = val;
      this._invalidate(true);
    }
  }
  /** Radian value indicates the field of view in Y axis */
  get fovY() {
    return this._fovY;
  }
  set fovY(val) {
    if (val !== this._fovY) {
      this._fovY = val;
      this._invalidate(true);
    }
  }
  /** Aspect ratio of the perspective transform */
  get aspect() {
    return this._aspect;
  }
  set aspect(val) {
    if (val !== this._aspect) {
      this._aspect = val;
      this._invalidate(true);
    }
  }
  /** Adjust aspect ratio according to viewport settings of the camera */
  adjustAspectRatio() {
    if (this.viewport) {
      this.aspect = this.viewport[2] / this.viewport[3];
    } else {
      if (!this.adapted || getDevice().getFramebuffer()) {
        const vp = getDevice().getViewport();
        this.aspect = vp.width / vp.height;
      } else {
        const transform = getEngine().screen.transform;
        this.aspect = transform.viewportWidth / transform.viewportHeight;
      }
    }
  }
  /**
   * {@inheritDoc Camera.setPerspective}
   */
  setPerspective(fovY: number, aspect: number, zNear: number, zFar: number) {
    this._projectionMode = 'fov';
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
  setOrtho(_left: number, _right: number, _bottom: number, _top: number, _near: number, _far: number): this {
    throw new Error(`setOrtho() not allowed on PerspectiveCamera`);
  }
  /**
   * Setup a projection matrix for the camera
   * @param matrix - The projection matrix
   */
  setProjectionMatrix(matrix: Matrix4x4) {
    if (matrix !== this._projMatrix) {
      if (matrix?.isPerspective()) {
        super.setProjectionMatrix(matrix);
        this._aspect = matrix.getAspect();
        this._fovY = matrix.getFov();
        this._projectionMode = 'fov';
        this._near = matrix.getNearPlane();
        this._far = matrix.getFarPlane();
      } else {
        throw new Error(
          `PerspectiveCamera.setProjectionMatrix(): param is not a perspective projection matrix`
        );
      }
    }
  }
  /** {@inheritDoc Camera.render} */
  render(scene: Scene) {
    if (this._autoAspect) {
      this.adjustAspectRatio();
    }
    super.render(scene);
  }
  /** @internal */
  protected _computeProj() {
    const fovY = this.effectiveFovY;
    if (this.adapted) {
      this.calcAdaptedPerspectiveProjection(fovY, this._near, this._far, this._projMatrix);
    } else {
      const h = this._near * Math.tan(fovY * 0.5);
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
    }
    Matrix4x4.invert(this._projMatrix, this._invProjMatrix);
  }
}
