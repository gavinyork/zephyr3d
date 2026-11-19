import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  Mesh,
  SphereShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// Mesh levels of detail work on every backend.
// ?backend=webgl2 or ?backend=webgpu forces a backend.
async function resolveBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'webgl2') {
    return backendWebGL2;
  }
  if (forced === 'webgpu') {
    return backendWebGPU;
  }
  return (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2;
}

const myApp = new Application({
  backend: await resolveBackend(),
  canvas: document.querySelector('#my-canvas')
});

const COLUMNS = 7;
const ROWS = 16;
const SPACING = 3;

myApp.ready().then(function () {
  const scene = new Scene();
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // #region shapes
  // With `lod` in their options, shapes simplify themselves into levels of
  // detail: each level keeps half the triangles of the one before, none has
  // fewer than 100. The editor's default pixel error is 8; 2 keeps every level
  // longer, so that all of them show within this field
  const lod = { lodMinTriangles: 100, lodReduction: 0.5, lodPixelError: 2 };
  const sphereShape = new SphereShape({
    radius: 1,
    verticalDetail: 24,
    horizonalDetail: 48,
    lod
  });
  const torusShape = new TorusShape({
    outerRadius: 0.8,
    innerRadius: 0.3,
    numSlices: 64,
    numSegments: 32,
    lod
  });
  // #endregion shapes

  const sphereMaterial = new PBRMetallicRoughnessMaterial();
  sphereMaterial.albedoColor = new Vector4(0.8, 0.55, 0.3, 1);
  sphereMaterial.roughness = 0.5;
  const torusMaterial = new PBRMetallicRoughnessMaterial();
  torusMaterial.albedoColor = new Vector4(0.3, 0.55, 0.8, 1);
  torusMaterial.metallic = 0.5;
  torusMaterial.roughness = 0.3;

  // A field of meshes sharing the two shapes. Every mesh picks its own level
  // from its size on screen, so the levels get coarser row by row
  const meshes = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLUMNS; col++) {
      const sphere = (row + col) % 2 === 0;
      const mesh = sphere
        ? new Mesh(scene, sphereShape, sphereMaterial)
        : new Mesh(scene, torusShape, torusMaterial);
      mesh.position.setXYZ((col - (COLUMNS - 1) / 2) * SPACING, 0, -row * SPACING);
      if (!sphere) {
        // Stand the ring up, facing the camera
        mesh.rotation.fromEulerAngle(Math.PI / 2, 0, 0);
      }
      meshes.push(mesh);
    }
  }

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 500);
  const center = new Vector3(0, 0, -15);
  camera.lookAt(new Vector3(0, 3, 4), center, Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center, zoomSpeed: 2 });
  scene.mainCamera = camera;
  getInput().use(camera.handleEvent, camera);

  // UI
  /** @type {HTMLInputElement} */
  const colorationCheck = document.querySelector('#coloration-check');
  /** @type {HTMLInputElement} */
  const wireframeCheck = document.querySelector('#wireframe-check');
  /** @type {HTMLInputElement} */
  const scaleRange = document.querySelector('#scale-range');
  /** @type {HTMLSelectElement} */
  const forcedSelect = document.querySelector('#forced-select');
  /** @type {HTMLSelectElement} */
  const minSelect = document.querySelector('#min-select');
  /** @type {HTMLSelectElement} */
  const errorSelect = document.querySelector('#error-select');

  function applyView() {
    // #region view
    // Debug views: index.html sets globalThis.__ZEPHYR3D_DEBUG_VIEWS__ before
    // the engine loads, without it these two have no effect
    camera.lodColoration = colorationCheck.checked;
    camera.wireframe = wireframeCheck.checked;
    // Above 1, meshes switch to coarser levels closer to the camera
    camera.lodDistanceScale = Number(scaleRange.value);
    for (const mesh of meshes) {
      // -1 picks the level by screen size; past the coarsest level means the coarsest
      mesh.forcedLod = Number(forcedSelect.value);
      // The finest level picked by screen size
      mesh.minLod = Number(minSelect.value);
    }
    // #endregion view
    minSelect.disabled = forcedSelect.value !== '-1';
    document.querySelector('#scale-value').textContent = camera.lodDistanceScale.toFixed(2);
  }
  for (const control of [colorationCheck, wireframeCheck, forcedSelect, minSelect]) {
    control.addEventListener('change', applyView);
  }
  scaleRange.addEventListener('input', applyView);
  applyView();

  errorSelect.value = String(lod.lodPixelError);
  // #region rebuild
  // New options rebuild a shape, its levels of detail included; every mesh
  // using the shape follows
  errorSelect.addEventListener('change', function () {
    const lodPixelError = Number(errorSelect.value);
    for (const shape of [sphereShape, torusShape]) {
      shape.options = { ...shape.options, lod: { ...shape.options.lod, lodPixelError } };
    }
  });
  // #endregion rebuild

  // Triangles drawn at the levels this camera uses, against all at level 0
  const stats = document.querySelector('#stats');
  function updateStats() {
    let triangles = 0;
    let fullTriangles = 0;
    for (const mesh of meshes) {
      const primitive = mesh.primitive;
      // The level the renderer draws the mesh at for this camera
      const level = mesh.selectLod(camera);
      triangles += (level > 0 ? primitive.lods[level - 1].indexCount : primitive.indexCount) / 3;
      fullTriangles += primitive.indexCount / 3;
    }
    stats.textContent =
      `Levels: sphere ${sphereShape.lodCount}, torus ${torusShape.lodCount}\n` +
      `Triangles: ${triangles.toLocaleString('en-US')} / ${fullTriangles.toLocaleString('en-US')}`;
  }
  let frame = 0;
  myApp.on('tick', function () {
    if (frame++ % 10 === 0) {
      updateStats();
    }
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
