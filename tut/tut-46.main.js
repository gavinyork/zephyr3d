import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
  Mesh,
  DirectionalLight,
  BoxShape,
  LambertMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const boxShape = new BoxShape();
  const material = new LambertMaterial();
  new Mesh(scene, boxShape, material);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  getEngine().setRenderable(scene, 1, {
    beforeRender(scene) {
      scene.mainCamera.viewport = [30, 30, 200, 160];
    },
    afterRender(scene) {
      scene.mainCamera.viewport = null;
    }
  });

  myApp.run();
});
