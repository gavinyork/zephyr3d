import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, Mesh, BoxShape, LambertMaterial, PlaneShape, SpotLight } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  // Turn off environment lighting
  scene.env.light.type = 'none';

  // Create spot light
  const light = new SpotLight(scene);
  // light color
  light.color = new Vector4(1, 1, 1, 1);
  // light cutoff angle
  light.cutoff = Math.PI * 0.2;
  // light range
  light.range = 200;
  // light position
  light.position.setXYZ(0, 10, 0);

  // Create several boxes
  const boxMaterial = new LambertMaterial();
  boxMaterial.albedoColor = new Vector4(1, 1, 0, 1);
  const boxShape = new BoxShape({ size: 6 });
  for (let i = 0; i < 16; i++) {
    const box = new Mesh(scene, boxShape, boxMaterial);
    box.position.setXYZ(Math.random() * 50 - 25, 0, Math.random() * 50 - 25);
  }
  // Create floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0, 1, 1, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 200 }), floorMaterial);
  floor.position.x = -100;
  floor.position.z = -100;

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  const eyePos = new Vector3(30, 30, 30);
  camera.lookAt(eyePos, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: eyePos.magnitude });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    light.rotation.fromEulerAngle(-Math.PI/6, myApp.device.frameInfo.elapsedOverall * 0.0005, 0, 'ZYX');
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
