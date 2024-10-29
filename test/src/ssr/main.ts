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
  SphereShape,
  BlinnMaterial,
  createGradientNoiseTexture,
  SceneNode,
  CylinderShape,
  UnlitMaterial
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

  const axisGroup = new SceneNode(scene);

  const primitiveAxis = new CylinderShape({ topRadius: 1, bottomRadius: 1, height: 10, anchor: 0 });
  const primitiveArrow = new CylinderShape({ topRadius: 0, bottomRadius: 2, height: 5, anchor: 0 });
  const materialAxis = new UnlitMaterial();

  const materialAxisX = materialAxis.createInstance();
  materialAxisX.albedoColor = new Vector4(1, 0, 0, 1);
  const axisXMesh = new Mesh(scene, primitiveAxis, materialAxisX);
  const arrowXMesh = new Mesh(scene, primitiveArrow, materialAxisX);
  arrowXMesh.parent = axisXMesh;
  arrowXMesh.position.setXYZ(0, 10, 0);
  axisXMesh.parent = axisGroup;
  axisXMesh.scale.setXYZ(0.1, 1, 0.1);
  axisXMesh.rotation.fromAxisAngle(new Vector3(0, 0, -1), Math.PI * 0.5);

  const materialAxisY = materialAxis.createInstance();
  materialAxisY.albedoColor = new Vector4(0, 1, 0, 1);
  const axisYMesh = new Mesh(scene, primitiveAxis, materialAxisY);
  const arrowYMesh = new Mesh(scene, primitiveArrow, materialAxisY);
  arrowYMesh.parent = axisYMesh;
  arrowYMesh.position.setXYZ(0, 10, 0);
  axisYMesh.parent = axisGroup;
  axisYMesh.scale.setXYZ(0.1, 1, 0.1);

  const materialAxisZ = materialAxis.createInstance();
  materialAxisZ.albedoColor = new Vector4(0, 0, 1, 1);
  const axisZMesh = new Mesh(scene, primitiveAxis, materialAxisZ);
  const arrowZMesh = new Mesh(scene, primitiveArrow, materialAxisZ);
  arrowZMesh.parent = axisZMesh;
  arrowZMesh.position.setXYZ(0, 10, 0);
  axisZMesh.parent = axisGroup;
  axisZMesh.scale.setXYZ(0.1, 1, 0.1);
  axisZMesh.rotation.fromAxisAngle(new Vector3(1, 0, 0), Math.PI * 0.5);

  axisGroup.parent = sphere;

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
