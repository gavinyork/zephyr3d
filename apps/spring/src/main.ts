// Demo entry point — scene setup + animation loop

import { createBoneChainDemo, type BoneChainDemo } from './bone-chain';
import { createClothGridDemo, type ClothGridDemo } from './cloth-grid';
import { createBarrelClothDemo, type BarrelClothDemo } from './barrel-cloth';
import { Plane, Vector2, Vector3 } from '@zephyr3d/base';
import type { IControllerPointerDownEvent, SceneNode } from '@zephyr3d/scene';
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
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

// ── Scene setup ──
const app = new Application({
  canvas: window.document.body.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});

await app.ready();

let elapsed = 0;
const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
camera.position.setXYZ(0, 1.5, 3);
camera.TAA = true;
scene.mainCamera = camera;

camera.controller = new OrbitCameraController({
  center: new Vector3(0, 1, 0)
});

const dirLight = new DirectionalLight(scene);
dirLight.lookAt(new Vector3(2, 4, 3), Vector3.zero(), Vector3.axisPY());

getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

app.on('tick', tick);

// ── Demos ──

let chainDemo: BoneChainDemo | null = null;
let clothDemo: ClothGridDemo | null = null;
let barrelDemo: BarrelClothDemo | null = null;
let activeDemo: 'chain' | 'cloth' | 'barrel' = 'cloth';
let windEnabled = false;
let broadPhaseEnabled = true;

function applyRuntimeFlags() {
  const controller = getActiveController();
  if (controller) {
    controller.setBroadPhaseEnabled(broadPhaseEnabled);
  }
}

function clearDemos() {
  if (chainDemo) {
    chainDemo.root.remove();
    chainDemo.colliderObj.remove();
    chainDemo.grabberObj.remove();
    for (const b of chainDemo.bones) {
      b.remove();
    }
    chainDemo = null;
  }
  if (clothDemo) {
    clothDemo.group.remove();
    clothDemo.colliderObj.remove();
    clothDemo.grabberObj.remove();
    clothDemo = null;
  }
  if (barrelDemo) {
    barrelDemo.group.remove();
    barrelDemo.colliderObj.remove();
    barrelDemo.grabberObj.remove();
    barrelDemo = null;
  }
}

function activateChain() {
  clearDemos();
  chainDemo = createBoneChainDemo(scene);
  chainDemo.springSystem.controller.warp();
  activeDemo = 'chain';

  const fixedSet = new Set<number>();
  fixedSet.add(0);

  btnChain.classList.add('active');
  btnCloth.classList.remove('active');
  btnBarrel.classList.remove('active');
  releaseControls.style.display = 'none';
  applyRuntimeFlags();
  updateStatus();
}

function activateCloth() {
  clearDemos();
  clothDemo = createClothGridDemo(scene);
  activeDemo = 'cloth';

  const fixedSet = new Set<number>();
  for (let col = 0; col < 6; col++) {
    fixedSet.add(col * 6);
  }

  btnChain.classList.remove('active');
  btnCloth.classList.add('active');
  btnBarrel.classList.remove('active');
  releaseControls.style.display = 'inline';
  nextReleaseCol = 0;
  applyRuntimeFlags();
  updateStatus();
}

function activateBarrel() {
  clearDemos();
  barrelDemo = createBarrelClothDemo(scene);
  activeDemo = 'barrel';

  const fixedSet = new Set<number>();
  for (let col = 0; col < barrelDemo.cols; col++) {
    fixedSet.add(col * barrelDemo.rows);
  }

  btnChain.classList.remove('active');
  btnCloth.classList.remove('active');
  btnBarrel.classList.add('active');
  releaseControls.style.display = 'inline';
  nextReleaseCol = 0;
  applyRuntimeFlags();
  updateStatus();
}

// ── UI ──

const btnChain = document.getElementById('btn-chain')!;
const btnCloth = document.getElementById('btn-cloth')!;
const btnBarrel = document.getElementById('btn-barrel')!;
const btnWind = document.getElementById('btn-wind')!;
const btnBroadPhase = document.getElementById('btn-broadphase')!;
const btnReset = document.getElementById('btn-reset')!;
const releaseControls = document.getElementById('release-controls')! as HTMLElement;
const btnReleaseOne = document.getElementById('btn-release-one')!;
const btnReleaseAll = document.getElementById('btn-release-all')!;
const btnFixAll = document.getElementById('btn-fix-all')!;
const statusDiv = document.getElementById('status')!;

let nextReleaseCol = 0;

btnChain.addEventListener('click', activateChain);
btnCloth.addEventListener('click', activateCloth);
btnBarrel.addEventListener('click', activateBarrel);
btnWind.addEventListener('click', () => {
  windEnabled = !windEnabled;
  btnWind.classList.toggle('active', windEnabled);
});
btnBroadPhase.addEventListener('click', () => {
  broadPhaseEnabled = !broadPhaseEnabled;
  btnBroadPhase.classList.toggle('active', broadPhaseEnabled);
  btnBroadPhase.textContent = broadPhaseEnabled ? 'Broad-Phase On' : 'Broad-Phase Off';
  applyRuntimeFlags();
  updateStatus();
});
btnReset.addEventListener('click', () => {
  if (chainDemo) {
    chainDemo.springSystem.controller.reset();
  }
  if (clothDemo) {
    clothDemo.springSystem.controller.reset();
    // Re-fix all top-row points
    for (const idx of clothDemo.fixedIndices) {
      clothDemo.springSystem.controller.fixPoint(idx);
    }
    nextReleaseCol = 0;
  }
  if (barrelDemo) {
    barrelDemo.springSystem.controller.reset();
    for (const idx of barrelDemo.fixedIndices) {
      barrelDemo.springSystem.controller.fixPoint(idx);
    }
    nextReleaseCol = 0;
  }
  updateStatus();
});

// Release/Fix controls (cloth grid and barrel only)
btnReleaseOne.addEventListener('click', () => {
  const demo = clothDemo ?? barrelDemo;
  if (!demo) {
    return;
  }
  if (nextReleaseCol < demo.cols) {
    const idx = demo.fixedIndices[nextReleaseCol];
    demo.springSystem.controller.releasePoint(idx);
    nextReleaseCol++;
    updateStatus();
  }
});

btnReleaseAll.addEventListener('click', () => {
  const demo = clothDemo ?? barrelDemo;
  if (!demo) {
    return;
  }
  for (const idx of demo.fixedIndices) {
    demo.springSystem.controller.releasePoint(idx);
  }
  nextReleaseCol = demo.cols;
  updateStatus();
});

btnFixAll.addEventListener('click', () => {
  const demo = clothDemo ?? barrelDemo;
  if (!demo) {
    return;
  }
  for (const idx of demo.fixedIndices) {
    demo.springSystem.controller.fixPoint(idx);
  }
  nextReleaseCol = 0;
  updateStatus();
});

function updateStatus() {
  const demo = activeDemo === 'cloth' ? clothDemo : activeDemo === 'barrel' ? barrelDemo : null;
  if (demo) {
    const states = demo.fixedIndices.map((idx, col) => {
      const fixed = demo!.springSystem.controller.isPointFixed(idx);
      return `Col${col}: ${fixed ? 'Fixed' : 'Free'}`;
    });
    statusDiv.textContent = `Top row: ${states.join('  |  ')} | Colliders: ${demo.collidersR.length} | Broad-Phase: ${broadPhaseEnabled ? 'On' : 'Off'}`;
  } else {
    statusDiv.textContent = `Broad-Phase: ${broadPhaseEnabled ? 'On' : 'Off'}`;
  }
}

// ── Start ──

activateCloth();

app.run();

// ── Grabber mouse interaction ──

const raycaster = new RaycastVisitor();
const mouse = new Vector2();
const grabPlane = new Plane(0, 0, 1, 0);
const grabIntersect = new Vector3();
let grabbing = false;

function getActiveGrabber(): SceneNode | null {
  if (activeDemo === 'chain' && chainDemo) {
    return chainDemo.grabberObj;
  }
  if (activeDemo === 'cloth' && clothDemo) {
    return clothDemo.grabberObj;
  }
  if (activeDemo === 'barrel' && barrelDemo) {
    return barrelDemo.grabberObj;
  }
  return null;
}

function getActiveController() {
  if (activeDemo === 'chain' && chainDemo) {
    return chainDemo.springSystem.controller;
  }
  if (activeDemo === 'cloth' && clothDemo) {
    return clothDemo.springSystem.controller;
  }
  if (activeDemo === 'barrel' && barrelDemo) {
    return barrelDemo.springSystem.controller;
  }
  return null;
}

function updateGrabPlane() {
  // Plane faces camera, passes through grab target area
  const cameraWorldMatrix = camera.worldMatrix;
  const camDir = new Vector3(
    -cameraWorldMatrix[8],
    -cameraWorldMatrix[9],
    -cameraWorldMatrix[10]
  ).inplaceNormalize();
  grabPlane.a = -camDir.x;
  grabPlane.b = -camDir.y;
  grabPlane.c = -camDir.z;
  const grabber = getActiveGrabber();
  if (grabber) {
    grabPlane.d = -Vector3.dot(grabPlane.getNormal(), grabber.position);
  }
}

function updateMousePosition(e: IControllerPointerDownEvent) {
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
}

function moveGrabberToMouse() {
  raycaster.ray = camera.constructRay(mouse.x, mouse.y);
  const d = raycaster.ray.intersectionTestPlane(grabPlane);
  if (d === null) {
    return;
  }
  Vector3.add(raycaster.ray.origin, Vector3.scale(raycaster.ray.direction, d), grabIntersect);
  const grabber = getActiveGrabber();
  if (grabber) {
    grabber.position.set(grabIntersect);
    // Show grabber radius visualization
    const vis = grabber.children[0].get()!;
    if (vis) {
      vis.showState = 'visible';
    }
  }
}

getInput().useFirst((evt) => {
  if (evt.type === 'pointerdown') {
    const e = evt as unknown as IControllerPointerDownEvent;
    if (e.button !== 2) {
      return false;
    } // right click only
    grabbing = true;
    updateMousePosition(e);
    updateGrabPlane();
    moveGrabberToMouse();
    const ctrl = getActiveController();
    if (ctrl) {
      const grabber = getActiveGrabber()!;
      const p = grabber.position;
      ctrl.updateGrabberState(0, true, new Vector3(p.x, p.y, p.z));
    }
    return true;
  } else if (evt.type === 'pointermove') {
    const e = evt as unknown as IControllerPointerDownEvent;
    if (!grabbing) {
      return false;
    }
    updateMousePosition(e);
    moveGrabberToMouse();
    const ctrl = getActiveController();
    if (ctrl) {
      const grabber = getActiveGrabber()!;
      const p = grabber.position;
      ctrl.updateGrabberState(0, true, new Vector3(p.x, p.y, p.z));
    }
    return true;
  } else if (evt.type === 'pointerup') {
    if (!grabbing) {
      return false;
    }
    grabbing = false;
    const ctrl = getActiveController();
    if (ctrl) {
      ctrl.updateGrabberState(0, false, Vector3.zero());
    }
    const grabber = getActiveGrabber();
    if (grabber) {
      const vis = grabber.children[0].get()!;
      if (vis) {
        vis.showState = 'hidden';
      }
    }
    return true;
  }
  return false;
});
// ── Animation loop ──

function tick(dt: number) {
  scene.mainCamera.updateController();

  dt = Math.min(dt / 1000, 1 / 30); // cap at 30fps min
  elapsed += dt;

  const wind = windEnabled
    ? new Vector3(Math.sin(elapsed * 2) * 80, 0, Math.cos(elapsed * 1.3) * 60)
    : Vector3.zero();

  if (activeDemo === 'chain' && chainDemo) {
    chainDemo.springSystem.controller.setWindForce(wind);
    chainDemo.update(elapsed, dt);
  }

  if (activeDemo === 'cloth' && clothDemo) {
    clothDemo.springSystem.controller.setWindForce(wind);
    clothDemo.update(elapsed, dt);
  }

  if (activeDemo === 'barrel' && barrelDemo) {
    barrelDemo.springSystem.controller.setWindForce(wind);
    barrelDemo.update(elapsed, dt);
  }
}
