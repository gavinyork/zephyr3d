/**
 * Worker generating foliage instances for the foliage_scatter MCP tool.
 *
 * Candidates are laid on a jittered grid with a cell of `spacing` over the region, then a user
 * script `place(p, api, input)` decides for each one whether an instance stands there. `p` gives
 * the candidate world position, the terrain height, normal and slope there, and a deterministic
 * random number; `p` is reused between calls, so the script must not keep references to it.
 *
 * The script returns a falsy value to skip the candidate, true to keep it, a number in 0..1 for
 * the probability of keeping it, or an object { probability?, scale?, rotation?, y_offset? }.
 */
import { checkDeadline, cloneJsonValue, compileSandboxedScript, createScriptApi } from './procedural_core';
import type { JsonValue } from './procedural_core';
import { sampleHeight, sampleNormal } from './terrain_sampling';

export type FoliageScatterMessage = {
  type: 'scatter';
  source: string;
  entry: string;
  input: JsonValue;
  seed: number;
  /** Distance between candidates, which is also the minimum distance between the new instances */
  spacing: number;
  /** Random scale range applied when the script does not set a scale */
  scaleRange: [number, number];
  /** World region to scatter in: minX, minZ, maxX, maxZ */
  area: [number, number, number, number];
  /** World region of the terrain: minX, minZ, maxX, maxZ */
  region: [number, number, number, number];
  /** World heights on the height map grid, row by row */
  heights: Float32Array;
  heightsWidth: number;
  heightsDepth: number;
  /** World x, z pairs of instances the new ones keep away from */
  avoid: Float32Array;
  avoidRadius: number;
  deadlineAt: number;
};

export type FoliageScatterResult = {
  type: 'success';
  /** World x, z, y offset, rotation, scale per instance */
  instances: Float32Array;
  candidates: number;
};

function hash2(x: number, z: number, seed: number) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scatter(msg: FoliageScatterMessage): FoliageScatterResult {
  const spacing = msg.spacing;
  if (!(spacing > 0)) {
    throw new Error('spacing must be positive');
  }
  const [ax0, az0, ax1, az1] = msg.area;
  const cols = Math.ceil((ax1 - ax0) / spacing);
  const rows = Math.ceil((az1 - az0) / spacing);
  if (cols * rows > 4_000_000) {
    throw new Error(`Too many candidates (${cols * rows}); raise spacing or shrink the region`);
  }
  const api = createScriptApi(msg.deadlineAt);
  const fn = compileSandboxedScript(msg.source, msg.entry, api);
  const input = cloneJsonValue(msg.input ?? null);
  const { region, heights, heightsWidth, heightsDepth } = msg;
  const rw = region[2] - region[0];
  const rh = region[3] - region[1];
  // Grid of the instances to keep away from, with cells as large as the avoid radius
  const avoidRadius = msg.avoidRadius;
  const avoidCell = Math.max(avoidRadius, 1e-3);
  const avoidGrid = new Map<string, number[]>();
  for (let k = 0; k + 1 < msg.avoid.length; k += 2) {
    const key = `${Math.floor(msg.avoid[k] / avoidCell)},${Math.floor(msg.avoid[k + 1] / avoidCell)}`;
    let list = avoidGrid.get(key);
    if (!list) {
      list = [];
      avoidGrid.set(key, list);
    }
    list.push(msg.avoid[k], msg.avoid[k + 1]);
  }
  const blocked = (x: number, z: number) => {
    if (avoidGrid.size === 0) {
      return false;
    }
    const cx = Math.floor(x / avoidCell);
    const cz = Math.floor(z / avoidCell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = avoidGrid.get(`${cx + dx},${cz + dz}`);
        if (list) {
          for (let k = 0; k < list.length; k += 2) {
            const ex = list[k] - x;
            const ez = list[k + 1] - z;
            if (ex * ex + ez * ez < avoidRadius * avoidRadius) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
  const normal: [number, number, number] = [0, 1, 0];
  const p = { x: 0, z: 0, u: 0, v: 0, height: 0, normal, slope: 0, random: 0 };
  const out: number[] = [];
  const [s0, s1] = msg.scaleRange;
  let lastProgress = Date.now();
  for (let j = 0; j < rows; j++) {
    checkDeadline(msg.deadlineAt);
    const now = Date.now();
    if (now - lastProgress > 200) {
      lastProgress = now;
      postMessage({ type: 'progress', progress: j / rows });
    }
    for (let i = 0; i < cols; i++) {
      // Jittered within a cell inset so that neighbours never get closer than about half a spacing
      const rand = mulberry32(hash2(i, j, msg.seed));
      const x = ax0 + (i + 0.15 + rand() * 0.7) * spacing;
      const z = az0 + (j + 0.15 + rand() * 0.7) * spacing;
      if (x > ax1 || z > az1) {
        continue;
      }
      const u = (x - region[0]) / rw;
      const v = (z - region[1]) / rh;
      if (u < 0 || u > 1 || v < 0 || v > 1 || blocked(x, z)) {
        continue;
      }
      p.x = x;
      p.z = z;
      p.u = u;
      p.v = v;
      p.height = sampleHeight(heights, heightsWidth, heightsDepth, u, v);
      p.slope = sampleNormal(heights, heightsWidth, heightsDepth, u, v, rw, rh, normal);
      p.random = rand();
      const r = fn(p, api, input) as unknown;
      let probability = 0;
      let scale = Number.NaN;
      let rotation = Number.NaN;
      let yOffset = 0;
      if (r === true) {
        probability = 1;
      } else if (typeof r === 'number') {
        probability = r;
      } else if (r && typeof r === 'object') {
        const o = r as Record<string, unknown>;
        probability = o.probability === undefined ? 1 : Number(o.probability);
        scale = o.scale === undefined ? Number.NaN : Number(o.scale);
        rotation = o.rotation === undefined ? Number.NaN : Number(o.rotation);
        yOffset = o.y_offset === undefined ? 0 : Number(o.y_offset);
      }
      if (!(probability > 0) || rand() >= probability) {
        continue;
      }
      if (!Number.isFinite(scale)) {
        scale = s0 + (s1 - s0) * rand();
      }
      if (!Number.isFinite(rotation)) {
        rotation = rand() * Math.PI * 2;
      }
      out.push(x, z, Number.isFinite(yOffset) ? yOffset : 0, rotation, scale);
    }
  }
  return { type: 'success', instances: new Float32Array(out), candidates: cols * rows };
}

self.onmessage = (event: MessageEvent<FoliageScatterMessage>) => {
  const message = event.data;
  if (message?.type !== 'scatter') {
    return;
  }
  try {
    const result = scatter(message);
    (self as unknown as Worker).postMessage(result, [result.instances.buffer]);
  } catch (err) {
    postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
