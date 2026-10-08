import type { DeepRequireOptionals, Immutable } from '@zephyr3d/base';
import { Vector3, Quaternion } from '@zephyr3d/base';
import type { IControllerMouseEvent, IControllerWheelEvent } from './base';
import { BaseCameraController } from './base';

/**
 * Creation options for OrbitCameraController
 * @public
 */
export interface OrbitCameraControllerOptions {
  /** target position */
  center: Vector3;
  /** Fraction of the rotate/pan velocity lost per 1/60 s, independent of the actual frame rate. */
  damping?: number;
  /**
   * Zooming speed: world units the camera moves toward or away from the center per 100 pixels of
   * wheel scroll (one mouse wheel notch), as the editor camera does. Default 5.
   */
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
    zoomWheel?: boolean; // Whether mouse-wheel zoom is enabled
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
  private readonly options: DeepRequireOptionals<OrbitCameraControllerOptions>;
  /** @internal */
  private lastMouseX!: number;
  /** @internal */
  private lastMouseY!: number;
  /** @internal */
  private rotateX!: number;
  /** @internal */
  private rotateY!: number;
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
  private currentOp!: OperationType;
  /** @internal */
  private panVelocityX!: number;
  /** @internal */
  private panVelocityY!: number;
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
        zoomSpeed: 5,
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
  get center(): Immutable<Vector3> {
    return this.options.center;
  }
  set center(val: Immutable<Vector3>) {
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
  reset() {
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
  protected _onMouseDown(evt: IControllerMouseEvent) {
    if (this.matchesControl(evt, this.options.controls.rotate)) {
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      this.rotateX = 0;
      this.rotateY = 0;
      this.panVelocityX = 0;
      this.panVelocityY = 0;
      this.currentOp = OperationType.ROTATE;
      return true;
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
      return true;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseUp}
   * @override
   */
  protected _onMouseUp(evt: IControllerMouseEvent) {
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
  protected _onMouseWheel(evt: IControllerWheelEvent) {
    // Same scroll handling as the editor camera (EditorCameraController._onMouseWheel)
    let px = evt.deltaY;
    if (evt.deltaMode === 1) {
      px *= 16;
    } else if (evt.deltaMode === 2) {
      px *= window.innerHeight;
    }
    if (evt.ctrlKey) {
      px *= 10;
    }
    if (evt.shiftKey) {
      px *= 0.1;
    }
    this.zoom(Math.max(-100, Math.min(100, px)));
    return true;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseMove}
   * @override
   */
  protected _onMouseMove(evt: IControllerMouseEvent) {
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
  /**
   * Moves the eye along the view direction by zoomSpeed per 100 pixels, away from the center for
   * positive values; it stops short of the center instead of passing through it
   */
  private zoom(px: number) {
    const center = this.options.center;
    const distance = Vector3.distance(this.eyePos, center);
    if (distance < 1e-6 || px === 0) {
      return;
    }
    const newDistance = Math.max(0.01, distance + this.options.zoomSpeed * px * 0.01);
    if (newDistance !== distance) {
      this.eyePos.combineBy(center, newDistance / distance, 1 - newDistance / distance);
    }
  }
  private matchesControl(
    evt: IControllerMouseEvent,
    control: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  ) {
    return (
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
    const camera = this._getCamera();
    if (camera) {
      this.eyePos.set(from);
      this.options.center.set(to);
      this.upVector.set(up);
      camera.lookAt(this.eyePos, this.options.center, this.upVector);
      Vector3.sub(this.eyePos, this.options.center, this.direction);
      this.direction.inplaceNormalize();
      const mat = camera.localMatrix;
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
   * {@inheritDoc BaseCameraController._onUpdate}
   * @override
   */
  protected _onUpdate(deltaTime: number) {
    const camera = this._getCamera()!;
    const center = this.options.center;
    // Velocities are per 60 Hz frame and decay by `damping` per frame. For `frames`
    // such frames the velocity decays by `decay`, and the distance covered is the
    // sum of the geometric series, `travel` times the current velocity. At 60 fps
    // this is exactly one frame: travel 1, decay 1 - damping.
    const frames = deltaTime * 60;
    const damping = this.options.damping;
    const decay = Math.pow(1 - damping, frames);
    const travel = damping > 0 ? (1 - decay) / damping : frames;

    if (Math.abs(this.panVelocityX) > 0.0001 || Math.abs(this.panVelocityY) > 0.0001) {
      const right = this.xVector;
      const up = this.upVector;

      center.combineBy(right, 1, this.panVelocityX * travel);
      center.combineBy(up, 1, this.panVelocityY * travel);
      this.eyePos.combineBy(right, 1, this.panVelocityX * travel);
      this.eyePos.combineBy(up, 1, this.panVelocityY * travel);

      this.panVelocityX *= decay;
      this.panVelocityY *= decay;

      if (Math.abs(this.panVelocityX) < 0.0001) {
        this.panVelocityX = 0;
      }
      if (Math.abs(this.panVelocityY) < 0.0001) {
        this.panVelocityY = 0;
      }
    }

    if (Math.abs(this.rotateX) > 0.0001 || Math.abs(this.rotateY) > 0.0001) {
      Quaternion.fromAxisAngle(this.xVector, this.rotateX * travel, this.quat);
      this.quat.transform(this.eyePos.subBy(center), this.eyePos);
      Quaternion.fromEulerAngle(0, this.rotateY * travel, 0, 'ZYX', this.quat);
      this.quat.transform(this.eyePos, this.eyePos);
      this.quat.transform(this.xVector, this.xVector).inplaceNormalize();
      Vector3.normalize(this.eyePos, this.direction).inplaceNormalize();
      Vector3.cross(this.direction, this.xVector, this.upVector).inplaceNormalize();
      this.eyePos.addBy(center);

      this.rotateX *= decay;
      this.rotateY *= decay;
      if (Math.abs(this.rotateX) < 0.0001) {
        this.rotateX = 0;
      }
      if (Math.abs(this.rotateY) < 0.0001) {
        this.rotateY = 0;
      }
    }

    camera.lookAt(this.eyePos, center, this.upVector);
  }
}
