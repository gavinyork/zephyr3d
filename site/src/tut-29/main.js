import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  PlaneShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  getInput
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.light.strength = 0.4;

  const dirLight = new DirectionalLight(scene);
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  dirLight.castShadow = true;
  dirLight.shadow.mode = 'pcf-opt';

  // Create scene
  const material = new PBRMetallicRoughnessMaterial();
  material.metallic = 0.1;
  material.roughness = 0.9;
  const box = new Mesh(scene, new BoxShape({ size: 10 }), material);
  box.position.setXYZ(16, 5, -12);
  new Mesh(scene, new PlaneShape({ size: 60 }), material);
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.position.setXYZ(0, 3, 0);

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
  camera.SSAOIntensity = 0.05;
  camera.SSAOScale = 15;

  getInput().use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
    // The lower half of the screen uses SAO
    camera.SSAO = true;
    camera.viewport = [0, 0, width, height >> 1];
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);
    // No SAO on the upper half of the screen
    camera.SSAO = false;
    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
