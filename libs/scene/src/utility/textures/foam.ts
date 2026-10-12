import type { Texture2D } from '@zephyr3d/device';
import { getDevice } from '../../app/api';

/** Edge of the default foam texture in texels. */
const FOAM_TEX_SIZE = 256;
/** Voronoi cells across one tile of the default foam texture, coarsest octave. */
export const FOAM_TEX_CELLS = 8;
/** Width of a foam filament in units of cell size (F2 - F1). */
const FOAM_FILAMENT_WIDTH = 0.35;

let foamTexture: Texture2D | null = null;

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable F2 - F1 Voronoi with `n` cells across the tile, at uv in [0, 1). */
function voronoiEdge(u: number, v: number, n: number, seed: number) {
  const x = u * n;
  const y = v * n;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      // Wrapped for the hash only, so the tile repeats seamlessly.
      const wx = ((cx % n) + n) % n;
      const wy = ((cy % n) + n) % n;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 17);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}

/** Tileable value noise with `n` lattice cells across the tile. */
function valueNoise(u: number, v: number, n: number, seed: number) {
  const x = u * n;
  const y = v * n;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash2(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const a = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx;
  const b = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * fx;
  return a + (b - a) * fy;
}

/**
 * Default foam texture: a tileable bubble web (Voronoi edges at two scales)
 * broken into clumps by low-frequency noise, histogram-equalized so the value
 * at a texel is the share of the tile darker than it. Thresholding at `1 - d`
 * then covers about `d` of the area, which is what the black-point fade of the
 * water shader relies on. Single channel, mipmapped, repeat-wrapped.
 *
 * @internal
 */
export function getDefaultFoamTexture() {
  if (!foamTexture) {
    const size = FOAM_TEX_SIZE;
    const values = new Float32Array(size * size);
    for (let j = 0; j < size; j++) {
      const v = (j + 0.5) / size;
      for (let i = 0; i < size; i++) {
        const u = (i + 0.5) / size;
        const web0 = 1 - Math.min(voronoiEdge(u, v, FOAM_TEX_CELLS, 1) / FOAM_FILAMENT_WIDTH, 1);
        const web1 = 1 - Math.min(voronoiEdge(u, v, FOAM_TEX_CELLS * 2, 7) / FOAM_FILAMENT_WIDTH, 1);
        const clump =
          0.6 * valueNoise(u, v, FOAM_TEX_CELLS / 2, 3) + 0.4 * valueNoise(u, v, FOAM_TEX_CELLS, 11);
        // Clumps raise whole areas, the web carves holes into them.
        values[j * size + i] = (0.6 * web0 + 0.4 * web1) * 0.55 + clump * 0.45;
      }
    }
    // Histogram equalization by rank.
    const order = new Uint32Array(size * size);
    for (let i = 0; i < order.length; i++) {
      order[i] = i;
    }
    order.sort((a, b) => values[a] - values[b]);
    const data = new Uint8Array(size * size);
    for (let r = 0; r < order.length; r++) {
      data[order[r]] = Math.min(255, Math.floor((r / (order.length - 1)) * 256));
    }
    foamTexture = getDevice().createTexture2D('r8unorm', size, size)!;
    foamTexture.name = '@WaterFoam';
    foamTexture.update(data, 0, 0, size, size);
  }
  return foamTexture;
}
