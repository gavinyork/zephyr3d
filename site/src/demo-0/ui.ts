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
    this.renderMenuBar();
    this.renderStatusBar();
    imGuiEndFrame();
  }
  renderMenuBar(){
    if(ImGui.BeginMainMenuBar()){
      if(ImGui.BeginMenu('Scene')){
        if(ImGui.BeginMenu('Environment')){
          for(const id of this._viewer.envMaps.getIdList()){
            ImGui.MenuItem(`${id}##env`, null, (val?: boolean) => {
              if (val === undefined) {
                val = id === this._viewer.envMaps.getCurrentId();
              } else if (val) {
                this._viewer.envMaps.selectById(id, this._viewer.scene);
              }
              return val;
            });
          }
          ImGui.EndMenu();
        }
        ImGui.MenuItem('Bloom', null, (val?: boolean) => {
          if (val === undefined) {
            val = this._viewer.bloomEnabled();
          } else {
            this._viewer.enableBloom(val);
          }
          return val;
        });
        ImGui.MenuItem('ToneMap', null, (val?: boolean) => {
          if (val === undefined) {
            val = this._viewer.tonemapEnabled();
          } else {
            this._viewer.enableTonemap(val);
          }
          return val;
        });
        ImGui.MenuItem('FXAA', null, (val?: boolean) => {
          if (val === undefined) {
            val = this._viewer.FXAAEnabled();
          } else {
            this._viewer.enableFXAA(val);
          }
          return val;
        });
        ImGui.EndMenu();
      }
      const animations = this._viewer.animationSet?.getAnimationNames() ?? [];
      if (animations.length > 0) {
        if (ImGui.BeginMenu('Animation')){
          for(const name of animations){
            ImGui.MenuItem(`${name}##ani`, null, (val?: boolean) => {
              if (val === undefined) {
                val = this._viewer.animationSet.isPlayingAnimation(name);
              } else if (val) {
                this._viewer.animationSet.playAnimation(name);
              }
              return val;
            });
          }
          ImGui.EndMenu();
        }
      }
      ImGui.EndMainMenuBar();
    }
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
