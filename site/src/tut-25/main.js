import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  LambertMaterial,
  AnimationSet,
  AnimationClip,
  TranslationTrack,
  BoxShape,
  Mesh,
  EulerRotationTrack
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  const box = new Mesh(scene, new BoxShape(), new LambertMaterial());
  const animationSet = new AnimationSet(scene, box);
  const animationClip = new AnimationClip('move');
  animationClip
    .addTrack(
      box,
      new TranslationTrack('linear', [
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
      new EulerRotationTrack('linear', [
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
  animationSet.add(animationClip);
  animationSet.playAnimation('move');

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

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
