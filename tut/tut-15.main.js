import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, LambertMaterial, SphereShape, Mesh } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();

  // Hemisphere lighting
  scene.env.light.type = 'hemisphere';
  scene.env.light.ambientUp = new Vector4(0, 0.4, 1, 1);
  scene.env.light.ambientDown = new Vector4(0.3, 0.2, 0, 1);

  // Create a sphere
  const material = new LambertMaterial();
  new Mesh(scene, new SphereShape(), material);

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 0, 4), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController({ distance: 4 });

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);

    // The lower half of the screen has ambient light
    scene.env.light.type = 'hemisphere';
    camera.viewport = [0, 0, width, height >> 1];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
    // No ambient light on the upper half of the screen
    scene.env.light.type = 'none';
    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
  });

  myApp.run();
});
