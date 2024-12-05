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
  BoxShape,
  BlinnMaterial,
  createGradientNoiseTexture
} from '@zephyr3d/scene';
import * as common from '../common';
import { Inspector } from '@zephyr3d/inspector';
import { imGuiInit } from '@zephyr3d/imgui';
import { Vector3, Vector4 } from '@zephyr3d/base';

const ssrApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});

ssrApp.ready().then(async () => {
  const device = ssrApp.device;
  const noiseTex = createGradientNoiseTexture(device, 128, 50, false);
  noiseTex.name = 'GradientNoiseTexture';
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
  camera.lookAt(new Vector3(2, 8, 2), new Vector3(0, 6, 0), new Vector3(0, 1, 0));
  camera.controller = new FPSCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;
  camera.enablePicking = true;

  const batchGroup = new BatchGroup(scene);
  const mat1 = new BlinnMaterial();
  mat1.albedoColor = new Vector4(0.8, 0.8, 0.6, 1);
  mat1.shininess = 256;
  const boxShape1 = new BoxShape({ sizeX: 50, sizeY: 1, sizeZ: 50 });
  const floor = new Mesh(scene, boxShape1, mat1);
  //floor.position.setXYZ(-50, 0, -50);
  floor.parent = batchGroup;

  const mat3 = new BlinnMaterial();
  mat3.albedoColor = new Vector4(1, 1, 0, 1);
  mat3.shininess = 5;

  const boxShape = new BoxShape({ size: 8 });
  const box = new Mesh(scene, boxShape, mat3);
  box.position.setXYZ(0, 6, 0);
  box.parent = batchGroup;

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const inspector = new Inspector(scene, compositor, camera);

  ssrApp.inputManager.use(inspector.handleEvent.bind(inspector));
  ssrApp.inputManager.use(camera.handleEvent.bind(camera));

  ssrApp.on('resize', (width, height) => {
    camera.setPerspective(camera.getFOV(), width / height, camera.getNearPlane(), camera.getFarPlane());
  });

  ssrApp.device.canvas.addEventListener('pointermove', (ev) => {
    camera.pickPosX = ev.offsetX;
    camera.pickPosY = ev.offsetY;
  });

  ssrApp.on('tick', () => {
    camera.updateController();
    camera.render(scene, compositor);
    inspector.render();
    camera.pickResultAsync.then((pickResult) => {
      if (pickResult?.target?.node?.isMesh()) {
        console.log(`Mesh ${pickResult.target.node.name ?? '???'} picked`);
      }
    });
  });
  ssrApp.run();
});
