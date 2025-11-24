import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  SphereShape,
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
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Create a lambert material
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 0, 0, 1);
  // Create a sphere mesh
  new Mesh(scene, new SphereShape(), material);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
