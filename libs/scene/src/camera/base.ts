import type { Vector3 } from '@zephyr3d/base';
import type { Camera } from './camera';

/**
 * Base class for camera controllers.
 *
 * Provides a common lifecycle and event-handling surface for concrete camera controllers
 * (e.g., orbit, fly, FPS). Subclasses implement protected handler methods to react to
 * mouse/keyboard input, and update camera transforms in `update()`.
 *
 * Responsibilities:
 * - Holds a reference to a `Camera` and resets internal state when the camera changes.
 * - Offers a `lookAt(from, to, up)` helper that delegates to the camera.
 * - Exposes public event entry points (`onMouseDown`, `onMouseUp`, `onMouseMove`,
 *   `onMouseWheel`, `onKeyDown`, `onKeyUp`) that forward to protected handlers which
 *   subclasses can override.
 * - Defines `reset()` and `update()` lifecycle methods for state initialization and per-frame updates.
 *
 * Event handling contract:
 * - Each public `onXxx` method returns a boolean that indicates whether the event
 *   was handled by the controller. Returning `true` allows upstream dispatchers to
 *   stop propagation if desired.
 *
 * Subclassing guidelines:
 * - Override the protected `_onXxx` handlers rather than the public `onXxx` methods.
 * - Override `reset()` to reinitialize controller state when a new camera is attached.
 * - Override `update()` to advance state each frame (e.g., apply accumulated deltas with damping).
 *
 * Lifecycle:
 * 1. A camera is attached via internal `_setCamera(camera)`, which calls `reset()`.
 * 2. Input events are passed in through the public `onXxx` methods.
 * 3. Per-frame, `update()` is called to apply state changes to the camera.
 *
 * Thread-safety/assumptions:
 * - Designed for use on the main thread in a browser environment.
 * - Pointer events are used for mouse input; keyboard events for key input.
 *
 * @public
 */
export class BaseCameraController {
  /** @internal */
  private _camera: Camera;
  /**
   * Create a base camera controller.
   *
   * The controller starts without an attached camera. Call the internal `_setCamera`
   * to attach a camera (performed by the owning system), which triggers `reset()`.
   */
  constructor() {
    this._camera = null;
  }
  /**
   * Get the attached camera.
   *
   * @returns The current camera or `null` if none is attached.
   * @internal
   */
  _getCamera() {
    return this._camera;
  }
  /**
   * Attach a camera to the controller.
   *
   * If the camera changes, the controller will call `reset()` so subclasses can
   * reinitialize state that depends on the camera.
   *
   * @param camera - The camera to attach.
   * @internal
   */
  _setCamera(camera: Camera) {
    if (this._camera !== camera) {
      this._camera = camera;
      this.reset();
    }
  }
  /**
   * Convenience method that delegates to `camera.lookAt`.
   *
   * @param from - Camera position.
   * @param to - Look-at target.
   * @param up - Up direction.
   */
  lookAt(from: Vector3, to: Vector3, up: Vector3) {
    this._camera.lookAt(from, to, up);
  }
  /**
   * Reset the controller's internal state.
   *
   * Called automatically when a camera is attached via `_setCamera`. Subclasses
   * should override this to reset accumulators, velocities, targets, etc.
   */
  reset(): void {}
  /**
   * Handle pointer down (mouse/touch/pen) events.
   *
   * @param evt - The pointer event.
   * @returns `true` if handled and should stop further processing; otherwise `false`.
   */
  onMouseDown(evt: PointerEvent): boolean {
    return this._onMouseDown(evt);
  }
  /**
   * Handle pointer up events.
   *
   * @param evt - The pointer event.
   * @returns `true` if handled; otherwise `false`.
   */
  onMouseUp(evt: PointerEvent): boolean {
    return this._onMouseUp(evt);
  }
  /**
   * Handle mouse wheel (scroll) events.
   *
   * Typical usage: zoom/dolly control, FOV adjustments.
   *
   * @param evt - The wheel event.
   * @returns `true` if handled; otherwise `false`.
   */
  onMouseWheel(evt: WheelEvent): boolean {
    return this._onMouseWheel(evt);
  }
  /**
   * Handle pointer move events.
   *
   * Typical usage: orbit, pan, or look controls based on button/modifier state.
   *
   * @param evt - The pointer event.
   * @returns `true` if handled; otherwise `false`.
   */
  onMouseMove(evt: PointerEvent): boolean {
    return this._onMouseMove(evt);
  }
  /**
   * Handle key down events.
   *
   * Typical usage: WASD navigation, modifiers for speed, toggling modes.
   *
   * @param evt - The keyboard event.
   * @returns `true` if handled; otherwise `false`.
   */
  onKeyDown(evt: KeyboardEvent): boolean {
    return this._onKeyDown(evt);
  }
  /**
   * Handle key up events.
   *
   * @param evt - The keyboard event.
   * @returns `true` if handled; otherwise `false`.
   */
  onKeyUp(evt: KeyboardEvent): boolean {
    return this._onKeyUp(evt);
  }
  /**
   * Per-frame update.
   *
   * Subclasses should override this to:
   * - Integrate velocities/accelerations and apply damping.
   * - Smoothly interpolate camera transforms.
   * - Clamp angles/distances/FOV, etc.
   *
   * Called once per frame by the owning system.
   */
  update(): void {}
  /**
   * Mouse down event handler
   * @param evt - Mouse event
   * @returns Boolean value indices whether this event was handled
   */
  protected _onMouseDown(_evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Pointer up handler for subclasses to override.
   *
   * @param _evt - Pointer event.
   * @returns `true` if handled; otherwise `false`.
   */
  protected _onMouseUp(_evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Mouse wheel handler for subclasses to override.
   *
   * @param _evt - Wheel event.
   * @returns `true` if handled; otherwise `false`.
   */
  protected _onMouseWheel(_evt: WheelEvent): boolean {
    return false;
  }
  /**
   * Pointer move handler for subclasses to override.
   *
   * @param _evt - Pointer event.
   * @returns `true` if handled; otherwise `false`.
   */
  protected _onMouseMove(_evt: PointerEvent): boolean {
    return false;
  }
  /**
   * Key down handler for subclasses to override.
   *
   * @param _evt - Keyboard event.
   * @returns `true` if handled; otherwise `false`.
   */
  protected _onKeyDown(_evt: KeyboardEvent): boolean {
    return false;
  }
  /**
   * Key up handler for subclasses to override.
   *
   * @param _evt - Keyboard event.
   * @returns `true` if handled; otherwise `false`.
   */
  protected _onKeyUp(_evt: KeyboardEvent): boolean {
    return false;
  }
}
