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
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const torusShape = new TorusShape();
  for (let i = 0; i < 30; i++) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    const mesh = new Mesh(scene, torusShape, material);
    mesh.position.setRandom(-10, 10);
    mesh.rotation.fromEulerAngle(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    mesh.pickable = true;
    mesh.gpuPickable = true;
  }

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 0, 20), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  /** @type {*} */
  let lastPickResult;

  let x = 0;
  let y = 0;
  myApp.device.canvas.addEventListener('pointermove', (ev) => {
    x = ev.offsetX;
    y = ev.offsetY;
  });

  function continusPicking() {
    scene.mainCamera.pickAsync(x, y).then((pickResult) => {
      if (lastPickResult !== pickResult?.target.node) {
        if (lastPickResult) {
          lastPickResult.material.emissiveColor = Vector3.zero();
          lastPickResult = null;
        }
        if (pickResult) {
          lastPickResult = pickResult.target.node;
          lastPickResult.material.emissiveColor = new Vector3(1, 1, 0);
        }
      }
    });
  }

  myApp.on('tick', continusPicking);

  myApp.run();
});
