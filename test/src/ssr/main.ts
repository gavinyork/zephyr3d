import {
  Scene,
  Application,
  PerspectiveCamera,
  Compositor,
  BatchGroup,
  DirectionalLight,
  WeightedBlendedOIT,
  ABufferOIT,
  Mesh,
  FPSCameraController,
  Tonemap,
  PBRMetallicRoughnessMaterial,
  BoxShape
} from '@zephyr3d/scene';
import * as common from '../common';
import { Inspector } from '@zephyr3d/inspector';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Vector3, Vector4 } from '@zephyr3d/base';

const ssrApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});

ssrApp.ready().then(async () => {
  const device = ssrApp.device;
  await imGuiInit(device);
  const scene = new Scene();
  scene.env.sky.skyType = 'color';
  scene.env.sky.skyColor = new Vector4(0, 0, 1, 1);
  scene.env.sky.fogType = 'none';
  scene.env.sky.skyType = 'scatter';
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    300
  );
  camera.position.setXYZ(0, 0, 6);
  camera.controller = new FPSCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;
  camera.enablePicking = true;
  camera.HiZ = true;

  ssrApp.inputManager.use(imGuiInjectEvent);
  ssrApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  const inspector = new Inspector(scene, compositor, camera);

  const batchGroup = new BatchGroup(scene);
  const mat1 = new PBRMetallicRoughnessMaterial();
  mat1.albedoColor = new Vector4(0.8, 0.8, 0.6, 1);
  mat1.metallic = 0.8;
  mat1.roughness = 0.3;
  const boxShape1 = new BoxShape({ sizeX: 300, sizeY: 1, sizeZ: 300 });
  const floor = new Mesh(scene, boxShape1, mat1);
  floor.position.setXYZ(-150, 0, -150);
  floor.parent = batchGroup;

  const mat2 = new PBRMetallicRoughnessMaterial();
  mat2.albedoColor = new Vector4(0.8, 0, 0, 1);
  mat2.metallic = 0.1;
  mat2.roughness = 0.3;
  const boxShape2 = new BoxShape({ sizeX: 1, sizeY: 100, sizeZ: 300 });
  const wall = new Mesh(scene, boxShape2, mat2);
  wall.position.setXYZ(0, 0, -150);
  wall.parent = batchGroup;

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  ssrApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });

  let mouseX = 0;
  let mouseY = 0;
  ssrApp.device.canvas.addEventListener('pointermove', (ev) => {
    mouseX = ev.offsetX;
    mouseY = ev.offsetY;
    camera.pickPosX = mouseX;
    camera.pickPosY = mouseY;
  });

  ssrApp.on('tick', (ev) => {
    camera.updateController();
    camera.render(scene, compositor);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  ssrApp.run();
});
