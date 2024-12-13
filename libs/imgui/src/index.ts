import type { AbstractDevice, Font } from '@zephyr3d/device';
import * as ImGui from './imgui';
import * as ImGui_Impl from './imgui_impl';

/**
 * The ImGui interface
 * @public
 */
export { ImGui };

let inFrame = false;

/**
 * Initialize the ImGUI bindings
 *
 * @param device - The device object
 * @param fontFamily - Font family, default to arial
 * @param fontSize - Default font size, default to 16
 * @public
 */
export async function imGuiInit(device: AbstractDevice, fontFamily?: string, fontSize?: number) {
  await ImGui.default();
  ImGui.CHECKVERSION();
  console.log('ImGui.CreateContext() VERSION=', ImGui.VERSION);

  ImGui.CreateContext();
  ImGui.StyleColorsDark();
  const io: ImGui.IO = ImGui.GetIO();

  io.ConfigWindowsResizeFromEdges = true;
  io.ConfigDragClickToInputText = true;
  io.BackendFlags |= ImGui.BackendFlags.HasMouseCursors;
  const font = io.Fonts.AddFontDefault();

  font.FontName = fontFamily || 'arial';
  font.FontSize = fontSize || 16;
  ImGui_Impl.Init(device);
}

/**
 * Whether a frame is currently rendering
 * @public
 */
export function imGuiInFrame(): boolean {
  return inFrame;
}

/**
 * Starts a new frame
 * @public
 */
export function imGuiNewFrame() {
  if (inFrame) {
    throw new Error('imGuiNewFrame() failed: alreay in a frame');
  }
  inFrame = true;
  ImGui_Impl.NewFrame(Date.now());
  ImGui.NewFrame();
}

/**
 * Ends current frame
 * @public
 */
export function imGuiEndFrame() {
  if (!inFrame) {
    throw new Error('imGuiEndFrame() failed: not in a frame');
  }
  inFrame = false;
  ImGui.EndFrame();
  ImGui.Render();
  ImGui_Impl.RenderDrawData(ImGui.GetDrawData());
}

/**
 * Injects a browser event into the GUI system
 * @param ev - The event object
 * @param type - Event type, default to ev.type if not specified.
 * @returns A boolean value indices if the event was processed by GUI system
 * @public
 */
export function imGuiInjectEvent(ev: Event, type?: string) {
  type = type ?? ev.type;
  if (type === 'pointermove' || type === 'pointerdown' || type === 'pointerup') {
    return ImGui_Impl.injectPointerEvent(ev as PointerEvent);
  } else if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
    return ImGui_Impl.injectKeyEvent(ev as KeyboardEvent);
  } else if (type === 'wheel') {
    return ImGui_Impl.injectWheelEvent(ev as WheelEvent);
  } else {
    return false;
  }
}

/**
 * Set special text glyph font
 * @param charCode - char code of glyph
 * @param font - Web font
 */
export function imGuiSetFontGlyph(charCode: number, font: Font) {
  ImGui_Impl.addCustomGlyph(charCode, font);
}
