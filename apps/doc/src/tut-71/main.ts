import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import {
  Application,
  DirectionalLight,
  HairNode,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  getEngine,
  getInput,
  isHairSimulationSupported
} from '@zephyr3d/scene';

const HAIR_ASSET = 'https://cdn.zephyr3d.org/misc/straight.zhair';

// Radians of node rotation per pixel dragged.
const DRAG_SPEED = 0.008;

const ui = {
  blend: document.querySelector<HTMLSelectElement>('#blend-mode'),
  shading: document.querySelector<HTMLSelectElement>('#shading-model'),
  shadow: document.querySelector<HTMLSelectElement>('#shadow-mode'),
  simulation: document.querySelector<HTMLInputElement>('#simulation'),
  status: document.querySelector<HTMLDivElement>('#status')
};

const hasWebGPU = await backendWebGPU.supported();

const app = new Application({
  backend: hasWebGPU ? backendWebGPU : backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

await app.ready();

const scene = new Scene();

const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
camera.controller = new OrbitCameraController({
  controls: {
    rotate: { button: 2, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false },
    pan: { button: 2, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false },
    zoom: { button: 2, shiftKey: false, ctrlKey: true, altKey: false, metaKey: false },
    zoomWheel: true
  }
});
camera.TAA = true;

const hair = new HairNode(scene);
await loadHair();

hair.segmentsPerStrand = 24;
hair.minStrandWidth = 0.001;
hair.minPixelWidth = 0.97;
hair.albedoColor = new Vector4(0.155, 0.103, 0.017, 1);
hair.rootOcclusion = 1;
hair.scatterColor = new Vector3(1, 0.85, 0.7);
hair.scatterIntensity = 1;
hair.scatterLocal = 0.16;
hair.scatterWrap = 1;
hair.transmissionColor = new Vector3(0.9, 0.65, 0.45);
hair.transmissionPower = 6;
hair.marschnerShift = 0;
hair.marschnerRoughness = 0.39;
hair.marschnerAbsorption = 2.2;
hair.specular2Power = 40;
hair.specular2Shift = 0.1;
hair.strandRoundness = 0;

// Simulation.
hair.gravity = new Vector3(0, -4.8, 0);
hair.localStiffness = 0.13;
hair.globalStiffness = 0.01;
hair.globalRange = 0.6;
hair.ftlDamping = 0.17;
hair.damping = 0.27;
hair.substeps = 2;
hair.vspCoeff = 0.57;
hair.vspAccelThreshold = 50;

hair.transparentShadowCaster = true;
hair.transparentMotionVector = true;

const light = new DirectionalLight(scene);
light.rotation.setXYZW(-0.049534, 0.534916, 0.454403, 0.710584);
light.castShadow = true;
light.shadow.mode = 'dom';
light.shadow.domLayerDistance = 1.0;
light.shadow.domDensity = 0.3;
light.shadow.shadowRegion.addDynamicCaster(hair);

const orientation = Quaternion.identity();
const drag = { active: false, x: 0, y: 0 };

getInput().use(handleHairDrag);
getInput().use(camera.handleEvent, camera);

ui.blend.addEventListener('change', () => applyBlendMode(ui.blend.value));
ui.shading.addEventListener('change', () => applyShadingModel(ui.shading.value));
ui.shadow.addEventListener('change', () => applyShadowMode(ui.shadow.value));
ui.simulation.addEventListener('change', () => {
  hair.simulationEnabled = ui.simulation.checked;
});

applyBlendMode(ui.blend.value);
applyShadowMode(ui.shadow.value);
applyShadingModel(ui.shading.value);

getEngine().setRenderable(scene, 0);
app.run();

async function loadHair() {
  if (!hasWebGPU) {
    setStatus('This device has no WebGPU support, so the groom cannot be drawn.');
    return;
  }
  setStatus('Loading hair asset...');
  await hair.setHairAsset(HAIR_ASSET);
  if (hair.strandCount === 0) {
    setStatus('Failed to load the hair asset, see the console for details.');
    return;
  }
  frameCamera();
  ui.blend.disabled = false;
  ui.shading.disabled = false;
  ui.shadow.disabled = false;
  if (isHairSimulationSupported()) {
    ui.simulation.disabled = false;
    ui.simulation.checked = true;
    hair.simulationEnabled = true;
    setStatus(`${hair.strandCount} strands. Drag with the left button to swing the hair.`);
  } else {
    setStatus(`${hair.strandCount} strands. Strand dynamics need WebGPU.`);
  }
}

/**
 * Places the camera so the whole groom fits, from its world space bounds.
 */
function frameCamera() {
  const box = hair.getWorldBoundingVolume()?.toAABB();
  if (!box || !box.isValid()) {
    return;
  }
  const center = box.center;
  const radius = box.diagonalLength * 0.5;
  // Distance at which a sphere of that radius exactly fills the vertical field
  // of view, plus a margin so the groom does not touch the edges.
  const distance = (radius / Math.sin(camera.fovY * 0.5)) * 1.15;
  camera.near = Math.max(radius * 0.01, 0.01);
  camera.far = distance + radius * 20;
  // Slightly above and in front, so the roots and the tips are both visible.
  const eye = new Vector3(0, radius * 0.25, distance).addBy(center);
  camera.controller.lookAt(eye, center, Vector3.axisPY());
}

/**
 * Turns left-button drags into node rotation.
 */
function handleHairDrag(ev: any, type: string) {
  if (type === 'pointerdown' && ev.button === 0) {
    drag.active = true;
    drag.x = ev.offsetX;
    drag.y = ev.offsetY;
    return true;
  }
  if (type === 'pointermove' && drag.active) {
    const dx = ev.offsetX - drag.x;
    const dy = ev.offsetY - drag.y;
    drag.x = ev.offsetX;
    drag.y = ev.offsetY;
    // Rows 0 and 1 of the camera's world matrix are its right and up vectors:
    // drag horizontally and the groom spins around the screen's vertical axis,
    // drag vertically and it tumbles over the screen's horizontal one.
    const right = camera.worldMatrix.getRow(0).xyz().inplaceNormalize();
    const up = camera.worldMatrix.getRow(1).xyz().inplaceNormalize();
    const delta = Quaternion.fromAxisAngle(up, dx * DRAG_SPEED);
    delta.multiplyRight(Quaternion.fromAxisAngle(right, dy * DRAG_SPEED));
    // Renormalize: the deltas accumulate every mouse move, and the drift adds up.
    orientation.multiplyLeft(delta).inplaceNormalize();
    hair.rotation = orientation;
    return true;
  }
  if ((type === 'pointerup' || type === 'pointercancel') && drag.active) {
    drag.active = false;
    return true;
  }
  return false;
}

/**
 * Switches between the two ways a groom can resolve its edges.
 */
function applyBlendMode(mode) {
  if (mode === 'dither') {
    hair.blendMode = 'none';
    hair.alphaCutoff = 0.01;
    hair.alphaDither = true;
    hair.strandLOD = true;
    hair.strandRoundness = 0.3;
    camera.oitMode = 'none';
  } else {
    hair.blendMode = 'blend';
    hair.alphaDither = false;
    hair.alphaCutoff = 0;
    hair.strandLOD = false;
    hair.strandRoundness = 0;
    camera.oitMode = 'dual-depth';
    camera.oitDualDepthPeels = 4;
  }
}

function applyShadowMode(mode) {
  if (mode === 'none') {
    light.castShadow = false;
  } else {
    light.castShadow = true;
    light.shadow.mode = mode as 'pcf' | 'dom';
  }
}
/**
 * Switches the scattering model.
 */
function applyShadingModel(model) {
  hair.shadingModel = model;
  hair.transmissionIntensity = model === 'marschner' ? 0.13 : 0.6;
}

function setStatus(text) {
  ui.status.textContent = text;
}
