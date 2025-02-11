import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import {
  Scene,
  OrbitCameraController,
  DirectionalLight,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup,
  LambertMaterial,
  BoxShape,
  Mesh,
  ABufferOIT,
  WeightedBlendedOIT
} from '@zephyr3d/scene';
import { Panel } from './ui';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

function getBackend(): DeviceBackend {
  const type = getQueryString('dev');
  if (type === 'webgpu') {
    if (backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  return backendWebGL2.supported() ? backendWebGL2 : backendWebGL1;
}

const showUI = !!getQueryString('ui');
const app = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas')
});

app.ready().then(async () => {
  const device = app.device;
  const scene = new Scene();
  scene.env.sky.fogType = 'none';
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(0, 0, 12);
  camera.controller = new OrbitCameraController();
  camera.oit = device.type === 'webgpu' ? new ABufferOIT() : new WeightedBlendedOIT();
  camera.depthPrePass = true;

  app.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const boxShape = new BoxShape();

  const opaqueMat = new LambertMaterial();
  for (let i = 0; i < 100; i++) {
    const instanceMat = new LambertMaterial();
    instanceMat.blendMode = 'additive';
    instanceMat.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), Math.random());
    const transMesh = new Mesh(scene, boxShape, instanceMat);
    transMesh.position.setXYZ(Math.random() * 5 - 2.5, Math.random() * 5 - 2.5, Math.random() * 5 - 2.5);
    transMesh.parent = batchGroup;
  }
  for (let i = 0; i < 8; i++) {
    const instanceMat = opaqueMat.createInstance();
    instanceMat.albedoColor = new Vector4(1, 0, 0, 1);
    const opaqueMesh = new Mesh(scene, boxShape, instanceMat);
    opaqueMesh.position.setXYZ(Math.random() * 5 - 2.5, Math.random() * 5 - 2.5, Math.random() * 5 - 2.5);
    opaqueMesh.parent = batchGroup;
  }
  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  app.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  app.on('tick', () => {
    camera.updateController();
    camera.render(scene, compositor);
  });

  if (showUI) {
    new Panel(camera);
  }

  app.run();
});
