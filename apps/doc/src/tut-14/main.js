import { HttpFS, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  panoramaToCubemap,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-14')
  }
});

myApp.ready().then(function () {
  const scene = new Scene();

  // Load panorama
  getEngine()
    .resourceManager.fetchTexture('/assets/Wide_Street.hdr')
    .then((tex) => {
      // Generate a cube sky map from the panorama
      const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
      panoramaToCubemap(/** @type {import('@zephyr3d/device').Texture2D} */ (tex), skyMap);
      // Set the sky mode to a skybox and set the skybox texture
      scene.env.sky.skyType = 'skybox';
      scene.env.sky.skyboxTexture = skyMap;
      // Turn off fog
      scene.env.sky.fogType = 'none';
    });

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  light.color = new Vector4(1, 1, 1, 1);

  // Load a model
  getEngine()
    .resourceManager.instantiatePrefab(scene.rootNode, '/assets/DamagedHelmet.zprefab')
    .then((model) => {
      model.scale.setXYZ(10, 10, 10);
    });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  const eyePos = new Vector3(0, 0, 30);
  scene.mainCamera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Toggle IBL through the UI buttons
  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');

  function setIBL(enabled) {
    scene.env.light.type = enabled ? 'ibl' : 'none';
    btnOff.classList.toggle('active', !enabled);
    btnOn.classList.toggle('active', enabled);
    btnOff.setAttribute('aria-pressed', String(!enabled));
    btnOn.setAttribute('aria-pressed', String(enabled));
  }

  btnOff.addEventListener('click', () => setIBL(false));
  btnOn.addEventListener('click', () => setIBL(true));
  setIBL(true);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
