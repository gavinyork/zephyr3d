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

  // Toggle Ambient through the UI buttons
  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');

  function setAmbient(enabled) {
    scene.env.light.type = enabled ? 'hemisphere' : 'none';
    btnOff.classList.toggle('active', !enabled);
    btnOn.classList.toggle('active', enabled);
    btnOff.setAttribute('aria-pressed', String(!enabled));
    btnOn.setAttribute('aria-pressed', String(enabled));
  }

  btnOff.addEventListener('click', () => setAmbient(false));
  btnOn.addEventListener('click', () => setAmbient(true));
  setAmbient(true);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
