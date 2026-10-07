import { Plane, Vector2, Vector3 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import type { IControllerMouseEvent, SceneNode } from '@zephyr3d/scene';
import {
  Application,
  DirectionalLight,
  getEngine,
  getInput,
  OrbitCameraController,
  PerspectiveCamera,
  RaycastVisitor,
  Scene
} from '@zephyr3d/scene';
import { createIKDemo, type IKHandle } from './ik-demo';

const app = new Application({
  canvas: window.document.body.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});

await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
camera.position.setXYZ(0.15, 1.55, 3.1);
camera.TAA = true;
scene.mainCamera = camera;
camera.controller = new OrbitCameraController({
  center: new Vector3(0.45, 1.35, 0)
});

const keyLight = new DirectionalLight(scene);
keyLight.lookAt(new Vector3(3, 4, 4), new Vector3(0.3, 1.1, 0), Vector3.axisPY());

getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

const demo = createIKDemo(scene);

const btnAuto = document.getElementById('btn-auto')!;
const btnReset = document.getElementById('btn-reset')!;
const weightInput = document.getElementById('weight')! as HTMLInputElement;

let activeHandle: IKHandle = 'target';
let autoTarget = true;
let elapsed = 0;

btnAuto.addEventListener('click', () => {
  autoTarget = !autoTarget;
  btnAuto.classList.toggle('active', autoTarget);
});
btnReset.addEventListener('click', () => {
  demo.reset();
  autoTarget = true;
  btnAuto.classList.add('active');
  setActiveHandle('target');
});
weightInput.addEventListener('input', () => {
  demo.setWeight(Number(weightInput.value));
});

function setActiveHandle(handle: IKHandle) {
  activeHandle = handle;
}

function getHandleNode(handle: IKHandle): SceneNode {
  return handle === 'target' ? demo.targetNode : demo.poleNode;
}

function updateAutoTarget(time: number) {
  if (!autoTarget || dragging) {
    return;
  }
  demo.targetNode.position.setXYZ(
    1.04 + Math.sin(time * 0.95) * 0.26,
    1.34 + Math.sin(time * 1.35) * 0.2,
    0.18 + Math.cos(time * 0.85) * 0.28
  );
}

const raycaster = new RaycastVisitor();
const mouse = new Vector2();
const dragPlane = new Plane(0, 0, 1, 0);
const dragIntersect = new Vector3();
const tempWorld = new Vector3();
let dragging = false;

function pickHandle(): IKHandle | null {
  raycaster.ray = camera.constructRay(mouse.x, mouse.y);
  const targetDist = raycaster.ray.intersectionTestSphere(demo.targetNode.getWorldPosition(tempWorld), 0.12);
  const targetHit = targetDist ? Math.min(...targetDist) : Number.POSITIVE_INFINITY;
  const poleDist = raycaster.ray.intersectionTestSphere(demo.poleNode.getWorldPosition(tempWorld), 0.1);
  const poleHit = poleDist ? Math.min(...poleDist) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(targetHit) && !Number.isFinite(poleHit)) {
    return null;
  }
  return targetHit <= poleHit ? 'target' : 'pole';
}

function updateMousePosition(e: IControllerMouseEvent) {
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
}

function updateDragPlane() {
  const cameraWorldMatrix = camera.worldMatrix;
  const camDir = new Vector3(
    -cameraWorldMatrix[8],
    -cameraWorldMatrix[9],
    -cameraWorldMatrix[10]
  ).inplaceNormalize();
  dragPlane.a = -camDir.x;
  dragPlane.b = -camDir.y;
  dragPlane.c = -camDir.z;
  dragPlane.d = -Vector3.dot(dragPlane.getNormal(), getHandleNode(activeHandle).getWorldPosition(tempWorld));
}

function moveActiveHandleToMouse() {
  raycaster.ray = camera.constructRay(mouse.x, mouse.y);
  const d = raycaster.ray.intersectionTestPlane(dragPlane);
  if (d === null) {
    return;
  }
  Vector3.add(raycaster.ray.origin, Vector3.scale(raycaster.ray.direction, d), dragIntersect);
  getHandleNode(activeHandle).position.set(dragIntersect);
}

getInput().useFirst((evt, type) => {
  if (type === 'pointerdown') {
    if (evt.button !== 0) {
      return false;
    }
    updateMousePosition(evt);
    const pickedHandle = pickHandle();
    if (pickedHandle) {
      setActiveHandle(pickedHandle);
    }
    autoTarget = false;
    btnAuto.classList.remove('active');
    dragging = true;
    updateDragPlane();
    moveActiveHandleToMouse();
    return true;
  }
  if (evt.type === 'pointermove') {
    const e = evt as unknown as IControllerMouseEvent;
    if (!dragging) {
      return false;
    }
    updateMousePosition(e);
    moveActiveHandleToMouse();
    return true;
  }
  if (evt.type === 'pointerup') {
    if (!dragging) {
      return false;
    }
    dragging = false;
    return true;
  }
  return false;
});

app.on('tick', tick);
app.run();

function tick(dt: number) {
  scene.mainCamera.updateController();
  elapsed += Math.min(dt / 1000, 1 / 30);
  updateAutoTarget(elapsed);
  demo.update(elapsed);
}
