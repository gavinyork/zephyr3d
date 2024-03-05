import { Matrix4x4, Vector3 } from '@zephyr3d/base';
import { Scene, OrbitCameraController, Application, PerspectiveCamera, AnimationSet, AnimationClip, AssetManager, UserTrack } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  const assetManager = new AssetManager();
  const model = await assetManager.fetchModel(scene, 'assets/models/BoxTextured.glb');
  const animationSet = new AnimationSet(scene);
  const animationClip = new AnimationClip('UV_Opacity');
  animationClip.addTrack(model.group, new UserTrack('linear', 'number', [{
    time: 0,
    value: 0
  }, {
    time: 2,
    value: 1
  }], (node, value) => {
    node.iterate(node => {
      if (node.isMesh()) {
        const material = /** @type {import('@zephyr3d/scene').PBRMetallicRoughnessMaterial} */ (node.material);
        material.albedoTexCoordMatrix = Matrix4x4.translation(new Vector3(value[0], 0, 0));
      }
    });
  }));
  animationClip.addTrack(model.group, new UserTrack('linear', 'number', [{
    time: 0,
    value: 0.9
  }, {
    time: 1,
    value: 0
  }, {
    time: 2,
    value: 0.9
  }], (node, value) => {
    node.iterate(node => {
      if (node.isMesh()) {
        const material = /** @type {import('@zephyr3d/scene').MeshMaterial} */ (node.material);
        material.opacity = value[0];
      }
    });
  }));
  animationSet.add(animationClip);
  animationSet.playAnimation('UV_Opacity', 0);

  // Create camera
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 3, 8), Vector3.zero(), Vector3.axisPY());
  camera.controller = new OrbitCameraController();

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
