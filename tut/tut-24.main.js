import { HttpFS, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  getInput,
  getEngine,
  DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-24')
  }
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // Load a model with animation
  const model = await getEngine().resourceManager.instantiatePrefab(
    scene.rootNode,
    '/assets/CesiumMan.zprefab'
  );
  model.scale.setXYZ(10, 10, 10);

  // Play the first animation
  model.animationSet.playAnimation(model.animationSet.getAnimationNames()[0], {
    repeat: 0,
    speedRatio: 1,
    fadeIn: 0
  });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 8, 0) });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
