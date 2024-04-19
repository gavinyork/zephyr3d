import { GUI } from 'lil-gui';
import { GLTFViewer } from './gltfviewer';
import { ABufferOIT, Application, WeightedBlendedOIT } from '@zephyr3d/scene';

interface GUIParams {
  deviceType: string;
  environment: string;
  iblLighting: boolean;
  punctualLighting: boolean;
  tonemap: boolean;
  water: boolean;
  bloom: boolean;
  fxaa: boolean;
  FPS: string;
  oitType: string;
  animation?: string;
}

export class Panel {
  private _viewer: GLTFViewer;
  private _deviceList: string[];
  private _oitTypes: string[];
  private _oitNames: string[];
  private _params: GUIParams;
  private _gui: GUI;
  private _animationController: GUI;
  constructor(viewer: GLTFViewer){
    this._viewer = viewer;
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._oitTypes = ['', WeightedBlendedOIT.type, ABufferOIT.type];
    this._oitNames = ['None', 'weighted-blended', 'per-pixel linked list'];
    this._gui = new GUI({ container: document.body });
    this._params = {
      deviceType: this._deviceList[this._deviceList.findIndex(val => val.toLowerCase() === Application.instance.device.type)],
      environment: this._viewer.envMaps.getCurrentId(),
      iblLighting: this._viewer.environmentLightEnabled,
      punctualLighting: this._viewer.punctualLightEnabled,
      tonemap: this._viewer.tonemapEnabled(),
      water: this._viewer.waterEnabled(),
      bloom: this._viewer.bloomEnabled(),
      fxaa: this._viewer.FXAAEnabled(),
      FPS: '',
      oitType: this._oitNames[this._oitTypes.indexOf(this._viewer.getOITType())]
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
    const desc1 = document.createElement('p');
    desc1.style.marginTop = '1.5rem';
    desc1.style.padding = '0.5rem';
    desc1.style.color = '#ffff00';
    desc1.innerText = 'Drag GLTF/GLB/ZIP/Folder to view model';
    const desc2 = document.createElement('p');
    desc2.style.marginBottom = '1rem';
    desc2.style.padding = '0.5rem';
    desc2.style.color = '#ffff00';
    desc2.innerText = 'Drag HDR to change environment';
    this._gui.domElement.append(desc1, desc2);

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

    const oitSettings = this._gui.addFolder('OIT');
    oitSettings.add(this._params, 'oitType', this._oitNames)
    .name('Select OIT type')
    .onChange(value=>{
      const index = this._oitNames.indexOf(value);
      this._viewer.setOITType(this._oitTypes[index]);
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
    ppSettings.add(this._params, 'water')
    .name('Water')
    .onChange(value=>{
      this._viewer.enableWater(value);
    });

    const perfSettings = this._gui.addFolder('Performance');
    perfSettings.add(this._params, 'FPS').name('FPS').disable(true).listen();
    setInterval(() => {
      this._params.FPS = Application.instance.device.frameInfo.FPS.toFixed(2);
    }, 1000);
  }
}
