import type { Vector3 } from '@zephyr3d/base';
import type { Camera } from './camera';

/**
 * Base class for any kind of camera controllers
 * @public
 */
export class BaseCameraController {
  /** @internal */
  private _camera: Camera;
  /**
   * Creates an instance of BaseCameraController
   */
  constructor() {
    this._camera = null;
  }
  /** @internal */
  _getCamera() {
    return this._camera;
  }
  /** @internal */
  _setCamera(camera: Camera) {
    if (this._camera !== camera) {
      this._camera = camera;
      this.reset();
    }
  }
  lookAt(from: Vector3, to: Vector3, up: Vector3) {
    this._camera.lookAt(from, to, up);
  }
  /**
   * Resets state
   */
  reset(): void {}
  /** @internal */
  onMouseDown(evt: PointerEvent): boolean {
    return this._onMouseDown(evt);
  }
  /** @internal */
  onMouseUp(evt: PointerEvent): boolean {
    return this._onMouseUp(evt);
  }
  /** @internal */
  onMouseWheel(evt: WheelEvent): boolean {
    return this._onMouseWheel(evt);
  }
  /** @internal */
  onMouseMove(evt: PointerEvent): boolean {
    return this._onMouseMove(evt);
  }
  /** @internal */
  onKeyDown(evt: KeyboardEvent): boolean {
    return this._onKeyDown(evt);
  }
  /** @internal */
  onKeyUp(evt: KeyboardEvent): boolean {
    return this._onKeyUp(evt);
  }
  /**
   * Updates state
   */
  update(): void {}
  /**
   * Mouse down event handler
   * @param evt - Mouse event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onMouseDown(evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Mouse up event handler
   * @param evt - Mouse event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onMouseUp(evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Mouse wheel event handler
   * @param evt - Mouse event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onMouseWheel(evt: WheelEvent): boolean {
    return false;
  }
  /**
   * Mouse move event handler
   * @param evt - Mouse event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onMouseMove(evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Key down event handler
   * @param evt - Keyboard event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onKeyDown(evt: KeyboardEvent): boolean {
    return false;
  }
  /**
   * Key up event handler
   * @param evt - Keyboard event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onKeyUp(evt: KeyboardEvent): boolean {
    return false;
  }
}
