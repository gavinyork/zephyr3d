import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  AssetManager,
  panoramaToCubemap,
  prefilterCubemap,
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
  const scene = new Scene();

  const assetManager = new AssetManager();
  // Load panorama
  assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr').then((tex) => {
    // Generate a cube sky map from the panorama
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
    panoramaToCubemap(/** @type {import('@zephyr3d/device').Texture2D} */ (tex), skyMap);
    // Generate an radiance map from the cube sky map
    const radianceMap = myApp.device.createCubeTexture('rgba16f', 256);
    prefilterCubemap(skyMap, 'ggx', radianceMap);
    // Generate an irradiance map from the cube sky map
    const irradianceMap = myApp.device.createCubeTexture('rgba16f', 64);
    prefilterCubemap(skyMap, 'lambertian', irradianceMap);
    // Set the sky mode to a skybox and set the skybox texture
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;
    scene.env.sky.fogType = 'none';
    // Set the environment lighting mode to IBL and set the radiance map and irradiance map
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = radianceMap;
  });

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  light.color = new Vector4(1, 1, 1, 1);

  // Load a model
  assetManager
    .fetchModel(scene, 'https://cdn.zephyr3d.org/doc/assets/models/DamagedHelmet.glb')
    .then((info) => {
      info.group.scale.setXYZ(10, 10, 10);
    });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  const eyePos = new Vector3(0, 0, 30);
  scene.mainCamera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0, {
    beforeRender: (scene) => {
      const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
      scene.env.light.type = 'ibl';
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
