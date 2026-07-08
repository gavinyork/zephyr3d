import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  LambertMaterial,
  Mesh,
  DirectionalLight,
  BoxShape,
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

  // Turn off environment lighting.
  scene.env.light.type = 'none';

  // Create a directional light.
  const dirLight = new DirectionalLight(scene);
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  dirLight.castShadow = true;
  dirLight.shadow.depthBias = 0.005;
  dirLight.shadow.shadowMapSize = 1024;

  // PCSS settings: larger light radius makes distant penumbrae visibly softer.
  dirLight.shadow.pcssLightRadius = 8;
  dirLight.shadow.pcssBlockerSampleCount = 64;
  dirLight.shadow.pcssFilterSampleCount = 64;
  dirLight.shadow.pcssMaxFilterRadius = 64;
  dirLight.shadow.pcssTemporalJitter = true;

  const casterMaterial = new LambertMaterial();
  casterMaterial.albedoColor = new Vector4(1, 0.9, 0.15, 1);

  const contactBox = new Mesh(
    scene,
    new BoxShape({ sizeX: 2, sizeY: 32, sizeZ: 2, anchorX: 0.5, anchorY: 0, anchorZ: 0.5 }),
    casterMaterial
  );
  contactBox.position.setXYZ(-16, 0, 0);
  dirLight.shadow.shadowRegion.addStaticCaster(contactBox);

  const torus = new Mesh(scene, new TorusShape(), casterMaterial);
  torus.scale.setXYZ(8, 8, 8);
  torus.position.setXYZ(20, 24, 10);
  dirLight.shadow.shadowRegion.addStaticCaster(torus);

  // Create floor.
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 120 }), floorMaterial);
  floor.castShadow = false;

  // Create camera.
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 45, 75), new Vector3(0, 6, 0), new Vector3(0, 1, 0));
  scene.mainCamera.TAA = true;
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 6, 0) });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

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
      dirLight.shadow.mode = useShadowAA ? 'pcss' : 'hard';
      dirLight.shadow.pcssTemporalJitter = useShadowAA;
      scene.mainCamera.TAA = useShadowAA;
    }
  });

  myApp.on('tick', function () {
    dirLight.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0);
  });

  myApp.run();
});
