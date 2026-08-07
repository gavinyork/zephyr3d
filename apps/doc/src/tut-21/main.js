import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  LambertMaterial,
  Mesh,
  DirectionalLight,
  PlaneShape,
  TorusShape,
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

  // Create a directional light
  const dirLight = new DirectionalLight(scene);
  // light direction
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  // Enable shadowing
  dirLight.castShadow = true;
  // Depth bias
  dirLight.shadow.depthBias = 0.005;
  // Shadow map size
  dirLight.shadow.shadowMapSize = 256;

  // Create a torus
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 1, 0, 1);
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.scale.setXYZ(10, 10, 10);
  torus.position.setXYZ(0, 20, 0);
  dirLight.shadow.shadowRegion.addStaticCaster(torus);

  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);
  floor.castShadow = false;

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 40, 60), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent.bind(scene.mainCamera));

  let useShadowAA = true;
  const btnNoAA = document.querySelector('#btn-no-aa');
  const btnAA = document.querySelector('#btn-aa');

  function setShadowAA(enabled) {
    useShadowAA = enabled;
    btnNoAA.classList.toggle('active', !enabled);
    btnAA.classList.toggle('active', enabled);
    btnNoAA.setAttribute('aria-pressed', String(!enabled));
    btnAA.setAttribute('aria-pressed', String(enabled));
  }

  btnNoAA.addEventListener('click', () => setShadowAA(false));
  btnAA.addEventListener('click', () => setShadowAA(true));
  setShadowAA(true);

  getEngine().setRenderable(scene, 0, {
    beforeRender(scene) {
      const width = myApp.device.deviceXToScreen(myApp.device.canvas.width);
      const height = myApp.device.deviceYToScreen(myApp.device.canvas.height);
      scene.mainCamera.viewport = [0, 0, width, height];
      dirLight.shadow.mode = useShadowAA ? 'vsm' : 'hard';
      if (useShadowAA) {
        dirLight.shadow.vsmDarkness = 0.1;
        dirLight.shadow.vsmBlurKernelSize = 9;
        dirLight.shadow.vsmBlurRadius = 4;
      }
    }
  });

  myApp.on('tick', function () {
    // light rotation
    dirLight.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0);
  });

  myApp.run();
});
