import type { Nullable } from '@zephyr3d/base';

/**
 * Buttons of the W3C "standard" gamepad layout, named after the Xbox controller.
 * The value is the button's index in `Gamepad.buttons`.
 *
 * @public
 */
export const GamepadButtons = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LS: 10,
  RS: 11,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
  Home: 16
} as const;

/**
 * Name of a button of the standard gamepad layout.
 *
 * @public
 */
export type GamepadButtonName = keyof typeof GamepadButtons;

/**
 * Name of a thumbstick of the standard gamepad layout.
 *
 * @public
 */
export type GamepadStickName = 'LS' | 'RS';

const BUTTON_COUNT = 17;
/** Analog buttons (triggers) count as pressed above this value. */
const PRESS_THRESHOLD = 0.5;

/**
 * Per-frame state of one gamepad with the standard layout.
 *
 * Owned and polled by {@link InputManager} at the start of every frame, so all
 * reads within a frame see the same values. Stick axes are reported with +y up,
 * the opposite of the raw Gamepad API, and with a radial dead zone applied.
 *
 * @public
 */
export class GamepadState {
  /** Radial dead zone of both sticks, as a fraction of full deflection. */
  stickDeadZone = 0.15;
  /** Analog buttons below this value read as 0. */
  triggerDeadZone = 0.05;
  private readonly _index: number;
  private _id: string;
  private _connected: boolean;
  private readonly _values: Float32Array;
  private readonly _down: Uint8Array;
  private readonly _prevDown: Uint8Array;
  private readonly _sticks: Float32Array;
  private _raw: Nullable<Gamepad>;
  /** @internal */
  constructor(index: number) {
    this._index = index;
    this._id = '';
    this._connected = false;
    this._values = new Float32Array(BUTTON_COUNT);
    this._down = new Uint8Array(BUTTON_COUNT);
    this._prevDown = new Uint8Array(BUTTON_COUNT);
    this._sticks = new Float32Array(4);
    this._raw = null;
  }
  /** Index of the gamepad as reported by `navigator.getGamepads()`. */
  get index() {
    return this._index;
  }
  /** Device id string reported by the browser. */
  get id() {
    return this._id;
  }
  /** Whether the gamepad was connected when last polled. */
  get connected() {
    return this._connected;
  }
  /**
   * Analog value of a button in [0, 1]; digital buttons read 0 or 1.
   *
   * @param button - Button name.
   */
  value(button: GamepadButtonName) {
    return this._values[GamepadButtons[button]];
  }
  /**
   * Whether a button is held this frame.
   *
   * @param button - Button name.
   */
  isDown(button: GamepadButtonName) {
    return !!this._down[GamepadButtons[button]];
  }
  /**
   * Whether a button went down this frame.
   *
   * @param button - Button name.
   */
  pressed(button: GamepadButtonName) {
    const i = GamepadButtons[button];
    return !!this._down[i] && !this._prevDown[i];
  }
  /**
   * Whether a button went up this frame.
   *
   * @param button - Button name.
   */
  released(button: GamepadButtonName) {
    const i = GamepadButtons[button];
    return !this._down[i] && !!this._prevDown[i];
  }
  /**
   * Deflection of a stick, each component in [-1, 1] and the length at most 1.
   * +x is right and +y is up.
   *
   * @param stick - Stick name.
   * @param out - Optional output object.
   * @returns The deflection.
   */
  stick(stick: GamepadStickName, out?: { x: number; y: number }) {
    const i = stick === 'LS' ? 0 : 2;
    out = out ?? { x: 0, y: 0 };
    out.x = this._sticks[i];
    out.y = this._sticks[i + 1];
    return out;
  }
  /**
   * Plays a rumble effect if the browser and the gamepad support it; otherwise
   * does nothing.
   *
   * @param strong - Strength of the low-frequency motor in [0, 1].
   * @param weak - Strength of the high-frequency motor in [0, 1].
   * @param durationMs - Duration in milliseconds.
   */
  rumble(strong: number, weak: number, durationMs: number) {
    const actuator = (this._raw as any)?.vibrationActuator;
    if (actuator?.playEffect) {
      actuator
        .playEffect('dual-rumble', {
          duration: durationMs,
          strongMagnitude: Math.min(Math.max(strong, 0), 1),
          weakMagnitude: Math.min(Math.max(weak, 0), 1)
        })
        .catch(() => {});
    }
  }
  /**
   * Whether anything was operated this frame: a button went down or a stick left
   * its dead zone.
   *
   * @internal
   */
  get active() {
    for (let i = 0; i < BUTTON_COUNT; i++) {
      if (this._down[i] && !this._prevDown[i]) {
        return true;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (this._sticks[i] !== 0) {
        return true;
      }
    }
    return false;
  }
  /** @internal */
  _update(pad: Nullable<Gamepad>) {
    this._prevDown.set(this._down);
    this._raw = pad;
    this._connected = !!pad?.connected;
    if (!pad || !this._connected) {
      this._values.fill(0);
      this._down.fill(0);
      this._sticks.fill(0);
      return;
    }
    this._id = pad.id;
    for (let i = 0; i < BUTTON_COUNT; i++) {
      const b = pad.buttons[i];
      const v = b ? b.value : 0;
      this._values[i] = v < this.triggerDeadZone ? (b?.pressed ? 1 : 0) : v;
      this._down[i] = b && (b.pressed || v > PRESS_THRESHOLD) ? 1 : 0;
    }
    this._readStick(pad, 0);
    this._readStick(pad, 2);
  }
  /** @internal */
  _reset() {
    this._prevDown.set(this._down);
    this._values.fill(0);
    this._down.fill(0);
    this._sticks.fill(0);
  }
  private _readStick(pad: Gamepad, axis: number) {
    const x = pad.axes[axis] ?? 0;
    const y = -(pad.axes[axis + 1] ?? 0);
    const len = Math.hypot(x, y);
    const dz = this.stickDeadZone;
    if (len <= dz) {
      this._sticks[axis] = 0;
      this._sticks[axis + 1] = 0;
    } else {
      // Rescale so that output starts at 0 just outside the dead zone
      const scale = Math.min((len - dz) / (1 - dz), 1) / len;
      this._sticks[axis] = x * scale;
      this._sticks[axis + 1] = y * scale;
    }
  }
}
