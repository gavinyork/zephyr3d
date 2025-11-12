import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.intensity = 20;
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Loads a model
  getEngine()
    .serializationManager.fetchModel('https://cdn.zephyr3d.org/doc/assets/models/DamagedHelmet.glb', scene)
    .then((info) => {
      info.group.position.setXYZ(0, -0.5, 0);
    });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 3), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0, {
    beforeRender(scene) {
      const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
      // The lower half of the screen uses Bloom
      scene.mainCamera.viewport = [0, 0, width, height >> 1];
      scene.mainCamera.bloom = true;
    }
  });

  getEngine().setRenderable(scene, 1, {
    beforeRender(scene) {
      const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
      scene.mainCamera.viewport = [0, height >> 1, width, height - (height >> 1)];
      scene.mainCamera.bloom = false;
    }
  });

  myApp.run();
});
