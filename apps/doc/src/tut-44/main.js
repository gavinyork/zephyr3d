import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
  Mesh,
  DirectionalLight,
  BoxShape,
  LambertMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  // Create box shape
  const boxShape = new BoxShape();
  const material = new LambertMaterial();
  for (let i = -40; i <= 40; i += 4) {
    for (let j = -40; j <= 40; j += 4) {
      const mesh = new Mesh(scene);
      const instanceMaterial = material.createInstance();
      instanceMaterial.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
      // Use same primitive
      mesh.primitive = boxShape;
      // Instance of same material
      mesh.material = instanceMaterial;
      // Set instance position
      mesh.position.setXYZ(i, j, 0);
    }
  }

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 0, 60), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
