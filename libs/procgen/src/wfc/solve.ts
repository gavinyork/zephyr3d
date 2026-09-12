import { Random } from '../random';
import { DIRECTION_OFFSETS, type Direction, type WfcModel, type WfcTileDef } from './model';

/**
 * Options for {@link solveWfc}.
 * @public
 */
export interface WfcSolveOptions {
  /** Grid width in cells. */
  width: number;
  /** Grid height in cells (along +Z). */
  height: number;
  /** Random seed. The same seed and options always produce the same grid. */
  seed?: number;
  /**
   * Restricts a cell to a subset of tile ids before solving; return `null` to leave
   * it unconstrained. This is how boundary conditions are expressed — a ring of road
   * around the block, a fixed entrance, a pre-placed landmark.
   */
  fixed?: (x: number, z: number) => readonly string[] | null;
  /**
   * How many times to restart from scratch after a contradiction. Restarting is
   * simpler than backtracking and, for tile sets this small, converges quickly.
   * Defaults to 24.
   */
  maxAttempts?: number;
}

/**
 * A solved grid.
 * @public
 */
export interface WfcResult<T = unknown> {
  width: number;
  height: number;
  /** Collapsed tiles indexed `[z][x]`. */
  tiles: WfcTileDef<T>[][];
  /** How many attempts it took, counting the successful one. */
  attempts: number;
}

/** Raised internally when a cell runs out of options; callers see a retry instead. */
class Contradiction extends Error {}

function popcount(wave: Uint32Array, base: number, words: number): number {
  let total = 0;
  for (let w = 0; w < words; w++) {
    let v = wave[base + w];
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    total += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  return total;
}

function hasBit(wave: Uint32Array, base: number, tile: number): boolean {
  return (wave[base + (tile >>> 5)] & (1 << (tile & 31))) !== 0;
}

/**
 * Solves a grid by wave function collapse.
 *
 * The loop is the classic one: pick the cell with the lowest entropy, collapse it to
 * a single tile chosen by weight, then propagate the consequences until the grid is
 * arc-consistent again. Entropy is weighted rather than a plain option count, so a
 * heavily weighted tile does not make a cell look more decided than it is.
 *
 * @throws If no attempt succeeds within `maxAttempts`, or the grid size is invalid.
 * @public
 */
export function solveWfc<T>(model: WfcModel<T>, options: WfcSolveOptions): WfcResult<T> {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`WFC grid size must be positive integers, got ${width}x${height}`);
  }
  const maxAttempts = Math.max(1, options.maxAttempts ?? 24);
  const tileCount = model.tiles.length;
  const { words, weights, allowed } = model;
  const cells = width * height;

  const idToIndex = new Map<string, number>();
  model.tiles.forEach((tile, index) => idToIndex.set(tile.id, index));

  // Precomputed so entropy does not recompute logs on every cell visit.
  const logWeights = weights.map((w) => w * Math.log(w));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Decorrelate retries without disturbing the caller's seed.
    const rng = new Random((options.seed ?? 0) + (attempt - 1) * 0x9e3779b1);
    const wave = new Uint32Array(cells * words);

    // Every cell starts as "any tile", with the unused tail bits left clear.
    const fullTail = tileCount & 31;
    for (let c = 0; c < cells; c++) {
      const base = c * words;
      for (let w = 0; w < words; w++) {
        wave[base + w] = 0xffffffff;
      }
      if (fullTail !== 0) {
        wave[base + words - 1] = (1 << fullTail) - 1;
      }
    }

    const stack: number[] = [];
    try {
      if (options.fixed) {
        for (let z = 0; z < height; z++) {
          for (let x = 0; x < width; x++) {
            const ids = options.fixed(x, z);
            if (!ids) {
              continue;
            }
            const base = (z * width + x) * words;
            const mask = new Uint32Array(words);
            for (const id of ids) {
              const index = idToIndex.get(id);
              if (index === undefined) {
                throw new Error(`Fixed cell (${x}, ${z}) names unknown tile id "${id}"`);
              }
              mask[index >>> 5] |= 1 << (index & 31);
            }
            let changed = false;
            for (let w = 0; w < words; w++) {
              const next = wave[base + w] & mask[w];
              changed ||= next !== wave[base + w];
              wave[base + w] = next;
            }
            if (popcount(wave, base, words) === 0) {
              throw new Contradiction();
            }
            if (changed) {
              stack.push(z * width + x);
            }
          }
        }
      }

      // Seed propagation with every cell so the grid starts arc-consistent even when
      // a tile has no legal neighbour in some direction.
      for (let c = 0; c < cells; c++) {
        stack.push(c);
      }
      propagate();

      for (;;) {
        const cell = lowestEntropyCell();
        if (cell < 0) {
          break;
        }
        collapse(cell);
        stack.push(cell);
        propagate();
      }

      const tiles: WfcTileDef<T>[][] = [];
      for (let z = 0; z < height; z++) {
        const row: WfcTileDef<T>[] = [];
        for (let x = 0; x < width; x++) {
          const base = (z * width + x) * words;
          let chosen = -1;
          for (let t = 0; t < tileCount; t++) {
            if (hasBit(wave, base, t)) {
              chosen = t;
              break;
            }
          }
          if (chosen < 0) {
            throw new Contradiction();
          }
          row.push(model.tiles[chosen]);
        }
        tiles.push(row);
      }
      return { width, height, tiles, attempts: attempt };
    } catch (err) {
      if (err instanceof Contradiction) {
        continue;
      }
      throw err;
    }

    /** Index of the least-decided uncollapsed cell, or -1 when the grid is done. */
    function lowestEntropyCell(): number {
      let best = -1;
      let bestEntropy = Infinity;
      for (let c = 0; c < cells; c++) {
        const base = c * words;
        const count = popcount(wave, base, words);
        if (count <= 1) {
          continue;
        }
        let sumW = 0;
        let sumWLogW = 0;
        for (let t = 0; t < tileCount; t++) {
          if (hasBit(wave, base, t)) {
            sumW += weights[t];
            sumWLogW += logWeights[t];
          }
        }
        // Shannon entropy of the remaining weighted choices, plus a little noise so
        // ties do not always resolve in scan order (which produces visible streaks).
        const entropy = Math.log(sumW) - sumWLogW / sumW + rng.next() * 1e-6;
        if (entropy < bestEntropy) {
          bestEntropy = entropy;
          best = c;
        }
      }
      return best;
    }

    function collapse(cell: number): void {
      const base = cell * words;
      let total = 0;
      for (let t = 0; t < tileCount; t++) {
        if (hasBit(wave, base, t)) {
          total += weights[t];
        }
      }
      let roll = rng.next() * total;
      let chosen = -1;
      for (let t = 0; t < tileCount; t++) {
        if (!hasBit(wave, base, t)) {
          continue;
        }
        roll -= weights[t];
        chosen = t;
        if (roll <= 0) {
          break;
        }
      }
      if (chosen < 0) {
        throw new Contradiction();
      }
      for (let w = 0; w < words; w++) {
        wave[base + w] = 0;
      }
      wave[base + (chosen >>> 5)] = 1 << (chosen & 31);
    }

    function propagate(): void {
      const scratch = new Uint32Array(words);
      while (stack.length > 0) {
        const cell = stack.pop()!;
        const base = cell * words;
        const cx = cell % width;
        const cz = (cell / width) | 0;

        for (let dir = 0 as Direction; dir < 4; dir++) {
          const [dx, dz] = DIRECTION_OFFSETS[dir];
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) {
            continue;
          }
          // Everything this cell's surviving tiles would permit on that side.
          scratch.fill(0);
          for (let t = 0; t < tileCount; t++) {
            if (!hasBit(wave, base, t)) {
              continue;
            }
            const mask = allowed[dir][t];
            for (let w = 0; w < words; w++) {
              scratch[w] |= mask[w];
            }
          }
          const nBase = (nz * width + nx) * words;
          let changed = false;
          let any = 0;
          for (let w = 0; w < words; w++) {
            const next = wave[nBase + w] & scratch[w];
            changed ||= next !== wave[nBase + w];
            wave[nBase + w] = next;
            any |= next;
          }
          if (any === 0) {
            throw new Contradiction();
          }
          if (changed) {
            stack.push(nz * width + nx);
          }
        }
      }
    }
  }

  throw new Error(
    `Wave function collapse failed after ${maxAttempts} attempts on a ${width}x${height} grid. ` +
      'The tile set is probably over-constrained.'
  );
}
