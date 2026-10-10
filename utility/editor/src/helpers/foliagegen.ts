/**
 * Candidate grid and generation rule of foliage layers, shared by the foliage brush on the main
 * thread and the scatter worker. Dependency free, so that the worker can import it.
 *
 * Candidates lie on a grid of `spacing` aligned with the origin of the foliage system, one per
 * cell `(i, j)` covering `[i·S, (i+1)·S) × [j·S, (j+1)·S)`. Each cell seeds a generator from its
 * coordinates and the layer seed only, and draws in a fixed order: the jitter of its position,
 * its threshold, its rotation and its scale. A candidate is thus the same whenever and wherever
 * it is evaluated, which is what lets one area be regenerated on its own: the instances outside
 * stay untouched, and the ones inside that already existed come out bit for bit the same.
 *
 * The approach follows the PCG paint tool of Unreal Engine 5, which also seeds every point from
 * its position (PCGHelpers::ComputeSeedFromPosition) so that painted points stay stable.
 */

/** Number of floats per foliage instance: x, z, y offset, rotation about Y, scale */
export const FOLIAGE_GEN_STRIDE = 5;

/** A region of the plane of a foliage system, `[minX, minZ, maxX, maxZ]` */
export type FoliageGenRegion = [number, number, number, number];

/** The generation settings of a layer the rule needs (see FoliageGeneration in the scene package) */
export type FoliageGenSettings = {
  spacing: number;
  scaleRange: [number, number];
  slopeRange: [number, number];
  heightRange: [number, number] | null;
  yOffset: number;
  randomYaw: boolean;
  seed: number;
};

/** What a candidate stands on, found by the caller */
export type FoliageGenSurface = {
  /** World height of the surface */
  height: number;
  /** Slope of the surface in degrees from horizontal */
  slope: number;
  /** Unit normal of the surface, world space */
  normal: [number, number, number];
};

/** A candidate handed to the place script, reused between calls */
export type FoliageGenPoint = {
  /** World position */
  x: number;
  z: number;
  /** Position local to the foliage system */
  lx: number;
  lz: number;
  height: number;
  slope: number;
  normal: [number, number, number];
  /** Density of the mask there, 0..1 */
  density: number;
  /** Deterministic random number of the candidate, 0..1 */
  random: number;
  /** Normalized terrain coordinates, when the layer stands on a terrain */
  u: number;
  v: number;
};

/** What a place script returned, normalized */
export type FoliageGenPlacement = {
  probability: number;
  scale: number;
  rotation: number;
  yOffset: number;
};

/** Everything a generation pass needs besides the settings */
export type FoliageGenContext = {
  /** Density of the mask at the candidate of cell (i, j), at local position (lx, lz), 0..1 */
  density(lx: number, lz: number, i: number, j: number): number;
  /**
   * The surface below a local position; null when there is none (off the terrain, or no
   * collider below), in which case no instance stands there
   */
  surface(lx: number, lz: number): FoliageGenSurface | null;
  /**
   * Whether instances store the surface height (any surface) or only the offset above it
   * (terrain, whose height is added when the instance is drawn)
   */
  storeHeight: boolean;
  /** World position of the origin of the foliage system, minus which positions are local */
  originX: number;
  originY: number;
  originZ: number;
  /** Optional rule; returns what a place script returns */
  place?: (p: FoliageGenPoint) => unknown;
  /** Normalized terrain coordinates of a local position, for the place script */
  terrainUV?: (lx: number, lz: number) => [number, number];
};

/** Hash of a candidate cell and seed, the seed of its random sequence */
export function foliageCellHash(i: number, j: number, seed: number) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Same algorithm as PRNG in @zephyr3d/base (libs/base/src/prng.ts) */
export function foliageMulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalizes what a place script returned: false/0/null skip, true keeps, a number is a probability */
export function normalizePlacement(r: unknown): FoliageGenPlacement {
  const out: FoliageGenPlacement = { probability: 0, scale: Number.NaN, rotation: Number.NaN, yOffset: 0 };
  if (r === true) {
    out.probability = 1;
  } else if (typeof r === 'number') {
    out.probability = r;
  } else if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    out.probability = o.probability === undefined ? 1 : Number(o.probability);
    out.scale = o.scale === undefined ? Number.NaN : Number(o.scale);
    out.rotation = o.rotation === undefined ? Number.NaN : Number(o.rotation);
    out.yOffset = o.y_offset === undefined ? 0 : Number(o.y_offset);
  }
  if (!Number.isFinite(out.probability)) {
    out.probability = 0;
  }
  if (!Number.isFinite(out.yOffset)) {
    out.yOffset = 0;
  }
  return out;
}

/** The candidate cells a region needs, inclusive, and the region they exactly cover */
export function foliageCellRange(region: Readonly<FoliageGenRegion>, spacing: number) {
  const i0 = Math.floor(region[0] / spacing);
  const j0 = Math.floor(region[1] / spacing);
  // A region edge on a cell edge does not reach into the next cell
  const i1 = Math.ceil(region[2] / spacing) - 1;
  const j1 = Math.ceil(region[3] / spacing) - 1;
  const aligned: FoliageGenRegion = [i0 * spacing, j0 * spacing, (i1 + 1) * spacing, (j1 + 1) * spacing];
  return { i0, j0, i1, j1, aligned };
}

/**
 * Local positions of the candidates in a region, x and z per cell, row by row over
 * {@link foliageCellRange}`(region)`; to sample a density mask at them
 * @param settings - Generation settings; only spacing and seed matter
 * @param region - Region, local; widened to whole candidate cells
 */
export function foliageCandidatePositions(
  settings: Pick<FoliageGenSettings, 'spacing' | 'seed'>,
  region: Readonly<FoliageGenRegion>
) {
  const S = settings.spacing;
  const range = foliageCellRange(region, S);
  const cols = range.i1 - range.i0 + 1;
  const rows = range.j1 - range.j0 + 1;
  const positions = new Float32Array(Math.max(0, cols * rows * 2));
  let o = 0;
  for (let j = range.j0; j <= range.j1; j++) {
    for (let i = range.i0; i <= range.i1; i++) {
      const rand = foliageMulberry32(foliageCellHash(i, j, settings.seed));
      positions[o++] = (i + 0.15 + rand() * 0.7) * S;
      positions[o++] = (j + 0.15 + rand() * 0.7) * S;
    }
  }
  return { ...range, cols, rows, positions };
}

/**
 * Generates the instances of the candidates in a region
 *
 * @remarks
 * Every cell the region touches is evaluated, so the result covers exactly
 * {@link foliageCellRange}`(region).aligned`; replace the generated instances of that region
 * with it. Instances are written local to the foliage system.
 *
 * @param settings - Generation settings of the layer
 * @param region - Region, local; widened to whole candidate cells
 * @param ctx - Mask, surface and rule
 * @param check - Called every row, e.g. to enforce a deadline
 * @returns The instances, and the aligned region they replace
 */
export function generateFoliageRegion(
  settings: FoliageGenSettings,
  region: Readonly<FoliageGenRegion>,
  ctx: FoliageGenContext,
  check?: (progress: number) => void
) {
  const S = settings.spacing;
  const { i0, j0, i1, j1, aligned } = foliageCellRange(region, S);
  const out: number[] = [];
  const [s0, s1] = settings.scaleRange;
  const slopeMin = Math.min(settings.slopeRange[0], settings.slopeRange[1]);
  const slopeMax = Math.max(settings.slopeRange[0], settings.slopeRange[1]);
  const hr = settings.heightRange;
  const p: FoliageGenPoint = {
    x: 0,
    z: 0,
    lx: 0,
    lz: 0,
    height: 0,
    slope: 0,
    normal: [0, 1, 0],
    density: 0,
    random: 0,
    u: 0,
    v: 0
  };
  const rows = j1 - j0 + 1;
  for (let j = j0; j <= j1; j++) {
    check?.((j - j0) / rows);
    for (let i = i0; i <= i1; i++) {
      // The draws below happen in the same order for every cell, whether it is kept or not
      const rand = foliageMulberry32(foliageCellHash(i, j, settings.seed));
      const lx = (i + 0.15 + rand() * 0.7) * S;
      const lz = (j + 0.15 + rand() * 0.7) * S;
      const threshold = rand();
      const yaw = rand() * Math.PI * 2;
      const scaleT = rand();
      const random = rand();
      const density = ctx.density(lx, lz, i, j);
      if (!(density > threshold)) {
        continue;
      }
      const surface = ctx.surface(lx, lz);
      if (!surface) {
        continue;
      }
      if (surface.slope < slopeMin || surface.slope > slopeMax) {
        continue;
      }
      if (hr && (surface.height < Math.min(hr[0], hr[1]) || surface.height > Math.max(hr[0], hr[1]))) {
        continue;
      }
      let placement: FoliageGenPlacement | null = null;
      if (ctx.place) {
        p.x = lx + ctx.originX;
        p.z = lz + ctx.originZ;
        p.lx = lx;
        p.lz = lz;
        p.height = surface.height;
        p.slope = surface.slope;
        p.normal[0] = surface.normal[0];
        p.normal[1] = surface.normal[1];
        p.normal[2] = surface.normal[2];
        p.density = density;
        p.random = random;
        if (ctx.terrainUV) {
          const [u, v] = ctx.terrainUV(lx, lz);
          p.u = u;
          p.v = v;
        }
        placement = normalizePlacement(ctx.place(p));
        if (!(density * placement.probability > threshold)) {
          continue;
        }
      }
      const yOffset = settings.yOffset + (placement?.yOffset ?? 0);
      const y = ctx.storeHeight ? surface.height - ctx.originY + yOffset : yOffset;
      const rotation =
        placement && Number.isFinite(placement.rotation) ? placement.rotation : settings.randomYaw ? yaw : 0;
      const scale = placement && Number.isFinite(placement.scale) ? placement.scale : s0 + (s1 - s0) * scaleT;
      out.push(lx, lz, y, rotation, scale);
    }
  }
  return { instances: new Float32Array(out), region: aligned, candidates: (i1 - i0 + 1) * rows };
}

/**
 * Surface sampling from a world height grid, as the scatter worker receives it
 * @param heights - World heights on the height map grid, row by row
 * @param width - Grid columns
 * @param depth - Grid rows
 * @param terrainRegion - World region of the terrain, `[minX, minZ, maxX, maxZ]`
 * @param originX - World x of the foliage origin
 * @param originZ - World z of the foliage origin
 */
export function heightGridSurface(
  heights: Float32Array,
  width: number,
  depth: number,
  terrainRegion: Readonly<FoliageGenRegion>,
  originX: number,
  originZ: number
) {
  const rw = terrainRegion[2] - terrainRegion[0];
  const rh = terrainRegion[3] - terrainRegion[1];
  const uv = (lx: number, lz: number): [number, number] => [
    (lx + originX - terrainRegion[0]) / rw,
    (lz + originZ - terrainRegion[1]) / rh
  ];
  const sample = (u: number, v: number) => {
    const fx = Math.min(Math.max(u * width - 0.5, 0), width - 1);
    const fz = Math.min(Math.max(v * depth - 0.5, 0), depth - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, width - 1);
    const z1 = Math.min(z0 + 1, depth - 1);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = heights[z0 * width + x0] + (heights[z0 * width + x1] - heights[z0 * width + x0]) * tx;
    const b = heights[z1 * width + x0] + (heights[z1 * width + x1] - heights[z1 * width + x0]) * tx;
    return a + (b - a) * tz;
  };
  const result: FoliageGenSurface = { height: 0, slope: 0, normal: [0, 1, 0] };
  const surface = (lx: number, lz: number): FoliageGenSurface | null => {
    const [u, v] = uv(lx, lz);
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return null;
    }
    // Central differences one texel apart
    const du = 1 / width;
    const dv = 1 / depth;
    const nx = -(sample(u + du, v) - sample(u - du, v)) / ((2 * rw) / width);
    const nz = -(sample(u, v + dv) - sample(u, v - dv)) / ((2 * rh) / depth);
    const len = Math.sqrt(nx * nx + 1 + nz * nz);
    result.height = sample(u, v);
    result.normal[0] = nx / len;
    result.normal[1] = 1 / len;
    result.normal[2] = nz / len;
    result.slope = (Math.acos(Math.min(1, result.normal[1])) * 180) / Math.PI;
    return result;
  };
  return { surface, terrainUV: uv };
}

/**
 * Surface lookup from surfaces found per candidate cell, row by row over the cell range
 * `[i0, i0 + cols) × [j0, ...)`: world height, slope and normal per cell, NaN height for none
 * @param surfaces - 5 floats per cell
 * @param spacing - Candidate spacing
 * @param i0 - First cell column
 * @param j0 - First cell row
 * @param cols - Cell columns
 */
export function precomputedSurface(
  surfaces: Float32Array,
  spacing: number,
  i0: number,
  j0: number,
  cols: number
) {
  const found: FoliageGenSurface = { height: 0, slope: 0, normal: [0, 1, 0] };
  const rows = Math.floor(surfaces.length / 5 / Math.max(1, cols));
  return (lx: number, lz: number): FoliageGenSurface | null => {
    const i = Math.floor(lx / spacing) - i0;
    const j = Math.floor(lz / spacing) - j0;
    if (i < 0 || i >= cols || j < 0 || j >= rows) {
      return null;
    }
    const o = (j * cols + i) * 5;
    const h = surfaces[o];
    if (!Number.isFinite(h)) {
      return null;
    }
    found.height = h;
    found.slope = surfaces[o + 1];
    found.normal[0] = surfaces[o + 2];
    found.normal[1] = surfaces[o + 3];
    found.normal[2] = surfaces[o + 4];
    return found;
  };
}
