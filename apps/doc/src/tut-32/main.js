import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  AssetManager,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
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

  // Load skybox texture
  const assetManager = new AssetManager();
  /** @type {import('@zephyr3d/device').TextureCube} */
  const skyboxTexture = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/sky.dds');

  // Set the sky rendering mode to Skybox
  scene.env.sky.skyType = 'skybox';
  // Set skybox texture
  scene.env.sky.skyboxTexture = skyboxTexture;
  // Disable height fog
  scene.env.sky.fogType = 'none';

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
