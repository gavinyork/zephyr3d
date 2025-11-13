import type { PerspectiveCamera } from '@zephyr3d/scene';
import { Application, FPSCameraController, getInput, ResourceManager } from '@zephyr3d/scene';
import * as common from '../common';
import { HttpFS } from '@zephyr3d/base';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  const vfs = new HttpFS('http://localhost:8001/dist/assets');
  const manager = new ResourceManager(vfs);
  const scene = await manager.loadScene('/scenes/test.scn');
  scene.mainCamera.controller = new FPSCameraController();
  getInput().use(scene.mainCamera.handleEvent.bind(scene.mainCamera));
  myApp.on('tick', function () {
    scene.mainCamera.updateController();
    (scene.mainCamera as PerspectiveCamera).aspect =
      myApp.device.getDrawingBufferWidth() / myApp.device.getDrawingBufferHeight();
    scene.render();
  });
  myApp.run();
});
