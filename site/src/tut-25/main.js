import { InterpolationMode, Quaternion, Vector3 } from '@zephyr3d/base';
import { Scene, OrbitCameraController, Application, PerspectiveCamera, LambertMaterial, AnimationSet, AnimationClip, TranslationTrack, BoxShape, Mesh, RotationTrack, Quadtree, EulerRotationTrack } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  const box = new Mesh(scene, new BoxShape({ anchorX: 0.5, anchorY: 0.5, anchorZ: 0.5 }), new LambertMaterial())
  const animationSet = new AnimationSet(scene);
  const animationClip = new AnimationClip('move');
  animationClip.addTrack(box, new TranslationTrack('linear', [{
    time: 0,
    value: new Vector3(0, 0, 0)
  }, {
    time: 1,
    value: new Vector3(0, 3, 0)
  }, {
    time: 2,
    value: new Vector3(0, 0, 0)
  }])).addTrack(box, new EulerRotationTrack('linear', [{
    time: 0,
    value: new Vector3(0, 0, 0, 'ZYX')
  }, {
    time: 2,
    value: new Vector3(0, 8 * Math.PI, 0, 'ZYX')
  }]));
  animationSet.add(animationClip);
  animationSet.playAnimation('move', 0);

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 3, 8), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ distance: camera.getWorldPosition().magnitude });

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
