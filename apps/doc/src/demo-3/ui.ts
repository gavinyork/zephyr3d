import { GUI } from 'lil-gui';
import { getDevice } from '@zephyr3d/scene';

interface GUIParams {
  deviceType: string;
}

export class Panel {
  private readonly _deviceList: string[];
  private readonly _params: GUIParams;
  private _shown: boolean;
  private readonly _gui: GUI;
  constructor() {
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._params = {
      deviceType:
        this._deviceList[this._deviceList.findIndex((val) => val.toLowerCase() === getDevice().type)]
    };
    this._gui = new GUI({ container: document.body });
    this._shown = true;
    this.create();
  }
  toggle() {
    this._shown = !this._shown;
    this._gui.show(this._shown);
  }
  create() {
    const desc1 = document.createElement('p');
    desc1.style.marginTop = '1.5rem';
    desc1.style.padding = '0.5rem';
    desc1.style.color = '#ffff00';
    desc1.innerText = 'Rotate with left mouse button.';
    const desc2 = document.createElement('p');
    desc2.style.marginBottom = '1rem';
    desc2.style.padding = '0.5rem';
    desc2.style.color = '#ffff00';
    desc2.innerText = 'Move with right mouse button.';
    this._gui.domElement.append(desc1, desc2);
    const systemSettings = this._gui.addFolder('System');
    systemSettings
      .add(this._params, 'deviceType', this._deviceList)
      .name('Select device')
      .onChange((value) => {
        const url = new URL(window.location.href);
        url.searchParams.set('dev', value.toLowerCase());
        window.location.href = url.href;
      });
  }
}
