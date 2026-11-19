import { MemoryFS, PRNG, Vector3, Vector4, float2half } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  ClipmapTerrain,
  FoliageSystem,
  FOLIAGE_INSTANCE_STRIDE,
  SceneNode,
  Mesh,
  CylinderShape,
  PBRMetallicRoughnessMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const TERRAIN_SIZE = 512;
const TERRAIN_HEIGHT = 40;
const TREE_PREFAB = '/assets/pine/pine.zprefab';

// Deterministic integer hash returning a value in [0, 1)
function hash2(ix, iz) {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// Smoothly interpolated 2D value noise
function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// Fractal noise; the sample domain is rotated each octave so no
// axis-aligned patterns show up in the terrain
function fbm(x, z, octaves) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let ox = x;
  let oz = z;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(ox, oz);
    total += amp;
    amp *= 0.5;
    const nx = (ox * 0.825 - oz * 0.565) * 2 + 13.7;
    const nz = (ox * 0.565 + oz * 0.825) * 2 + 7.3;
    ox = nx;
    oz = nz;
  }
  return sum / total;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// Rolling hills height function, returns a normalized height in [0, 1]
function heightAt(x, z) {
  const h = fbm(x * 0.007, z * 0.007, 5);
  return clamp01(h * h * (3 - 2 * h));
}

// How likely a tree is at a point, 0 to 1: patches of forest with clearings
// between them, and no trees on steep slopes
function forestDensity(x, z) {
  const gx = (heightAt(x + 1, z) - heightAt(x - 1, z)) * TERRAIN_HEIGHT * 0.5;
  const gz = (heightAt(x, z + 1) - heightAt(x, z - 1)) * TERRAIN_HEIGHT * 0.5;
  const slope = Math.hypot(gx, gz);
  const patches = fbm(x * 0.012 + 31.7, z * 0.012 + 5.3, 3);
  return clamp01((patches - 0.42) * 6) * clamp01((0.45 - slope) * 5);
}

// #region prefab
// Writes an object into the file system as an asset and records its path, so that
// a mesh using it is saved with a reference to the file
async function saveAsset(path, obj) {
  const manager = getEngine().resourceManager;
  const data = await manager.serializeObject(obj);
  await manager.VFS.writeFile(path, JSON.stringify({ type: 'Default', data }), {
    encoding: 'utf8',
    create: true
  });
  manager.setAssetId(obj, path);
}

// Builds a stylized pine from shapes and saves it as a prefab: a trunk and two cones
async function createTreePrefab(scene, path) {
  const trunkShape = new CylinderShape({ height: 3, bottomRadius: 0.22, topRadius: 0.12, radialDetail: 8 });
  const crownShape = new CylinderShape({
    height: 4,
    bottomRadius: 1.8,
    topRadius: 0,
    radialDetail: 12,
    topCap: false
  });
  const bark = new PBRMetallicRoughnessMaterial();
  bark.albedoColor = new Vector4(0.3, 0.2, 0.12, 1);
  bark.metallic = 0;
  bark.roughness = 0.9;
  const needles = new PBRMetallicRoughnessMaterial();
  needles.albedoColor = new Vector4(0.12, 0.3, 0.1, 1);
  needles.metallic = 0;
  needles.roughness = 0.8;
  // #region transmission
  // The crowns let sunlight through when the sun is behind them
  needles.foliageTransmission = true;
  needles.foliageTransmissionColor = new Vector3(0.3, 0.5, 0.1);
  // #endregion transmission
  await saveAsset('/assets/pine/trunk.zmsh', trunkShape);
  await saveAsset('/assets/pine/crown.zmsh', crownShape);
  await saveAsset('/assets/pine/bark.zmtl', bark);
  await saveAsset('/assets/pine/needles.zmtl', needles);

  const tree = new SceneNode(scene);
  const trunk = new Mesh(scene, trunkShape, bark);
  trunk.parent = tree;
  // The upper cone is a smaller copy of the lower one
  for (const [y, s] of [
    [1.5, 1],
    [3.4, 0.7]
  ]) {
    const crown = new Mesh(scene, crownShape, needles);
    crown.position.setXYZ(0, y, 0);
    crown.scale.setXYZ(s, s, s);
    crown.parent = tree;
  }
  // A prefab file is the serialized node tree in a small envelope
  const data = await getEngine().resourceManager.serializeObject(tree);
  await getEngine().resourceManager.VFS.writeFile(path, JSON.stringify({ type: 'SceneNode', data }), {
    encoding: 'utf8',
    create: true
  });
  // The foliage system loads its own copy from the file
  tree.dispose();
}
// #endregion prefab

// Per-instance culling and fading need WebGPU; WebGL2 culls whole chunks.
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

// #region vfs
const myApp = new Application({
  backend: await resolveBackend(),
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    // Asset paths resolve in an in-memory file system, which the tree prefab is written
    // into; absolute URLs, such as the ground texture, are still fetched over HTTP
    VFS: new MemoryFS()
  }
});
// #endregion vfs

myApp.ready().then(async function () {
  const webgpu = myApp.device.type === 'webgpu';
  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  scene.env.light.strength = 0.5;

  // A low sun, for long shadows and crowns lit from behind
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-1, 0.5, -0.6), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  sun.shadow.shadowDistance = 400;
  sun.shadow.numShadowCascades = 4;

  // Create a clipmap terrain covering TERRAIN_SIZE x TERRAIN_SIZE world units.
  // Height values are normalized to [0, 1] and scaled by the node's Y scale.
  const terrain = new ClipmapTerrain(scene, TERRAIN_SIZE, TERRAIN_SIZE);
  terrain.scale.setXYZ(1, TERRAIN_HEIGHT, 1);

  // #region heights
  // Foliage reads the ground height on the CPU (terrain.heightData). setHeights() uploads
  // half float heights, one per texel, and keeps that copy, so trees stand on the ground at once
  const heights = new Uint16Array(TERRAIN_SIZE * TERRAIN_SIZE);
  for (let z = 0; z < TERRAIN_SIZE; z++) {
    for (let x = 0; x < TERRAIN_SIZE; x++) {
      heights[z * TERRAIN_SIZE + x] = float2half(heightAt(x + 0.5, z + 0.5));
    }
  }
  terrain.setHeights(heights);
  // #endregion heights

  // Ground texture: the default splat map gives the first detail map full weight
  /** @type {import('@zephyr3d/device').Texture2D} */
  const groundTexture = await getEngine().resourceManager.fetchTexture(
    'https://cdn.zephyr3d.org/misc/detail1.jpg'
  );
  terrain.numDetailMaps = 1;
  terrain.material.setDetailMap(0, groundTexture);
  terrain.material.setDetailMapUVScale(0, 120);

  await createTreePrefab(scene, TREE_PREFAB);

  // #region foliage
  // The foliage system is a node under the terrain; each layer scatters one asset
  const foliage = new FoliageSystem(scene);
  foliage.parent = terrain;
  const pines = foliage.addLayer(TREE_PREFAB, {
    cullDistance: 300,
    fadeDistance: 20
  });
  // #endregion foliage

  // #region scatter
  // Places up to count trees where forestDensity allows. Each attempt draws the same five
  // numbers from a seeded sequence, so a larger count keeps the trees already placed
  function scatter(count) {
    const rng = new PRNG(1234);
    const data = new Float32Array(count * FOLIAGE_INSTANCE_STRIDE);
    let n = 0;
    for (let attempt = 0; attempt < count * 50 && n < count; attempt++) {
      const x = 4 + rng.get() * (TERRAIN_SIZE - 8);
      const z = 4 + rng.get() * (TERRAIN_SIZE - 8);
      const yaw = rng.get() * Math.PI * 2;
      const scale = 0.7 + rng.get() * 0.6;
      if (rng.get() < forestDensity(x, z)) {
        const o = n++ * FOLIAGE_INSTANCE_STRIDE;
        data[o + 0] = x; // x and z, local to the foliage system
        data[o + 1] = z;
        data[o + 2] = -0.2; // height above the ground: sink the trunk slightly
        data[o + 3] = yaw; // rotation about the vertical axis, in radians
        data[o + 4] = scale; // uniform scale
      }
    }
    // Replaces the manual (placed) instances of the layer
    foliage.setInstances(pines, data.subarray(0, n * FOLIAGE_INSTANCE_STRIDE));
  }
  // #endregion scatter

  // Camera orbiting around the terrain center, looking partly toward the sun
  const center = new Vector3(
    TERRAIN_SIZE / 2,
    heightAt(TERRAIN_SIZE / 2, TERRAIN_SIZE / 2) * TERRAIN_HEIGHT,
    TERRAIN_SIZE / 2
  );
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.5, 1500);
  scene.mainCamera.lookAt(
    new Vector3(center.x + 110, center.y + 40, center.z - 20),
    center,
    Vector3.axisPY()
  );
  scene.mainCamera.controller = new OrbitCameraController({ center, zoomSpeed: 20 });
  scene.mainCamera.TAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // UI
  /** @type {HTMLInputElement} */
  const countRange = document.querySelector('#count-range');
  /** @type {HTMLInputElement} */
  const cullRange = document.querySelector('#cull-range');
  /** @type {HTMLInputElement} */
  const fadeRange = document.querySelector('#fade-range');
  /** @type {HTMLInputElement} */
  const shadowCheck = document.querySelector('#shadow-check');
  /** @type {HTMLElement} */
  const note = document.querySelector('#backend-note');
  const layer = foliage.getLayer(pines);
  cullRange.value = String(layer.cullDistance);
  fadeRange.value = String(layer.fadeDistance);
  shadowCheck.checked = layer.castShadow;
  if (webgpu) {
    note.textContent = 'WebGPU: trees are culled and faded one by one.';
  } else {
    fadeRange.disabled = true;
    note.textContent = 'WebGL2: whole 64 m chunks are culled, and trees pop instead of fading.';
  }
  function showValues() {
    document.querySelector('#count-value').textContent = countRange.value;
    document.querySelector('#cull-value').textContent = `${cullRange.value} m`;
    document.querySelector('#fade-value').textContent = `${fadeRange.value} m`;
  }
  showValues();
  scatter(Number(countRange.value));
  for (const input of [countRange, cullRange, fadeRange]) {
    input.addEventListener('input', showValues);
  }
  // #region settings
  // Changing a layer setting rebuilds every chunk of the foliage system, and replacing the
  // instances rebuilds the chunks they touch, so the sliders apply on release, not while dragging
  countRange.addEventListener('change', () => scatter(Number(countRange.value)));
  cullRange.addEventListener('change', () => {
    foliage.setLayerSettings(pines, { cullDistance: Number(cullRange.value) });
  });
  fadeRange.addEventListener('change', () => {
    foliage.setLayerSettings(pines, { fadeDistance: Number(fadeRange.value) });
  });
  shadowCheck.addEventListener('change', () => {
    foliage.setLayerSettings(pines, { castShadow: shadowCheck.checked });
  });
  // #endregion settings

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
