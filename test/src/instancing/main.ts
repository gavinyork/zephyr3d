import {
  Scene,
  Application,
  PerspectiveCamera,
  Compositor,
  BatchGroup,
  DirectionalLight,
  WeightedBlendedOIT,
  ABufferOIT,
  SphereShape,
  UnlitMaterial,
  Mesh,
  FPSCameraController
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
  scene.env.sky.skyType = 'color';
  scene.env.sky.skyColor = new Vector4(0, 0, 1, 1);
  scene.env.sky.fogType = 'none';
  //scene.env.sky.skyType = 'none';
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    10
  );
  camera.position.setXYZ(0, 0, 6);
  camera.controller = new FPSCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;
  camera.enablePicking = true;
  camera.HiZ = true;

  instancingApp.inputManager.use(imGuiInjectEvent);
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  //compositor.appendPostEffect(new Tonemap());
  //compositor.appendPostEffect(new PostWater(0));
  const inspector = new common.Inspector(scene, compositor, camera);

  const batchGroup = new BatchGroup(scene);
  const sphere = new SphereShape();
  const mat = new UnlitMaterial();
  mat.albedoColor = new Vector4(0, 1, 0, 1);
  const mesh = new Mesh(scene, sphere, mat);
  mesh.parent = batchGroup;

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  instancingApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });

  let mouseX = 0;
  let mouseY = 0;
  instancingApp.device.canvas.addEventListener('pointermove', (ev) => {
    mouseX = ev.offsetX;
    mouseY = ev.offsetY;
    camera.pickPosX = mouseX;
    camera.pickPosY = mouseY;
  });

  instancingApp.on('tick', (ev) => {
    camera.updateController();
    camera.viewport = null;
    camera.window = null;
    camera.render(scene, compositor);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  instancingApp.run();
});
