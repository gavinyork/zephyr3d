import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  LambertMaterial,
  NodeTranslationTrack,
  BoxShape,
  Mesh,
  NodeEulerRotationTrack,
  getInput,
  getEngine,
  DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // Create a box mesh and add animation
  const box = new Mesh(scene, new BoxShape(), new LambertMaterial());
  const clip = box.animationSet.createAnimation('animation');
  clip
    .addTrack(
      box,
      new NodeTranslationTrack('linear', [
        {
          time: 0,
          value: new Vector3(0, 0, 0)
        },
        {
          time: 1,
          value: new Vector3(0, 3, 0)
        },
        {
          time: 2,
          value: new Vector3(0, 0, 0)
        }
      ])
    )
    .addTrack(
      box,
      new NodeEulerRotationTrack('linear', [
        {
          time: 0,
          value: new Vector3(0, 0, 0)
        },
        {
          time: 2,
          value: new Vector3(0, 8 * Math.PI, 0)
        }
      ])
    );
  box.animationSet.playAnimation('animation');

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 3, 8), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
