import type { Nullable } from '@zephyr3d/base';
import type { GamepadButtonName, GamepadStickName, GamepadState } from './gamepad';
import { GamepadButtons } from './gamepad';

/**
 * Input device last used to operate an action, e.g. to show matching button prompts.
 *
 * @public
 */
export type InputDeviceKind = 'keyboardMouse' | 'gamepad';

/**
 * One source of an action's value.
 *
 * - `key`: a key by `KeyboardEvent.code`, e.g. `'KeyW'`; reads 1 while held.
 * - `keys`: a pair of keys `[positive, negative]` forming one axis.
 * - `keys2d`: four keys forming a 2D axis; `up` is +y.
 * - `mouse`: a mouse button by `MouseEvent.button` (0 left, 1 middle, 2 right).
 * - `pointer`: pointer movement this frame in CSS pixels, also while pointer-locked.
 *   `'delta'` is 2D with +y up.
 * - `wheel`: wheel movement this frame, in pixels.
 * - `pad`: a button, a stick (`'LS'`, `'RS'`, 2D, +y up) or one axis of a stick
 *   (`'LS.x'`, `'RS.y'` ...) of the active gamepad.
 *
 * `scale` multiplies the value (default 1), `invert` negates it. With
 * `perSecond`, the value is also multiplied by the frame time, turning a rate
 * such as stick deflection into an amount for this frame; use it to mix a stick
 * with pointer movement in one look action.
 *
 * @public
 */
export type InputBinding = (
  | { key: string }
  | { keys: [positive: string, negative: string] }
  | { keys2d: { up: string; down: string; left: string; right: string } }
  | { mouse: number }
  | { pointer: 'delta' | 'deltaX' | 'deltaY' }
  | { wheel: 'x' | 'y' }
  | { pad: GamepadButtonName | GamepadStickName | `${GamepadStickName}.${'x' | 'y'}` }
) & {
  scale?: number;
  invert?: boolean;
  perSecond?: boolean;
};

/**
 * Definition of an action.
 *
 * - `button`: on or off. Analog sources count as on beyond 0.5.
 * - `axis`: a number; the sum of all bindings, clamped to [-1, 1] unless `unbounded`.
 * - `vector2`: a 2D value; the sum of all bindings, its length clamped to 1 unless
 *   `unbounded`. One-dimensional bindings feed x.
 *
 * Make an action `unbounded` when it accumulates movement, such as a look action
 * fed by pointer deltas.
 *
 * @public
 */
export interface InputActionDef {
  type: 'button' | 'axis' | 'vector2';
  bindings: InputBinding[];
  unbounded?: boolean;
}

/**
 * Read-only view of the raw input state that actions are evaluated from.
 * Implemented by {@link InputManager}.
 *
 * @public
 */
export interface InputStateSource {
  isKeyDown(code: string): boolean;
  keyPressed(code: string): boolean;
  keyReleased(code: string): boolean;
  isMouseDown(button: number): boolean;
  mousePressed(button: number): boolean;
  mouseReleased(button: number): boolean;
  readonly pointerDelta: Readonly<{ x: number; y: number }>;
  readonly wheelDelta: Readonly<{ x: number; y: number }>;
  readonly gamepad: Nullable<GamepadState>;
}

type ActionState = {
  def: InputActionDef;
  x: number;
  y: number;
  down: boolean;
  prevDown: boolean;
  /** Went down during this frame, possibly also back up */
  pressed: boolean;
  released: boolean;
  /** Went down since last consumePressed() */
  latched: boolean;
};

const tmpStick = { x: 0, y: 0 };

/**
 * A named set of actions, e.g. `driving` or `onfoot`, evaluated once per frame
 * from keyboard, mouse and gamepad.
 *
 * Add maps to {@link InputManager.addActionMap}; maps added later sit on top. A
 * map with `blocking` set hides everything below it while enabled, which is how
 * a pause menu silences gameplay without each map checking for it.
 *
 * Values are evaluated at the start of every frame before `tick`, so every read
 * in a frame - `onUpdate`, `onFixedUpdate`, `onLateUpdate` - sees the same values.
 * A frame may run several fixed steps or none: to act on a press exactly once in
 * `onFixedUpdate`, use {@link InputActionMap.consumePressed} rather than
 * {@link InputActionMap.pressed}.
 *
 * @example
 * ```ts
 * const driving = new InputActionMap('driving', {
 *   throttle: { type: 'axis', bindings: [{ key: 'KeyW' }, { pad: 'RT' }] },
 *   steer: { type: 'axis', bindings: [{ keys: ['KeyD', 'KeyA'] }, { pad: 'LS.x' }] },
 *   look: {
 *     type: 'vector2',
 *     unbounded: true,
 *     bindings: [{ pointer: 'delta', scale: 0.003 }, { pad: 'RS', scale: 3, perSecond: true }]
 *   },
 *   exit: { type: 'button', bindings: [{ key: 'KeyF' }, { pad: 'Y' }] }
 * });
 * getInput().addActionMap(driving);
 * // per frame
 * vehicle.throttle = driving.value('throttle');
 * if (driving.pressed('exit')) leaveVehicle();
 * ```
 *
 * @public
 */
export class InputActionMap<A extends Record<string, InputActionDef> = Record<string, InputActionDef>> {
  /** Name of the map, for diagnostics. */
  readonly name: string;
  /** While enabled, a blocking map hides all maps below it. */
  blocking: boolean;
  private _enabled: boolean;
  private readonly _actions: Map<keyof A, ActionState>;
  /**
   * @param name - Name of the map.
   * @param actions - Action definitions by action name.
   * @param options - `blocking`: see {@link InputActionMap.blocking}.
   */
  constructor(name: string, actions: A, options?: { blocking?: boolean }) {
    this.name = name;
    this.blocking = !!options?.blocking;
    this._enabled = true;
    this._actions = new Map();
    for (const key of Object.keys(actions) as (keyof A)[]) {
      this._actions.set(key, {
        def: { ...actions[key], bindings: [...actions[key].bindings] },
        x: 0,
        y: 0,
        down: false,
        prevDown: false,
        pressed: false,
        released: false,
        latched: false
      });
    }
  }
  /**
   * Whether the map is evaluated. A disabled map reads as idle; disabling it
   * while a button is held reports the release on the next frame.
   */
  get enabled() {
    return this._enabled;
  }
  set enabled(val: boolean) {
    this._enabled = !!val;
  }
  /**
   * Value of an action: an axis value, 1/0 for a button, x for a vector2.
   *
   * @param action - Action name.
   */
  value(action: keyof A) {
    return this._get(action).x;
  }
  /**
   * Value of a vector2 action. For other action types y is 0.
   *
   * @param action - Action name.
   * @param out - Optional output object.
   */
  vector2(action: keyof A, out?: { x: number; y: number }) {
    const s = this._get(action);
    out = out ?? { x: 0, y: 0 };
    out.x = s.x;
    out.y = s.y;
    return out;
  }
  /**
   * Whether an action is active this frame: a button held, or an axis/vector2 off zero.
   *
   * @param action - Action name.
   */
  isDown(action: keyof A) {
    return this._get(action).down;
  }
  /**
   * Whether an action became active this frame. A tap that went down and up
   * between two frames also counts.
   *
   * @param action - Action name.
   */
  pressed(action: keyof A) {
    return this._get(action).pressed;
  }
  /**
   * Whether an action became inactive this frame.
   *
   * @param action - Action name.
   */
  released(action: keyof A) {
    return this._get(action).released;
  }
  /**
   * Returns true once per press: true if the action was pressed since the last
   * call that returned true. Use it in `onFixedUpdate`, which may run several
   * times per frame or not at all.
   *
   * @param action - Action name.
   */
  consumePressed(action: keyof A) {
    const s = this._get(action);
    const latched = s.latched;
    s.latched = false;
    return latched;
  }
  /**
   * Bindings of an action, e.g. to save them after the player rebinds.
   *
   * @param action - Action name.
   */
  getBindings(action: keyof A): InputBinding[] {
    return this._get(action).def.bindings.map((b) => ({ ...b }));
  }
  /**
   * Replaces the bindings of an action, e.g. to apply the player's rebinding.
   *
   * @param action - Action name.
   * @param bindings - New bindings.
   */
  setBindings(action: keyof A, bindings: InputBinding[]) {
    this._get(action).def.bindings = bindings.map((b) => ({ ...b }));
  }
  /** @internal */
  _evaluate(src: Nullable<InputStateSource>, dt: number) {
    for (const s of this._actions.values()) {
      s.prevDown = s.down;
      s.x = 0;
      s.y = 0;
      let tapped = false;
      if (src && this._enabled) {
        for (const b of s.def.bindings) {
          const r = evaluateBinding(b, src, dt);
          s.x += r.x;
          s.y += r.y;
          tapped ||= r.tapped;
        }
      }
      if (!s.def.unbounded) {
        if (s.def.type === 'vector2') {
          const len = Math.hypot(s.x, s.y);
          if (len > 1) {
            s.x /= len;
            s.y /= len;
          }
        } else {
          s.x = Math.min(Math.max(s.x, -1), 1);
        }
      }
      if (s.def.type === 'button') {
        s.down = Math.abs(s.x) > 0.5;
        s.x = s.down ? 1 : 0;
      } else {
        s.down = s.x !== 0 || s.y !== 0;
      }
      s.pressed = (s.down && !s.prevDown) || (tapped && !s.prevDown);
      s.released = (!s.down && s.prevDown) || (tapped && !s.down && !s.prevDown);
      if (s.pressed) {
        s.latched = true;
      }
      if (!this._enabled || !src) {
        s.latched = false;
      }
    }
  }
  private _get(action: keyof A) {
    const s = this._actions.get(action);
    if (!s) {
      throw new Error(`InputActionMap '${this.name}': unknown action '${String(action)}'`);
    }
    return s;
  }
}

const result = { x: 0, y: 0, tapped: false };

function evaluateBinding(b: InputBinding, src: InputStateSource, dt: number) {
  result.x = 0;
  result.y = 0;
  result.tapped = false;
  if ('key' in b) {
    result.x = src.isKeyDown(b.key) ? 1 : 0;
    result.tapped = src.keyPressed(b.key);
  } else if ('keys' in b) {
    result.x = (src.isKeyDown(b.keys[0]) ? 1 : 0) - (src.isKeyDown(b.keys[1]) ? 1 : 0);
    result.tapped = src.keyPressed(b.keys[0]) || src.keyPressed(b.keys[1]);
  } else if ('keys2d' in b) {
    const k = b.keys2d;
    result.x = (src.isKeyDown(k.right) ? 1 : 0) - (src.isKeyDown(k.left) ? 1 : 0);
    result.y = (src.isKeyDown(k.up) ? 1 : 0) - (src.isKeyDown(k.down) ? 1 : 0);
    result.tapped =
      src.keyPressed(k.up) || src.keyPressed(k.down) || src.keyPressed(k.left) || src.keyPressed(k.right);
  } else if ('mouse' in b) {
    result.x = src.isMouseDown(b.mouse) ? 1 : 0;
    result.tapped = src.mousePressed(b.mouse);
  } else if ('pointer' in b) {
    const d = src.pointerDelta;
    if (b.pointer === 'delta') {
      result.x = d.x;
      result.y = -d.y;
    } else {
      result.x = b.pointer === 'deltaX' ? d.x : -d.y;
    }
  } else if ('wheel' in b) {
    result.x = b.wheel === 'x' ? src.wheelDelta.x : src.wheelDelta.y;
  } else if ('pad' in b) {
    const pad = src.gamepad;
    if (pad?.connected) {
      const name = b.pad;
      if (name === 'LS' || name === 'RS') {
        pad.stick(name, tmpStick);
        result.x = tmpStick.x;
        result.y = tmpStick.y;
      } else if (name.length === 4 && name[2] === '.') {
        pad.stick(name.slice(0, 2) as GamepadStickName, tmpStick);
        result.x = name[3] === 'x' ? tmpStick.x : tmpStick.y;
      } else if (name in GamepadButtons) {
        result.x = pad.value(name as GamepadButtonName);
        result.tapped = pad.pressed(name as GamepadButtonName);
      }
    }
  }
  const scale = (b.scale ?? 1) * (b.invert ? -1 : 1) * (b.perSecond ? dt : 1);
  result.x *= scale;
  result.y *= scale;
  return result;
}
