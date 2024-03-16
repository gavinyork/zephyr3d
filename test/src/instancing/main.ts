import { Vector3, Vector4, Quaternion } from '@zephyr3d/base';
import {
  Scene,
  OrbitCameraController,
  AssetManager,
  PBRMetallicRoughnessMaterial,
  Mesh,
  DirectionalLight,
  Application,
  panoramaToCubemap,
  prefilterCubemap,
  PerspectiveCamera,
  BoxShape
} from '@zephyr3d/scene';
import * as common from '../common';
import type { Texture2D } from '@zephyr3d/device';

const instancingApp = new Application({
  backend: common.getBackend(),
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
    160
  );
  camera.position.setXYZ(0, 0, 60);
  camera.controller = new OrbitCameraController();
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));

  const assetManager = new AssetManager();
  const radianceMap = device.createCubeTexture('rgba16f', 256);
  const irradianceMap = device.createCubeTexture('rgba16f', 64, { samplerOptions: { mipFilter: 'none' } });
  const skyMap = device.createCubeTexture('rgba16f', 512);
  const hdrTex = await assetManager.fetchTexture<Texture2D>(`./assets/images/environments/papermill.hdr`);
  panoramaToCubemap(hdrTex, skyMap);
  prefilterCubemap(skyMap, 'ggx', radianceMap);
  prefilterCubemap(skyMap, 'lambertian', irradianceMap);
  scene.env.light.type = 'ibl';
  scene.env.light.radianceMap = radianceMap;
  scene.env.light.irradianceMap = irradianceMap;
  scene.env.sky.skyType = 'skybox';
  scene.env.sky.skyboxTexture = skyMap;
  hdrTex.dispose();

  const boxMaterial = new PBRMetallicRoughnessMaterial();
  boxMaterial.albedoTexture = await assetManager.fetchTexture('./assets/images/rustediron2_basecolor.png');
  boxMaterial.normalTexture = await assetManager.fetchTexture('./assets/images/rustediron2_normal.png', {
    linearColorSpace: true
  });
  boxMaterial.metallicRoughnessTexture = await assetManager.fetchTexture('./assets/images/mr.png', {
    linearColorSpace: true
  });
  const box = new BoxShape();
  for (let x = -20; x <= 20; x += 2) {
    for (let y = -20; y <= 20; y += 2) {
      for (let z = -20; z <= 20; z += 2) {
        const instance = new Mesh(scene, box);
        const instanceMaterial = boxMaterial.createInstance();
        instanceMaterial.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
        instance.material = instanceMaterial;
        instance.position.setXYZ(x, y, z);
      }
    }
  }

  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.rotation.set(Quaternion.fromAxisAngle(new Vector3(1, 1, 0).inplaceNormalize(), (Math.PI * 2) / 3));

  instancingApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  instancingApp.on('tick', (ev) => {
    camera.updateController();
    camera.render(scene);
  });
  instancingApp.run();
});
