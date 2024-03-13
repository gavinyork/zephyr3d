import { GUI } from 'lil-gui';
import { GLTFViewer } from './gltfviewer';
import { Application } from '@zephyr3d/scene';

interface GUIParams {
  deviceType: string;
  environment: string;
  iblLighting: boolean;
  punctualLighting: boolean;
  tonemap: boolean;
  bloom: boolean;
  fxaa: boolean;
  FPS: number;
  animation?: string;
}

export class Panel {
  private _viewer: GLTFViewer;
  private _deviceList: string[];
  private _params: GUIParams;
  private _gui: GUI;
  private _animationController: GUI;
  constructor(viewer: GLTFViewer){
    this._viewer = viewer;
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._gui = new GUI({ container: document.body });
    this._params = {
      deviceType: this._deviceList[this._deviceList.findIndex(val => val.toLowerCase() === Application.instance.device.type)],
      environment: this._viewer.envMaps.getCurrentId(),
      iblLighting: this._viewer.environmentLightEnabled,
      punctualLighting: this._viewer.punctualLightEnabled,
      tonemap: this._viewer.tonemapEnabled(),
      bloom: this._viewer.bloomEnabled(),
      fxaa: this._viewer.FXAAEnabled(),
      FPS: 0
    };
    this._animationController = null;
    this.create();
  }
  update(){
    if (this._animationController) {
      this._animationController.destroy();
      this._animationController = null;
      this._params.animation = null;
    }
    if (this._viewer.animationSet) {
      const animationNames = this._viewer.animationSet.getAnimationNames();
      const playIndex = animationNames.findIndex(val => this._viewer.animationSet.isPlayingAnimation(val));
      this._params.animation = playIndex >= 0 ? animationNames[playIndex] : '';
      this._animationController = this._gui.addFolder('Animation');
      this._animationController.add(this._params, 'animation', animationNames)
        .name('Animation')
        .onChange(value=>{
          this._viewer.animationSet.playAnimation(value);
        });
    }
  }
  create(){
    const systemSettings = this._gui.addFolder('System');
    systemSettings.add(this._params, 'deviceType', this._deviceList)
    .name('Select device')
    .onChange(value=>{
      const url = new URL(window.location.href);
      url.searchParams.set('dev', value.toLowerCase());
      window.location.href = url.href;
    });

    const lightSettings = this._gui.addFolder('Lighting');
    lightSettings.add(this._params, 'environment', this._viewer.envMaps.getIdList())
    .name('Environment')
    .onChange(value=>{
      this._viewer.envMaps.selectById(value, this._viewer.scene);
    });
    lightSettings.add(this._params, 'iblLighting')
    .name('IBL lighting')
    .onChange(value=>{
      this._viewer.environmentLightEnabled = value;
    });
    lightSettings.add(this._params, 'punctualLighting')
    .name('Punctual lighting')
    .onChange(value=>{
      this._viewer.punctualLightEnabled = value;
    });

    const ppSettings = this._gui.addFolder('PostProcess');
    ppSettings.add(this._params, 'tonemap')
    .name('Tonemap')
    .onChange(value=>{
      this._viewer.enableTonemap(value);
    });
    ppSettings.add(this._params, 'bloom')
    .name('Bloom')
    .onChange(value=>{
      this._viewer.enableBloom(value);
    });
    ppSettings.add(this._params, 'fxaa')
    .name('FXAA')
    .onChange(value=>{
      this._viewer.enableFXAA(value);
    });
  }
  /*
  renderSettings(){
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0), ImGui.Cond.Always);
    ImGui.SetNextWindowSize(new ImGui.ImVec2(300, Math.min(500, Application.instance.device.getViewport().height)), ImGui.Cond.Always);
    if (ImGui.Begin('Settings')){
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
  */
}
