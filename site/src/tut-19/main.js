import { AABB, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  LambertMaterial,
  Mesh,
  DirectionalLight,
  BoxShape,
  PlaneShape
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
  dirLight.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0, 'ZYX');
  // Enable shadowing
  dirLight.castShadow = true;
  dirLight.shadow.shadowRegion = new AABB(new Vector3(-50, 0, -50), new Vector3(50, 6, 50));

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

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    // light rotation
    dirLight.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');
    camera.updateController();

    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);

    camera.viewport = [0, 0, width, height >> 1];
    dirLight.shadow.shadowMapSize = 1024;
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);

    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    dirLight.shadow.shadowMapSize = 256;
    camera.aspect = camera.viewport[2] / camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
