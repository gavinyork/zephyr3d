import type { PerspectiveCamera } from '@zephyr3d/scene';
import { Application, AssetRegistry, deserializeSceneFromURL, OrbitCameraController } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  const assetRegistry = new AssetRegistry('assets/scenes/test1');
  await assetRegistry.loadFromURL('assets/scenes/test1/assets/index.json');
  const { scene, meta } = await deserializeSceneFromURL('assets/scenes/test1/scene.json', assetRegistry);
  const cameraId: string = meta.activeCamera;
  const camera = scene.findNodeById<PerspectiveCamera>(cameraId);
  camera.controller = new OrbitCameraController();
  if (!camera) {
    throw new Error('Active camera not found');
  }
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    camera.aspect = myApp.device.getDrawingBufferWidth() / myApp.device.getDrawingBufferHeight();
    camera.render(scene);
  });
  myApp.run();
});
