import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import {
  Scene,
  OrbitCameraController,
  DirectionalLight,
  Application,
  PerspectiveCamera,
  BatchGroup,
  LambertMaterial,
  BoxShape,
  Mesh,
  getInput
} from '@zephyr3d/scene';
import { Panel } from './ui';

let instanceCount = 0;

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
  const scene = new Scene();
  scene.env.light.strength = 0.1;
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  camera.position.setXYZ(0, 0, 100);
  camera.controller = new OrbitCameraController();
  getInput().use(camera.handleEvent.bind(camera));

  const numMaterials = 8;
  const batchGroup = new BatchGroup(scene);
  const materials = Array.from({ length: numMaterials }).map(() => {
    const mat = new LambertMaterial();
    mat.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    return mat;
  });
  const boxShape = new BoxShape();

  const createNBoxes = function (n: number) {
    for (let i = 0; i < n; i++) {
      const mesh = new Mesh(scene, boxShape, materials[Math.floor(Math.random() * numMaterials)]);
      const scale = 2 + Math.random() * 2 - 1;
      mesh.position = new Vector3(
        Math.random() * 200 - 100,
        Math.random() * 200 - 100,
        Math.random() * 200 - 100
      );
      mesh.scale = new Vector3(scale, scale, scale);
      mesh.rotation = Quaternion.fromEulerAngle(Math.random(), Math.random(), Math.random());
      mesh.parent = batchGroup;
    }
    instanceCount += n;
    return instanceCount;
  };
  const removeNBoxes = function (n: number) {
    for (let i = 0; i < Math.min(batchGroup.children.length, n); i++) {
      batchGroup.children[0].get().remove();
      instanceCount--;
    }
    return instanceCount;
  };

  createNBoxes(5000);

  const light = new DirectionalLight(scene)
    .setCastShadow(false)
    .setColor(new Vector4(1, 1, 1, 1))
    .setIntensity(15);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  app.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  app.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  if (showUI) {
    new Panel(
      instanceCount,
      camera,
      () => {
        return createNBoxes(500);
      },
      () => {
        return removeNBoxes(500);
      }
    );
  }

  app.run();
});
