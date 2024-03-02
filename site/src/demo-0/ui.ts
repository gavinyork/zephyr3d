import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application } from "@zephyr3d/scene";
import type { GLTFViewer } from "./gltfviewer";

export class UI {
  private _viewer: GLTFViewer;
  constructor(viewer: GLTFViewer){
    this._viewer = viewer;
  }
  render(){
    imGuiNewFrame();
    this.renderSettings();
    this.renderStatusBar();
    imGuiEndFrame();
  }
  renderSettings(){
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0), ImGui.Cond.Always);
    ImGui.SetNextWindowSize(new ImGui.ImVec2(300, Math.min(400, Application.instance.device.getViewport().height)), ImGui.Cond.Always);
    if (ImGui.Begin('Settings')){
      ImGui.BeginSection('Light');
      const idList = this._viewer.envMaps.getIdList();
      const index = [idList.indexOf(this._viewer.envMaps.getCurrentId())] as [number];
      ImGui.SetNextItemWidth(150);
      if(ImGui.Combo('Environment', index, idList)){
        this._viewer.envMaps.selectById(idList[index[0]], this._viewer.scene);
      }
      ImGui.Checkbox('Enable IBL lighting', (val?: boolean) => {
        if (val === undefined) {
          val = this._viewer.environmentLightEnabled;
        } else {
          this._viewer.environmentLightEnabled = val;
        }
        return val;
      });
      ImGui.Checkbox('Enable Punctual lighting', (val?: boolean) => {
        if (val === undefined) {
          val = this._viewer.punctualLightEnabled;
        } else {
          this._viewer.punctualLightEnabled = val;
        }
        return val;
      });
      ImGui.EndSection(1);

      ImGui.BeginSection('Post process');
      ImGui.Checkbox('Tonemap', (val?: boolean) => {
        if (val === undefined) {
          val = this._viewer.tonemapEnabled();
        } else {
          this._viewer.enableTonemap(val);;
        }
        return val;
      });
      ImGui.Checkbox('Bloom', (val?: boolean) => {
        if (val === undefined) {
          val = this._viewer.bloomEnabled();
        } else {
          this._viewer.enableBloom(val);;
        }
        return val;
      });
      ImGui.Checkbox('Fxaa', (val?: boolean) => {
        if (val === undefined) {
          val = this._viewer.FXAAEnabled();
        } else {
          this._viewer.enableFXAA(val);;
        }
        return val;
      });
      ImGui.EndSection(1);
      if (ImGui.BeginChild('Usage')) {
        ImGui.TextWrapped('Drag GLTF/GLB/ZIP to view model.')
        ImGui.TextWrapped('Drag HDR to change environment.')
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
