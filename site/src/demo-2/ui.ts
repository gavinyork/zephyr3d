import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application } from "@zephyr3d/scene";

export class UI {
  private _deviceList: string[];
  private _deviceIndex: [number];
  constructor(){
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._deviceIndex = [this._deviceList.findIndex(val => val.toLowerCase() === Application.instance.device.type)];
  }
  render(){
    imGuiNewFrame();
    this.renderSettings();
    this.renderStatusBar();
    imGuiEndFrame();
  }
  renderSettings(){
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0), ImGui.Cond.Always);
    ImGui.SetNextWindowSize(new ImGui.ImVec2(300, Math.min(500, Application.instance.device.getViewport().height)), ImGui.Cond.Always);
    if (ImGui.Begin('Settings')){
      ImGui.BeginSection('System');
      ImGui.SetNextItemWidth(150);
      if(ImGui.Combo('Select device', this._deviceIndex, this._deviceList)){
        const url = new URL(window.location.href);
        url.searchParams.set('dev', this._deviceList[this._deviceIndex[0]].toLowerCase());
        window.location.href = url.href;
      }
      ImGui.EndSection(1);
      if (ImGui.BeginChild('')) {
        ImGui.TextWrapped('Move with W/S/A/D keys.');
        ImGui.TextWrapped('Rotate with left mouse button.');
      }
      ImGui.EndChild();
    }
    ImGui.End();
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
