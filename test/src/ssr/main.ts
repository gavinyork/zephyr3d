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
  BoxShape,
  SphereShape,
  BlinnMaterial
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
  camera.lookAt(new Vector3(0, 6, 20), new Vector3(0, 6, 0), new Vector3(0, 1, 0));
  camera.controller = new FPSCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;
  camera.enablePicking = true;

  ssrApp.inputManager.use(imGuiInjectEvent);
  ssrApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  const inspector = new Inspector(scene, compositor, camera);

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

  const sphereShape = new SphereShape({ radius: 4 });
  const sphere = new Mesh(scene, sphereShape, mat3);
  sphere.position.setXYZ(0, 6, 0);
  sphere.parent = batchGroup;

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  ssrApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
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
