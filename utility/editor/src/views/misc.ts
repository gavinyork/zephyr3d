import { ImGui, imGuiEndFrame, imGuiInFrame, imGuiNewFrame } from '@zephyr3d/imgui';

let frameHeight = 0;
export function getFrameHeight() {
  if (frameHeight === 0) {
    const inFrame = imGuiInFrame();
    if (!inFrame) {
      imGuiNewFrame();
      ImGui.Begin('Dummy');
    }
    frameHeight = ImGui.GetFrameHeight();
    if (!inFrame) {
      ImGui.End();
      imGuiEndFrame();
    }
  }
  return frameHeight;
}
