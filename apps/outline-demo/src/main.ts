import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
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
import { createOutlineModule, type OutlineSettings } from './outline-module';

const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});
await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 80);
camera.position.setXYZ(0, 4.5, 11);
camera.controller = new OrbitCameraController({ center: new Vector3(0, 1.2, 0) });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);

const keyLight = new DirectionalLight(scene);
keyLight.lookAt(new Vector3(4, 8, 6), new Vector3(0, 1, 0), Vector3.axisPY());

const floorMaterial = new LambertMaterial();
floorMaterial.albedoColor = new Vector4(0.2, 0.23, 0.28, 1);
const floor = new Mesh(scene, new BoxShape({ size: 1 }), floorMaterial);
floor.scale.setXYZ(12, 0.2, 7);
floor.position.setXYZ(0, -0.1, 0);

const targetMaterial = new LambertMaterial();
targetMaterial.albedoColor = new Vector4(0.12, 0.48, 0.92, 1);
const outlinedTorus = new Mesh(
  scene,
  new TorusShape({ outerRadius: 1.55, innerRadius: 0.48, numSlices: 64, numSegments: 24 }),
  targetMaterial
);
outlinedTorus.position.setXYZ(0, 1.8, 0);

const neighborMaterial = new LambertMaterial();
neighborMaterial.albedoColor = new Vector4(0.5, 0.54, 0.6, 1);
for (const x of [-3.2, 3.2]) {
  const sphere = new Mesh(scene, new SphereShape({ radius: 1 }), neighborMaterial);
  sphere.position.setXYZ(x, 1, 0);
}

// This foreground sphere overlaps the torus so the shared-depth occlusion is easy to verify.
const occluder = new Mesh(scene, new SphereShape({ radius: 0.9 }), neighborMaterial);
occluder.position.setXYZ(0.9, 1.45, 1.3);

const settings: OutlineSettings = { enabled: true, width: 0.1 };
camera.renderPipeline = createForwardPlusPipeline().insertAfter(
  'SkyPass',
  createOutlineModule(outlinedTorus, settings)
);
getEngine().setRenderable(scene);

const enabledInput = document.querySelector<HTMLInputElement>('#outline-enabled')!;
const widthInput = document.querySelector<HTMLInputElement>('#outline-width')!;
const widthValue = document.querySelector<HTMLOutputElement>('#outline-width-value')!;
enabledInput.addEventListener('change', () => {
  settings.enabled = enabledInput.checked;
});
widthInput.addEventListener('input', () => {
  settings.width = Number(widthInput.value);
  widthValue.value = settings.width.toFixed(2);
});

app.on('tick', (_deltaMs, elapsedMs) => {
  const seconds = elapsedMs * 0.001;
  outlinedTorus.rotation.set(Quaternion.fromEulerAngle(seconds * 0.45, seconds * 0.8, 0));
  camera.updateController();
});
app.run();
