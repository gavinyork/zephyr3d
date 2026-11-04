/**
 * Procedural terrain: a ClipmapTerrain whose height map is filled with fractal noise.
 *
 * Algorithms, by reference:
 * - Gradient noise is Perlin's improved noise (K. Perlin, "Improving Noise", SIGGRAPH 2002): quintic
 *   fade curve and the 12 cube-edge gradients, evaluated in the z = 0 plane.
 * - Rolling hills are fractional Brownian motion, the sum of octaves with frequency multiplied by the
 *   lacunarity and amplitude by the gain (F. K. Musgrave, "Texturing & Modeling: A Procedural
 *   Approach", 3rd ed., ch. 16).
 * - Mountains are Musgrave's ridged multifractal from the same chapter (offset 1, gain 2, H 1), where
 *   the weight of an octave follows the previous signal so ridges stay sharp and valleys smooth.
 * - Domain warping offsets the sample position by two further fBm fields
 *   (I. Quilez, "Domain Warping", iquilezles.org, 2002).
 * - Redistribution raises the normalised height to a power to flatten valleys and keep peaks
 *   (Red Blob Games, "Making maps with noise functions", 2015).
 */
import { float2half, Vector3 } from '@zephyr3d/base';
import { ClipmapTerrain, DirectionalLight } from '@zephyr3d/scene';
import { numParam, setupCamera, type ExampleSceneType } from './common';

/** Small fast seeded PRNG (mulberry32), only used to shuffle the permutation table */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class ImprovedNoise {
  private readonly _perm: Uint8Array;
  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    const rand = mulberry32(seed);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this._perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this._perm[i] = p[i & 255];
    }
  }
  /** Improved noise at (x, y, 0); roughly in [-1, 1] */
  noise(x: number, y: number) {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const X = fx & 255;
    const Y = fy & 255;
    x -= fx;
    y -= fy;
    const u = fade(x);
    const v = fade(y);
    const p = this._perm;
    const A = p[X] + Y;
    const AA = p[A];
    const AB = p[A + 1];
    const B = p[X + 1] + Y;
    const BA = p[B];
    const BB = p[B + 1];
    return lerp(
      v,
      lerp(u, grad(p[AA], x, y), grad(p[BA], x - 1, y)),
      lerp(u, grad(p[AB], x, y - 1), grad(p[BB], x - 1, y - 1))
    );
  }
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number) {
  return a + t * (b - a);
}

/** Perlin's 2002 gradient selection with z = 0 */
function grad(hash: number, x: number, y: number) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

const LACUNARITY = 2;

function fbm(noise: ImprovedNoise, x: number, y: number, octaves: number, gain: number) {
  let sum = 0;
  let amp = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise.noise(x, y);
    x *= LACUNARITY;
    y *= LACUNARITY;
    amp *= gain;
  }
  return sum;
}

/** Musgrave's RidgedMultifractal with H = 1, offset = 1, gain = 2 */
function ridged(noise: ImprovedNoise, x: number, y: number, octaves: number) {
  const offset = 1;
  const gain = 2;
  let signal = offset - Math.abs(noise.noise(x, y));
  signal *= signal;
  let result = signal;
  let frequency = 1;
  for (let i = 1; i < octaves; i++) {
    x *= LACUNARITY;
    y *= LACUNARITY;
    frequency *= LACUNARITY;
    const weight = Math.min(1, Math.max(0, signal * gain));
    signal = offset - Math.abs(noise.noise(x, y));
    signal *= signal * weight;
    // pow(frequency, -H) with H = 1
    result += signal / frequency;
  }
  return result;
}

export const terrainScene: ExampleSceneType = {
  id: 'terrain',
  label: 'Terrain',
  description: 'A clipmap terrain with a fractal noise height map, lit by the sun.',
  writesAssets: false,
  params: [
    {
      type: 'enum',
      key: 'resolution',
      label: 'Resolution',
      default: '1024',
      options: [
        { value: '256', label: '256 x 256' },
        { value: '512', label: '512 x 512' },
        { value: '1024', label: '1024 x 1024' },
        { value: '2048', label: '2048 x 2048' }
      ],
      tooltip: 'Height map texels along each side'
    },
    {
      type: 'float',
      key: 'cellSize',
      label: 'Cell Size',
      default: 1,
      min: 0.1,
      max: 16,
      format: '%.2f',
      tooltip: 'World units between two height map texels'
    },
    {
      type: 'enum',
      key: 'shape',
      label: 'Landform',
      default: 'mountains',
      options: [
        { value: 'hills', label: 'Rolling hills' },
        { value: 'mountains', label: 'Ridged mountains' }
      ]
    },
    {
      type: 'float',
      key: 'maxHeight',
      label: 'Max Height',
      default: 160,
      min: 1,
      max: 2000,
      format: '%.1f',
      tooltip: 'Height of the highest peak above the lowest point, in world units'
    },
    {
      type: 'float',
      key: 'featureSize',
      label: 'Feature Size',
      default: 400,
      min: 4,
      max: 20000,
      format: '%.0f',
      tooltip: 'Width of the largest hills or mountains, in world units'
    },
    {
      type: 'int',
      key: 'octaves',
      label: 'Detail Octaves',
      default: 8,
      min: 1,
      max: 12,
      tooltip: 'More octaves add finer detail on top of the large shapes'
    },
    {
      type: 'float',
      key: 'roughness',
      label: 'Roughness',
      default: 0.5,
      min: 0.2,
      max: 0.8,
      format: '%.2f',
      tooltip: 'How strong the fine detail is compared with the large shapes (rolling hills only)'
    },
    {
      type: 'float',
      key: 'warp',
      label: 'Warp',
      default: 0.35,
      min: 0,
      max: 2,
      format: '%.2f',
      tooltip: 'Bends the shapes so they look less regular'
    },
    {
      type: 'float',
      key: 'flatness',
      label: 'Valley Flatness',
      default: 1.6,
      min: 0.5,
      max: 4,
      format: '%.2f',
      tooltip: 'Higher values widen flat valleys and leave the peaks steep'
    },
    {
      type: 'int',
      key: 'seed',
      label: 'Seed',
      default: 1,
      min: 0,
      max: 1000000
    }
  ],
  async build(ctx, params) {
    const scene = ctx.scene;
    const resolution = Number(params.resolution) || 1024;
    const cellSize = Math.max(0.01, numParam(params, 'cellSize'));
    const maxHeight = Math.max(0, numParam(params, 'maxHeight'));
    const featureSize = Math.max(1e-3, numParam(params, 'featureSize'));
    const octaves = Math.max(1, Math.round(numParam(params, 'octaves')));
    const roughness = numParam(params, 'roughness');
    const warp = Math.max(0, numParam(params, 'warp'));
    const flatness = Math.max(0.01, numParam(params, 'flatness'));
    const seed = Math.round(numParam(params, 'seed'));
    const mountains = params.shape === 'mountains';

    const noise = new ImprovedNoise(seed);
    const warpNoise = new ImprovedNoise(seed ^ 0x5f3759df);
    const worldSize = resolution * cellSize;
    const raw = new Float32Array(resolution * resolution);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let lastYield = performance.now();
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        // Texel centres, in units of the feature size
        let x = ((i + 0.5) * cellSize) / featureSize;
        let y = ((j + 0.5) * cellSize) / featureSize;
        if (warp > 0) {
          const wx = fbm(warpNoise, x, y, 4, 0.5);
          const wy = fbm(warpNoise, x + 5.2, y + 1.3, 4, 0.5);
          x += warp * wx;
          y += warp * wy;
        }
        const h = mountains ? ridged(noise, x, y, octaves) : fbm(noise, x, y, octaves, roughness);
        raw[j * resolution + i] = h;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      // Keep the editor drawing while a large map is generated
      if (performance.now() - lastYield > 50) {
        ctx.progress(`Generating terrain heights... ${Math.floor(((j + 1) / resolution) * 100)}%`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    const range = max - min || 1;
    const halfs = new Uint16Array(resolution * resolution);
    for (let k = 0; k < raw.length; k++) {
      const t = (raw[k] - min) / range;
      raw[k] = Math.pow(t, flatness) * maxHeight;
      halfs[k] = float2half(raw[k]);
    }

    const terrain = new ClipmapTerrain(scene, resolution, resolution);
    terrain.name = 'Terrain';
    terrain.parent = scene.rootNode;
    terrain.scale = new Vector3(cellSize, 1, cellSize);
    terrain.position = new Vector3(-worldSize * 0.5, 0, -worldSize * 0.5);
    terrain.setHeights(halfs);

    const sun = new DirectionalLight(scene);
    sun.name = 'Sun';
    sun.sunLight = true;
    sun.lookAt(new Vector3(0.6, 0.55, 0.45), Vector3.zero(), Vector3.axisPY());
    sun.castShadow = true;
    sun.shadow.shadowDistance = Math.min(worldSize, 2000);
    sun.shadow.numShadowCascades = 4;

    // Look across the terrain from the middle of its +Z edge
    const heightAt = (wx: number, wz: number) => {
      const i = Math.min(resolution - 1, Math.max(0, Math.floor(wx / cellSize + resolution * 0.5)));
      const j = Math.min(resolution - 1, Math.max(0, Math.floor(wz / cellSize + resolution * 0.5)));
      return raw[j * resolution + i];
    };
    const eyeZ = worldSize * 0.42;
    const eye = new Vector3(0, heightAt(0, eyeZ) + Math.max(maxHeight * 0.5, 10 * cellSize), eyeZ);
    const target = new Vector3(0, heightAt(0, 0) * 0.5, 0);
    setupCamera(scene, eye, target, Math.max(0.1, cellSize * 0.25), Math.max(1000, worldSize * 2));
  }
};
