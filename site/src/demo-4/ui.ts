import { GUI } from 'lil-gui';
import { Application } from "@zephyr3d/scene";

interface GUIParams {
  deviceType: string;
  FPS: string;
}

export class Panel {
  private _deviceList: string[];
  private _params: GUIParams;
  private _gui: GUI;
  constructor(){
    this._deviceList = ['WebGL2', 'WebGPU'];
    this._params = {
      deviceType: this._deviceList[this._deviceList.findIndex(val => val.toLowerCase() === Application.instance.device.type)],
      FPS: ''
    };
    this._gui = new GUI({ container: document.body });
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
    const stats = this._gui.addFolder('Stats');
    stats.add(this._params, 'FPS').name('FPS').disable(true).listen();
    setInterval(() => {
      this._params.FPS = Application.instance.device.frameInfo.FPS.toFixed(2);
    }, 1000);
  }
}
