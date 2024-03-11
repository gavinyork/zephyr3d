import { Vector3 } from '@zephyr3d/base';
import { Scene, OrbitCameraController, AssetManager, Application, PerspectiveCamera } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  const assetManager = new AssetManager();
  const actor = await assetManager.fetchModel(scene, 'assets/models/CesiumMan.glb');
  actor.group.scale.setXYZ(10, 10, 10);
  actor.animationSet.playAnimation(actor.animationSet.getAnimationNames()[0], 0);

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center: new Vector3(0, 8, 0) });

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
