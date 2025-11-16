import { HttpFS, Interpolator, Matrix4x4, Vector3 } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  AnimationTrack,
  getInput,
  getEngine,
  DirectionalLight
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// Custom animation track for UV animation
class MyAnimationTrack extends AnimationTrack {
  // Track state, a Float32Array of length 1 storing the UV offset
  _state;
  // Interpolator used for keyframe interpolation
  _interpolator;
  constructor(interpolator) {
    super();
    this._interpolator = interpolator;
    this._state = new Float32Array(1);
  }
  // Calculate the track state at the given time
  calculateState(target, currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }
  // If more than one track affects the same node, mix their states
  mixState(a, b, t) {
    const result = new Float32Array(1);
    result[0] = a[0] + (b[0] - a[0]) * t;
    return result;
  }
  // Apply the track state to the target node
  applyState(target, state) {
    target.iterate((node) => {
      if (node.isMesh()) {
        const material = /** @type {import('@zephyr3d/scene').PBRMetallicRoughnessMaterial} */ (
          node.material
        );
        material.albedoTexCoordMatrix = Matrix4x4.translation(new Vector3(state[0], 0, 0));
      }
    });
  }
  // BlendId for this track type, tracks with the same BlendId can be blended together
  getBlendId() {
    return 'uv_animation';
  }
  // Duration of the animation track
  getDuration() {
    return this._interpolator.maxTime;
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    VFS: new HttpFS('https://cdn.zephyr3d.org/doc/tut-26')
  }
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Create directional light
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // Load model
  const model = await getEngine().resourceManager.instantiatePrefab(
    scene.rootNode,
    '/assets/BoxTextured.zprefab'
  );
  // Create an animation
  const animation = model.animationSet.createAnimation('UserTrackTest');
  // Create an interpolator storing keyframes for the custom animation
  const interpolator = new Interpolator('linear', null, new Float32Array([0, 2]), new Float32Array([0, 1]));
  // Create custom track using the keyframe data and add it to the animation
  const track = new MyAnimationTrack(interpolator);
  animation.addTrack(model, track);
  // Start playing the animation
  model.animationSet.playAnimation('UserTrackTest');

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 600);
  scene.mainCamera.lookAt(new Vector3(0, 1, 2), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
