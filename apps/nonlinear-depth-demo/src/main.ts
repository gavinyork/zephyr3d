import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import {
  Application,
  BoxShape,
  createForwardPlusPipeline,
  DirectionalLight,
  getEngine,
  getInput,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import { createNonLinearDepthModule } from './nonlinear-depth-module';

const app = new Application({
  canvas: window.document.body.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});

await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 60);
camera.position.setXYZ(0, 3, 9);
scene.mainCamera = camera;
camera.controller = new OrbitCameraController({ center: new Vector3(0, 0.5, 0) });

const keyLight = new DirectionalLight(scene);
keyLight.lookAt(new Vector3(4, 6, 4), Vector3.zero(), Vector3.axisPY());

getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

// A row of objects marching away from the camera, so depth varies clearly.
function makeMaterial(color: Vector4) {
  const material = new LambertMaterial();
  material.albedoColor = color;
  return material;
}

const ground = new Mesh(
  scene,
  new BoxShape({ size: 40, sizeY: 0.2, sizeZ: 40 }),
  makeMaterial(new Vector4(0.4, 0.42, 0.46, 1))
);
ground.position.setXYZ(-20, -0.6, -20);

for (let i = 0; i < 8; i++) {
  const z = 2 - i * 3;
  const hue = i / 8;
  const color = new Vector4(0.5 + 0.5 * Math.sin(hue * 6.28), 0.6, 0.5 + 0.5 * Math.cos(hue * 6.28), 1);
  const shape =
    i % 3 === 0
      ? new SphereShape({ radius: 0.8 })
      : i % 3 === 1
        ? new BoxShape({ size: 1.4 })
        : new TorusShape({ outerRadius: 0.8, innerRadius: 0.3 });
  const mesh = new Mesh(scene, shape, makeMaterial(color));
  mesh.position.setXYZ(Math.sin(i) * 1.6, 0.4, z);
}

// ── The user-side extension ────────────────────────────────────────────────
// Same takeover mechanism as the linear-depth demo, but this module samples the
// raw depth-stencil attachment and shows the non-linear z directly.
const depthModule = createNonLinearDepthModule();
const shadedPipeline = createForwardPlusPipeline();
const depthPipeline = createForwardPlusPipeline().append(depthModule);

let depthEnabled = true;
camera.renderPipeline = depthPipeline;

const btn = document.getElementById('btn-depth')!;
btn.addEventListener('click', () => {
  depthEnabled = !depthEnabled;
  camera.renderPipeline = depthEnabled ? depthPipeline : shadedPipeline;
  btn.textContent = `Non-Linear Depth: ${depthEnabled ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', depthEnabled);
});

app.on('tick', () => {
  scene.mainCamera.updateController();
});
app.run();
