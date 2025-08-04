import { Application, FPSCameraController, PerspectiveCamera, SerializationManager } from '@zephyr3d/scene';
import * as common from '../common';
import { HttpFS } from '@zephyr3d/base';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  const vfs = new HttpFS('http://localhost:8001/dist/assets');
  const manager = new SerializationManager(vfs);
  const scene = await manager.loadScene('/scenes/test.zscn');
  const camera = new PerspectiveCamera(scene);
  camera.controller = new FPSCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));
  myApp.on('tick', function () {
    camera.updateController();
    camera.aspect = myApp.device.getDrawingBufferWidth() / myApp.device.getDrawingBufferHeight();
    camera.render(scene);
  });
  myApp.run();
});
