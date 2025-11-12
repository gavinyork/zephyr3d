import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  LambertMaterial,
  SphereShape,
  Mesh,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();

  // Hemisphere lighting
  scene.env.light.type = 'hemisphere';
  scene.env.light.ambientUp = new Vector4(0, 0.4, 1, 1);
  scene.env.light.ambientDown = new Vector4(0.3, 0.2, 0, 1);

  // Create a sphere
  const material = new LambertMaterial();
  new Mesh(scene, new SphereShape(), material);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0, {
    beforeRender: (scene) => {
      const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
      scene.env.light.type = 'hemisphere';
      scene.mainCamera.viewport = [0, 0, width, height >> 1];
    }
  });

  getEngine().setRenderable(scene, 1, {
    beforeRender: (scene) => {
      const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
      scene.env.light.type = 'none';
      scene.mainCamera.viewport = [0, height >> 1, width, height - (height >> 1)];
    }
  });

  myApp.run();
});
