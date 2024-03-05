import { Vector3, Quaternion } from '@zephyr3d/base';
import { BaseCameraController } from './base';

/**
 * Creation options for OrbitCameraController
 * @public
 */
export interface OrbitCameraControllerOptions {
  /** target position */
  center: Vector3;
  /** initial distance between the camera and the target */
  distance?: number;
  /** damping value */
  damping?: number;
  /** Zooming speed */
  zoomSpeed?: number;
  /** Rotating speed */
  rotateSpeed?: number;
}

/**
 * Orbit camera controller
 * @public
 */
export class OrbitCameraController extends BaseCameraController {
  /** @internal */
  private options: OrbitCameraControllerOptions;
  /** @internal */
  private mouseDown: boolean;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  private rotateX: number;
  /** @internal */
  private rotateY: number;
  /** @internal */
  private eyePos: Vector3;
  /** @internal */
  private upVector: Vector3;
  /** @internal */
  private xVector: Vector3;
  /** @internal */
  private target: Vector3;
  /** @internal */
  private direction: Vector3;
  /** @internal */
  private quat: Quaternion;
  /** @internal */
  private scale: number;
  /**
   * Creates an instance of OrbitCameraController
   * @param options - The creation options
   */
  constructor(options?: OrbitCameraControllerOptions) {
    super();
    this.options = Object.assign(
      {
        center: Vector3.zero(),
        distance: 1,
        damping: 0.1,
        moveSpeed: 0.2,
        rotateSpeed: 0.01,
        zoomSpeed: 1
      },
      options || {}
    );
    this.rotateX = 0;
    this.rotateY = 0;
    this.eyePos = new Vector3();
    this.upVector = Vector3.axisPY();
    this.xVector = new Vector3();
    this.target = new Vector3();
    this.direction = new Vector3();
    this.quat = new Quaternion();
    this.scale = 1;
  }
  /** Rotation center */
  get center(): Vector3 {
    return this.options.center;
  }
  set center(val: Vector3) {
    this.options.center.set(val);
  }
  /**
   * {@inheritDoc BaseCameraController.reset}
   * @override
   */
  reset(): void {
    this.mouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.rotateX = 0;
    this.rotateY = 0;
    this.upVector = Vector3.axisPY();
    this.scale = 1;
    this._loadCameraParams();
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseDown}
   * @override
   */
  protected _onMouseDown(evt: PointerEvent): boolean {
    if (evt.button === 0) {
      this.mouseDown = true;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.rotateX = 0;
      this.rotateY = 0;
      return true;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseUp}
   * @override
   */
  protected _onMouseUp(evt: PointerEvent): boolean {
    if (evt.button === 0 && this.mouseDown) {
      this.mouseDown = false;
      return true;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseWheel}
   * @override
   */
  protected _onMouseWheel(evt: WheelEvent): boolean {
    const factor = Math.pow(0.9, Math.abs(this.options.zoomSpeed));
    if (evt.deltaY > 0) {
      this.scale /= factor;
    } else {
      this.scale *= factor;
    }
    return true;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseMove}
   * @override
   */
  protected _onMouseMove(evt: PointerEvent): boolean {
    if (this.mouseDown) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.rotateX -= dy * this.options.rotateSpeed;
      this.rotateY -= dx * this.options.rotateSpeed;
      return true;
    }
    return false;
  }
  /** @internal */
  private _loadCameraParams() {
    const camera = this._getCamera();
    if (camera) {
      this.eyePos = this._getCamera().position;
      this.target.set(this.options.center);
      camera.lookAt(this.eyePos, this.target, this.upVector);
      Vector3.sub(this.eyePos, this.target, this.direction);
      this.options.distance = this.direction.magnitude;
      this.direction.inplaceNormalize();
      const mat = this._getCamera().localMatrix;
      this.xVector.setXYZ(mat[0], mat[1], mat[2]);
    }
  }
  /**
   * Set options
   * @param opt - options
   */
  setOptions(opt?: OrbitCameraControllerOptions) {
    opt && Object.assign(this.options, opt);
    this.reset();
  }
  /**
   * {@inheritDoc BaseCameraController.update}
   * @override
   */
  update() {
    if (this._getCamera()) {
      const dx = this.options.center.x - this.target.x;
      const dy = this.options.center.y - this.target.y;
      const dz = this.options.center.z - this.target.z;
      this.eyePos.x += dx;
      this.eyePos.y += dy;
      this.eyePos.z += dz;
      this.target.set(this.options.center);
      Quaternion.fromAxisAngle(this.xVector, this.rotateX, this.quat);
      this.quat.transform(this.eyePos.subBy(this.target), this.eyePos);
      Quaternion.fromEulerAngle(0, this.rotateY, 0, 'XYZ', this.quat);
      this.quat.transform(this.eyePos, this.eyePos);
      this.quat.transform(this.xVector, this.xVector).inplaceNormalize();
      Vector3.normalize(this.eyePos, this.direction).inplaceNormalize();
      Vector3.cross(this.direction, this.xVector, this.upVector).inplaceNormalize();
      Vector3.add(
        this.target,
        Vector3.scale(this.direction, this.options.distance * this.scale),
        this.eyePos
      );
      this._getCamera().lookAt(this.eyePos, this.target, this.upVector);
      // this._loadCameraParams();
      if (this.mouseDown) {
        this.rotateX = 0;
        this.rotateY = 0;
      } else {
        this.rotateX *= 1 - this.options.damping;
        this.rotateY *= 1 - this.options.damping;
        if (Math.abs(this.rotateX) < 0.0001) {
          this.rotateX = 0;
        }
        if (Math.abs(this.rotateY) < 0.0001) {
          this.rotateY = 0;
        }
      }
    }
  }
}
