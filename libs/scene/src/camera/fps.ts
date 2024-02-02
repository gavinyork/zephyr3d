import { Vector3, Quaternion, Matrix3x3, Matrix4x4 } from '@zephyr3d/base';
import { BaseCameraController } from './base';

/**
 * Creation options for FPSCameraController
 * @public
 */
export interface FPSCameraControllerOptions {
  /** The control keys */
  controlKeys?: {
    up: string;
    down: string;
    forward: string;
    backward: string;
    left: string;
    right: string;
  };
  /** Moving speed */
  moveSpeed?: number;
  /** Rotating speed */
  rotateSpeed?: number;
}

/**
 * FPS camera controller
 * @public
 */
export class FPSCameraController extends BaseCameraController {
  /** @internal */
  private options: FPSCameraControllerOptions;
  /** @internal */
  private mouseDown: boolean;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  private keyUp: boolean;
  /** @internal */
  private keyDown: boolean;
  /** @internal */
  private keyLeft: boolean;
  /** @internal */
  private keyRight: boolean;
  /** @internal */
  private keyForward: boolean;
  /** @internal */
  private keyBackward: boolean;
  /**
   * Creates an instance of FPSCameraController
   * @param options - The creation options
   */
  constructor(options?: FPSCameraControllerOptions) {
    super();
    this.options = Object.assign(
      {
        controlKeys: {
          up: 'KeyQ',
          down: 'KeyE',
          forward: 'KeyW',
          backward: 'KeyS',
          left: 'KeyA',
          right: 'KeyD'
        },
        moveSpeed: 0.2,
        rotateSpeed: 0.01
      },
      options || {}
    );
  }
  /**
   * {@inheritDoc BaseCameraController.reset}
   * @override
   */
  reset() {
    this.mouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.keyUp = false;
    this.keyDown = false;
    this.keyLeft = false;
    this.keyRight = false;
    this.keyForward = false;
    this.keyBackward = false;
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
   * {@inheritDoc BaseCameraController._onMouseMove}
   * @override
   */
  protected _onMouseMove(evt: PointerEvent): boolean {
    if (this.mouseDown) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      const zAxis = this._getCamera().worldMatrix.getRow(2).xyz();
      const alpha = Math.atan2(zAxis.z, zAxis.x) + dx * this.options.rotateSpeed;
      const beta = Math.min(
        Math.PI / 2.1,
        Math.max(-Math.PI / 2.1, Math.asin(zAxis.y) + dy * this.options.rotateSpeed)
      );
      const newY = Math.sin(beta);
      const r = Math.sqrt(Math.max(0, 1 - newY * newY));
      const newZ = Math.sin(alpha) * r;
      const newX = Math.cos(alpha) * r;
      zAxis.setXYZ(newX, newY, newZ).inplaceNormalize();
      const XAxis = Vector3.cross(Vector3.axisPY(), zAxis).inplaceNormalize();
      const YAxis = Vector3.cross(zAxis, XAxis).inplaceNormalize();
      const rotation = Quaternion.fromRotationMatrix(
        new Matrix3x3([XAxis.x, XAxis.y, XAxis.z, YAxis.x, YAxis.y, YAxis.z, zAxis.x, zAxis.y, zAxis.z])
      );
      if (!this._getCamera().parent) {
        this._getCamera().rotation.set(rotation);
      } else {
        const pos = new Vector3();
        const scale = new Vector3();
        this._getCamera().worldMatrix.decompose(scale, null, pos);
        const newWorldMatrix = Matrix4x4.scaling(scale).rotateLeft(rotation).translateLeft(pos);
        const newLocalMatrix = this._getCamera().parent
          ? newWorldMatrix.multiplyLeftAffine(Matrix4x4.invertAffine(this._getCamera().parent.worldMatrix))
          : newWorldMatrix;
        newLocalMatrix.decompose(scale, rotation, pos);
        this._getCamera().position.set(pos);
        this._getCamera().scale.set(scale);
        this._getCamera().rotation.set(rotation);
      }
      return true;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onKeyDown}
   * @override
   */
  protected _onKeyDown(evt: KeyboardEvent): boolean {
    switch (evt.code) {
      case this.options.controlKeys.up:
        this.keyUp = true;
        break;
      case this.options.controlKeys.down:
        this.keyDown = true;
        break;
      case this.options.controlKeys.left:
        this.keyLeft = true;
        break;
      case this.options.controlKeys.right:
        this.keyRight = true;
        break;
      case this.options.controlKeys.forward:
        this.keyForward = true;
        break;
      case this.options.controlKeys.backward:
        this.keyBackward = true;
        break;
      default:
        return false;
    }
    return true;
  }
  /**
   * {@inheritDoc BaseCameraController._onKeyUp}
   * @override
   */
  protected _onKeyUp(evt: KeyboardEvent): boolean {
    switch (evt.code) {
      case this.options.controlKeys.up:
        this.keyUp = false;
        break;
      case this.options.controlKeys.down:
        this.keyDown = false;
        break;
      case this.options.controlKeys.left:
        this.keyLeft = false;
        break;
      case this.options.controlKeys.right:
        this.keyRight = false;
        break;
      case this.options.controlKeys.forward:
        this.keyForward = false;
        break;
      case this.options.controlKeys.backward:
        this.keyBackward = false;
        break;
      default:
        return false;
    }
    return true;
  }
  /**
   * Set options
   * @param opt - options
   */
  setOptions(opt?: FPSCameraControllerOptions) {
    opt && Object.assign(this.options, opt);
    this.reset();
  }
  /**
   * {@inheritDoc BaseCameraController.update}
   * @override
   */
  update() {
    const x = this._getCamera().worldMatrix.getRow(0).xyz();
    x.y = 0;
    x.inplaceNormalize();
    if (x.isNaN()) {
      console.log(`Camera error 1: ${x.toString()}`);
    }
    const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
    if (z.isNaN()) {
      console.log(`Camera error 2: ${z.toString()}`);
    }
    const move = new Vector3(0, 0, 0);
    let changed = false;
    if (this.keyForward) {
      changed = true;
      move.subBy(Vector3.scale(z, this.options.moveSpeed));
    }
    if (this.keyBackward) {
      changed = true;
      move.addBy(Vector3.scale(z, this.options.moveSpeed));
    }
    if (this.keyUp) {
      changed = true;
      move.y += this.options.moveSpeed;
    }
    if (this.keyDown) {
      changed = true;
      move.y -= this.options.moveSpeed;
    }
    if (this.keyLeft) {
      changed = true;
      move.subBy(Vector3.scale(x, this.options.moveSpeed));
    }
    if (this.keyRight) {
      changed = true;
      move.addBy(Vector3.scale(x, this.options.moveSpeed));
    }
    if (changed) {
      if (this._getCamera().parent) {
        const pos = new Vector3();
        const scale = new Vector3();
        const rotation = new Quaternion();
        this._getCamera().worldMatrix.decompose(scale, rotation, pos);
        pos.addBy(move);
        const newWorldMatrix = Matrix4x4.scaling(scale).rotateLeft(rotation).translateLeft(pos);
        const newLocalMatrix = newWorldMatrix.multiplyLeftAffine(
          Matrix4x4.invertAffine(this._getCamera().parent.worldMatrix)
        );
        newLocalMatrix.decompose(scale, rotation, pos);
        if (scale.isNaN() || rotation.isNaN() || pos.isNaN()) {
          console.log(`Camera error 3: ${scale.toString()} ${rotation.toString()} ${pos.toString()}`);
        }
        this._getCamera().position.set(pos);
        this._getCamera().scale.set(scale);
        this._getCamera().rotation.set(rotation);
      } else {
        this._getCamera().moveBy(move);
      }
    }
  }
}
