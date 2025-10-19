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
  private readonly options: OrbitCameraControllerOptions;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  private rotateX: number;
  /** @internal */
  private rotateY: number;
  /** @internal */
  private readonly eyePos: Vector3;
  /** @internal */
  private upVector: Vector3;
  /** @internal */
  private readonly xVector: Vector3;
  /** @internal */
  private readonly direction: Vector3;
  /** @internal */
  private readonly quat: Quaternion;
  /** @internal */
  private currentOp: OperationType;
  /** @internal */
  private panVelocityX: number;
  /** @internal */
  private panVelocityY: number;
  /**
   * Creates an instance of OrbitCameraController
   * @param options - The creation options
   */
  constructor(options?: Partial<OrbitCameraControllerOptions>) {
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
    this.eyePos = new Vector3();
    this.upVector = new Vector3();
    this.xVector = new Vector3();
    this.direction = new Vector3();
    this.quat = new Quaternion();
    this.reset();
  }
  /** Rotation center */
  get center(): Vector3 {
    return this.options.center;
  }
  set center(val: Vector3) {
    const center = this.options.center;
    const dx = val.x - center.x;
    const dy = val.y - center.y;
    const dz = val.z - center.z;
    center.x += dx;
    center.y += dy;
    center.z += dz;
    this.eyePos.x += dx;
    this.eyePos.y += dy;
    this.eyePos.z += dz;
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
    this.currentOp = OperationType.NONE;
    this.panVelocityX = 0;
    this.panVelocityY = 0;
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
      this.panVelocityX = 0;
      this.panVelocityY = 0;
      this.currentOp = OperationType.ROTATE;
    } else if (this.matchesControl(evt, this.options.controls.pan)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.rotateX = 0;
      this.rotateY = 0;
      this.panVelocityX = 0;
      this.panVelocityY = 0;
      this.currentOp = OperationType.PAN;
      return true;
    } else if (this.matchesControl(evt, this.options.controls.zoom)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.currentOp = OperationType.ZOOM;
      this.rotateX = 0;
      this.rotateY = 0;
      this.panVelocityX = 0;
      this.panVelocityY = 0;
    }
    return true;
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
    return true;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseWheel}
   * @override
   */
  protected _onMouseWheel(evt: WheelEvent): boolean {
    this.zoom(evt.deltaY);
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
        this.panVelocityX = -dx * this.options.panSpeed;
        this.panVelocityY = dy * this.options.panSpeed;
      } else if (this.currentOp === OperationType.ZOOM) {
        this.zoom(dy);
      }
      return true;
    }
    return false;
  }
  private zoom(dy: number) {
    const distance = Vector3.distance(this.eyePos, this.options.center);
    let t = dy > 0 ? this.options.zoomSpeed : dy < 0 ? -this.options.zoomSpeed : 0;
    t = Math.exp(t * 0.1);
    if (t > 1 || distance > 0.01) {
      this.eyePos.combineBy(this.options.center, t, 1 - t);
    }
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
      this.lookAt(camera.position, this.options.center, this.upVector);
    }
  }
  lookAt(from: Vector3, to: Vector3, up: Vector3) {
    this.eyePos.set(from);
    this.options.center.set(to);
    this.upVector.set(up);
    this._getCamera().lookAt(this.eyePos, this.options.center, this.upVector);
    Vector3.sub(this.eyePos, this.options.center, this.direction);
    this.direction.inplaceNormalize();
    const mat = this._getCamera().localMatrix;
    this.xVector.setXYZ(mat[0], mat[1], mat[2]);
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
      const center = this.options.center;

      if (Math.abs(this.panVelocityX) > 0.0001 || Math.abs(this.panVelocityY) > 0.0001) {
        const right = this.xVector;
        const up = this.upVector;

        center.combineBy(right, 1, this.panVelocityX);
        center.combineBy(up, 1, this.panVelocityY);
        this.eyePos.combineBy(right, 1, this.panVelocityX);
        this.eyePos.combineBy(up, 1, this.panVelocityY);

        this.panVelocityX *= 1 - this.options.damping;
        this.panVelocityY *= 1 - this.options.damping;

        if (Math.abs(this.panVelocityX) < 0.0001) {
          this.panVelocityX = 0;
        }
        if (Math.abs(this.panVelocityY) < 0.0001) {
          this.panVelocityY = 0;
        }
      }

      if (Math.abs(this.rotateX) > 0.0001 || Math.abs(this.rotateY) > 0.0001) {
        Quaternion.fromAxisAngle(this.xVector, this.rotateX, this.quat);
        this.quat.transform(this.eyePos.subBy(center), this.eyePos);
        Quaternion.fromEulerAngle(0, this.rotateY, 0, 'ZYX', this.quat);
        this.quat.transform(this.eyePos, this.eyePos);
        this.quat.transform(this.xVector, this.xVector).inplaceNormalize();
        Vector3.normalize(this.eyePos, this.direction).inplaceNormalize();
        Vector3.cross(this.direction, this.xVector, this.upVector).inplaceNormalize();
        this.eyePos.addBy(center);

        this.rotateX *= 1 - this.options.damping;
        this.rotateY *= 1 - this.options.damping;
        if (Math.abs(this.rotateX) < 0.0001) {
          this.rotateX = 0;
        }
        if (Math.abs(this.rotateY) < 0.0001) {
          this.rotateY = 0;
        }
      }

      this._getCamera().lookAt(this.eyePos, center, this.upVector);
    }
  }
}
