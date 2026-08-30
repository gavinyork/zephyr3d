import { HttpFS, Vector3 } from '@zephyr3d/base';
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
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-14')
  }
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.intensity = 20;
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Loads a model
  getEngine().resourceManager.instantiatePrefab(scene.rootNode, '/assets/DamagedHelmet.zprefab');

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 3), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Toggle Bloom through the UI buttons
  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');

  function setBloom(enabled) {
    scene.mainCamera.bloom = enabled;
    btnOff.classList.toggle('active', !enabled);
    btnOn.classList.toggle('active', enabled);
    btnOff.setAttribute('aria-pressed', String(!enabled));
    btnOn.setAttribute('aria-pressed', String(enabled));
  }

  btnOff.addEventListener('click', () => setBloom(false));
  btnOn.addEventListener('click', () => setBloom(true));
  setBloom(true);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
