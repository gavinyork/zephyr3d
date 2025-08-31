import { AABB, Vector3, Vector4 } from '@zephyr3d/base';
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
  getInput
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
  dirLight.shadow.shadowRegion = new AABB(new Vector3(-50, 0, -50), new Vector3(50, 30, 50));

  // Create a torus
  const material = new LambertMaterial();
  material.albedoColor = new Vector4(1, 1, 0, 1);
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.scale.setXYZ(10, 10, 10);
  torus.position.setXYZ(0, 20, 0);

  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    600
  );
  camera.lookAt(new Vector3(0, 40, 60), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  getInput().use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    // light rotation
    dirLight.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0);
    camera.updateController();

    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);

    camera.viewport = [0, 0, width, height >> 1];
    dirLight.shadow.mode = 'hard';
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);

    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    dirLight.shadow.mode = 'vsm';
    dirLight.shadow.vsmDarkness = 0.3;
    dirLight.shadow.vsmBlurKernelSize = 7;
    dirLight.shadow.vsmBlurRadius = 2;
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
