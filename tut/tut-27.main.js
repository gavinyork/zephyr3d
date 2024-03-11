import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, OrbitCameraController, PerspectiveCamera, Compositor, Tonemap, DirectionalLight, AssetManager } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const assetManager = new AssetManager();
  // Load a model
  assetManager.fetchModel(scene, 'assets/models/DamagedHelmet.glb').then(info => {
    info.group.position.setXYZ(0, -0.5, 0);
  });

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 100);
  camera.lookAt(new Vector3(0, 0, 3), Vector3.zero(), new Vector3(0, 1, 0));
  camera.controller = new OrbitCameraController();

  const compositor = new Compositor();
  // Add a Tonemap post-processing effect
  compositor.appendPostEffect(new Tonemap());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', function () {
    camera.updateController();
    const width = myApp.device.deviceToScreen(myApp.device.canvas.width);
    const height = myApp.device.deviceToScreen(myApp.device.canvas.height);
    // The lower half of the screen uses Tonemap
    camera.viewport = [0, 0, width, height >> 1];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene, compositor);
    // No Tonemap on the upper half of the screen 
    camera.viewport = [0, height >> 1, width, height - (height >> 1)];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
