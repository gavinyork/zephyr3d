import { AABB, Vector3, Vector4 } from '@zephyr3d/base';

import {
  Scene,
  Application,
  FPSCameraController,
  PerspectiveCamera,
  DirectionalLight,
  LambertMaterial,
  BoxShape,
  Mesh,
  SphereShape,
  BatchGroup,
  Compositor,
  Tonemap,
} from '@zephyr3d/scene';
import type { DeviceBackend } from '@zephyr3d/device';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { PhysicsWorld } from './physics';
import { Panel } from './ui';

const objectCount = 18;

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

function getBackend(): DeviceBackend {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgpu') {
    if (backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  if (type === 'webgl2') {
    if (backendWebGL2.supported()) {
      return backendWebGL2;
    } else {
      console.warn('No WebGL2 support, fall back to WebGL1');
    }
  }
  return backendWebGL1;
}

const PhysicsApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});

PhysicsApp.ready().then(async () => {
  const device = PhysicsApp.device;
  device.setFont('24px arial');

  const scene = new Scene();
  const light = new DirectionalLight(scene)
    .setColor(new Vector4(1, 1, 1, 1))
    .setCastShadow(false);
  light.lookAt(new Vector3(0, 0, 0), new Vector3(0.5, -0.707, -0.5), Vector3.axisPY());
  light.castShadow = true;
  light.shadow.mode = 'pcf-opt';
  light.shadow.pcfKernelSize = 3;
  light.shadow.numShadowCascades = 4;
  light.shadow.shadowRegion = new AABB(new Vector3(-100, -1, -100), new Vector3(100, 50, 100));

  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    200
  );
  camera.lookAt(new Vector3(0, 40, 40), Vector3.zero(), Vector3.axisPY());
  camera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  PhysicsApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  PhysicsApp.on('resize', (ev) => {
    camera.aspect = ev.width / ev.height;
  });
  PhysicsApp.on('tick', () => {
    camera.updateController();
    camera.render(scene, compositor);
  });

  const physicsWorld = new PhysicsWorld();
  await physicsWorld.init();
  const queue: Mesh[] = [];
  const batchGroup = new BatchGroup(scene);
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0.3, 0.2, 0.2, 1);
  const box = new BoxShape({ sizeX: 200, sizeY: 1, sizeZ: 200 });
  const floor = new Mesh(scene, box);
  floor.parent = batchGroup;
  floor.material = floorMaterial;
  physicsWorld.positionMesh(floor, 0, 0, -10, 0);

  const objMaterial = new LambertMaterial();
  const boxShape = new BoxShape({ size: 2 });
  const sphereShape = new SphereShape();
  for (let i = 0; i < objectCount >> 1; i++) {
    let instanceMaterial = objMaterial.createInstance();
    instanceMaterial.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    const box = new Mesh(scene, boxShape, instanceMaterial);
    box.position.setXYZ(0, 50, 0);
    box.parent = batchGroup;
    queue.push(box);
    instanceMaterial = objMaterial.createInstance();
    instanceMaterial.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    const sphere = new Mesh(scene, sphereShape, instanceMaterial);
    sphere.position.setXYZ(0, 50, 0);
    sphere.parent = batchGroup;
    queue.push(sphere);
  }
  physicsWorld.start();

  setInterval(() => {
    const mesh = queue.shift();
    queue.push(mesh);
    physicsWorld.positionMesh(mesh, 1, Math.random() * 8 - 4, 50, Math.random() * 8 - 4);
  }, 50);

  new Panel();
  PhysicsApp.run();
});
