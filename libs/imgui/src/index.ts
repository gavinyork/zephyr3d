import type { AbstractDevice } from "@zephyr3d/device";
import * as ImGui from "./imgui";
import * as ImGui_Impl from "./imgui_impl";

/**
 * The ImGui interface
 * @public
 */
export { ImGui };

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
  console.log("ImGui.CreateContext() VERSION=", ImGui.VERSION);

  ImGui.CreateContext();
  ImGui.StyleColorsDark();
  const io:ImGui.IO=ImGui.GetIO();
  let font =io.Fonts.AddFontDefault();

  font.FontName = fontFamily || "arial";
  font.FontSize = fontSize || 16;
  ImGui_Impl.Init(device);
}

/**
 * Starts a new frame
 * @public
 */
export function imGuiNewFrame() {
  ImGui_Impl.NewFrame(Date.now());
  ImGui.NewFrame();
}

/**
 * Ends current frame
 * @public
 */
export function imGuiEndFrame() {
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
