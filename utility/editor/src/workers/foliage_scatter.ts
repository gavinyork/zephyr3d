/**
 * Worker generating foliage instances on a terrain, for the foliage_scatter MCP tool and for
 * painted layers with a place script.
 *
 * Candidates come from the shared candidate grid of helpers/foliagegen.ts, aligned with the
 * foliage system origin, so a region generated here matches what the foliage brush generates
 * for the same cells. A user script `place(p, api, input)` decides for each candidate whether an
 * instance stands there. `p` gives the candidate world position, the terrain height, normal and
 * slope there, the mask density and a deterministic random number; `p` is reused between calls,
 * so the script must not keep references to it.
 *
 * The script returns a falsy value to skip the candidate, true to keep it, a number in 0..1 for
 * the probability of keeping it, or an object { probability?, scale?, rotation?, y_offset? }.
 */
import { checkDeadline, cloneJsonValue, compileSandboxedScript, createScriptApi } from './procedural_core';
import type { JsonValue } from './procedural_core';
import {
  FOLIAGE_GEN_STRIDE,
  generateFoliageRegion,
  heightGridSurface,
  precomputedSurface
} from '../helpers/foliagegen';
import type { FoliageGenRegion, FoliageGenSettings } from '../helpers/foliagegen';

export type FoliageScatterMessage = {
  type: 'scatter';
  /** Place script; empty for none */
  source: string;
  entry: string;
  input: JsonValue;
  settings: FoliageGenSettings;
  /** Region to generate, local to the foliage system */
  area: FoliageGenRegion;
  /** World position of the foliage system origin */
  origin: [number, number, number];
  /**
   * Density mask of the region, one value per candidate cell, row by row over the aligned
   * region; null for a density of 1 everywhere
   */
  density: Float32Array | null;
  /**
   * Surfaces found for the candidates by the main thread (for layers on any surface, found by
   * raycasting, which the worker cannot do): per candidate cell, row by row over the aligned
   * region, world height, slope in degrees and the normal; NaN height where there is none.
   * Null to sample the height grid instead.
   */
  surfaces: Float32Array | null;
  /** Whether instances store the surface height rather than the offset above the terrain */
  storeHeight: boolean;
  /** World region of the terrain: minX, minZ, maxX, maxZ */
  region: FoliageGenRegion;
  /** World heights on the height map grid, row by row */
  heights: Float32Array;
  heightsWidth: number;
  heightsDepth: number;
  /** Local x, z pairs of instances the new ones keep away from */
  avoid: Float32Array;
  avoidRadius: number;
  deadlineAt: number;
};

export type FoliageScatterResult = {
  type: 'success';
  /** Local x, z, y offset, rotation, scale per instance */
  instances: Float32Array;
  /** Region the instances replace, local, aligned with the candidate grid */
  region: FoliageGenRegion;
  candidates: number;
};

/** Spatial grid of points the new instances keep away from */
function makeAvoidTest(avoid: Float32Array, radius: number) {
  if (avoid.length === 0 || !(radius > 0)) {
    return () => false;
  }
  const cell = radius;
  const grid = new Map<string, number[]>();
  for (let k = 0; k + 1 < avoid.length; k += 2) {
    const key = `${Math.floor(avoid[k] / cell)},${Math.floor(avoid[k + 1] / cell)}`;
    let list = grid.get(key);
    if (!list) {
      list = [];
      grid.set(key, list);
    }
    list.push(avoid[k], avoid[k + 1]);
  }
  const r2 = radius * radius;
  return (x: number, z: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = grid.get(`${cx + dx},${cz + dz}`);
        if (list) {
          for (let k = 0; k < list.length; k += 2) {
            const ex = list[k] - x;
            const ez = list[k + 1] - z;
            if (ex * ex + ez * ez < r2) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
}

function scatter(msg: FoliageScatterMessage): FoliageScatterResult {
  const S = msg.settings.spacing;
  if (!(S > 0)) {
    throw new Error('spacing must be positive');
  }
  const [ax0, az0, ax1, az1] = msg.area;
  const i0 = Math.floor(ax0 / S);
  const j0 = Math.floor(az0 / S);
  const cols = Math.ceil(ax1 / S) - i0;
  const rows = Math.ceil(az1 / S) - j0;
  if (cols * rows > 4_000_000) {
    throw new Error(`Too many candidates (${cols * rows}); raise spacing or shrink the region`);
  }
  const api = createScriptApi(msg.deadlineAt);
  const fn = msg.source.trim() ? compileSandboxedScript(msg.source, msg.entry, api) : null;
  const input = cloneJsonValue(msg.input ?? null);
  const [ox, oy, oz] = msg.origin;
  const grid = msg.surfaces
    ? null
    : heightGridSurface(msg.heights, msg.heightsWidth, msg.heightsDepth, msg.region, ox, oz);
  const fromMain = msg.surfaces ? precomputedSurface(msg.surfaces, S, i0, j0, cols) : null;
  const surface = (lx: number, lz: number) => (grid ? grid.surface(lx, lz) : fromMain!(lx, lz));
  const blocked = makeAvoidTest(msg.avoid, msg.avoidRadius);
  const density = msg.density;
  let lastProgress = Date.now();
  const result = generateFoliageRegion(
    msg.settings,
    msg.area,
    {
      // The scatter tool covers a rectangle exactly; candidates outside it are skipped
      density: (lx, lz, i, j) => {
        if (lx < ax0 || lx > ax1 || lz < az0 || lz > az1 || blocked(lx, lz)) {
          return 0;
        }
        return density ? (density[(j - j0) * cols + (i - i0)] ?? 0) : 1;
      },
      surface,
      storeHeight: msg.storeHeight,
      originX: ox,
      originY: oy,
      originZ: oz,
      place: fn ? (p) => fn(p, api, input) : undefined,
      terrainUV: grid?.terrainUV
    },
    (progress) => {
      checkDeadline(msg.deadlineAt);
      const now = Date.now();
      if (now - lastProgress > 200) {
        lastProgress = now;
        postMessage({ type: 'progress', progress });
      }
    }
  );
  return {
    type: 'success',
    instances: result.instances,
    region: result.region,
    candidates: result.candidates
  };
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

export { FOLIAGE_GEN_STRIDE };
