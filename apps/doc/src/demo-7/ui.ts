import { GUI } from 'lil-gui';
import type { Camera } from '@zephyr3d/scene';
import { ABufferOIT, getDevice, WeightedBlendedOIT } from '@zephyr3d/scene';

interface GUIParams {
  deviceType: string;
  FPS: string;
  oitType: string;
}

export class Panel {
  private readonly _deviceList: string[];
  private readonly _oitTypes: string[];
  private readonly _oitNames: string[];
  private readonly _params: GUIParams;
  private readonly _camera: Camera;
  private readonly _gui: GUI;
  constructor(camera: Camera) {
    this._camera = camera;
    this._deviceList = ['WebGL', 'WebGL2', 'WebGPU'];
    this._gui = new GUI({ container: document.body });
    this._oitTypes = ['', WeightedBlendedOIT.type];
    this._oitNames = ['Sort back to front', 'weighted-blended'];
    if (getDevice().type === 'webgpu') {
      this._oitTypes.push(ABufferOIT.type);
      this._oitNames.push('per-pixel linked list');
    }
    this._params = {
      deviceType:
        this._deviceList[this._deviceList.findIndex((val) => val.toLowerCase() === getDevice().type)],
      FPS: '',
      oitType: this._oitNames[this._oitTypes.indexOf(this._camera.oit ? this._camera.oit.getType() : '')]
    };
    this.create();
  }
  create() {
    const systemSettings = this._gui.addFolder('System');
    systemSettings
      .add(this._params, 'deviceType', this._deviceList)
      .name('Select device')
      .onChange((value) => {
        const url = new URL(window.location.href);
        url.searchParams.set('dev', value.toLowerCase());
        window.location.href = url.href;
      });

    const oitSettings = this._gui.addFolder('OIT');
    oitSettings
      .add(this._params, 'oitType', this._oitNames)
      .name('Select OIT type')
      .onChange((value) => {
        this._camera.oit?.dispose();
        this._camera.oit = null;
        const index = this._oitNames.indexOf(value);
        switch (this._oitTypes[index]) {
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
      this._params.FPS = getDevice().frameInfo.FPS.toFixed(2);
    }, 1000);
  }
}
