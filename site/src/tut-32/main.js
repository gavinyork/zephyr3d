import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Scene, AssetManager, Application, PerspectiveCamera, OrbitCameraController } from '@zephyr3d/scene';

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
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // Load skybox texture
  const assetManager = new AssetManager();
  const skyboxTexture = await assetManager.fetchTexture('assets/images/sky.dds');

  // Set the sky rendering mode to Skybox
  scene.env.sky.skyType = 'skybox';
  // Set skybox texture
  scene.env.sky.skyboxTexture = skyboxTexture;

  // Reset aspect ratio when size was changed
  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
