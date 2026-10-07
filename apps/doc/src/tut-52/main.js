// Demo entry point — scene setup + animation loop

import { createBoneChainDemo } from './bone-chain';
import { createClothGridDemo } from './cloth-grid';
import { createBarrelClothDemo } from './barrel-cloth';
import { createClosedChainDemo } from './closed-chain';
import { Plane, Vector2, Vector3 } from '@zephyr3d/base';
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
const canvas = /** @type {HTMLCanvasElement} */ (window.document.body.querySelector('#canvas'));
const app = new Application({
  canvas,
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

let chainDemo = null;
let clothDemo = null;
let barrelDemo = null;
let closedDemo = null;
let activeDemo = 'cloth';
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
  if (closedDemo) {
    closedDemo.root.remove();
    closedDemo.colliderObj.remove();
    closedDemo.grabberObj.remove();
    for (const b of closedDemo.bones) {
      b.remove();
    }
    closedDemo = null;
  }
}

function activateChain() {
  clearDemos();
  chainDemo = createBoneChainDemo(scene);
  chainDemo.springSystem.controller.reset();
  activeDemo = 'chain';

  const fixedSet = new Set();
  fixedSet.add(0);

  btnChain.classList.add('active');
  btnCloth.classList.remove('active');
  btnBarrel.classList.remove('active');
  btnClosed.classList.remove('active');
  releaseControls.hidden = true;
  applyRuntimeFlags();
  updateStatus();
}

function activateCloth() {
  clearDemos();
  clothDemo = createClothGridDemo(scene);
  activeDemo = 'cloth';

  const fixedSet = new Set();
  for (let col = 0; col < 6; col++) {
    fixedSet.add(col * 6);
  }

  btnChain.classList.remove('active');
  btnCloth.classList.add('active');
  btnBarrel.classList.remove('active');
  btnClosed.classList.remove('active');
  releaseControls.hidden = false;
  nextReleaseCol = 0;
  applyRuntimeFlags();
  updateStatus();
}

function activateBarrel() {
  clearDemos();
  barrelDemo = createBarrelClothDemo(scene);
  activeDemo = 'barrel';

  const fixedSet = new Set();
  for (let col = 0; col < barrelDemo.cols; col++) {
    fixedSet.add(col * barrelDemo.rows);
  }

  btnChain.classList.remove('active');
  btnCloth.classList.remove('active');
  btnBarrel.classList.add('active');
  btnClosed.classList.remove('active');
  releaseControls.hidden = false;
  nextReleaseCol = 0;
  applyRuntimeFlags();
  updateStatus();
}

function activateClosed() {
  clearDemos();
  closedDemo = createClosedChainDemo(scene);
  activeDemo = 'closed';

  btnChain.classList.remove('active');
  btnCloth.classList.remove('active');
  btnBarrel.classList.remove('active');
  btnClosed.classList.add('active');
  releaseControls.hidden = true;
  applyRuntimeFlags();
  updateStatus();
}

// ── UI ──

const btnChain = document.getElementById('btn-chain');
const btnCloth = document.getElementById('btn-cloth');
const btnBarrel = document.getElementById('btn-barrel');
const btnClosed = document.getElementById('btn-closed');
const btnWind = document.getElementById('btn-wind');
const btnBroadPhase = document.getElementById('btn-broadphase');
const btnReset = document.getElementById('btn-reset');
const releaseControls = document.getElementById('release-controls');
const btnReleaseOne = document.getElementById('btn-release-one');
const btnReleaseAll = document.getElementById('btn-release-all');
const btnFixAll = document.getElementById('btn-fix-all');
const statusDiv = document.getElementById('status');

let nextReleaseCol = 0;

btnChain.addEventListener('click', activateChain);
btnCloth.addEventListener('click', activateCloth);
btnBarrel.addEventListener('click', activateBarrel);
btnClosed.addEventListener('click', activateClosed);
btnWind.addEventListener('click', () => {
  windEnabled = !windEnabled;
  btnWind.classList.toggle('active', windEnabled);
  updateStatus();
});
btnBroadPhase.addEventListener('click', () => {
  broadPhaseEnabled = !broadPhaseEnabled;
  btnBroadPhase.classList.toggle('active', broadPhaseEnabled);
  btnBroadPhase.textContent = broadPhaseEnabled ? 'Broad On' : 'Broad Off';
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
  if (closedDemo) {
    closedDemo.springSystem.controller.reset();
    for (const idx of closedDemo.fixedIndices) {
      closedDemo.springSystem.controller.fixPoint(idx);
    }
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
    const fixedCount = demo.fixedIndices.reduce((count, idx) => {
      return count + (demo.springSystem.controller.isPointFixed(idx) ? 1 : 0);
    }, 0);
    statusDiv.textContent = `Pins ${fixedCount}/${demo.fixedIndices.length} fixed | Colliders ${demo.collidersR.length} | Broad ${broadPhaseEnabled ? 'on' : 'off'} | Wind ${windEnabled ? 'on' : 'off'}`;
  } else if (activeDemo === 'closed' && closedDemo) {
    const states = closedDemo.fixedIndices.map((idx, pin) => {
      const fixed = closedDemo.springSystem.controller.isPointFixed(idx);
      return `${pin === 0 ? 'Head' : 'Tail'} ${fixed ? 'fixed' : 'free'}`;
    });
    statusDiv.textContent = `${states.join(' | ')} | Colliders ${closedDemo.collidersR.length} | Broad ${broadPhaseEnabled ? 'on' : 'off'} | Wind ${windEnabled ? 'on' : 'off'}`;
  } else {
    statusDiv.textContent = `Broad ${broadPhaseEnabled ? 'on' : 'off'} | Wind ${windEnabled ? 'on' : 'off'}`;
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

function getActiveGrabber() {
  if (activeDemo === 'chain' && chainDemo) {
    return chainDemo.grabberObj;
  }
  if (activeDemo === 'cloth' && clothDemo) {
    return clothDemo.grabberObj;
  }
  if (activeDemo === 'barrel' && barrelDemo) {
    return barrelDemo.grabberObj;
  }
  if (activeDemo === 'closed' && closedDemo) {
    return closedDemo.grabberObj;
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
  if (activeDemo === 'closed' && closedDemo) {
    return closedDemo.springSystem.controller;
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

function updateMousePosition(e) {
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
    const vis = grabber.children[0];
    if (vis) {
      vis.showState = 'visible';
    }
  }
}

getInput().useFirst((evt, type) => {
  if (evt.target !== canvas) {
    return false;
  }
  if (type === 'pointerdown') {
    if (evt.button !== 2) {
      return false;
    }
    grabbing = true;
    updateMousePosition(evt);
    updateGrabPlane();
    moveGrabberToMouse();
    const ctrl = getActiveController();
    if (ctrl) {
      ctrl.setGrabberEnabledAt(0, true);
    }
    return true;
  } else if (type === 'pointermove') {
    if (!grabbing) {
      return false;
    }
    updateMousePosition(evt);
    moveGrabberToMouse();
    const ctrl = getActiveController();
    if (ctrl) {
      ctrl.setGrabberEnabledAt(0, true);
    }
    return true;
  } else if (evt.type === 'pointerup') {
    if (!grabbing) {
      return false;
    }
    grabbing = false;
    const ctrl = getActiveController();
    if (ctrl) {
      ctrl.setGrabberEnabledAt(0, false);
    }
    const grabber = getActiveGrabber();
    if (grabber) {
      const vis = grabber.children[0];
      if (vis) {
        vis.showState = 'hidden';
      }
    }
    return true;
  }
  return false;
});
// ── Animation loop ──

function tick(dt) {
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

  if (activeDemo === 'closed' && closedDemo) {
    closedDemo.springSystem.controller.setWindForce(wind);
    closedDemo.update(elapsed, dt);
  }
}
