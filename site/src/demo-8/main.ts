import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { DeviceBackend } from '@zephyr3d/device';
import {
  Scene,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup,
  Mesh,
  FPSCameraController,
  SphereShape,
  UnlitMaterial,
  AssetManager,
  PointLight,
  SceneNode
} from '@zephyr3d/scene';

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

const app = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas')
});

app.ready().then(async () => {
  const device = app.device;
  const scene = new Scene();
  scene.env.sky.fogType = 'none';
  scene.env.sky.skyType = 'scatter';
  scene.env.sky.autoUpdateIBLMaps = true;
  scene.env.light.radianceMap = scene.env.sky.radianceMap;
  scene.env.light.irradianceMap = scene.env.sky.irradianceMap;
  scene.env.light.strength = 0.8;

  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(200, 0, 12);
  camera.controller = new FPSCameraController();
  app.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);

  const assetManager = new AssetManager();
  const room = await assetManager.fetchModel(scene, 'assets/models/abandoned_building_room.glb');
  room.group.parent = batchGroup;

  const lightOrigin = new SceneNode(scene);
  lightOrigin.parent = room.group;
  lightOrigin.position.y = 151;

  const lightCage = await assetManager.fetchModel(scene, 'assets/models/cage/scene.gltf');
  lightCage.group.scale.setXYZ(15, 15, 15);
  lightCage.group.position.y = -40;
  lightCage.group.parent = lightOrigin;

  const lightSourceMat = new UnlitMaterial();
  lightSourceMat.albedoColor = new Vector4(1, 1, 0, 0);
  const lightSource = new Mesh(scene, new SphereShape({ radius: 0.02 }), lightSourceMat);
  lightSource.position.y = 0.6;
  lightSource.parent = lightCage.group;

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
    camera.render(scene, compositor);
  });

  app.run();
});
