/**
 * Worker evaluating a user script once per sample of a terrain grid, for the terrain_generate MCP tool.
 *
 * The script defines `sample(p, api, input)`, called for every texel of the grid being generated
 * (height map, splat map or a grass density map) with `p` describing the sample:
 *
 * - `x`, `z`: world position of the texel centre; `u`, `v`: the same in 0..1 over the terrain
 * - `i`, `j`: texel column and row; `width`, `depth`: grid size in texels
 * - `height`: current terrain height (world units) at the sample, `normal`: [x, y, z] unit normal,
 *   `slope`: angle from horizontal in degrees
 *
 * `p` is reused between calls, so the script must not keep references to it.
 * `api` is the procedural script API (math, noise, rng, vec3, curve, assert, check).
 */
import { checkDeadline, cloneJsonValue, compileSandboxedScript, createScriptApi } from './procedural_core';
import type { JsonValue } from './procedural_core';

export type TerrainFieldTarget = 'height' | 'splat' | 'grass';

export type TerrainFieldMessage = {
  type: 'field';
  target: TerrainFieldTarget;
  source: string;
  entry: string;
  input: JsonValue;
  /** Output grid size in texels */
  width: number;
  depth: number;
  /** World region of the terrain: minX, minZ, maxX, maxZ */
  region: [number, number, number, number];
  /** Current world heights on the height map grid, row by row */
  heights: Float32Array;
  heightsWidth: number;
  heightsDepth: number;
  /** Number of splat (detail) layers, for the splat target */
  layers: number;
  deadlineAt: number;
};

export type TerrainFieldResult = {
  type: 'success';
  target: TerrainFieldTarget;
  /** height: world heights; splat: RGBA8 weights, 4 layers per page, page after page; grass: densities */
  data: Float32Array | Uint8Array;
  min: number;
  max: number;
};

function sampleHeight(heights: Float32Array, w: number, h: number, u: number, v: number) {
  // Texel i holds the height at the centre of cell i, at u = (i + 0.5) / w
  const fx = Math.min(Math.max(u * w - 0.5, 0), w - 1);
  const fz = Math.min(Math.max(v * h - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, w - 1);
  const z1 = Math.min(z0 + 1, h - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const a = heights[z0 * w + x0] + (heights[z0 * w + x1] - heights[z0 * w + x0]) * tx;
  const b = heights[z1 * w + x0] + (heights[z1 * w + x1] - heights[z1 * w + x0]) * tx;
  return a + (b - a) * tz;
}

function evaluate(msg: TerrainFieldMessage): TerrainFieldResult {
  const { width, depth, region, heights, heightsWidth, heightsDepth, target } = msg;
  if (!(width > 0 && depth > 0)) {
    throw new Error('Invalid grid size');
  }
  const api = createScriptApi(msg.deadlineAt);
  const fn = compileSandboxedScript(msg.source, msg.entry, api);
  const input = cloneJsonValue(msg.input ?? null);
  const rw = region[2] - region[0];
  const rh = region[3] - region[1];
  // Normal from central differences one height texel apart
  const du = 1 / heightsWidth;
  const dv = 1 / heightsDepth;
  const cellX = rw / heightsWidth;
  const cellZ = rh / heightsDepth;
  const normal: [number, number, number] = [0, 1, 0];
  const p = {
    x: 0,
    z: 0,
    u: 0,
    v: 0,
    i: 0,
    j: 0,
    width,
    depth,
    height: 0,
    normal,
    slope: 0
  };
  const layers = Math.max(1, msg.layers | 0);
  const pages = Math.ceil(layers / 4);
  let data: Float32Array | Uint8Array;
  if (target === 'height') {
    data = new Float32Array(width * depth);
  } else if (target === 'splat') {
    data = new Uint8Array(width * depth * 4 * pages);
  } else {
    data = new Uint8Array(width * depth);
  }
  const weights = new Float32Array(layers);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let lastProgress = Date.now();
  for (let j = 0; j < depth; j++) {
    checkDeadline(msg.deadlineAt);
    const now = Date.now();
    if (now - lastProgress > 200) {
      lastProgress = now;
      postMessage({ type: 'progress', progress: j / depth });
    }
    for (let i = 0; i < width; i++) {
      const u = (i + 0.5) / width;
      const v = (j + 0.5) / depth;
      p.i = i;
      p.j = j;
      p.u = u;
      p.v = v;
      p.x = region[0] + u * rw;
      p.z = region[1] + v * rh;
      p.height = sampleHeight(heights, heightsWidth, heightsDepth, u, v);
      const hl = sampleHeight(heights, heightsWidth, heightsDepth, u - du, v);
      const hr = sampleHeight(heights, heightsWidth, heightsDepth, u + du, v);
      const hd = sampleHeight(heights, heightsWidth, heightsDepth, u, v - dv);
      const hu = sampleHeight(heights, heightsWidth, heightsDepth, u, v + dv);
      const nx = -(hr - hl) / (2 * cellX);
      const nz = -(hu - hd) / (2 * cellZ);
      const len = Math.sqrt(nx * nx + 1 + nz * nz);
      normal[0] = nx / len;
      normal[1] = 1 / len;
      normal[2] = nz / len;
      p.slope = (Math.acos(Math.min(1, normal[1])) * 180) / Math.PI;
      const out = fn(p, api, input);
      const index = j * width + i;
      if (target === 'height') {
        const h = Number(out);
        if (!Number.isFinite(h)) {
          throw new Error(`sample() must return a finite height, got ${String(out)} at texel (${i}, ${j})`);
        }
        data[index] = h;
        min = Math.min(min, h);
        max = Math.max(max, h);
      } else if (target === 'grass') {
        const d = Number(out);
        if (!Number.isFinite(d)) {
          throw new Error(`sample() must return a density in 0..1, got ${String(out)} at texel (${i}, ${j})`);
        }
        const c = Math.min(1, Math.max(0, d));
        data[index] = Math.round(c * 255);
        min = Math.min(min, c);
        max = Math.max(max, c);
      } else {
        weights.fill(0);
        if (Array.isArray(out)) {
          for (let k = 0; k < Math.min(layers, out.length); k++) {
            const w = Number(out[k]);
            weights[k] = Number.isFinite(w) && w > 0 ? w : 0;
          }
        } else if (typeof out === 'number' && Number.isInteger(out) && out >= 0 && out < layers) {
          // A layer index selects that layer alone
          weights[out] = 1;
        } else {
          throw new Error(
            `sample() must return an array of ${layers} layer weights or a layer index, got ${JSON.stringify(out)} at texel (${i}, ${j})`
          );
        }
        let sum = 0;
        for (let k = 0; k < layers; k++) {
          sum += weights[k];
        }
        if (sum <= 0) {
          weights[0] = 1;
          sum = 1;
        }
        // Quantize so that the bytes of every texel add up to exactly 255
        let remaining = 255;
        let largest = 0;
        for (let k = 0; k < layers; k++) {
          const b = Math.floor((weights[k] / sum) * 255);
          weights[k] = b;
          remaining -= b;
          if (b > weights[largest]) {
            largest = k;
          }
        }
        weights[largest] += remaining;
        for (let k = 0; k < layers; k++) {
          const page = k >> 2;
          data[(page * width * depth + index) * 4 + (k & 3)] = weights[k];
        }
      }
    }
  }
  return { type: 'success', target, data, min, max };
}

self.onmessage = (event: MessageEvent<TerrainFieldMessage>) => {
  const message = event.data;
  if (message?.type !== 'field') {
    return;
  }
  try {
    const result = evaluate(message);
    (self as unknown as Worker).postMessage(result, [result.data.buffer]);
  } catch (err) {
    postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
