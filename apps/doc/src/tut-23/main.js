import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  DirectionalLight,
  PBRMetallicRoughnessMaterial,
  Mesh,
  Application,
  PerspectiveCamera,
  BoxShape,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  // Turn off environment lighting
  scene.env.light.type = 'none';

  // Create a directional light
  const dirLight = new DirectionalLight(scene);
  // light direction
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  // Enable shadowing
  dirLight.castShadow = true;
  // 4 cascade levels
  dirLight.shadow.numShadowCascades = 4;
  // PCF
  dirLight.shadow.mode = 'pcf-opt';

  // Create the ground and some boxes
  const material = new PBRMetallicRoughnessMaterial();
  material.metallic = 0.1;
  material.roughness = 0.6;

  const box = new BoxShape();
  const floor = new Mesh(scene, box);
  floor.scale.setXYZ(2000, 10, 2000);
  floor.position.setXYZ(0, -5, 0);
  floor.material = material;

  for (let i = -40; i <= 40; i++) {
    const box1 = new Mesh(scene, box);
    box1.scale.setXYZ(3, 30, 3);
    box1.position.setXYZ(-20, 0, i * 10);
    box1.material = material;
    const box2 = new Mesh(scene, box);
    box2.scale.setXYZ(3, 30, 3);
    box2.position.setXYZ(20, 0, i * 10);
    box2.material = material;
  }

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 8, 0) });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.on('tick', () => {
    // light rotation
    dirLight.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0);
  });

  myApp.run();
});
