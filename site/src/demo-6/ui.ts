import { GUI } from 'lil-gui';
import { Application, Camera } from "@zephyr3d/scene";

interface GUIParams {
  numInstances: number;
  deviceType: string;
  commandBufferReuse: boolean;
  FPS: string;
  add: () => void;
  remove: () => void;
}

export class Panel {
  private _params: GUIParams;
  private _camera: Camera;
  private _gui: GUI;
  constructor(instanceCount: number, camera: Camera, addFunc: () => number, removeFunc: () => number){
    this._camera = camera;
    this._params = {
      numInstances: instanceCount,
      deviceType: Application.instance.device.type,
      commandBufferReuse: this._camera.commandBufferReuse,
      FPS: '',
      add() {
        this.numInstances = addFunc();
      },
      remove() {
        this.numInstances = removeFunc();
      }
    };
    this._gui = new GUI({ container: document.body });
    this.create();
  }
  create(){
    const desc1 = document.createElement('p');
    desc1.style.marginTop = '1.5rem';
    desc1.style.padding = '0.5rem';
    desc1.style.color = '#ffff00';
    desc1.innerText = 'The models are rendered without the use of geometry instancing.';
    const desc2 = document.createElement('p');
    desc2.style.marginBottom = '1rem';
    desc2.style.padding = '0.5rem';
    desc2.style.color = '#ffff00';
    desc2.innerText = 'The command buffer reuse optimization is only valid when used with a WebGPU device.';
    this._gui.domElement.append(desc1, desc2);
    
    const stats = this._gui.addFolder('Stats');
    stats.add(this._params, 'commandBufferReuse').name('Reuse commandbuffer').onChange(value=>{
      this._camera.commandBufferReuse = value;
    });
    stats.add(this._params, 'deviceType').name('Device').disable(true);
    stats.add(this._params, 'numInstances').name('Instance count').disable(true).listen();
    stats.add(this._params, 'add').name('Add 500 instances');
    stats.add(this._params, 'remove').name('Remove 500 instances');
    stats.add(this._params, 'FPS').name('FPS').disable(true).listen();
    setInterval(() => {
      this._params.FPS = Application.instance.device.frameInfo.FPS.toFixed(2);
    }, 1000);
  }
}
