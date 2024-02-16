import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  FPSCameraController,
  DirectionalLight,
  PBRMetallicRoughnessMaterial,
  Mesh,
  AssetManager,
  panoramaToCubemap,
  prefilterCubemap,
  Application,
  PerspectiveCamera,
  BoxShape
} from '@zephyr3d/scene';
import * as common from '../common';
import type { Texture2D } from '@zephyr3d/device';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';

const shadowApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});
shadowApp.ready().then(async () => {
  const device = shadowApp.device;
  await imGuiInit(device);
  const scene = new Scene();
  scene.env.light.strength = 0.2;
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  shadowApp.inputManager.use(imGuiInjectEvent);
  shadowApp.inputManager.use(camera.handleEvent.bind(camera));

  const inspector = new common.Inspector(scene, null, camera);

  // const directionlight = null;
  const directionlight = new DirectionalLight(scene);
  directionlight.setCastShadow(true).setColor(new Vector4(1, 1, 1, 1));
  directionlight.lookAt(new Vector3(20, 28, -20), Vector3.zero(), Vector3.axisPY());
  directionlight.shadow.shadowMapSize = 2048;
  directionlight.shadow.numShadowCascades = 4;

  const planeMaterial = new PBRMetallicRoughnessMaterial();
  planeMaterial.metallic = 0.1;
  planeMaterial.roughness = 0.6;

  const box = new BoxShape();
  const floor = new Mesh(scene, box);
  floor.scale.setXYZ(2000, 10, 2000);
  floor.position.setXYZ(-1000, -10, -1000);
  floor.castShadow = true;
  floor.material = planeMaterial;

  for (let i = -40; i <= 40; i++) {
    const box1 = new Mesh(scene, box);
    box1.scale.setXYZ(2, 20, 2);
    box1.position.setXYZ(-20, 0, i * 10);
    box1.material = planeMaterial;
    const box2 = new Mesh(scene, box);
    box2.scale.setXYZ(2, 20, 2);
    box2.position.setXYZ(20, 0, i * 10);
    box2.material = planeMaterial;
  }

  const assetManager = new AssetManager();
  const tex = await assetManager.fetchTexture<Texture2D>(`./assets/images/environments/field.hdr`);
  const skyMap = device.createCubeTexture('rgba16f', 512);
  const radianceMap = device.createCubeTexture('rgba16f', 256);
  const irradianceMap = device.createCubeTexture('rgba16f', 128, { samplerOptions: { mipFilter: 'none' } });
  panoramaToCubemap(tex, skyMap);
  prefilterCubemap(skyMap, 'ggx', radianceMap);
  prefilterCubemap(skyMap, 'lambertian', irradianceMap);
  scene.env.light.type = 'ibl';
  scene.env.light.radianceMap = radianceMap;
  scene.env.light.irradianceMap = irradianceMap;
  scene.env.sky.skyType = 'skybox';
  scene.env.sky.skyboxTexture = skyMap;
  tex.dispose();

  const tga = await assetManager.fetchTexture('./assets/maps/map3/splatmap.tga');
  tga.name = 'TGATest';

  shadowApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  shadowApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  shadowApp.run();
});
