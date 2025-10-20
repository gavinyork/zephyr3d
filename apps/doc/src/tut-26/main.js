import { Interpolator, Matrix4x4, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  AnimationTrack,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

class MyAnimationTrack extends AnimationTrack {
  _state;
  _interpolator;
  constructor(interpolator) {
    super();
    this._interpolator = interpolator;
    this._state = new Float32Array(2);
  }
  calculateState(target, currentTime) {
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
  getDuration() {
    return this._interpolator.maxTime;
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  const model = await getEngine().serializationManager.fetchModel(
    'https://cdn.zephyr3d.org/doc/assets/models/BoxTextured.glb',
    scene
  );
  const animation = model.group.animationSet.createAnimation('UserTrackTest');
  const interpolator = new Interpolator(
    'linear',
    null,
    new Float32Array([0, 1, 2]),
    new Float32Array([0, 0.9, 0.5, 0, 1, 0.9])
  );
  const track = new MyAnimationTrack(interpolator);
  animation.addTrack(model.group, track);
  model.group.animationSet.playAnimation('UserTrackTest');

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
