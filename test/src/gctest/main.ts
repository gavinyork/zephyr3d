import { Application } from '@zephyr3d/scene';
import * as common from '../common';

const myApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  /*
  const manager = new SerializationManager(new AssetRegistry('assets/scenes/test1'));
  await manager.assetRegistry.loadFromURL('assets/scenes/test1/assets/index.json');
  const { scene, meta } = await deserializeSceneFromURL('assets/scenes/test1/scene.json', manager);
  const cameraId: string = meta.activeCamera;
  const camera = scene.findNodeById<PerspectiveCamera>(cameraId) ?? new PerspectiveCamera(scene);
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    camera.aspect = myApp.device.getDrawingBufferWidth() / myApp.device.getDrawingBufferHeight();
    camera.render(scene);
  });
  */
  myApp.run();
});
