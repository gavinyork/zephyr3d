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
  getInput
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  const box = new Mesh(scene, new BoxShape(), new LambertMaterial());
  const animationClip = box.animationSet.createAnimation('move');
  animationClip
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
  box.animationSet.playAnimation('move');

  // Create camera
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    myApp.device.canvas.width / myApp.device.canvas.height,
    1,
    600
  );
  camera.lookAt(new Vector3(0, 3, 8), Vector3.zero(), Vector3.axisPY());
  camera.controller = new OrbitCameraController();

  getInput().use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
