import { ImGui } from "@zephyr3d/imgui";
import { Application } from "@zephyr3d/scene";

export class StatusBar {
  render() {
    if (ImGui.BeginStatusBar()) {
      ImGui.Text(`Device: ${Application.instance.device.type}`);
      ImGui.Text(`FPS: ${Application.instance.device.frameInfo.FPS.toFixed(2)}`);
      ImGui.Text(`DrawCall: ${Application.instance.device.frameInfo.drawCalls}`);
      ImGui.Text(`CPU time: ${Number(Application.instance.device.frameInfo.elapsedTimeCPU).toFixed(2)}`);
      ImGui.Text(`GPU time: ${Number(Application.instance.device.frameInfo.elapsedTimeGPU).toFixed(2)}`);
      ImGui.EndStatusBar();
    }
  }
}
