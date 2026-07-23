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
  Scene
} from '@zephyr3d/scene';
import { createRedBoxModule, type RedBoxMode } from './red-box-module';

const app = new Application({
  canvas: window.document.body.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});

await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 60);
camera.position.setXYZ(0, 3, 12);
scene.mainCamera = camera;
camera.controller = new OrbitCameraController({ center: new Vector3(0, 0.5, 0) });

const keyLight = new DirectionalLight(scene);
keyLight.lookAt(new Vector3(4, 6, 4), Vector3.zero(), Vector3.axisPY());

getInput().use(camera.handleEvent, camera);

// Blue boxes — visible, rendered by the normal pipeline.
const blueMat = new LambertMaterial();
blueMat.albedoColor = new Vector4(0.2, 0.4, 0.9, 1);
for (let i = -2; i <= 2; i++) {
  const mesh = new Mesh(scene, new BoxShape({ size: 1 }), blueMat);
  mesh.position.setXYZ(i * 2.5, 0.5, 0);
}

// Red boxes — hidden from the normal pipeline, rendered by the custom pass.
const redMat = new LambertMaterial();
redMat.albedoColor = new Vector4(0.9, 0.2, 0.2, 1);
const redMeshes: Mesh[] = [];
for (let i = -2; i <= 2; i++) {
  const mesh = new Mesh(scene, new BoxShape({ size: 1 }), redMat);
  mesh.position.setXYZ(i * 2.5, 0.5, -3);
  mesh.showState = 'hidden'; // hidden from normal culling
  redMeshes.push(mesh);
}

getEngine().setRenderable(scene);

let mode: RedBoxMode = 'transient';
const redBoxModule = createRedBoxModule(redMeshes, () => mode);
camera.renderPipeline = createForwardPlusPipeline().append(redBoxModule);

document.getElementById('btn-transient')!.addEventListener('click', () => {
  mode = 'transient';
  document.getElementById('btn-transient')!.classList.add('active');
  document.getElementById('btn-persistent')!.classList.remove('active');
});
document.getElementById('btn-persistent')!.addEventListener('click', () => {
  mode = 'persistent';
  document.getElementById('btn-persistent')!.classList.add('active');
  document.getElementById('btn-transient')!.classList.remove('active');
});

app.on('tick', () => {
  scene.mainCamera.updateController();
});
app.run();
