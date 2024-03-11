import { ImGui, imGuiEndFrame, imGuiNewFrame } from "@zephyr3d/imgui";
import { Application } from "@zephyr3d/scene";
import type { GLTFViewer } from "./gltfviewer";

export class UI {
  private _viewer: GLTFViewer;
  private _deviceList: string[];
  private _deviceIndex: [number];
  constructor(viewer: GLTFViewer){
    this._viewer = viewer;
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
      const animations = this._viewer.animationSet?.getAnimationNames() ?? [];
      if (animations.length > 0) {
        ImGui.BeginSection('Animation');
        const index = [animations.findIndex(ani => this._viewer.animationSet.isPlayingAnimation(ani))] as [number];
        ImGui.SetNextItemWidth(150);
        if (ImGui.Combo('Animation', index, animations)){
          this._viewer.animationSet.playAnimation(animations[index[0]]);
        }
        ImGui.EndSection(1);
      }
      if (ImGui.BeginChild('')) {
        ImGui.TextWrapped('Usage:');
        ImGui.TextWrapped('Drag GLTF/GLB/ZIP to view model.');
        ImGui.TextWrapped('Drag HDR to change environment.');
        ImGui.TextWrapped('Note:')
        ImGui.TextWrapped('Morph target animation currently not supported.');
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
