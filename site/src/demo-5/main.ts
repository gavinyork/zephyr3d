import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import type { PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
import {
  Scene,
  OrbitCameraController,
  AssetManager,
  DirectionalLight,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup
} from '@zephyr3d/scene';
import { Panel } from './ui';

let instanceCount = 0;
let vertexCount = 0;
let faceCount = 0;

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
const instancingApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas')
});

instancingApp.ready().then(async () => {
  const device = instancingApp.device;
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(0, 0, 60);
  camera.controller = new OrbitCameraController();
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const assetManager = new AssetManager();
  await (async function () {
    for (let i = 0; i < 2000; i++) {
      const stone1 = await assetManager.fetchModel(scene, 'assets/models/stone1.glb', {
        enableInstancing: true
      });
      stone1.group.parent = batchGroup;
      stone1.group.position.setXYZ(
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
        Math.random() * 100 - 50
      );
      stone1.group.iterate((node) => {
        if (node.isMesh()) {
          (node.material as PBRMetallicRoughnessMaterial).albedoColor = new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            1
          );
          vertexCount += node.primitive.getNumVertices();
          faceCount += node.primitive.getNumFaces();
        }
      });
      instanceCount++;
      const stone2 = await assetManager.fetchModel(scene, 'assets/models/stone2.glb', {
        enableInstancing: true
      });
      stone2.group.parent = batchGroup;
      stone2.group.position.setXYZ(
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
        Math.random() * 100 - 50
      );
      stone2.group.iterate((node) => {
        if (node.isMesh()) {
          (node.material as PBRMetallicRoughnessMaterial).albedoColor = new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            1
          );
          vertexCount += node.primitive.getNumVertices();
          faceCount += node.primitive.getNumFaces();
        }
      });
      instanceCount++;
    }
    if (showUI) {
      new Panel(instanceCount, vertexCount, faceCount);
    }
  })();

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  instancingApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  instancingApp.on('tick', (ev) => {
    camera.updateController();
    camera.render(scene, compositor);
  });
  instancingApp.run();
});
