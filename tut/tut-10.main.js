import { HttpFS, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    // When using the editor workflow, the asset path must be correctly configured
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-10')
  }
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Load a model
  getEngine()
    .resourceManager.instantiatePrefab(scene.rootNode, '/assets/Duck.zprefab')
    .then((model) => {
      model.position.setXYZ(0, -0.5, 0);
    });

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 3), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
