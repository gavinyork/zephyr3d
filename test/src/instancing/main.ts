import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup,
  AssetManager,
  PBRMetallicRoughnessMaterial,
  DirectionalLight,
  BoxShape,
  LambertMaterial,
  Mesh,
  InstanceBindGroupAllocator,
} from '@zephyr3d/scene';
import * as common from '../common';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Vector3, Vector4 } from '@zephyr3d/base';

const instancingApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

instancingApp.ready().then(async () => {
  const device = instancingApp.device;
  await imGuiInit(device);
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(0, 0, 10);
  camera.controller = new OrbitCameraController();
  instancingApp.inputManager.use(imGuiInjectEvent);
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));
  const inspector = new common.Inspector(scene, null, camera);

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const boxShape = new BoxShape();
  const mat = new LambertMaterial();
  const boxMesh = new Mesh(scene, boxShape, mat.createInstance());
  boxMesh.parent = batchGroup;
  const boxMesh2 = new Mesh(scene, boxShape, mat.createInstance());
  boxMesh2.parent = batchGroup;

  /*
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
*/
  const light = new DirectionalLight(scene).setCastShadow(false).setColor(new Vector4(1, 1, 1, 1));
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  instancingApp.on('resize', (ev) => {
    camera.setPerspective(camera.getFOV(), ev.width / ev.height, camera.getNearPlane(), camera.getFarPlane());
  });
  instancingApp.on('tick', (ev) => {
    boxMesh.position.y = Math.sin(instancingApp.device.frameInfo.elapsedOverall * 0.001 * Math.PI * 2) * 6;
    boxMesh.position.y += 1;
    boxMesh2.position.y = -boxMesh.position.y;
    camera.updateController();
    camera.render(scene);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  instancingApp.run();
});
