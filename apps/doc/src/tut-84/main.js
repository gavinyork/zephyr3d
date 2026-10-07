import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  LambertMaterial,
  Mesh,
  RectLight,
  BoxShape,
  PlaneShape,
  UnlitMaterial,
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

  // #region shadow
  // Create a rect light
  const rectLight = new RectLight(scene);
  rectLight.width = 6;
  rectLight.height = 6;
  rectLight.range = 80;
  rectLight.intensity = 30;
  // enable shadowing
  rectLight.castShadow = true;
  // With PCSS the penumbra follows the size of the rectangle
  rectLight.shadow.mode = 'pcss';
  rectLight.shadow.depthBias = 0.003;
  rectLight.shadow.normalBias = 2.5;
  // #endregion shadow

  // The light itself is invisible: a thin unlit panel shows where it is. It
  // must not cast a shadow of its own, or it would block the light.
  const panelMaterial = new UnlitMaterial();
  panelMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  const panel = new Mesh(scene, new BoxShape({ size: 1, sizeY: 1, sizeZ: 0.05 }), panelMaterial);
  panel.castShadow = false;
  panel.parent = rectLight;

  // Create a few pillars of different heights
  const boxMaterial = new LambertMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  for (let i = 0; i < 9; i++) {
    const height = 4 + (i % 3) * 4;
    const box = new Mesh(scene, new BoxShape({ size: 3, sizeY: height, sizeZ: 3 }), boxMaterial);
    box.position.setXYZ(((i % 3) - 1) * 14, height / 2, (Math.floor(i / 3) - 1) * 14);
  }
  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 40, 60), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.TAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Size and filtering mode, from the panel
  const sizeSlider = /** @type {HTMLInputElement} */ (document.querySelector('#size'));
  const sizeValue = document.querySelector('#size-value');
  const modeSelect = /** @type {HTMLSelectElement} */ (document.querySelector('#mode'));
  function applySize() {
    const size = Number(sizeSlider.value);
    rectLight.width = size;
    rectLight.height = size;
    panel.scale.setXYZ(size, size, 1);
    sizeValue.textContent = `${size} m`;
  }
  applySize();
  sizeSlider.addEventListener('input', applySize);
  modeSelect.addEventListener('change', () => {
    rectLight.shadow.mode = /** @type {'hard' | 'pcf' | 'pcss'} */ (modeSelect.value);
  });

  getEngine().setRenderable(scene, 0);

  myApp.on('tick', function () {
    // Sweep back and forth above the pillars, facing down: light travels
    // along the node's -Z axis.
    const x = 12 * Math.sin(myApp.device.frameInfo.elapsedOverall * 0.0004);
    rectLight.lookAt(new Vector3(x, 22, 0), new Vector3(x, 0, 0), Vector3.axisNZ());
  });

  myApp.run();
});
