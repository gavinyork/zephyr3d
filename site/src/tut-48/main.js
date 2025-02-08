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
  PBRMetallicRoughnessMaterial
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

  const torusShape = new TorusShape();
  for (let i = 0; i < 30; i++) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(Math.random(), Math.random(), Math.random(), 1);
    const mesh = new Mesh(scene, torusShape, material);
    mesh.position.setRandom(-50, 50);
    mesh.rotation.fromEulerAngle(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
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

  myApp.inputManager.use(camera.handleEvent.bind(camera));

  /** @type {*} */
  let lastPickResult;

  let x = 0;
  let y = 0;
  myApp.device.canvas.addEventListener('pointermove', (ev) => {
    x = ev.offsetX;
    y = ev.offsetY;
  });

  function continusPicking() {
    camera.pickAsync(x, y).then((pickResult) => {
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
      continusPicking();
    });
  }

  continusPicking();

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
