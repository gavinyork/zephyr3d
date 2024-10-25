import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  LambertMaterial,
  Mesh,
  SpotLight,
  BoxShape,
  PlaneShape
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Inspector } from '@zephyr3d/inspector';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});

myApp.ready().then(async function () {
  await imGuiInit(myApp.device);
  const scene = new Scene();

  // Turn off environment lighting
  scene.env.light.type = 'none';

  // Create a spot light
  const spotLight = new SpotLight(scene);
  spotLight.cutoff = Math.PI * 0.2;
  spotLight.range = 200;
  spotLight.position.setXYZ(0, 10, 0);
  spotLight.castShadow = true;

  // Create several boxes
  const boxMaterial = new LambertMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  const boxShape = new BoxShape({ size: 6 });
  for (let i = 0; i < 16; i++) {
    const box = new Mesh(scene, boxShape, boxMaterial);
    box.position.setXYZ(Math.random() * 50 - 25, 3, Math.random() * 50 - 25);
  }
  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);
  floor.position.x = -50;
  floor.position.z = -50;

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

  myApp.inputManager.use(imGuiInjectEvent);
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  const inspector = new Inspector(scene, null, camera);

  myApp.on('tick', function () {
    // light rotation
    spotLight.rotation.fromEulerAngle(-Math.PI / 6, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');

    camera.updateController();
    camera.render(scene);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });

  myApp.run();
});
