import {
  Scene,
  OrbitCameraController,
  Application,
  PerspectiveCamera,
  Compositor,
  Tonemap,
  BatchGroup,
  DirectionalLight,
  BoxShape,
  LambertMaterial,
  Mesh,
  WeightedBlendedOIT,
} from '@zephyr3d/scene';
import * as common from '../common';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { LinearDepthMaterial } from './materal';

const instancingApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas')
});

instancingApp.ready().then(async () => {
  const device = instancingApp.device;
  await imGuiInit(device);
  const scene = new Scene();
  scene.env.sky.fogType = 'none';
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    1000
  );
  camera.position.setXYZ(0, 0, 30);
  camera.controller = new OrbitCameraController();
  camera.oit = new WeightedBlendedOIT();
  camera.depthPrePass = true;

  instancingApp.inputManager.use(imGuiInjectEvent);
  instancingApp.inputManager.use(camera.handleEvent.bind(camera));
  const inspector = new common.Inspector(scene, null, camera);

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  const batchGroup = new BatchGroup(scene);
  const boxShape = new BoxShape();
  /*
  const mat = new LambertMaterial();
  mat.blendMode = 'blend';
  for (let i = 0; i < 100; i++) {
    const instanceMat = mat.createInstance();
    instanceMat.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), Math.random());
    const boxMesh = new Mesh(scene, boxShape, instanceMat);
    boxMesh.position.setXYZ(Math.random() * 5 - 2.5, Math.random() * 5, Math.random() * 5 - 2.5);
    boxMesh.parent = batchGroup;
  }
  */
  const mat2 = new LinearDepthMaterial();
  const mesh2 = new Mesh(scene, boxShape, mat2);
  mesh2.scale = new Vector3(4, 4, 4);
  mesh2.parent = batchGroup;



  /*
  const assetManager = new AssetManager();
  for (let i = 0; i < 2; i++) {
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
    camera.updateController();
    camera.render(scene, compositor);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  instancingApp.run();
});
