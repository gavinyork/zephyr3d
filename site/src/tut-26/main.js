import { Interpolator, Matrix4x4, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  AnimationSet,
  AnimationClip,
  AssetManager,
  AnimationTrack
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

class MyAnimationTrack extends AnimationTrack {
  _state;
  constructor(interpolator) {
    super(interpolator);
    this._state = new Float32Array(2);
  }
  calculateState(currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }
  mixState(a, b, t) {
    const result = new Float32Array(2);
    result[0] = a[0] + (b[0] - a[0]) * t;
    result[1] = a[1] + (b[1] - a[1]) * t;
    return result;
  }
  applyState(node, state) {
    node.iterate((node) => {
      if (node.isMesh()) {
        const material = /** @type {import('@zephyr3d/scene').PBRMetallicRoughnessMaterial} */ (
          node.material
        );
        material.albedoTexCoordMatrix = Matrix4x4.translation(new Vector3(state[0], 0, 0));
        material.opacity = state[1];
      }
    });
  }
  getBlendId() {
    return 'uv_and_opacity';
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  const assetManager = new AssetManager();
  const model = await assetManager.fetchModel(scene, 'assets/models/BoxTextured.glb');
  const animationSet = new AnimationSet(scene, model.group);
  const animation = new AnimationClip('UserTrackTest');
  const interpolator = new Interpolator(
    'linear',
    null,
    new Float32Array([0, 1, 2]),
    new Float32Array([0, 0.9, 0.5, 0, 1, 0.9])
  );
  const track = new MyAnimationTrack(interpolator);
  animation.addTrack(model.group, track);
  animationSet.add(animation);
  animationSet.playAnimation('UserTrackTest');

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
