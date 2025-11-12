import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  const actor = await getEngine().serializationManager.fetchModel(
    'https://cdn.zephyr3d.org/doc/assets/models/CesiumMan.glb',
    scene
  );
  actor.group.scale.setXYZ(10, 10, 10);
  actor.animationSet.playAnimation(actor.animationSet.getAnimationNames()[0]);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 8, 0) });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
