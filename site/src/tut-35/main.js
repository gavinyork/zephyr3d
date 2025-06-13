import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  DirectionalLight,
  PBRMetallicRoughnessMaterial,
  BoxShape,
  Mesh,
  FPSCameraController
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  // Create scene
  const scene = new Scene();

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    600
  );
  camera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // Create sun light
  const sunLight = new DirectionalLight(scene);
  sunLight.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  sunLight.castShadow = true;
  sunLight.shadow.numShadowCascades = 4;

  // Set the sky rendering mode to Atmospheric Scattering
  scene.env.sky.skyType = 'scatter';
  // Set the fog effect to atmospheric scattering
  scene.env.sky.fogType = 'scatter';

  // Create the ground and some boxes

  const material = new PBRMetallicRoughnessMaterial();
  material.metallic = 0.1;
  material.roughness = 0.6;
  material.albedoColor = new Vector4(0.3, 0.2, 0.2, 1);

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

  // Reset aspect ratio when size was changed
  myApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
