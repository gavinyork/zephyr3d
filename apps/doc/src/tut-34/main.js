import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  // Create scene
  const scene = new Scene();

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 0, 1) });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Create a directional light (which automatically sets the sunlight properties)
  const sunLight = new DirectionalLight(scene);
  // Set the direction of sunlight
  sunLight.lookAt(new Vector3(0, 15, -10), new Vector3(0, 0, 0), new Vector3(0, 1, 0));

  // Set the sky rendering mode to Atmospheric Scattering
  scene.env.sky.skyType = 'scatter';
  // Set cloud density
  scene.env.sky.cloudy = 0.5;
  // Set cloud move speed
  scene.env.sky.wind.setXY(600, 0);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
