import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  AssetManager,
  BatchGroup,
  FPSCameraController,
  Compositor,
  Tonemap,
  FXAA,
  DirectionalLight
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const device = myApp.device;

  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'ibl';
  scene.env.light.strength = 1;

  const light = new DirectionalLight(scene);
  light.setColor(Vector4.one());
  light.lookAt(new Vector3(1, 4, -1), new Vector3(0, 0, 0), new Vector3(0, 1, 1));

  // Load mesh
  const assetManager = new AssetManager();
  const batchGroup = new BatchGroup(scene);
  const room = await assetManager.fetchModel(scene, 'assets/models/sitting_room_with_baked_textures.glb');
  room.group.parent = batchGroup;

  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    500
  );
  camera.lookAt(new Vector3(-2, 1, 1), new Vector3(-2, 1, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController();
  camera.HiZ = true;
  camera.SSR = true;
  camera.ssrRoughnessFactor = 0.01;
  camera.ssrBlurScale = 0.06;

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  compositor.appendPostEffect(new FXAA());

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
