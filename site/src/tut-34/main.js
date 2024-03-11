import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, OrbitCameraController, DirectionalLight, Compositor, Tonemap } from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});


myApp.ready().then(async() => {
  const device = myApp.device;

  // Create scene
  const scene = new Scene();

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, device.canvas.width / device.canvas.height, 1, 500);
  camera.controller = new OrbitCameraController({ center: new Vector3(0, 0, 1) });
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // Create a directional light (which automatically sets the sunlight properties)
  const sunLight = new DirectionalLight(scene);
  // Set the direction of sunlight
  sunLight.lookAt(new Vector3(0, 15, -10), new Vector3(0, 0, 0), new Vector3(0, 1, 0));

  // Set the sky rendering mode to Atmospheric Scattering
  scene.env.sky.skyType = 'scatter';
  // Set cloud density
  scene.env.sky.cloudy = 0.7;
  // Set cloud move speed
  scene.env.sky.wind.setXY(600, 0);

  // Added a Tonemap post-processing effect
  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  // Reset aspect ratio when size was changed
  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
