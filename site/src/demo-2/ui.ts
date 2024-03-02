import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application } from "@zephyr3d/scene";

export class UI {
  render(){
    imGuiNewFrame();
    this.renderStatusBar();
    imGuiEndFrame();
  }
  private renderStatusBar() {
    if (ImGui.BeginStatusBar()) {
      ImGui.Text(`Device: ${Application.instance.device.type}`);
      ImGui.Text(`FPS: ${Application.instance.device.frameInfo.FPS.toFixed(2)}`);
      ImGui.Text(`DrawCall: ${Application.instance.device.frameInfo.drawCalls}`);
      ImGui.EndStatusBar();
    }
  }
}
