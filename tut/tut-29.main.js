import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Mesh, DirectionalLight, BoxShape, PlaneShape, TorusShape, PBRMetallicRoughnessMaterial, Tonemap, SAO } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.light.strength = 0.4;

  const dirLight = new DirectionalLight(scene);
  dirLight.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
  dirLight.castShadow = true;
  dirLight.shadow.mode = 'pcf-opt';

  // Create scene
  const material = new PBRMetallicRoughnessMaterial();
  material.metallic = 0.1;
  material.roughness = 0.9;
  const box = new Mesh(scene, new BoxShape({ size: 10 }), material);
  box.position.setXYZ(16, 5, -12);
  const floor = new Mesh(scene, new PlaneShape({ size: 60 }), material);
  floor.position.x = -30;
  floor.position.z = -30;
  const torus = new Mesh(scene, new TorusShape(), material);
  torus.position.setXYZ(0, 3, 0);

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());
  const sao = new SAO();
  sao.intensity = 0.05;
  sao.scale = 15;

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 40, 60), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
    // The lower half of the screen uses SAO
    compositor.appendPostEffect(sao);
    camera.viewport = [0, 0, width, height >> 1];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
    // No SAO on the upper half of the screen
    compositor.removePostEffect(sao);
    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
  });

  myApp.run();
});
