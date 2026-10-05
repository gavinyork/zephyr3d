import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  ClipmapTerrain,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const TERRAIN_SIZE = 256;
const TERRAIN_HEIGHT = 35;

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

// Rolling hills height function, returns a normalized height in [0, 1]
function heightAt(x, z) {
  const h = fbm(x * 0.012, z * 0.012, 5);
  // Push valleys slightly wider than peaks
  return Math.min(1, Math.max(0, h * h * (3 - 2 * h)));
}

// Procedural ground detail texture: green with brownish noise
function createGroundTexture(device) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Low-frequency mottling plus per-texel grain
      const t = 0.7 * valueNoise(x * 0.15, y * 0.15) + 0.3 * hash2(x, y);
      data[i * 4 + 0] = 55 + t * 45;
      data[i * 4 + 1] = 110 + t * 40;
      data[i * 4 + 2] = 35 + t * 25;
      data[i * 4 + 3] = 255;
    }
  }
  const texture = device.createTexture2D('rgba8unorm', size, size);
  texture.update(data, 0, 0, size, size);
  return texture;
}

// Geometry grass blades need WebGPU; WebGL2 falls back to textured grass cards.
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

myApp.ready().then(async function () {
  const webgpu = myApp.device.type === 'webgpu';
  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  scene.env.light.strength = 0.5;

  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 1.1, Math.PI / 3, 0);
  sun.castShadow = true;

  // Create a clipmap terrain covering TERRAIN_SIZE x TERRAIN_SIZE world units
  const terrain = new ClipmapTerrain(scene, TERRAIN_SIZE, TERRAIN_SIZE);
  terrain.scale.setXYZ(1, TERRAIN_HEIGHT, 1);

  // Fill the height map procedurally. Height values are normalized to [0, 1]
  // and scaled by the node's Y scale.
  const heightData = new Float32Array(TERRAIN_SIZE * TERRAIN_SIZE);
  for (let z = 0; z < TERRAIN_SIZE; z++) {
    for (let x = 0; x < TERRAIN_SIZE; x++) {
      heightData[z * TERRAIN_SIZE + x] = heightAt(x, z);
    }
  }
  const heightMap = myApp.device.createTexture2D('r32f', TERRAIN_SIZE, TERRAIN_SIZE, {
    mipmapping: false
  });
  heightMap.update(heightData, 0, 0, TERRAIN_SIZE, TERRAIN_SIZE);
  terrain.heightMap = heightMap;
  terrain.updateBoundingBox();

  // Ground texture: the default splat map gives the first detail map full weight
  /** @type {import('@zephyr3d/device').Texture2D} */
  const groundTexture = await getEngine().resourceManager.fetchTexture(
    'https://cdn.zephyr3d.org/misc/detail1.jpg'
  );
  terrain.numDetailMaps = 1;
  terrain.material.setDetailMap(0, groundTexture);
  terrain.material.setDetailMapUVScale(0, 60);

  // Author the grass distribution once as a density map, one byte per texel:
  // grass grows on gentle slopes and thins out on steep ones. Blade instances
  // are derived from the density deterministically at runtime.
  const dw = TERRAIN_SIZE;
  const dh = TERRAIN_SIZE;
  const density = new Uint8Array(dw * dh);
  for (let z = 0; z < dh; z++) {
    for (let x = 0; x < dw; x++) {
      const wx = ((x + 0.5) / dw) * TERRAIN_SIZE;
      const wz = ((z + 0.5) / dh) * TERRAIN_SIZE;
      // Slope from finite differences of the height function
      const slope =
        Math.abs(heightAt(wx + 1, wz) - heightAt(wx - 1, wz)) +
        Math.abs(heightAt(wx, wz + 1) - heightAt(wx, wz - 1));
      const slopeMask = Math.min(1, Math.max(0, (0.07 - slope) * 30));
      density[z * dw + x] = Math.round(255 * slopeMask);
    }
  }
  const empty = new Uint8Array(dw * dh);

  // Textured grass cards: every backend
  /** @type {import('@zephyr3d/device').Texture2D} */
  const grassTexture = await getEngine().resourceManager.fetchTexture(
    'https://cdn.zephyr3d.org/misc/grass2.dds'
  );
  const cardLayer = terrain.grassRenderer.getLayer(terrain.grassRenderer.addLayer(0.7, 0.9, grassTexture));
  cardLayer.drawDistance = 300;
  const bladeLayer = webgpu
    ? terrain.grassRenderer.getLayer(terrain.grassRenderer.addLayer(0.04, 1.5, null, 'blade'))
    : null;
  if (bladeLayer) {
    bladeLayer.drawDistance = 300;
  }
  // Shows one kind of grass: the other layer gets an empty density map.
  // Blades are denser, up to 8 x 8 per density texel instead of 2 x 2
  function showGrass(kind) {
    const blades = kind === 'blade' && !!bladeLayer;
    cardLayer.setDensityData(dw, dh, 2, blades ? empty : density);
    bladeLayer?.setDensityData(dw, dh, 8, blades ? density : empty);
  }
  showGrass(webgpu ? 'blade' : 'card');

  // Grass sways in the scene-wide wind
  scene.env.wind.direction = 30;
  scene.env.wind.strength = 0.5;

  // Create camera orbiting around the terrain center
  const centerHeight = heightAt(TERRAIN_SIZE / 2, TERRAIN_SIZE / 2) * TERRAIN_HEIGHT;
  const center = new Vector3(TERRAIN_SIZE / 2, centerHeight, TERRAIN_SIZE / 2);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 1000);
  // Close to the ground, where the blades show; zoom out to see the meadows
  scene.mainCamera.lookAt(new Vector3(center.x, centerHeight + 4, center.z + 12), center, Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center });
  scene.mainCamera.FXAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // UI
  /** @type {HTMLSelectElement} */
  const grassSelect = document.querySelector('#grass-select');
  /** @type {HTMLInputElement} */
  const windRange = document.querySelector('#wind-range');
  /** @type {HTMLElement} */
  const note = document.querySelector('#backend-note');
  if (webgpu) {
    grassSelect.value = 'blade';
    note.textContent = 'WebGPU: geometry blades available.';
  } else {
    grassSelect.value = 'card';
    grassSelect.disabled = true;
    note.textContent = 'WebGL2: geometry blades need WebGPU, showing grass cards.';
  }
  grassSelect.addEventListener('change', () => showGrass(grassSelect.value));
  windRange.value = String(scene.env.wind.strength);
  windRange.addEventListener('input', () => {
    scene.env.wind.strength = Number(windRange.value);
  });

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
