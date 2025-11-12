import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  BoxShape,
  LambertMaterial,
  PlaneShape,
  PointLight,
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
  // Turn off environment lighting
  scene.env.light.type = 'none';

  // Create point light
  const light = new PointLight(scene);
  // point light range
  light.range = 30;
  // light color
  light.color = new Vector4(1, 1, 1, 1);

  // Create several boxes
  const boxMaterial = new LambertMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  const boxShape = new BoxShape({ size: 6 });
  for (let i = 0; i < 16; i++) {
    const box = new Mesh(scene, boxShape, boxMaterial);
    box.position.setXYZ(Math.random() * 50 - 25, 3, Math.random() * 50 - 25);
  }
  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);

  // create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 200);
  const eyePos = new Vector3(30, 30, 30);
  scene.mainCamera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.on('tick', function () {
    light.position.setXYZ(20 * Math.cos(Date.now() * 0.001) - 10, 15, 20 * Math.sin(Date.now() * 0.001) - 10);
  });

  myApp.run();
});
