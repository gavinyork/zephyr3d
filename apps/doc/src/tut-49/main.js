import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  BatchGroup,
  FPSCameraController,
  DirectionalLight,
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'ibl';
  scene.env.light.strength = 1;

  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(1, 4, -1), new Vector3(0, 0, 0), new Vector3(0, 1, 1));

  // Load mesh
  const batchGroup = new BatchGroup(scene);
  const room = await getEngine().serializationManager.fetchModel(
    'https://cdn.zephyr3d.org/doc/assets/models/sitting_room_with_baked_textures.glb',
    scene
  );
  room.group.parent = batchGroup;

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(-2, 1, 1), new Vector3(-2, 1, 0), Vector3.axisPY());
  scene.mainCamera.controller = new FPSCameraController();
  scene.mainCamera.HiZ = true;
  scene.mainCamera.SSR = true;
  scene.mainCamera.ssrRoughnessFactor = 0.01;
  scene.mainCamera.ssrBlurScale = 0.06;

  scene.mainCamera.FXAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
