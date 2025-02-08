import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  DirectionalLight,
  Mesh,
  BoxShape,
  LambertMaterial,
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

  // Create directional light
  const light = new DirectionalLight(scene);
  // light direction
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  // light color
  light.color = new Vector4(1, 1, 1, 1);

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

  // create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    200
  );
  const eyePos = new Vector3(30, 30, 30);
  camera.lookAt(eyePos, Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    light.rotation.fromEulerAngle(-Math.PI / 4, myApp.device.frameInfo.elapsedOverall * 0.0005, 0);
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
