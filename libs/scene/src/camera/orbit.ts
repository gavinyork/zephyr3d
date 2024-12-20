import { Vector3, Quaternion } from '@zephyr3d/base';
import { BaseCameraController } from './base';

/**
 * Creation options for OrbitCameraController
 * @public
 */
export interface OrbitCameraControllerOptions {
  /** target position */
  center: Vector3;
  /** damping value */
  damping?: number;
  /** Zooming speed */
  zoomSpeed?: number;
  /** Rotating speed */
  rotateSpeed?: number;
  /** Panning speed */
  panSpeed?: number;
  controls?: {
    rotate?: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };
    pan?: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };
    zoom?: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };
    zoomWheel?: boolean; // 是否启用滚轮缩放
  };
}

enum OperationType {
  NONE = 0,
  ROTATE = 1,
  PAN = 2,
  ZOOM = 3
}

/**
 * Orbit camera controller
 * @public
 */
export class OrbitCameraController extends BaseCameraController {
  /** @internal */
  private options: OrbitCameraControllerOptions;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  private distance: number;
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
  /** @internal */
  private currentOp: OperationType;
  /**
   * Creates an instance of OrbitCameraController
   * @param options - The creation options
   */
  constructor(options?: OrbitCameraControllerOptions) {
    super();
    this.options = Object.assign(
      {
        center: Vector3.zero(),
        damping: 1,
        rotateSpeed: 1,
        panSpeed: 1,
        zoomSpeed: 1,
        controls: {
          rotate: {
            button: 0,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false
          },
          pan: {
            button: 0,
            shiftKey: true,
            ctrlKey: false,
            altKey: false,
            metaKey: false
          },
          zoom: {
            button: 2,
            shiftKey: false,
            ctrlKey: true,
            altKey: false,
            metaKey: false
          },
          zoomWheel: true
        }
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
    this.currentOp = OperationType.NONE;
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
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.rotateX = 0;
    this.rotateY = 0;
    this.upVector = Vector3.axisPY();
    this.scale = 1;
    this.currentOp = OperationType.NONE;
    this._loadCameraParams();
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseDown}
   * @override
   */
  protected _onMouseDown(evt: PointerEvent): boolean {
    if (this.matchesControl(evt, this.options.controls.rotate)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.rotateX = 0;
      this.rotateY = 0;
      this.currentOp = OperationType.ROTATE;
    } else if (this.matchesControl(evt, this.options.controls.pan)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.currentOp = OperationType.PAN;
      return true;
    } else if (this.matchesControl(evt, this.options.controls.zoom)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.currentOp = OperationType.ZOOM;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseUp}
   * @override
   */
  protected _onMouseUp(evt: PointerEvent): boolean {
    const control =
      this.currentOp === OperationType.ROTATE
        ? this.options.controls.rotate
        : this.currentOp === OperationType.PAN
        ? this.options.controls.pan
        : this.currentOp === OperationType.ZOOM
        ? this.options.controls.zoom
        : null;
    if (control && evt.button === control.button) {
      this.currentOp = OperationType.NONE;
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
    if (this.currentOp !== OperationType.NONE) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      if (this.currentOp === OperationType.ROTATE) {
        this.rotateX -= dy * this.options.rotateSpeed * 0.005;
        this.rotateY -= dx * this.options.rotateSpeed * 0.005;
      } else if (this.currentOp === OperationType.PAN) {
        const right = this.xVector;
        const up = this.upVector;
        const panX = -dx * this.options.panSpeed * this.distance * 0.01;
        const panY = dy * this.options.panSpeed * this.distance * 0.01;
        this.target.combineBy(right, 1, panX);
        this.target.combineBy(up, 1, panY);
        this.eyePos.combineBy(right, 1, panX);
        this.eyePos.combineBy(up, 1, panY);
        this.options.center.combineBy(right, 1, panX);
        this.options.center.combineBy(up, 1, panY);
      } else if (this.currentOp === OperationType.ZOOM) {
        const factor = Math.pow(0.9, Math.abs(this.options.zoomSpeed));
        if (dy > 0) {
          this.scale /= factor;
        } else if (dy < 0) {
          this.scale *= factor;
        }
      }
      return true;
    }
    return false;
  }
  private matchesControl(
    evt: PointerEvent | WheelEvent,
    control: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  ): boolean {
    return (
      evt instanceof PointerEvent &&
      evt.button === control.button &&
      evt.shiftKey === control.shiftKey &&
      evt.ctrlKey === control.ctrlKey &&
      evt.altKey === control.altKey &&
      evt.metaKey === control.metaKey
    );
  }
  /** @internal */
  private _loadCameraParams() {
    const camera = this._getCamera();
    if (camera) {
      this.eyePos.set(this._getCamera().position);
      this.target.set(this.options.center);
      camera.lookAt(this.eyePos, this.target, this.upVector);
      Vector3.sub(this.eyePos, this.target, this.direction);
      this.distance = this.direction.magnitude;
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
    Object.assign(this.options, opt ?? {});
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
      Vector3.add(this.target, Vector3.scale(this.direction, this.distance * this.scale), this.eyePos);
      this._getCamera().lookAt(this.eyePos, this.target, this.upVector);
      if (this.rotateX !== 0 || this.rotateY !== 0) {
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
