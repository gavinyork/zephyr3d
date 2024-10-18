import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  OrbitCameraController,
  Mesh,
  DirectionalLight,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  BoxShape
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const device = myApp.device;

  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const planeMaterial = new PBRMetallicRoughnessMaterial();
  planeMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  planeMaterial.metallic = 0.8;
  planeMaterial.roughness = 0.5;
  const groundMesh = new Mesh(scene, new BoxShape({ size: 60 }), planeMaterial);
  groundMesh.position.setXYZ(-30, 0, -30);

  const mirrorMaterial = new PBRMetallicRoughnessMaterial();
  mirrorMaterial.albedoColor = new Vector4(1, 1, 1, 1);
  mirrorMaterial.metallic = 0.8;
  mirrorMaterial.roughness = 0.1;
  const mirrorMesh = new Mesh(scene, new BoxShape({ sizeX: 10, sizeY: 20, sizeZ: 1 }), mirrorMaterial);
  mirrorMesh.position.setXYZ(-25, 10, 0);
  const torusShape = new TorusShape();
  for (let i = 0; i < 30; i++) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    const mesh = new Mesh(scene, torusShape, material);
    mesh.position.setRandom(-50, 50);
    mesh.rotation.fromEulerAngle(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      'ZYX'
    );
    mesh.pickable = true;
  }

  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    500
  );
  camera.lookAt(new Vector3(0, 0, 100), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController();
  camera.enablePicking = true;

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  /** @type {*} */
  let lastPickResult;

  myApp.device.canvas.addEventListener('pointermove', (ev) => {
    camera.pickPosX = ev.offsetX;
    camera.pickPosY = ev.offsetY;
  });

  myApp.on('tick', (ev) => {
    camera.updateController();
    camera.render(scene);
    camera.pickResultAsync.then((pickResult) => {
      if (lastPickResult !== pickResult?.node) {
        if (lastPickResult) {
          lastPickResult.material.emissiveColor = Vector3.zero();
          lastPickResult = null;
        }
        if (pickResult) {
          lastPickResult = pickResult.node;
          lastPickResult.material.emissiveColor = new Vector3(1, 1, 0);
        }
      }
    });
  });

  myApp.run();
});
