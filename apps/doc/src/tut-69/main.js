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

// Procedural grass blade texture: a few tapered blades on transparent background
function createGrassBladeTexture(device) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const blades = [10, 24, 38, 52];
  for (let y = 0; y < size; y++) {
    // Row 0 is the top of the blade
    const tipFrac = y / (size - 1); // 0 at tip, 1 at root
    for (const cx of blades) {
      const halfWidth = 1 + tipFrac * 3.5;
      const sway = Math.sin(cx * 12.9898) * 6 * (1 - tipFrac);
      for (let x = 0; x < size; x++) {
        if (Math.abs(x - cx - sway) <= halfWidth) {
          const i = (y * size + x) * 4;
          const shade = 0.45 + 0.55 * (1 - tipFrac);
          data[i + 0] = 60 * shade;
          data[i + 1] = 160 * shade;
          data[i + 2] = 40 * shade;
          data[i + 3] = 255;
        }
      }
    }
  }
  const texture = device.createTexture2D('rgba8unorm', size, size, { mipmapping: false });
  texture.update(data, 0, 0, size, size);
  return texture;
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

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  scene.env.light.strength = 0.5;

  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 3, 0);
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
  terrain.numDetailMaps = 1;
  terrain.material.setDetailMap(0, createGroundTexture(myApp.device));
  terrain.material.setDetailMapUVScale(0, 60);

  // Add a grass layer and author its distribution through the density map:
  // grass grows on gentle slopes below a height limit. Blade instances are
  // derived from the density deterministically at runtime.
  const grassLayer = terrain.grassRenderer.getLayer(
    terrain.grassRenderer.addLayer(0.7, 0.9, createGrassBladeTexture(myApp.device))
  );
  const dw = grassLayer.densityMapWidth;
  const dh = grassLayer.densityMapHeight;
  const density = grassLayer.densityMap;
  for (let z = 0; z < dh; z++) {
    for (let x = 0; x < dw; x++) {
      const wx = ((x + 0.5) / dw) * TERRAIN_SIZE;
      const wz = ((z + 0.5) / dh) * TERRAIN_SIZE;
      const h = heightAt(wx, wz);
      // Slope from finite differences of the height function
      const slope =
        Math.abs(heightAt(wx + 1, wz) - heightAt(wx - 1, wz)) +
        Math.abs(heightAt(wx, wz + 1) - heightAt(wx, wz - 1));
      const heightMask = Math.min(1, Math.max(0, (0.65 - h) * 6));
      const slopeMask = Math.min(1, Math.max(0, (0.035 - slope) * 50));
      // Independent patch noise breaks the meadows into organic clusters
      const patch = fbm(wx * 0.06 + 91.7, wz * 0.06 + 33.1, 3);
      const patchMask = Math.min(1, Math.max(0, (patch - 0.42) * 6));
      density[z * dw + x] = Math.round(255 * heightMask * slopeMask * patchMask);
    }
  }
  grassLayer.updateDensityRegion(0, 0, dw, dh);

  // Create camera orbiting around the terrain center
  const centerHeight = heightAt(TERRAIN_SIZE / 2, TERRAIN_SIZE / 2) * TERRAIN_HEIGHT;
  const center = new Vector3(TERRAIN_SIZE / 2, centerHeight, TERRAIN_SIZE / 2);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  scene.mainCamera.lookAt(new Vector3(center.x, centerHeight + 40, center.z + 90), center, Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center });
  scene.mainCamera.FXAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
