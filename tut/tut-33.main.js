import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  AssetManager,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
  panoramaToCubemap,
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

  const assetManager = new AssetManager();
  // Load panorama
  /** @type {import('@zephyr3d/device').Texture2D} */
  const panorama = await assetManager.fetchTexture(
    'https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr'
  );
  // Create the skybox cubemap
  const skyboxTexture = myApp.device.createCubeTexture('rgba16f', 512);
  // Call the built-in panoramaToCubemap method to render the panorama into the skybox texture
  await panoramaToCubemap(panorama, skyboxTexture);

  // Set the sky rendering mode to Skybox
  scene.env.sky.skyType = 'skybox';
  // Set the skybox texture
  scene.env.sky.skyboxTexture = skyboxTexture;
  // Disable height fog
  scene.env.sky.fogType = 'none';

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
