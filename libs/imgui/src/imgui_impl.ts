import type { AbstractDevice, AtlasInfo, Texture2D } from '@zephyr3d/device';
import { GlyphManager, Font as DeviceFont } from '@zephyr3d/device';
import { Renderer } from './renderer';
import * as ImGui from './imgui';
import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';

let clipboard_text = '';
let renderer: Nullable<Renderer> = null;
let prev_time = 0;
let g_FontTexture: Nullable<Texture2D> = null;
let glyphManager: Nullable<GlyphManager> = null;
let wantKeyboard = false;
let fontSizeGlyph = 0;
const fonts: Record<string, DeviceFont> = {};
const glyphFonts: Record<string, DeviceFont> = {};

export class Input {
  public _dom_input: HTMLInputElement;
  constructor(cvs: HTMLCanvasElement) {
    this._dom_input = document.createElement('input');
    this._dom_input.style.position = 'fixed';
    this._dom_input.style.top = -10000 + 'px';
    this._dom_input.style.left = -10000 + 'px';
    this._dom_input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      this.onKeydown(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('keyup', (e) => {
      e.stopPropagation();
      this.onKeyup(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('keypress', (e) => {
      e.stopPropagation();
      this.onKeypress(e as KeyboardEvent);
    });
    this._dom_input.addEventListener('compositionend', (e) => {
      this.onCompositionEnd(e as CompositionEvent);
    });
    cvs.appendChild(this._dom_input);
    this.blur();
  }
  onKeydown(e: KeyboardEvent) {
    canvas_on_keydown(e);
  }
  onKeyup(e: KeyboardEvent) {
    canvas_on_keyup(e);
  }
  onKeypress(e: KeyboardEvent) {
    e.preventDefault();
    canvas_on_keypress(e);
  }
  onCompositionEnd(e: CompositionEvent) {
    e.preventDefault();
    for (let i = 0; i < e.data.length; i++) {
      const io = ImGui.GetIO();
      io.AddInputCharacter(e.data.codePointAt(i)!);
    }
  }
  blur() {
    this._dom_input.blur();
  }
  focus() {
    this._dom_input.focus();
  }
}

/*
function document_on_copy(event: ClipboardEvent) {
    if (event.clipboardData) {
        event.clipboardData.setData("text/plain", clipboard_text);
    }
    // console.log(`${event.type}: "${clipboard_text}"`);
    event.preventDefault();
}

function document_on_cut(event: ClipboardEvent) {
    if (event.clipboardData) {
        event.clipboardData.setData("text/plain", clipboard_text);
    }
    // console.log(`${event.type}: "${clipboard_text}"`);
    event.preventDefault();
}

function document_on_paste(event: ClipboardEvent) {
    if (event.clipboardData) {
        clipboard_text = event.clipboardData.getData("text/plain");
    }
    // console.log(`${event.type}: "${clipboard_text}"`);
    event.preventDefault();
}
*/
function window_on_resize() {}

function window_on_gamepadconnected(event: any /* GamepadEvent */) {
  console.info(
    'Gamepad connected at index %d: %s. %d buttons, %d axes.',
    event.gamepad.index,
    event.gamepad.id,
    event.gamepad.buttons.length,
    event.gamepad.axes.length
  );
}

function window_on_gamepaddisconnected(event: any /* GamepadEvent */) {
  console.info('Gamepad disconnected at index %d: %s.', event.gamepad.index, event.gamepad.id);
}

function canvas_on_blur(_event: FocusEvent) {
  const io = ImGui.GetIO();
  io.KeyCtrl = false;
  io.KeyShift = false;
  io.KeyAlt = false;
  io.KeySuper = false;
  for (let i = 0; i < io.KeysDown.length; ++i) {
    io.KeysDown[i] = false;
  }
  for (let i = 0; i < io.MouseDown.length; ++i) {
    io.MouseDown[i] = false;
  }
}

const key_code_to_index: Record<string, number> = {
  Tab: 9,
  Backspace: 8,
  Space: 32,
  Insert: 45,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  Enter: 13,
  Escape: 27,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  NumpadEnter: 176,
  KeyA: 65,
  KeyC: 67,
  KeyV: 86,
  KeyX: 88,
  KeyY: 89,
  KeyZ: 90
};

export function canvas_on_keydown(event: KeyboardEvent) {
  const io = ImGui.GetIO();
  io.KeyCtrl = event.ctrlKey;
  io.KeyShift = event.shiftKey;
  io.KeyAlt = event.altKey;
  io.KeySuper = event.metaKey;
  const key_index = key_code_to_index[event.code];
  if (key_index) {
    ImGui.ASSERT(key_index >= 0 && key_index < ImGui.ARRAYSIZE(io.KeysDown));
    io.KeysDown[key_index] = true;
    // forward to the keypress event
    if (key_index == 9 || wantKeyboard || io.WantCaptureKeyboard || io.WantTextInput) {
      return true;
    }
  }
  return false;
}

export function canvas_on_keyup(event: KeyboardEvent) {
  const io = ImGui.GetIO();
  io.KeyCtrl = event.ctrlKey;
  io.KeyShift = event.shiftKey;
  io.KeyAlt = event.altKey;
  io.KeySuper = event.metaKey;
  const key_index = key_code_to_index[event.code];
  if (key_index) {
    ImGui.ASSERT(key_index >= 0 && key_index < ImGui.ARRAYSIZE(io.KeysDown));
    io.KeysDown[key_index] = false;
    if (wantKeyboard || io.WantCaptureKeyboard || io.WantTextInput || key_index == 9) {
      return true;
    }
  }
  return false;
}

export function canvas_on_keypress(event: KeyboardEvent) {
  const io = ImGui.GetIO();
  io.AddInputCharacter(event.charCode);
  if (wantKeyboard || io.WantCaptureKeyboard || io.WantTextInput) {
    return true;
  }
  return false;
}

function canvas_on_pointermove(event: PointerEvent) {
  const io = ImGui.GetIO();
  io.MousePos.x = event.offsetX;
  io.MousePos.y = event.offsetY;
  if (io.WantCaptureMouse) {
    return true;
  }
  return false;
}

// MouseEvent.button
// A number representing a given button:
// 0: Main button pressed, usually the left button or the un-initialized state
// 1: Auxiliary button pressed, usually the wheel button or the middle button (if present)
// 2: Secondary button pressed, usually the right button
// 3: Fourth button, typically the Browser Back button
// 4: Fifth button, typically the Browser Forward button
const mouse_button_map: number[] = [
  ImGui.MouseButton.Left,
  ImGui.MouseButton.Middle,
  ImGui.MouseButton.Right,
  3,
  4
];

export function any_pointerdown() {
  const io = ImGui.GetIO();
  for (let i = 0; i < io.MouseDown.length; i++) {
    if (io.MouseDown[i]) {
      return true;
    }
  }
  return false;
}

function canvas_on_pointerdown(event: PointerEvent) {
  const io = ImGui.GetIO();
  io.MousePos.x = event.offsetX;
  io.MousePos.y = event.offsetY;
  io.MouseDown[mouseButtonToImGui(event.button)] = true;
  if (io.WantCaptureMouse) {
    return true;
  }
  return false;
}

function canvas_on_contextmenu(_event: Event) {
  const io = ImGui.GetIO();
  if (io.WantCaptureMouse) {
    return true;
  }
  return false;
}

function canvas_on_pointerup(event: PointerEvent) {
  const io = ImGui.GetIO();
  io.MouseDown[mouse_button_map[event.button]] = false;
  if (io.WantCaptureMouse) {
    return true;
  }
  return false;
}

function canvas_on_wheel(event: WheelEvent) {
  const io = ImGui.GetIO();
  let scale = 1.0;
  switch (event.deltaMode) {
    case event.DOM_DELTA_PIXEL:
      scale = 0.01;
      break;
    case event.DOM_DELTA_LINE:
      scale = 0.2;
      break;
    case event.DOM_DELTA_PAGE:
      scale = 1.0;
      break;
  }
  io.MouseWheelH = event.deltaX * scale;
  io.MouseWheel = -event.deltaY * scale; // Mouse wheel: 1 unit scrolls about 5 lines text.
  if (io.WantCaptureMouse) {
    return true;
  }
  return false;
}

let touch_count = 0;
let touch_id: number;
export class ITouch {
  x = 0;
  y = 0;
}
export let multi_touch: { [key: number]: ITouch } = {};

function canvas_on_touchstart(event: TouchEvent) {
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    touch_id = touch.identifier;
    multi_touch[touch.identifier] = { x: touch.clientX, y: touch.clientY };
  }
  const mtouch = multi_touch[touch_id];
  const io = ImGui.GetIO();
  io.MousePos.x = mtouch.x;
  io.MousePos.y = mtouch.y;
  io.MouseDown[0] = true;
}
function canvas_on_touchmove(event: TouchEvent) {
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    multi_touch[touch.identifier] = { x: touch.clientX, y: touch.clientY };
  }
  const mtouch = multi_touch[touch_id];
  const io = ImGui.GetIO();
  io.MousePos.x = mtouch.x;
  io.MousePos.y = mtouch.y;
}
function canvas_on_touchend(event: TouchEvent) {
  const io = ImGui.GetIO();
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i];
    if (touch.identifier == touch_id) {
      io.MouseDown[0] = false;
    }
    delete multi_touch[touch.identifier];
  }
  touch_count++;
  if (touch_count >= 200) {
    multi_touch = {};
  }
}
function canvas_on_touchcancel(event: TouchEvent) {
  canvas_on_touchend(event);
}

export const is_contextlost = false;

export function injectKeyEvent(ev: KeyboardEvent) {
  if (ev.type === 'keydown') {
    return canvas_on_keydown(ev);
  } else if (ev.type === 'keyup') {
    return canvas_on_keyup(ev);
  } else if (ev.type === 'keypress') {
    return canvas_on_keypress(ev);
  }
  return false;
}

export function injectWheelEvent(ev: WheelEvent) {
  return canvas_on_wheel(ev);
}

export function injectPointerEvent(ev: PointerEvent) {
  if (ev.type === 'pointermove') {
    return canvas_on_pointermove(ev);
  } else if (ev.type === 'pointerdown') {
    return canvas_on_pointerdown(ev);
  } else if (ev.type === 'pointerup') {
    return canvas_on_pointerup(ev);
  }
  return false;
}

export function injectTouchEvent(ev: TouchEvent) {
  if (ev.type === 'touchstart') {
    canvas_on_touchstart(ev);
  } else if (ev.type === 'touchmove') {
    canvas_on_touchmove(ev);
  } else if (ev.type === 'touchend') {
    canvas_on_touchend(ev);
  } else if (ev.type === 'touchcancel') {
    canvas_on_touchcancel(ev);
  }
}

/*
function canvas_on_contextlost(e:Event):void {
    e.preventDefault();
    console.info("canvas_on_contextlost");
    is_contextlost=true;
}

function canvas_on_contextrestored(e:Event):void {
    console.info("canvas_on_contextrestored");
    is_contextlost=false;
}
*/

export function Init(device: AbstractDevice, glyphSize: number) {
  const io = ImGui.GetIO();

  if (typeof window !== 'undefined') {
    io.BackendPlatformName = 'imgui_impl_browser';
    ImGui.LoadIniSettingsFromMemory(window.localStorage.getItem('imgui.ini') || '');
  } else {
    io.BackendPlatformName = 'imgui_impl_console';
  }

  if (typeof navigator !== 'undefined') {
    io.ConfigMacOSXBehaviors = navigator.platform.match(/Mac/) !== null;
  }

  /*
    if (typeof(document) !== "undefined") {
        document.body.addEventListener("copy", document_on_copy);
        document.body.addEventListener("cut", document_on_cut);
        document.body.addEventListener("paste", document_on_paste);
    }
    */

  io.SetClipboardTextFn = (user_data: any, text: string) => {
    clipboard_text = text;
    navigator.clipboard.writeText(clipboard_text);
  };
  io.GetClipboardTextFn = (_user_data: any) => {
    return clipboard_text;
  };
  io.ClipboardUserData = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', window_on_resize);
    window.addEventListener('gamepadconnected', window_on_gamepadconnected);
    window.addEventListener('gamepaddisconnected', window_on_gamepaddisconnected);
  }

  fontSizeGlyph = glyphSize;
  renderer = new Renderer(device);
  glyphManager = new GlyphManager(device, 1024, 1024, 1);
  dom_input = new Input(device.canvas);

  window_on_resize();
  renderer.device.canvas.style.touchAction = 'none'; // Disable browser handling of all panning and zooming gestures.
  renderer.device.canvas.addEventListener('blur', canvas_on_blur);
  renderer.device.canvas.addEventListener('contextmenu', canvas_on_contextmenu);

  // Setup back-end capabilities flags
  io.BackendFlags |= ImGui.BackendFlags.HasMouseCursors; // We can honor GetMouseCursor() values (optional)

  // Keyboard mapping. ImGui will use those indices to peek into the io.KeyDown[] array.
  io.KeyMap[ImGui.Key.Tab] = 9;
  io.KeyMap[ImGui.Key.LeftArrow] = 37;
  io.KeyMap[ImGui.Key.RightArrow] = 39;
  io.KeyMap[ImGui.Key.UpArrow] = 38;
  io.KeyMap[ImGui.Key.DownArrow] = 40;
  io.KeyMap[ImGui.Key.PageUp] = 33;
  io.KeyMap[ImGui.Key.PageDown] = 34;
  io.KeyMap[ImGui.Key.Home] = 36;
  io.KeyMap[ImGui.Key.End] = 35;
  io.KeyMap[ImGui.Key.Insert] = 45;
  io.KeyMap[ImGui.Key.Delete] = 46;
  io.KeyMap[ImGui.Key.Backspace] = 8;
  io.KeyMap[ImGui.Key.Space] = 32;
  io.KeyMap[ImGui.Key.Enter] = 13;
  io.KeyMap[ImGui.Key.Escape] = 27;
  io.KeyMap[ImGui.Key.KeyPadEnter] = key_code_to_index['NumpadEnter'];
  io.KeyMap[ImGui.Key.A] = 65;
  io.KeyMap[ImGui.Key.C] = 67;
  io.KeyMap[ImGui.Key.V] = 86;
  io.KeyMap[ImGui.Key.X] = 88;
  io.KeyMap[ImGui.Key.Y] = 89;
  io.KeyMap[ImGui.Key.Z] = 90;

  CreateDeviceObjects();
}

export function NewFrame(time: number) {
  const io = ImGui.GetIO();

  if (io.WantSaveIniSettings) {
    io.WantSaveIniSettings = false;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('imgui.ini', ImGui.SaveIniSettingsToMemory());
    }
  }

  const viewport = renderer!.device.getViewport();
  const canvas = renderer!.device.canvas;
  const w: number = viewport.width;
  const h: number = viewport.height;
  const display_w: number = renderer!.device.screenXToDevice(w);
  const display_h: number = renderer!.device.screenYToDevice(h);
  io.DisplaySize.x = w;
  io.DisplaySize.y = h;
  io.DisplayFramebufferScale.x = w > 0 ? display_w / w : 0;
  io.DisplayFramebufferScale.y = h > 0 ? display_h / h : 0;

  const dt: number = prev_time === 0 ? 0 : time - prev_time;
  prev_time = time;
  io.DeltaTime = Math.max(0.001, dt / 1000);

  /*
  if (io.WantSetMousePos) {
    console.log('TODO: MousePos', io.MousePos.x, io.MousePos.y);
  }
  */

  if (typeof document !== 'undefined') {
    if (io.MouseDrawCursor) {
      document.body.style.cursor = 'none';
    } else {
      switch (ImGui.GetMouseCursor()) {
        case ImGui.MouseCursor.None:
          canvas.style.cursor = 'none';
          break;
        case ImGui.MouseCursor.Arrow:
          canvas.style.cursor = 'default';
          break;
        case ImGui.MouseCursor.TextInput:
          canvas.style.cursor = 'text';
          break; // When hovering over InputText, etc.
        case ImGui.MouseCursor.ResizeAll:
          canvas.style.cursor = 'all-scroll';
          break; // Unused
        case ImGui.MouseCursor.ResizeNS:
          canvas.style.cursor = 'ns-resize';
          break; // When hovering over an horizontal border
        case ImGui.MouseCursor.ResizeEW:
          canvas.style.cursor = 'ew-resize';
          break; // When hovering over a vertical border or a column
        case ImGui.MouseCursor.ResizeNESW:
          canvas.style.cursor = 'nesw-resize';
          break; // When hovering over the bottom-left corner of a window
        case ImGui.MouseCursor.ResizeNWSE:
          canvas.style.cursor = 'nwse-resize';
          break; // When hovering over the bottom-right corner of a window
        case ImGui.MouseCursor.Hand:
          canvas.style.cursor = 'pointer';
          break;
        case ImGui.MouseCursor.NotAllowed:
          canvas.style.cursor = 'not-allowed';
          break;
        default:
          canvas.style.cursor = 'default';
          break;
      }
    }
  }

  // Gamepad navigation mapping [BETA]
  for (let i = 0; i < io.NavInputs.length; ++i) {
    // TODO: This is currently causing an issue and I have no gamepad to test with.
    //       The error is: ''set' on proxy: trap returned falsish for property '21'
    //       I think that the NavInputs are zeroed out by ImGui at the start of each frame anyway
    //       so I am not sure if the following is even necessary.
    //io.NavInputs[i] = 0.0;
  }
  if (io.ConfigFlags & ImGui.ConfigFlags.NavEnableGamepad) {
    // Update gamepad inputs
    const gamepads: (Gamepad | null)[] =
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()
        : [];
    for (let i = 0; i < gamepads.length; ++i) {
      const gamepad: Gamepad | null = gamepads[i];
      if (!gamepad) {
        continue;
      }
      io.BackendFlags |= ImGui.BackendFlags.HasGamepad;
      const buttons_count: number = gamepad.buttons.length;
      const axes_count: number = gamepad.axes.length;

      const MAP_BUTTON = function MAP_BUTTON(NAV_NO: number, BUTTON_NO: number) {
        if (!gamepad) {
          return;
        }
        if (buttons_count > BUTTON_NO && gamepad.buttons[BUTTON_NO].pressed) {
          io.NavInputs[NAV_NO] = 1.0;
        }
      };
      const MAP_ANALOG = function MAP_ANALOG(NAV_NO: number, AXIS_NO: number, V0: number, V1: number) {
        if (!gamepad) {
          return;
        }
        let v: number = axes_count > AXIS_NO ? gamepad.axes[AXIS_NO] : V0;
        v = (v - V0) / (V1 - V0);
        if (v > 1.0) {
          v = 1.0;
        }
        if (io.NavInputs[NAV_NO] < v) {
          io.NavInputs[NAV_NO] = v;
        }
      };
      // TODO: map input based on vendor and product id
      // https://developer.mozilla.org/en-US/docs/Web/API/Gamepad/id
      const match: RegExpMatchArray | null = gamepad.id.match(/^([0-9a-f]{4})-([0-9a-f]{4})-.*$/);
      const match_chrome: RegExpMatchArray | null = gamepad.id.match(
        /^.*\(.*Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4})\).*$/
      );
      const vendor: string = (match && match[1]) || (match_chrome && match_chrome[1]) || '0000';
      const product: string = (match && match[2]) || (match_chrome && match_chrome[2]) || '0000';
      switch (vendor + product) {
        case '046dc216': // Logitech Logitech Dual Action (Vendor: 046d Product: c216)
          MAP_BUTTON(ImGui.NavInput.Activate, 1); // Cross / A
          MAP_BUTTON(ImGui.NavInput.Cancel, 2); // Circle / B
          MAP_BUTTON(ImGui.NavInput.Menu, 0); // Square / X
          MAP_BUTTON(ImGui.NavInput.Input, 3); // Triangle / Y
          MAP_ANALOG(ImGui.NavInput.DpadLeft, 4, -0.3, -0.9); // D-Pad Left
          MAP_ANALOG(ImGui.NavInput.DpadRight, 4, +0.3, +0.9); // D-Pad Right
          MAP_ANALOG(ImGui.NavInput.DpadUp, 5, -0.3, -0.9); // D-Pad Up
          MAP_ANALOG(ImGui.NavInput.DpadDown, 5, +0.3, +0.9); // D-Pad Down
          MAP_BUTTON(ImGui.NavInput.FocusPrev, 4); // L1 / LB
          MAP_BUTTON(ImGui.NavInput.FocusNext, 5); // R1 / RB
          MAP_BUTTON(ImGui.NavInput.TweakSlow, 6); // L2 / LT
          MAP_BUTTON(ImGui.NavInput.TweakFast, 7); // R2 / RT
          MAP_ANALOG(ImGui.NavInput.LStickLeft, 0, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickRight, 0, +0.3, +0.9);
          MAP_ANALOG(ImGui.NavInput.LStickUp, 1, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickDown, 1, +0.3, +0.9);
          break;
        case '046dc21d': // Logitech Gamepad F310 (STANDARD GAMEPAD Vendor: 046d Product: c21d)
          MAP_BUTTON(ImGui.NavInput.Activate, 0); // Cross / A
          MAP_BUTTON(ImGui.NavInput.Cancel, 1); // Circle / B
          MAP_BUTTON(ImGui.NavInput.Menu, 2); // Square / X
          MAP_BUTTON(ImGui.NavInput.Input, 3); // Triangle / Y
          MAP_BUTTON(ImGui.NavInput.DpadLeft, 14); // D-Pad Left
          MAP_BUTTON(ImGui.NavInput.DpadRight, 15); // D-Pad Right
          MAP_BUTTON(ImGui.NavInput.DpadUp, 12); // D-Pad Up
          MAP_BUTTON(ImGui.NavInput.DpadDown, 13); // D-Pad Down
          MAP_BUTTON(ImGui.NavInput.FocusPrev, 4); // L1 / LB
          MAP_BUTTON(ImGui.NavInput.FocusNext, 5); // R1 / RB
          MAP_ANALOG(ImGui.NavInput.TweakSlow, 6, +0.3, +0.9); // L2 / LT
          MAP_ANALOG(ImGui.NavInput.TweakFast, 7, +0.3, +0.9); // R2 / RT
          MAP_ANALOG(ImGui.NavInput.LStickLeft, 0, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickRight, 0, +0.3, +0.9);
          MAP_ANALOG(ImGui.NavInput.LStickUp, 1, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickDown, 1, +0.3, +0.9);
          break;
        case '2dc86001': // 8Bitdo SN30 Pro  8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6001)
        case '2dc86101': // 8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)
          MAP_BUTTON(ImGui.NavInput.Activate, 1); // Cross / A
          MAP_BUTTON(ImGui.NavInput.Cancel, 0); // Circle / B
          MAP_BUTTON(ImGui.NavInput.Menu, 4); // Square / X
          MAP_BUTTON(ImGui.NavInput.Input, 3); // Triangle / Y
          MAP_ANALOG(ImGui.NavInput.DpadLeft, 6, -0.3, -0.9); // D-Pad Left
          MAP_ANALOG(ImGui.NavInput.DpadRight, 6, +0.3, +0.9); // D-Pad Right
          MAP_ANALOG(ImGui.NavInput.DpadUp, 7, -0.3, -0.9); // D-Pad Up
          MAP_ANALOG(ImGui.NavInput.DpadDown, 7, +0.3, +0.9); // D-Pad Down
          MAP_BUTTON(ImGui.NavInput.FocusPrev, 6); // L1 / LB
          MAP_BUTTON(ImGui.NavInput.FocusNext, 7); // R1 / RB
          MAP_BUTTON(ImGui.NavInput.TweakSlow, 8); // L2 / LT
          MAP_BUTTON(ImGui.NavInput.TweakFast, 9); // R2 / RT
          MAP_ANALOG(ImGui.NavInput.LStickLeft, 0, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickRight, 0, +0.3, +0.9);
          MAP_ANALOG(ImGui.NavInput.LStickUp, 1, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickDown, 1, +0.3, +0.9);
          break;
        default: // standard gamepad: https://w3c.github.io/gamepad/#remapping
          MAP_BUTTON(ImGui.NavInput.Activate, 0); // Cross / A
          MAP_BUTTON(ImGui.NavInput.Cancel, 1); // Circle / B
          MAP_BUTTON(ImGui.NavInput.Menu, 2); // Square / X
          MAP_BUTTON(ImGui.NavInput.Input, 3); // Triangle / Y
          MAP_BUTTON(ImGui.NavInput.DpadLeft, 14); // D-Pad Left
          MAP_BUTTON(ImGui.NavInput.DpadRight, 15); // D-Pad Right
          MAP_BUTTON(ImGui.NavInput.DpadUp, 12); // D-Pad Up
          MAP_BUTTON(ImGui.NavInput.DpadDown, 13); // D-Pad Down
          MAP_BUTTON(ImGui.NavInput.FocusPrev, 4); // L1 / LB
          MAP_BUTTON(ImGui.NavInput.FocusNext, 5); // R1 / RB
          MAP_BUTTON(ImGui.NavInput.TweakSlow, 6); // L2 / LT
          MAP_BUTTON(ImGui.NavInput.TweakFast, 7); // R2 / RT
          MAP_ANALOG(ImGui.NavInput.LStickLeft, 0, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickRight, 0, +0.3, +0.9);
          MAP_ANALOG(ImGui.NavInput.LStickUp, 1, -0.3, -0.9);
          MAP_ANALOG(ImGui.NavInput.LStickDown, 1, +0.3, +0.9);
          break;
      }
    }
  }
}

/*
function toRgba(col:number):string
{
    const r=(col>>>24);
    const g=(col>>16)&0xFF;
    const b=(col>>8)&0xFF;
    const a=(col&0xFF);
    return 'rgba('+r+','+g+','+b+','+a+')';
}
*/

let charCodeMap: Record<number, string> = {};

const glyphFontMap: Record<number, DeviceFont> = {};

/** @internal */
export function addCustomGlyph(charCode: number, font: DeviceFont) {
  glyphFontMap[charCode] = font;
}

/** @internal */
export function calcTextSize(text: string, out?: ImGui.ImVec2) {
  const font = ImGui.GetFont();
  const fontName = font.FontSize + 'px ' + font.FontName;
  let deviceFont = fonts[fontName];
  if (!deviceFont) {
    deviceFont = new DeviceFont(fontName, 1);
    fonts[fontName] = deviceFont;
  }
  let x = 0;
  let y = 0;
  if (text) {
    for (const ch of text) {
      const glyphSize = glyphManager!.getGlyphSize(ch, deviceFont) ?? 0;
      x += glyphSize[0];
      y = Math.max(glyphSize[1]);
    }
  }
  out = out ?? new ImGui.ImVec2();
  out.x = x;
  out.y = y;
  return out;
}

/** @internal */
export function font_update(io: ImGui.IO) {
  io.Fonts.Fonts.forEach((font) => {
    const fontName = fontSizeGlyph + 'px ' + font.FontName;
    const scale = font.FontSize / fontSizeGlyph;
    let deviceFont = glyphFonts[fontName];
    if (!deviceFont) {
      deviceFont = new DeviceFont(fontName, 1);
      glyphFonts[fontName] = deviceFont;
    }
    let glyph = font.GlyphToCreate;
    while (glyph) {
      const charCode = charCodeMap?.[glyph.Char] ?? glyph.Char;
      let char: string;
      let glyphInfo: AtlasInfo;
      let f: Nullable<DeviceFont> = null;
      if (typeof charCode === 'number') {
        f = glyphFontMap[charCode];
        char = String.fromCodePoint(charCode);
      } else {
        char = charCode;
      }
      if (f) {
        glyphInfo = glyphManager!.getGlyphInfo(char, f)!;
      } else {
        glyphInfo = glyphManager!.getGlyphInfo(char, deviceFont)!;
      }
      glyph.X0 = 0;
      glyph.X1 = Math.ceil(glyphInfo.width * scale);
      glyph.Y0 = 0;
      glyph.Y1 = Math.ceil(glyphInfo.height * scale);
      glyph.AdvanceX = Math.ceil(glyphInfo.width * scale);
      glyph.U0 = glyphInfo.uMin;
      glyph.U1 = glyphInfo.uMax;
      glyph.V0 = glyphInfo.vMin;
      glyph.V1 = glyphInfo.vMax;
      glyph.TextureID = glyphManager!.getAtlasTexture(glyphInfo.atlasIndex) ?? null;
      font.GlyphCreated(glyph);
      glyph = font.GlyphToCreate;
    }
  });
}

let current_window_id: ImGui.ImGuiID = 0;
export const scroll_acc: ImGui.ImVec2 = new ImGui.ImVec2(0, 0);
let mouse_first_down = false;

function scroll_update(io: ImGui.IO) {
  const hoveredWin = ImGui.GetHoveredWindow();
  const hoveredId = ImGui.GetHoveredId();
  if (hoveredWin && hoveredId == 0) {
    if (current_window_id != hoveredWin.ID) {
      current_window_id = hoveredWin.ID;
      scroll_acc.Set(0, 0);
      mouse_first_down = true;
    }

    if (hoveredWin.Flags & ImGui.ImGuiWindowFlags.NoMove) {
      let first_down = false;
      if (io.MouseDown[0]) {
        first_down = mouse_first_down;
        mouse_first_down = false;
      } else {
        mouse_first_down = true;
      }

      const scroll = new ImGui.ImVec2(hoveredWin.Scroll.x, hoveredWin.Scroll.y);
      if (hoveredWin.ScrollbarY) {
        if (io.MouseDown[0] && !first_down) {
          scroll.y -= io.MouseDelta.y;
          scroll_acc.y = io.MouseDelta.y;
        } else if (Math.abs(scroll_acc.y) > 1) {
          scroll.y -= scroll_acc.y;
          scroll_acc.y *= 0.8;
        }
        if (scroll.y < 0) {
          scroll.y = 0;
        } else if (scroll.y > hoveredWin.ScrollMax.y) {
          scroll.y = hoveredWin.ScrollMax.y;
        }
        hoveredWin.Scroll = scroll;
      }
      if (hoveredWin.ScrollbarX) {
        if (io.MouseDown[0]) {
          scroll.x -= io.MouseDelta.x;
          scroll_acc.x = io.MouseDelta.x;
        }
        if (scroll.x < 0) {
          scroll.x = 0;
        } else if (scroll.x > hoveredWin.ScrollMax.x) {
          scroll.x = hoveredWin.ScrollMax.x;
        }
        hoveredWin.Scroll = scroll;
      }
    }
  }
}

let dom_input: Input;
function input_text_update(_io: ImGui.IO) {
  const activeId = ImGui.GetActiveId();
  const inpId = ImGui.GetInputTextId();
  if (!activeId || activeId != inpId) {
    dom_input?.blur();
  } else {
    dom_input.focus();
  }
}

export function ClearBuffer(color: ImGui.ImVec4) {
  renderer!.device.clearFrameBuffer(new Vector4(color.x, color.y, color.z, color.w), 1, 0);
}

export function RenderDrawData(draw_data: ImGui.DrawData | null = ImGui.GetDrawData()) {
  const io = ImGui.GetIO();

  font_update(io);
  scroll_update(io);
  input_text_update(io);

  if (draw_data === null) {
    throw new Error();
  }

  // Avoid rendering when minimized, scale coordinates for retina displays (screen coordinates != framebuffer coordinates)
  const fb_width: number = io.DisplaySize.x * io.DisplayFramebufferScale.x;
  const fb_height: number = io.DisplaySize.y * io.DisplayFramebufferScale.y;
  if (fb_width === 0 || fb_height === 0) {
    return;
  }
  draw_data.ScaleClipRects(io.DisplayFramebufferScale);

  // Draw
  const pos = draw_data.DisplayPos;
  const scissorOld = renderer!.device.getScissor();
  renderer!.beginRender();
  draw_data.IterateDrawLists((draw_list: ImGui.DrawList) => {
    const vx = draw_list.VtxBuffer;
    const ix = draw_list.IdxBuffer;
    const ixU16 = new Uint16Array(ix.buffer.slice(ix.byteOffset, ix.byteOffset + ix.byteLength));
    let indexOffset = 0;

    draw_list.IterateDrawCmds((draw_cmd: ImGui.DrawCmd) => {
      if (draw_cmd.UserCallback !== null) {
        // User callback (registered via ImDrawList::AddCallback)
        draw_cmd.UserCallback(draw_list, draw_cmd);
      } else {
        const clip_rect = new ImGui.Vec4(
          draw_cmd.ClipRect.x - pos.x,
          draw_cmd.ClipRect.y - pos.y,
          draw_cmd.ClipRect.z - pos.x,
          draw_cmd.ClipRect.w - pos.y
        );
        if (clip_rect.x < fb_width && clip_rect.y < fb_height && clip_rect.z >= 0.0 && clip_rect.w >= 0.0) {
          // Apply scissor/clipping rectangle
          // renderer.device.setScissor([clip_rect.x, fb_height - clip_rect.w, clip_rect.z - clip_rect.x, clip_rect.w - clip_rect.y]);
          const scissorX = renderer!.device.deviceXToScreen(clip_rect.x);
          const scissorY = renderer!.device.deviceYToScreen(fb_height - clip_rect.w);
          const scissorW = renderer!.device.deviceXToScreen(clip_rect.z - clip_rect.x);
          const scissorH = renderer!.device.deviceYToScreen(clip_rect.w - clip_rect.y);
          renderer!.stream(vx, ixU16, indexOffset, draw_cmd.ElemCount, draw_cmd.TextureId, [
            scissorX,
            scissorY,
            scissorW,
            scissorH
          ]);
        }
      }
      indexOffset += draw_cmd.ElemCount;
    });
  });
  renderer!.device.setScissor(scissorOld);
}

export function CreateFontsTexture() {
  const io = ImGui.GetIO();

  // Backup GL state
  // const last_texture: WebGLTexture | null = gl && gl.getParameter(gl.TEXTURE_BINDING_2D);

  // Build texture atlas
  // const width: number = 256;
  // const height: number = 256;
  // const pixels: Uint8Array = new Uint8Array(4 * width * height).fill(0xff);

  //const { width, height, pixels } = io.Fonts.GetTexDataAsRGBA32();   // Load as RGBA 32-bits (75% of the memory is wasted, but default font is so small) because it is more likely to be compatible with user's existing shaders. If your ImTextureId represent a higher-level concept than just a GL texture id, consider calling GetTexDataAsAlpha8() instead to save on GPU memory.
  const { width, height, pixels } = io.Fonts.GetTexDataAsAlpha8();
  if (width && height && pixels) {
    const rgba8 = new Uint8Array(width * height * 4);
    let i = 0;
    pixels.forEach((p) => {
      rgba8[i++] = 0xff;
      rgba8[i++] = 0xff;
      rgba8[i++] = 0xff;
      rgba8[i++] = p;
    });
    // Upload texture to graphics system
    g_FontTexture = renderer!.device.createTexture2D('rgba8unorm', width, height, {
      mipmapping: false
    });
    g_FontTexture!.update(rgba8, 0, 0, width, height);
    //gl && gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Store our identifier
    io.Fonts.TexID = g_FontTexture || null;
    // console.log("font texture id", g_FontTexture);
  }
}

/** @internal */
export function getCharCodeMap() {
  return charCodeMap ?? {};
}

/** @internal */
export function setCharCodeMap(map: Record<number, string>) {
  charCodeMap = map;
}

export function DestroyFontsTexture() {
  const io = ImGui.GetIO();
  io.Fonts.TexID?.dispose();
  io.Fonts.TexID = null;
}

export function CreateDeviceObjects() {
  CreateFontsTexture();
}

export function DestroyDeviceObjects() {
  DestroyFontsTexture();
}

export function captureKeyboard(capture: boolean) {
  wantKeyboard = !!capture;
}

export function mouseButtonToImGui(button: number) {
  return mouse_button_map[button] ?? -1;
}

export function mouseButtonFromImGui(button: ImGui.MouseButton) {
  return mouse_button_map.indexOf(button);
}
export interface ITextureParam {
  internalFormat?: number;
  srcFormat?: number;
  srcType?: number;
  width?: number;
  height?: number;
  level?: number;
}

export class Texture {
  public _texture: Nullable<Texture2D> = null;
  public _width = 1;
  public _height = 1;

  constructor(_param?: ITextureParam) {}
  public Destroy() {
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
  }
  public Update(
    src: ImageBitmap | ImageData | HTMLCanvasElement | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>
  ) {
    let w: number, h: number;
    if (!src) {
      return;
    } else if (src instanceof HTMLVideoElement) {
      const srcVideo = src as HTMLVideoElement;
      if (srcVideo) {
        w = srcVideo.videoWidth;
        h = srcVideo.videoHeight;
      } else {
        return;
      }
    } else if (src instanceof Uint8Array || src instanceof Uint16Array) {
      w = this._width;
      h = this._height;
    } else {
      w = src.width;
      h = src.height;
    }
    if (!this._texture || this._texture.width !== w || this._texture.height !== h) {
      this._texture?.dispose();
      this._texture = renderer!.device.createTexture2D('rgba8unorm', w, h, {
        mipmapping: false
      });
      this._width = w;
      this._height = h;
    }
    if (src instanceof Uint8Array || src instanceof Uint16Array) {
      this._texture!.update(src, 0, 0, w, h);
    } else if (src instanceof ImageData) {
      this._texture!.update(src.data, 0, 0, w, h);
    } else {
      this._texture!.updateFromElement(src, 0, 0, 0, 0, w, h);
    }
  }
}

export class TextureCache {
  public constructor() {}

  public Destroy() {
    Object.entries(this.cache).forEach(([_key, value]) => {
      value.Destroy();
    });
    this.cache = {};
  }

  public async Load(name: string, src: string) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = src;
    await image.decode();
    const bitmap = await createImageBitmap(image, { premultiplyAlpha: 'none' });
    const tex = new Texture();
    tex.Update(bitmap);
    this.cache[name] = tex;
    return tex;
  }

  public cache: { [key: string]: Texture } = {};
}
