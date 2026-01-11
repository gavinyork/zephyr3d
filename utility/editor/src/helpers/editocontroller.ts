import { Vector3, Quaternion, Matrix3x3, Matrix4x4, ASSERT } from '@zephyr3d/base';
import type {
  IControllerPointerDownEvent,
  IControllerPointerMoveEvent,
  IControllerPointerUpEvent,
  IControllerWheelEvent
} from '@zephyr3d/scene';
import { BaseCameraController, getDevice } from '@zephyr3d/scene';

export interface EditorCameraControllerOptions {
  /** Moving speed */
  moveSpeed?: number;
  /** Zoom speed */
  zoomSpeed?: number;
  /** Rotating speed */
  rotateSpeed?: number;
  /** Scale speed */
  scaleSpeed?: number;
  /** Zoom damping */
  zoomDamping?: number;
}

export class EditorCameraController extends BaseCameraController {
  /** @internal */
  private readonly options: EditorCameraControllerOptions;
  /** @internal */
  private rightMouseDown: boolean;
  /** @internal */
  private middleMouseDown: boolean;
  /** @internal */
  private lastMouseX: number;
  /** @internal */
  private lastMouseY: number;
  /** @internal */
  private zoomVelocity: number;
  /**
   * Creates an instance of FPSCameraController
   * @param options - The creation options
   */
  constructor(options?: EditorCameraControllerOptions) {
    super();
    this.options = {
      moveSpeed: 0.1,
      zoomSpeed: 5,
      rotateSpeed: 0.01,
      scaleSpeed: 0.02,
      zoomDamping: 10,
      ...options
    };
    this.reset();
  }
  /**
   * {@inheritDoc BaseCameraController.reset}
   * @override
   */
  reset() {
    this.rightMouseDown = false;
    this.middleMouseDown = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.zoomVelocity = 0;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseDown}
   * @override
   */
  protected _onMouseDown(evt: IControllerPointerDownEvent): boolean {
    if (evt.button === 1) {
      this.middleMouseDown = true;
    } else if (evt.button === 2) {
      this.rightMouseDown = true;
    } else {
      return false;
    }
    this.lastMouseX = evt.offsetX;
    this.lastMouseY = evt.offsetY;
    return true;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseUp}
   * @override
   */
  protected _onMouseUp(evt: IControllerPointerUpEvent): boolean {
    if (evt.button === 1 && this.middleMouseDown) {
      this.middleMouseDown = false;
      return true;
    } else if (evt.button === 2 && this.rightMouseDown) {
      this.rightMouseDown = false;
      return true;
    }
    return false;
  }
  /**
   * {@inheritDoc BaseCameraController._onMouseMove}
   * @override
   */
  protected _onMouseMove(evt: IControllerPointerMoveEvent): boolean {
    if (this.rightMouseDown) {
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
    if (this.middleMouseDown) {
      const dx = evt.offsetX - this.lastMouseX;
      const dy = evt.offsetY - this.lastMouseY;
      this.lastMouseX = evt.offsetX;
      this.lastMouseY = evt.offsetY;
      const zooming = evt.ctrlKey;
      const moveSpeed = this._getCamera().isPerspective() ? this.options.moveSpeed : this.options.scaleSpeed;
      const moveX = -dx * moveSpeed;
      const moveY = dy * moveSpeed;
      const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
      if (zooming) {
        if (this._getCamera().isPerspective()) {
          const move = z.scaleBy(moveY);
          this._moveCamera(move);
        } else if (dy !== 0) {
          this._scaleCamera(dy < 0 ? 1 / (1 - dy * moveSpeed) : 1 + dy * moveSpeed);
        }
      } else {
        const x = this._getCamera()
          .worldMatrix.getRow(0)
          .xyz()
          .mulBy(new Vector3(1, 0, 1))
          .inplaceNormalize();
        const y = Vector3.cross(z, x);
        if (this._getCamera().isPerspective()) {
          const move = Vector3.combine(x, y, moveX, moveY);
          this._moveCamera(move);
        } else {
          const viewport = this._getCamera().viewport;
          const projMatrix = this._getCamera().getProjectionMatrix();
          const width = Math.abs(projMatrix.getRightPlane() - projMatrix.getLeftPlane());
          const height = Math.abs(projMatrix.getTopPlane() - projMatrix.getBottomPlane());
          const deltaX = (-dx * width) / viewport[2];
          const deltaY = (-dy * height) / viewport[3];
          const move = Vector3.combine(x, y, deltaX, deltaY);
          this._moveCamera(move);
        }
      }
      return true;
    }
    return false;
  }
  protected _onMouseWheel(evt: IControllerWheelEvent): boolean {
    /*
    const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
    const move = z.scaleBy(this.options.zoomSpeed * evt.deltaY);
    this._moveCamera(move);
    */
    const delta =
      (this._getCamera().isPerspective() ? this.options.zoomSpeed : this.options.scaleSpeed) * evt.deltaY;
    this.zoomVelocity += delta;
    return true;
  }
  private _scaleCamera(scale: number) {
    ASSERT(!this._getCamera().isPerspective());
    const projMatrix = this._getCamera().getProjectionMatrix();
    const left = projMatrix.getLeftPlane() * scale;
    const right = projMatrix.getRightPlane() * scale;
    const bottom = projMatrix.getBottomPlane() * scale;
    const top = projMatrix.getTopPlane() * scale;
    const near = projMatrix.getNearPlane();
    const far = projMatrix.getFarPlane();
    this._getCamera().setProjectionMatrix(Matrix4x4.ortho(left, right, bottom, top, near, far));
  }
  private _moveCamera(move: Vector3) {
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
      this._getCamera().position.set(pos);
      this._getCamera().scale.set(scale);
      this._getCamera().rotation.set(rotation);
    } else {
      this._getCamera().moveBy(move);
    }
  }
  /**
   * Set options
   * @param opt - options
   */
  setOptions(opt?: EditorCameraControllerOptions) {
    Object.assign(this.options, opt ?? {});
    this.reset();
  }
  /**
   * {@inheritDoc BaseCameraController.update}
   * @override
   */
  update() {
    if (Math.abs(this.zoomVelocity) > 1e-4) {
      const dt = getDevice().frameInfo.elapsedFrame * 0.001;
      const moveDist = this.zoomVelocity * dt;

      if (this._getCamera().isPerspective()) {
        const z = this._getCamera().worldMatrix.getRow(2).xyz().inplaceNormalize();
        const move = z.scaleBy(moveDist);
        this._moveCamera(move);
      } else {
        const scale = moveDist > 0 ? 1 + moveDist : 1 / (1 - moveDist);
        this._scaleCamera(scale);
      }

      const damping = this.options.zoomDamping;
      const factor = Math.exp(-damping * dt); // e^{-k dt}
      this.zoomVelocity *= factor;

      if (Math.abs(this.zoomVelocity) < 1e-4) {
        this.zoomVelocity = 0;
      }
    }
  }
}
