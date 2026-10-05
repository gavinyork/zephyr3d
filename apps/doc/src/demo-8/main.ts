import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import { GLTFImporter } from '@zephyr3d/loaders';
import {
  Scene,
  Application,
  PerspectiveCamera,
  BatchGroup,
  Mesh,
  FPSCameraController,
  SphereShape,
  UnlitMaterial,
  PointLight,
  SceneNode,
  getInput,
  getEngine
} from '@zephyr3d/scene';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

async function getBackend(): Promise<DeviceBackend> {
  const type = getQueryString('dev');
  if (type === 'webgpu') {
    if (await backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  return backendWebGL2;
}

const app = new Application({
  backend: await getBackend(),
  canvas: document.querySelector('#canvas')
});

app.ready().then(async () => {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

  const scene = new Scene();
  scene.env.sky.fogType = 'none';
  scene.env.sky.skyType = 'scatter';
  scene.env.light.radianceMap = scene.env.sky.radianceMap;
  scene.env.light.strength = 0.8;

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  camera.position.setXYZ(200, 0, 12);
  camera.controller = new FPSCameraController();
  getInput().use(camera.handleEvent.bind(camera));

  const batchGroup = new BatchGroup(scene);

  const room = await getEngine().resourceManager.fetchModel(
    'https://cdn.zephyr3d.org/doc/assets/models/abandoned_building_room.glb',
    scene
  );
  room.parent = batchGroup;

  const lightOrigin = new SceneNode(scene);
  lightOrigin.parent = room;
  lightOrigin.position.y = 151;

  const lightCage = await getEngine().resourceManager.fetchModel(
    'https://cdn.zephyr3d.org/doc/assets/models/cage/scene.gltf',
    scene
  );
  lightCage.scale.setXYZ(15, 15, 15);
  lightCage.position.y = -40;
  lightCage.parent = lightOrigin;

  const lightSourceMat = new UnlitMaterial();
  lightSourceMat.albedoColor = new Vector4(1, 1, 0, 0);
  const lightSource = new Mesh(scene, new SphereShape({ radius: 0.02 }), lightSourceMat);
  lightSource.position.y = 0.6;
  lightSource.parent = lightCage;

  const light = new PointLight(scene)
    .setCastShadow(true)
    .setColor(new Vector4(1, 1, 0.4, 0))
    .setIntensity(2)
    .setRange(10000);
  light.shadow.mode = 'pcf-opt';
  light.shadow.pcfKernelSize = 7;
  light.parent = lightSource;

  app.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  let t = 0;
  let a = 0;
  app.on('tick', () => {
    const elapsed = app.device.frameInfo.elapsedOverall;
    if (t === 0) {
      t = elapsed;
    }
    a += Math.cos((elapsed - t) * 0.001) * 0.01;
    lightOrigin.rotation.fromAxisAngle(new Vector3(0, 0, 1), a);
    camera.updateController();
    camera.render(scene);
  });

  app.run();
});
