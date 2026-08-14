import { ImGui } from '@zephyr3d/imgui';
import { getFrameHeight } from '../views/misc';
import { getDevice } from '@zephyr3d/scene';

export class StatusBar {
  private _statusText: string;
  constructor() {
    this._statusText = '';
  }
  get height() {
    return getFrameHeight();
  }
  setStatus(text: string) {
    this._statusText = text?.trim() ?? '';
  }
  render() {
    if (ImGui.BeginStatusBar()) {
      if (this._statusText) {
        ImGui.Text(this._statusText);
      }
      ImGui.Text(`Device: ${getDevice().type}`);
      ImGui.Text(`FPS: ${getDevice().frameInfo.FPS.toFixed(2)}`);
      ImGui.Text(`DrawCall: ${getDevice().frameInfo.drawCalls}`);
      ImGui.Text(`CPU time: ${Number(getDevice().frameInfo.elapsedTimeCPU).toFixed(2)}`);
      ImGui.Text(`GPU time: ${Number(getDevice().frameInfo.elapsedTimeGPU).toFixed(2)}`);
      ImGui.EndStatusBar();
    }
  }
}
