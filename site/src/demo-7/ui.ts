import { GUI } from 'lil-gui';
import { ABufferOIT, Application, Camera, WeightedBlendedOIT } from '@zephyr3d/scene';

interface GUIParams {
  deviceType: string;
  FPS: string;
  oitType: string;
}

export class Panel {
  private _deviceList: string[];
  private _oitTypes: string[];
  private _oitNames: string[];
  private _params: GUIParams;
  private _camera: Camera;
  private _gui: GUI;
  constructor(camera: Camera){
    this._camera = camera;
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._gui = new GUI({ container: document.body });
    this._oitTypes = ['', WeightedBlendedOIT.type];
    this._oitNames = ['Sort back to front', 'weighted-blended'];
    if (Application.instance.device.type === 'webgpu') {
      this._oitTypes.push(ABufferOIT.type);
      this._oitNames.push('per-pixel linked list');
    }
    this._params = {
      deviceType: this._deviceList[this._deviceList.findIndex(val => val.toLowerCase() === Application.instance.device.type)],
      FPS: '',
      oitType: this._oitNames[this._oitTypes.indexOf(this._camera.oit ? this._camera.oit.getType() : '')]
    };
    this.create();
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

    const oitSettings = this._gui.addFolder('OIT');
    oitSettings.add(this._params, 'oitType', this._oitNames)
    .name('Select OIT type')
    .onChange(value=>{
      this._camera.oit?.dispose();
      this._camera.oit = null;
      const index = this._oitNames.indexOf(value);
      switch(this._oitTypes[index]) {
        case ABufferOIT.type:
          this._camera.oit = new ABufferOIT();
          break;
        case WeightedBlendedOIT.type:
          this._camera.oit = new WeightedBlendedOIT();
          break;
      }
    });
    const perfSettings = this._gui.addFolder('Performance');
    perfSettings.add(this._params, 'FPS').name('FPS').disable(true).listen();
    setInterval(() => {
      this._params.FPS = Application.instance.device.frameInfo.FPS.toFixed(2);
    }, 1000);
  }
}
