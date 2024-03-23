import { Vector3, Vector4 } from '@zephyr3d/base';
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
import * as common from '../common';

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
    1000
  );
  camera.position.setXYZ(0, 0, 60);
  camera.controller = new OrbitCameraController();
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const assetManager = new AssetManager();
  for (let i = 0; i < 2000; i++) {
    assetManager.fetchModel(scene, 'assets/stone1.glb', { enableInstancing: true }).then((info) => {
      info.group.parent = batchGroup;
      info.group.position.setXYZ(
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
        Math.random() * 100 - 50
      );
      info.group.iterate((node) => {
        if (node.isMesh()) {
          (node.material as PBRMetallicRoughnessMaterial).albedoColor = new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            1
          );
        }
      });
    });
    assetManager.fetchModel(scene, 'assets/stone2.glb', { enableInstancing: true }).then((info) => {
      info.group.parent = batchGroup;
      info.group.position.setXYZ(
        Math.random() * 100 - 50,
        Math.random() * 100 - 50,
        Math.random() * 100 - 50
      );
      info.group.iterate((node) => {
        if (node.isMesh()) {
          (node.material as PBRMetallicRoughnessMaterial).albedoColor = new Vector4(
            Math.random(),
            Math.random(),
            Math.random(),
            1
          );
        }
      });
    });
  }

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
