import { ImGui } from '@zephyr3d/imgui';
import { getFrameHeight } from '../views/misc';
import { getDevice } from '@zephyr3d/scene';

export class StatusBar {
  get height() {
    return getFrameHeight();
  }
  render() {
    if (ImGui.BeginStatusBar()) {
      ImGui.Text(`Device: ${getDevice().type}`);
      ImGui.Text(`FPS: ${getDevice().frameInfo.FPS.toFixed(2)}`);
      ImGui.Text(`DrawCall: ${getDevice().frameInfo.drawCalls}`);
      ImGui.Text(`CPU time: ${Number(getDevice().frameInfo.elapsedTimeCPU).toFixed(2)}`);
      ImGui.Text(`GPU time: ${Number(getDevice().frameInfo.elapsedTimeGPU).toFixed(2)}`);
      ImGui.EndStatusBar();
    }
  }
}
