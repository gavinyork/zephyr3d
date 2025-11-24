import type { Application } from '../app';

type PointerEventData = {
  lastClick: boolean;
  lastClickX: number;
  lastClickY: number;
  lastClickTime: number;
  lastDown: boolean;
  lastDownX: number;
  lastDownY: number;
  lastDownTime: number;
  lastMoveX: number;
  lastMoveY: number;
};

type PointerEventHandler = (this: HTMLElement, ev: PointerEvent) => any;
type KeyboardEventHandler = (this: HTMLElement, ev: KeyboardEvent) => any;
type DragEventHandler = (this: HTMLElement, ev: DragEvent) => any;
type WheelEventHandler = (this: HTMLElement, ev: WheelEvent) => any;
type CompositionEventHandler = (this: HTMLElement, ev: CompositionEvent) => any;

/**
 * Input handler middleware type.
 *
 * Return true to indicate the event has been handled and should not be forwarded
 * to the Application's observable event system.
 *
 * @public
 */
export type InputEventHandler = (ev: Event, type?: string) => boolean;

/**
 * Input manager
 *
 * Centralizes DOM input event handling for the engine:
 * - Subscribes to pointer/keyboard/drag/wheel/composition events on the target canvas element.
 * - Normalizes click and double-click detection using distance/time tolerances.
 * - Supports a middleware chain (`use`) to intercept and optionally consume events
 *   before they are dispatched to the Application's observable event map.
 * - Manages pointer capture for mouse interactions to ensure consistent up/move delivery.
 *
 * Lifecycle:
 * - Call `start()` to attach all event listeners; `stop()` to remove them.
 *
 * @public
 */
export class InputManager {
  private readonly _app: Application;
  private readonly _target: HTMLElement;
  private _started: boolean;
  private readonly _clickDistTolerance: number;
  private readonly _clickTimeTolerance: number;
  private readonly _dblclickDistTolerance: number;
  private readonly _dblclickTimeTolerance: number;
  private readonly _pointerDownHandler: PointerEventHandler;
  private readonly _pointerUpHandler: PointerEventHandler;
  private readonly _pointerMoveHandler: PointerEventHandler;
  private readonly _pointerCancelHandler: PointerEventHandler;
  private readonly _contextMenuHandler: PointerEventHandler;
  private readonly _keyboardHandler: KeyboardEventHandler;
  private readonly _dragHandler: DragEventHandler;
  private readonly _wheelHandler: WheelEventHandler;
  private readonly _compositionHandler: CompositionEventHandler;
  private _enableContextMenu: boolean;
  private _captureId: number;
  private readonly _middlewares: { handler: InputEventHandler; ctx: unknown }[];
  private _lastEventDatas: PointerEventData[];
  /**
   * Creates an instance of InputManager bound to the given application/canvas.
   *
   * @param app - The owning Application instance.
   */
  constructor(app: Application) {
    this._app = app;
    this._target = app.options.canvas;
    this._started = false;
    this._clickDistTolerance = 4 * 4;
    this._clickTimeTolerance = 400;
    this._dblclickDistTolerance = 4 * 4;
    this._dblclickTimeTolerance = 400;
    this._lastEventDatas = [];
    this._enableContextMenu = false;
    this._pointerDownHandler = this._getPointerDownHandler();
    this._pointerUpHandler = this._getPointerUpHandler();
    this._pointerMoveHandler = this._getPointerMoveHander();
    this._pointerCancelHandler = this._getPointerCancelHandler();
    this._contextMenuHandler = this._getContextMenuHandler();
    this._keyboardHandler = this._getKeyboardHandler();
    this._dragHandler = this._getDragHandler();
    this._wheelHandler = this._getWheelHandler();
    this._compositionHandler = this._getCompositionHandler();
    this._captureId = -1;
    this._middlewares = [];
  }
  /**
   * Begin listening to DOM events on the target element.
   *
   * Idempotent: additional calls have no effect after the first successful start.
   *
   * @internal
   */
  start() {
    if (!this._started) {
      this._started = true;
      this._target.addEventListener('pointerdown', this._pointerDownHandler);
      this._target.addEventListener('pointerup', this._pointerUpHandler);
      this._target.addEventListener('pointermove', this._pointerMoveHandler);
      this._target.addEventListener('pointercancel', this._pointerCancelHandler);
      this._target.addEventListener('contextmenu', this._contextMenuHandler);
      this._target.addEventListener('keydown', this._keyboardHandler);
      this._target.addEventListener('keyup', this._keyboardHandler);
      this._target.addEventListener('keypress', this._keyboardHandler);
      this._target.addEventListener('drag', this._dragHandler);
      this._target.addEventListener('dragenter', this._dragHandler);
      this._target.addEventListener('dragleave', this._dragHandler);
      this._target.addEventListener('dragstart', this._dragHandler);
      this._target.addEventListener('dragend', this._dragHandler);
      this._target.addEventListener('dragover', this._dragHandler);
      this._target.addEventListener('drop', this._dragHandler);
      this._target.addEventListener('wheel', this._wheelHandler);
      this._target.addEventListener('compositionstart', this._compositionHandler);
      this._target.addEventListener('compositionupdate', this._compositionHandler);
      this._target.addEventListener('compositionend', this._compositionHandler);
    }
  }
  /**
   * Stop listening to DOM events and clear per-pointer cached state.
   *
   * Idempotent: does nothing if not started.
   *
   * @internal
   */
  stop() {
    if (this._started) {
      this._started = false;
      this._target.removeEventListener('pointerdown', this._pointerDownHandler);
      this._target.removeEventListener('pointerup', this._pointerUpHandler);
      this._target.removeEventListener('pointermove', this._pointerMoveHandler);
      this._target.removeEventListener('pointercancel', this._pointerCancelHandler);
      this._target.removeEventListener('contextmenu', this._contextMenuHandler);
      this._target.removeEventListener('keydown', this._keyboardHandler);
      this._target.removeEventListener('keyup', this._keyboardHandler);
      this._target.removeEventListener('keypress', this._keyboardHandler);
      this._target.removeEventListener('drag', this._dragHandler);
      this._target.removeEventListener('dragenter', this._dragHandler);
      this._target.removeEventListener('dragleave', this._dragHandler);
      this._target.removeEventListener('dragstart', this._dragHandler);
      this._target.removeEventListener('dragend', this._dragHandler);
      this._target.removeEventListener('dragover', this._dragHandler);
      this._target.removeEventListener('drop', this._dragHandler);
      this._target.removeEventListener('wheel', this._wheelHandler);
      this._target.removeEventListener('compositionstart', this._compositionHandler);
      this._target.removeEventListener('compositionupdate', this._compositionHandler);
      this._target.removeEventListener('compositionend', this._compositionHandler);
      this._lastEventDatas = [];
    }
  }
  /**
   * Register a middleware (interceptor) for input events.
   *
   * Order matters: middlewares are invoked in the order they were added until one returns true.
   * If a middleware returns true, the event is considered handled and will not be dispatched
   * to the Application's observers.
   *
   * @param handler - Middleware function to add.
   * @param ctx - `this` object for handler
   * @returns The InputManager instance for chaining.
   */
  use(handler: InputEventHandler, ctx?: unknown): this {
    if (handler) {
      this._middlewares.push({ handler, ctx });
    }
    return this;
  }
  /**
   * Register a middleware (interceptor) for input events at the first order.
   *
   * @param handler - Middleware function to add.
   * @param ctx - `this` object for handler
   * @returns The InputManager instance for chaining.
   */
  useFirst(handler: InputEventHandler, ctx?: unknown): this {
    if (handler) {
      this._middlewares.unshift({ handler, ctx });
    }
    return this;
  }
  /**
   * Unregister a previously registered middleware (interceptor) for input events.
   *
   * Removes the first middleware that matches both the given `handler` and `ctx`.
   * If no matching middleware is found, this method is a no-op.
   *
   * Note: This only removes the specific pair of `(handler, ctx)` previously added
   * via `use`. If the same `handler` was registered multiple times with different
   * contexts, only the first exact match will be removed.
   *
   * @param handler - Middleware function to remove.
   * @param ctx - `this` object that was associated with the `handler` when it was added.
   * @returns The InputManager instance for chaining.
   */
  unuse(handler: InputEventHandler, ctx?: unknown): this {
    const index = this._middlewares.findIndex((h) => h.handler === handler && h.ctx === ctx);
    if (index >= 0) {
      this._middlewares.splice(index, 1);
    }
    return this;
  }
  enableSystemContextMenu(enable: boolean) {
    this._enableContextMenu = !!enable;
  }
  /**
   * Utility middleware that logs the event type to the console.
   *
   * Can be used with `use(InputManager.log)` for quick diagnostics.
   *
   * @param ev - The DOM event being logged.
   * @param type - Optional explicit event type; falls back to `ev.type`.
   * @returns Always false (does not consume the event).
   */
  static log(ev: Event, type?: string) {
    console.log('Event log:', type ?? ev.type);
    return false;
  }
  private _callMiddlewares(
    ev: PointerEvent | WheelEvent | KeyboardEvent | DragEvent | CompositionEvent,
    type?: string
  ): boolean {
    for (const mw of this._middlewares) {
      if (mw.handler.call(mw.ctx, ev, type ?? ev.type)) {
        return true;
      }
    }
    return false;
  }
  private _getPointerCancelHandler() {
    const that = this;
    return function (ev: PointerEvent) {
      const eventData = that._getPointerEventData(ev.pointerId);
      eventData.lastDown = false;
      eventData.lastClick = false;
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getContextMenuHandler() {
    const that = this;
    return function (ev: PointerEvent) {
      if (!that._enableContextMenu) {
        ev.preventDefault();
      }
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getPointerMoveHander() {
    const that = this;
    return function (ev: PointerEvent) {
      const eventData = that._getPointerEventData(ev.pointerId);
      eventData.lastMoveX = ev.offsetX;
      eventData.lastMoveY = ev.offsetY;
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getPointerDownHandler() {
    const that = this;
    return function (ev: PointerEvent) {
      if (ev.pointerType === 'mouse') {
        that._captureId = ev.pointerId;
        that._app.options.canvas.setPointerCapture(ev.pointerId);
      }
      const eventData = that._getPointerEventData(ev.pointerId);
      eventData.lastDown = true;
      eventData.lastDownX = ev.offsetX;
      eventData.lastDownY = ev.offsetY;
      eventData.lastDownTime = Date.now();
      that._app.focus();
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getPointerUpHandler() {
    const that = this;
    return function (ev: PointerEvent) {
      const eventData = that._getPointerEventData(ev.pointerId);
      let emitClickEvent = false;
      let emitDoubleClickEvent = false;
      const now = Date.now();
      if (eventData.lastDown) {
        if (now <= eventData.lastDownTime + that._clickTimeTolerance) {
          let deltaX = ev.offsetX - eventData.lastDownX;
          let deltaY = ev.offsetY - eventData.lastDownY;
          if (deltaX * deltaX + deltaY * deltaY <= that._clickDistTolerance) {
            emitClickEvent = true;
            if (eventData.lastClick && now <= eventData.lastClickTime + that._dblclickTimeTolerance) {
              deltaX = ev.offsetX - eventData.lastClickX;
              deltaY = ev.offsetY - eventData.lastClickY;
              if (deltaX * deltaX + deltaY * deltaY <= that._dblclickDistTolerance) {
                emitDoubleClickEvent = true;
              }
            }
          }
        }
      }
      eventData.lastDown = false;
      eventData.lastMoveX = ev.offsetX;
      eventData.lastMoveY = ev.offsetY;
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
      if (emitClickEvent) {
        if (!that._callMiddlewares(ev, 'click')) {
          that._app.dispatchEvent('click', ev);
        }
        if (emitDoubleClickEvent) {
          if (!that._callMiddlewares(ev, 'dblclick')) {
            that._app.dispatchEvent('dblclick', ev);
          }
          eventData.lastClick = false;
        } else {
          eventData.lastClick = true;
          eventData.lastClickX = ev.offsetX;
          eventData.lastClickY = ev.offsetY;
          eventData.lastClickTime = now;
        }
      }
      if (ev.pointerType === 'mouse' && that._captureId === ev.pointerId) {
        that._app.options.canvas.releasePointerCapture(ev.pointerId);
        that._captureId = -1;
      }
    };
  }
  private _getKeyboardHandler() {
    const that = this;
    return function (ev: KeyboardEvent) {
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getDragHandler() {
    const that = this;
    return function (ev: DragEvent) {
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getWheelHandler() {
    const that = this;
    return function (ev: WheelEvent) {
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any);
      }
    };
  }
  private _getCompositionHandler() {
    const that = this;
    return function (ev: CompositionEvent) {
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any);
      }
    };
  }
  private _getPointerEventData(pointerId: number): PointerEventData {
    return (
      this._lastEventDatas[pointerId] ??
      (this._lastEventDatas[pointerId] = {
        lastClick: false,
        lastClickX: 0,
        lastClickY: 0,
        lastClickTime: 0,
        lastDown: false,
        lastDownX: 0,
        lastDownY: 0,
        lastDownTime: 0,
        lastMoveX: 0,
        lastMoveY: 0
      })
    );
  }
}
