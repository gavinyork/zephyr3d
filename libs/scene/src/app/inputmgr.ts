import type { Nullable } from '@zephyr3d/base';
import type { Application } from '../app';
import { GamepadState } from './gamepad';
import type { InputActionMap, InputDeviceKind, InputStateSource } from './inputactions';

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
 * Maps every event type delivered to input middlewares to its DOM event class.
 *
 * `click` and `dblclick` are synthesized by InputManager from pointer events,
 * so they carry the originating `PointerEvent`.
 *
 * @public
 */
export interface InputEventMap {
  pointerdown: PointerEvent;
  pointerup: PointerEvent;
  pointermove: PointerEvent;
  pointercancel: PointerEvent;
  contextmenu: PointerEvent;
  click: PointerEvent;
  dblclick: PointerEvent;
  keydown: KeyboardEvent;
  keyup: KeyboardEvent;
  keypress: KeyboardEvent;
  drag: DragEvent;
  dragenter: DragEvent;
  dragleave: DragEvent;
  dragstart: DragEvent;
  dragend: DragEvent;
  dragover: DragEvent;
  drop: DragEvent;
  wheel: WheelEvent;
  compositionstart: CompositionEvent;
  compositionupdate: CompositionEvent;
  compositionend: CompositionEvent;
}

/**
 * Argument list of an input middleware: a union of `[event, type]` pairs, one per
 * entry of {@link InputEventMap}. Checking `type` narrows `ev` to the matching event class.
 *
 * @public
 */
export type InputEventArgs = {
  [K in keyof InputEventMap]: [ev: InputEventMap[K], type: K];
}[keyof InputEventMap];

/**
 * Input handler middleware type.
 *
 * Return true to indicate the event has been handled and should not be forwarded
 * to the Application's observable event system.
 *
 * @example
 * ```ts
 * getInput().use((ev, type) => {
 *   if (type === 'pointerdown') {
 *     console.log(ev.button, ev.offsetX); // ev is PointerEvent here
 *   }
 *   return false;
 * });
 * ```
 *
 * @public
 */
export type InputEventHandler = (...args: InputEventArgs) => boolean;

/**
 * Single-argument form of {@link InputEventHandler}, for middlewares that only inspect the event.
 *
 * A separate type is needed because a one-parameter function is not assignable to a
 * rest parameter typed as a union of two-element tuples.
 *
 * @public
 */
export type InputEventHandlerSimple = (ev: InputEventMap[keyof InputEventMap]) => boolean;

/**
 * Input manager
 *
 * Centralizes DOM input event handling for the engine:
 * - Subscribes to pointer/keyboard/drag/wheel/composition events on the target canvas element.
 * - Normalizes click and double-click detection using distance/time tolerances.
 * - Supports a middleware chain (`use`) to intercept and optionally consume events
 *   before they are dispatched to the Application's observable event map.
 * - Manages pointer capture for mouse interactions to ensure consistent up/move delivery.
 * - Tracks which keys and mouse buttons are held, polls gamepads, and evaluates
 *   {@link InputActionMap}s, once per frame at the start of `Application.frame()`.
 *
 * Held state and middlewares: a key or button only counts as held if no
 * middleware consumed its down event, so a UI that consumes keyboard input while
 * focused keeps it from gameplay. Releases are always recorded. When the canvas
 * or the window loses focus, every held key is released and a synthesized `keyup`
 * is sent through the middlewares, so nothing stays stuck.
 *
 * Lifecycle:
 * - Call `start()` to attach all event listeners; `stop()` to remove them.
 *
 * @public
 */
export class InputManager implements InputStateSource {
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
  private readonly _blurHandler: () => void;
  private readonly _visibilityHandler: () => void;
  private readonly _keysDown: Map<string, KeyboardEvent>;
  private _keysPressedPending: Set<string>;
  private _keysReleasedPending: Set<string>;
  private _keysPressed: Set<string>;
  private _keysReleased: Set<string>;
  /** Held buttons per pointer id, as a mask of `1 << MouseEvent.button` */
  private readonly _pointerButtons: Map<number, number>;
  private _buttons: number;
  private _buttonsPressedPending: number;
  private _buttonsReleasedPending: number;
  private _buttonsPressed: number;
  private _buttonsReleased: number;
  private readonly _pointerDeltaPending: { x: number; y: number };
  private readonly _pointerDelta: { x: number; y: number };
  private readonly _wheelDeltaPending: { x: number; y: number };
  private readonly _wheelDelta: { x: number; y: number };
  private readonly _gamepads: GamepadState[];
  private _activeGamepad: Nullable<GamepadState>;
  private _lastDevice: Nullable<InputDeviceKind>;
  private readonly _actionMaps: InputActionMap<any>[];
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
    this._blurHandler = () => this._releaseAll();
    this._visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this._releaseAll();
      }
    };
    this._keysDown = new Map();
    this._keysPressedPending = new Set();
    this._keysReleasedPending = new Set();
    this._keysPressed = new Set();
    this._keysReleased = new Set();
    this._pointerButtons = new Map();
    this._buttons = 0;
    this._buttonsPressedPending = 0;
    this._buttonsReleasedPending = 0;
    this._buttonsPressed = 0;
    this._buttonsReleased = 0;
    this._pointerDeltaPending = { x: 0, y: 0 };
    this._pointerDelta = { x: 0, y: 0 };
    this._wheelDeltaPending = { x: 0, y: 0 };
    this._wheelDelta = { x: 0, y: 0 };
    this._gamepads = [];
    this._activeGamepad = null;
    this._lastDevice = null;
    this._actionMaps = [];
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
      this._target.addEventListener('blur', this._blurHandler);
      window.addEventListener('blur', this._blurHandler);
      document.addEventListener('visibilitychange', this._visibilityHandler);
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
      this._target.removeEventListener('blur', this._blurHandler);
      window.removeEventListener('blur', this._blurHandler);
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._releaseAll();
      this._lastEventDatas = [];
    }
  }
  /**
   * Whether a key is held, by `KeyboardEvent.code` (e.g. `'KeyW'`, `'Space'`).
   *
   * @param code - Key code.
   */
  isKeyDown(code: string) {
    return this._keysDown.has(code);
  }
  /**
   * Whether a key went down during the last frame. True for a tap that went
   * down and up between two frames, even though `isKeyDown` is false.
   *
   * @param code - Key code.
   */
  keyPressed(code: string) {
    return this._keysPressed.has(code);
  }
  /**
   * Whether a key went up during the last frame.
   *
   * @param code - Key code.
   */
  keyReleased(code: string) {
    return this._keysReleased.has(code);
  }
  /**
   * Whether a mouse button is held, by `MouseEvent.button` (0 left, 1 middle,
   * 2 right). A touch or pen contact counts as button 0.
   *
   * @param button - Button index.
   */
  isMouseDown(button: number) {
    return !!(this._buttons & (1 << button));
  }
  /**
   * Whether a mouse button went down during the last frame.
   *
   * @param button - Button index.
   */
  mousePressed(button: number) {
    return !!(this._buttonsPressed & (1 << button));
  }
  /**
   * Whether a mouse button went up during the last frame.
   *
   * @param button - Button index.
   */
  mouseReleased(button: number) {
    return !!(this._buttonsReleased & (1 << button));
  }
  /**
   * Pointer movement during the last frame in CSS pixels, +y down. Keeps
   * reporting movement while the pointer is locked.
   */
  get pointerDelta(): Readonly<{ x: number; y: number }> {
    return this._pointerDelta;
  }
  /** Wheel movement during the last frame in pixels. */
  get wheelDelta(): Readonly<{ x: number; y: number }> {
    return this._wheelDelta;
  }
  /**
   * The active gamepad: the one operated most recently, or the first connected
   * one. Null if no gamepad with the standard layout has been used yet - browsers
   * only expose a gamepad after one of its buttons has been pressed.
   */
  get gamepad(): Nullable<GamepadState> {
    return this._activeGamepad;
  }
  /** All connected gamepads with the standard layout. */
  get gamepads(): GamepadState[] {
    return this._gamepads.filter((pad) => pad?.connected);
  }
  /**
   * Device that was operated most recently, e.g. to show matching button
   * prompts; null before any input.
   */
  get lastDevice() {
    return this._lastDevice;
  }
  /**
   * Adds an action map on top of the existing ones. Its values are evaluated
   * from the next frame on.
   *
   * @param map - Map to add.
   * @returns The InputManager instance for chaining.
   */
  addActionMap(map: InputActionMap<any>) {
    if (!this._actionMaps.includes(map)) {
      this._actionMaps.push(map);
    }
    return this;
  }
  /**
   * Removes an action map; it then reads as idle.
   *
   * @param map - Map to remove.
   * @returns The InputManager instance for chaining.
   */
  removeActionMap(map: InputActionMap<any>) {
    const index = this._actionMaps.indexOf(map);
    if (index >= 0) {
      this._actionMaps.splice(index, 1);
      map._evaluate(null, 0);
    }
    return this;
  }
  /** Action maps, from bottom to top. */
  get actionMaps(): readonly InputActionMap<any>[] {
    return this._actionMaps;
  }
  /** Whether the pointer is locked to the canvas. */
  get pointerLocked() {
    return document.pointerLockElement === this._target;
  }
  /**
   * Locks the pointer to the canvas and hides it, for mouse look. Must be called
   * from a user gesture such as a click. Asks for raw, unaccelerated movement
   * where supported.
   */
  async requestPointerLock() {
    const target = this._target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      await target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      await target.requestPointerLock();
    }
  }
  /** Releases a pointer lock taken with {@link InputManager.requestPointerLock}. */
  exitPointerLock() {
    if (this.pointerLocked) {
      document.exitPointerLock();
    }
  }
  /**
   * Starts a new input frame: publishes the edges, movement and wheel collected
   * since the last call, polls gamepads and evaluates the action maps. Called by
   * `Application.frame()` before `tick`.
   *
   * @param deltaTime - Frame time in seconds, used by `perSecond` bindings.
   * @internal
   */
  _beginFrame(deltaTime: number) {
    [this._keysPressed, this._keysPressedPending] = [this._keysPressedPending, this._keysPressed];
    [this._keysReleased, this._keysReleasedPending] = [this._keysReleasedPending, this._keysReleased];
    this._keysPressedPending.clear();
    this._keysReleasedPending.clear();
    this._buttonsPressed = this._buttonsPressedPending;
    this._buttonsReleased = this._buttonsReleasedPending;
    this._buttonsPressedPending = 0;
    this._buttonsReleasedPending = 0;
    this._pointerDelta.x = this._pointerDeltaPending.x;
    this._pointerDelta.y = this._pointerDeltaPending.y;
    this._pointerDeltaPending.x = this._pointerDeltaPending.y = 0;
    this._wheelDelta.x = this._wheelDeltaPending.x;
    this._wheelDelta.y = this._wheelDeltaPending.y;
    this._wheelDeltaPending.x = this._wheelDeltaPending.y = 0;
    if (this._keysPressed.size > 0 || this._buttonsPressed || this._wheelDelta.x || this._wheelDelta.y) {
      this._lastDevice = 'keyboardMouse';
    }
    this._pollGamepads();
    let blocked = false;
    for (let i = this._actionMaps.length - 1; i >= 0; i--) {
      const map = this._actionMaps[i];
      map._evaluate(blocked ? null : this, deltaTime);
      blocked ||= map.enabled && map.blocking;
    }
  }
  private _pollGamepads() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < Math.max(pads.length, this._gamepads.length); i++) {
      const raw = pads[i];
      const pad = raw && raw.mapping === 'standard' ? raw : null;
      if (!pad && !this._gamepads[i]) {
        continue;
      }
      const state = (this._gamepads[i] ??= new GamepadState(i));
      state._update(pad);
      if (state.connected && state.active) {
        this._activeGamepad = state;
        this._lastDevice = 'gamepad';
      }
    }
    if (!this._activeGamepad?.connected) {
      this._activeGamepad = this._gamepads.find((pad) => pad?.connected) ?? null;
    }
  }
  private _releaseAll() {
    for (const ev of [...this._keysDown.values()]) {
      const up = new KeyboardEvent('keyup', { code: ev.code, key: ev.key, location: ev.location });
      this._keyboardHandler.call(this._target, up);
    }
    for (const pointerId of [...this._pointerButtons.keys()]) {
      this._setPointerButtons(pointerId, 0, false);
    }
    for (const pad of this._gamepads) {
      pad?._reset();
    }
  }
  private _setPointerButtons(pointerId: number, mask: number, consumed: boolean) {
    const old = this._pointerButtons.get(pointerId) ?? 0;
    // A press consumed by a middleware is not recorded; a release always is
    const next = (old & mask) | (consumed ? 0 : mask & ~old);
    if (next) {
      this._pointerButtons.set(pointerId, next);
    } else {
      this._pointerButtons.delete(pointerId);
    }
    let buttons = 0;
    for (const m of this._pointerButtons.values()) {
      buttons |= m;
    }
    this._buttonsPressedPending |= buttons & ~this._buttons;
    this._buttonsReleasedPending |= this._buttons & ~buttons;
    this._buttons = buttons;
  }
  private _updatePointerState(ev: PointerEvent, consumed: boolean) {
    // PointerEvent.buttons has right and middle swapped relative to
    // MouseEvent.button; convert to a mask of 1 << button
    const b = ev.type === 'pointerup' || ev.type === 'pointercancel' ? 0 : ev.buttons;
    const mask = (b & 1) | ((b & 4) >> 1) | ((b & 2) << 1) | (b & 24);
    this._setPointerButtons(ev.pointerId, mask, consumed);
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
  use(handler: Nullable<InputEventHandler>, ctx?: unknown): this;
  use(handler: Nullable<InputEventHandlerSimple>, ctx?: unknown): this;
  use(handler: Nullable<InputEventHandler | InputEventHandlerSimple>, ctx?: unknown) {
    if (handler) {
      this._middlewares.push({ handler: handler as InputEventHandler, ctx });
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
  useFirst(handler: Nullable<InputEventHandler>, ctx?: unknown): this;
  useFirst(handler: Nullable<InputEventHandlerSimple>, ctx?: unknown): this;
  useFirst(handler: Nullable<InputEventHandler | InputEventHandlerSimple>, ctx?: unknown) {
    if (handler) {
      this._middlewares.unshift({ handler: handler as InputEventHandler, ctx });
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
  unuse(handler: InputEventHandler | InputEventHandlerSimple, ctx?: unknown) {
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
  ) {
    const args = [ev, type ?? ev.type] as InputEventArgs;
    for (const mw of this._middlewares) {
      if (mw.handler.call(mw.ctx, ...args)) {
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
      that._updatePointerState(ev, false);
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
      const consumed = that._callMiddlewares(ev);
      if (!consumed) {
        that._app.dispatchEvent(ev.type as any, ev);
        that._pointerDeltaPending.x += ev.movementX ?? 0;
        that._pointerDeltaPending.y += ev.movementY ?? 0;
      }
      // A button pressed or released while another is held arrives as pointermove
      that._updatePointerState(ev, consumed);
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
      const consumed = that._callMiddlewares(ev);
      if (!consumed) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
      that._updatePointerState(ev, consumed);
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
      that._updatePointerState(ev, false);
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
      const consumed = that._callMiddlewares(ev);
      if (!consumed) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
      if (ev.code) {
        if (ev.type === 'keydown') {
          // A press consumed by a middleware is not recorded; a release always is
          if (!consumed && !that._keysDown.has(ev.code)) {
            that._keysDown.set(ev.code, ev);
            that._keysPressedPending.add(ev.code);
          }
        } else if (ev.type === 'keyup' && that._keysDown.delete(ev.code)) {
          that._keysReleasedPending.add(ev.code);
        }
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
        that._app.dispatchEvent(ev.type as any, ev);
        // Normalize line and page modes to pixels
        const scale =
          ev.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : ev.deltaMode === WheelEvent.DOM_DELTA_PAGE
              ? that._target.clientHeight
              : 1;
        that._wheelDeltaPending.x += ev.deltaX * scale;
        that._wheelDeltaPending.y += ev.deltaY * scale;
      }
    };
  }
  private _getCompositionHandler() {
    const that = this;
    return function (ev: CompositionEvent) {
      if (!that._callMiddlewares(ev)) {
        that._app.dispatchEvent(ev.type as any, ev);
      }
    };
  }
  private _getPointerEventData(pointerId: number) {
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
