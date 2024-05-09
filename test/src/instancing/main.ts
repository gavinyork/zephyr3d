import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup,
  DirectionalLight,
  BoxShape,
  LambertMaterial,
  Mesh,
  WeightedBlendedOIT,
  ABufferOIT,
  AssetManager
} from '@zephyr3d/scene';
import * as common from '../common';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Vector3, Vector4 } from '@zephyr3d/base';

const instancingApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});

instancingApp.ready().then(async () => {
  const device = instancingApp.device;
  await imGuiInit(device);
  const scene = new Scene();
  scene.env.sky.fogType = 'none';
  //scene.env.sky.skyType = 'none';
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(0, 0, 6);
  camera.controller = new OrbitCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;

  instancingApp.inputManager.use(imGuiInjectEvent);
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));
  const inspector = new common.Inspector(scene, null, camera);

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const assetManager = new AssetManager();
  assetManager.fetchModel(scene, 'assets/SimpleMorph.gltf', { enableInstancing: false }).then((info) => {
    info.group.parent = batchGroup;
  });
  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  instancingApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });

  instancingApp.on('tick', (ev) => {
    camera.updateController();
    camera.render(scene);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  instancingApp.run();
});
