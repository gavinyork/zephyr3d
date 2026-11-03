import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
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

// Volumetric clouds need WebGPU; ?backend=webgl2 or ?backend=webgpu forces a backend.
async function resolveBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'webgl2') {
    return backendWebGL2;
  }
  if (forced === 'webgpu') {
    return backendWebGPU;
  }
  return (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2;
}

const myApp = new Application({
  backend: await resolveBackend(),
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

  // Volumetric cloud layer, distances in metres
  const clouds = scene.env.sky.volumetricCloud;
  clouds.layerBottomAltitude = 5000;
  clouds.layerHeight = 10000;
  clouds.coverage = 0.45;
  clouds.wind.setXY(10, 0);

  // Switch between 2D and volumetric clouds through the UI buttons
  const btn2D = document.querySelector('#btn-2d');
  const btnVolumetric = document.querySelector('#btn-volumetric');
  const webgpu = myApp.device.type === 'webgpu';
  if (!webgpu) {
    btnVolumetric.disabled = true;
    btnVolumetric.title = 'Volumetric clouds require WebGPU';
  }

  function setCloudMode(mode) {
    scene.env.sky.cloudMode = mode;
    const volumetric = scene.env.sky.effectiveCloudMode === 'volumetric';
    btn2D.classList.toggle('active', !volumetric);
    btnVolumetric.classList.toggle('active', volumetric);
    btn2D.setAttribute('aria-pressed', String(!volumetric));
    btnVolumetric.setAttribute('aria-pressed', String(volumetric));
  }

  btn2D.addEventListener('click', () => setCloudMode('procedural'));
  btnVolumetric.addEventListener('click', () => setCloudMode('volumetric'));
  setCloudMode(webgpu ? 'volumetric' : 'procedural');

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
