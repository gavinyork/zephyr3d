import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  CapsuleShape,
  CylinderShape,
  SphereShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  renderSceneSDFView,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// The global field is composited by compute shaders and needs WebGPU.
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

function makeMaterial(r, g, b) {
  const material = new PBRMetallicRoughnessMaterial();
  material.albedoColor = new Vector4(r, g, b, 1);
  material.metallic = 0;
  material.roughness = 0.8;
  return material;
}

myApp.ready().then(function () {
  const webgpu = myApp.device.type === 'webgpu';
  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 3, Math.PI / 5, 0);
  sun.castShadow = true;

  // #region enable
  // Turn the scene field on. These few fields need under a million voxels,
  // so the shared atlas is cut from its 512x256x256 default (64 MB) to
  // 256x128x128 (8 MB)
  scene.sdf.enabled = true;
  scene.sdf.atlasSize = [256, 128, 128];
  // #endregion enable

  // Code-built shapes have no baked .zsdf file; their fields are baked below
  const primitives = [];
  const ground = new Mesh(
    scene,
    new BoxShape({ sizeX: 18, sizeY: 1, sizeZ: 18 }),
    makeMaterial(0.5, 0.5, 0.5)
  );
  ground.position.setXYZ(0, -0.5, 0);
  primitives.push(ground.primitive);
  const sphere = new Mesh(scene, new SphereShape({ radius: 1.2 }), makeMaterial(0.8, 0.3, 0.2));
  sphere.position.setXYZ(0, 1, 0);
  sun.shadow.shadowRegion.addStaticCaster(sphere);
  primitives.push(sphere.primitive);
  const box = new Mesh(scene, new BoxShape({ size: 2 }), makeMaterial(0.2, 0.45, 0.8));
  box.position.setXYZ(-3, 1, 0.5);
  box.rotation.fromEulerAngle(0, Math.PI / 6, 0);
  sun.shadow.shadowRegion.addStaticCaster(box);
  primitives.push(box.primitive);
  const capsule = new Mesh(
    scene,
    new CapsuleShape({ radius: 0.6, height: 1.6 }),
    makeMaterial(0.3, 0.7, 0.3)
  );
  capsule.position.setXYZ(1.5, 0.6, -2.4);
  capsule.rotation.fromEulerAngle(0, 0, Math.PI / 2);
  sun.shadow.shadowRegion.addStaticCaster(capsule);
  primitives.push(capsule.primitive);
  // Four pillars share one primitive, so they share one field as well
  const pillarShape = new CylinderShape({ topRadius: 0.5, bottomRadius: 0.5, height: 4 });
  const pillarMaterial = makeMaterial(0.75, 0.7, 0.6);
  for (const [x, z] of [
    [-7, -7],
    [7, -7],
    [-7, 7],
    [7, 7]
  ]) {
    const pillar = new Mesh(scene, pillarShape, pillarMaterial);
    pillar.position.setXYZ(x, 0, z);
    sun.shadow.shadowRegion.addStaticCaster(pillar);
  }
  primitives.push(pillarShape);

  // #region ring
  // A ring moved by code every frame. Without a rigid body, skin or morph
  // targets, 'auto' resolves it to static; 'dynamic' merges its field at
  // the current transform instead of compositing it into the clipmap
  const ring = new Mesh(
    scene,
    new TorusShape({ outerRadius: 1, innerRadius: 0.35 }),
    makeMaterial(0.9, 0.7, 0.2)
  );
  ring.sdfMode = 'dynamic';
  sun.shadow.shadowRegion.addDynamicCaster(ring);
  // #endregion ring
  primitives.push(ring.primitive);
  let angle = 0;
  function placeRing() {
    ring.position.setXYZ(Math.cos(angle) * 6, 1.5, Math.sin(angle) * 6);
    ring.rotation.fromEulerAngle(angle * 3, angle, 0.5);
  }
  placeRing();

  // #region bake
  // Bake the fields on the CPU from the shapes' triangles: once per
  // primitive, never per frame. Meshes pick their field up once it is set
  Promise.all(primitives.map((primitive) => scene.sdf.bakeField(primitive))).catch((err) =>
    console.error(`Cannot bake a distance field: ${err}`)
  );
  // #endregion bake

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 11, 7), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // UI
  /** @type {HTMLInputElement} */
  const fieldCheck = document.querySelector('#field-check');
  /** @type {HTMLSelectElement} */
  const modeSelect = document.querySelector('#mode-select');
  /** @type {HTMLInputElement} */
  const moveCheck = document.querySelector('#move-check');
  /** @type {HTMLSelectElement} */
  const budgetSelect = document.querySelector('#budget-select');
  /** @type {HTMLElement} */
  const statsBox = document.querySelector('#stats');
  /** @type {HTMLElement} */
  const note = document.querySelector('#backend-note');
  modeSelect.value = ring.sdfMode;
  modeSelect.addEventListener('change', () => {
    ring.sdfMode = /** @type {import('@zephyr3d/scene').MeshSDFMode} */ (modeSelect.value);
  });
  // #region budget
  // Clipmap bricks composited per frame; scene.sdf.global is null on WebGL2
  budgetSelect.addEventListener('change', () => {
    const globalSdf = scene.sdf.global;
    if (globalSdf) {
      globalSdf.brickBudget = Number(budgetSelect.value);
    }
  });
  // #endregion budget
  if (webgpu) {
    note.textContent = 'WebGPU: the debug view traces the global field.';
  } else {
    fieldCheck.checked = false;
    fieldCheck.disabled = true;
    budgetSelect.disabled = true;
    note.textContent =
      'WebGL2: fields still stream into the atlas, but the global field and its debug view need WebGPU.';
  }

  // #region stats
  // Live counters: streaming from scene.sdf, compositing from the global field
  function showStats() {
    const s = scene.sdf.getStats();
    const lines = [
      `Instances ${s.instances} (static ${s.staticInstances}, dynamic ${s.dynamicInstances})`,
      `Ready ${s.readyInstances}, fields ${s.assets}, in atlas ${s.assetsResident}`,
      `Atlas ${(s.atlasOccupancy * 100).toFixed(1)}% used, ${s.pendingUploads} uploads pending`,
      `Ring resolves to ${ring.effectiveSDFMode}`
    ];
    const globalSdf = scene.sdf.global;
    if (globalSdf) {
      const g = globalSdf.getStats();
      lines.push(`Bricks last frame ${g.lastBricks}, still dirty ${g.dirtyBricks}`);
      lines.push(`Dynamic meshes merged ${globalSdf.dynamicCount}`);
    }
    statsBox.textContent = lines.join('\n');
  }
  // #endregion stats

  let statsTime = 0;
  myApp.on('tick', function () {
    const dt = myApp.device.frameInfo.elapsedFrame;
    if (moveCheck.checked) {
      angle += dt * 0.0005;
      placeRing();
    }
    statsTime += dt;
    if (statsTime > 200) {
      statsTime = 0;
      showStats();
    }
  });

  // #region view
  // The distance field debug view: once the camera has rendered the scene,
  // every pixel sphere-traces the global field and overwrites the frame.
  // Surfaces are grey, empty space blue; both brighten with the number of
  // tracing steps, so silhouettes glow. Draws nothing without a global field
  getEngine().setRenderable(scene, 0, {
    afterRender(scene) {
      if (fieldCheck.checked) {
        renderSceneSDFView(scene, scene.mainCamera, 'distance');
      }
    }
  });
  // #endregion view
  myApp.run();
});
