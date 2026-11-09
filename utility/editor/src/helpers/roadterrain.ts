/**
 * Fitting a terrain to a RoadSpline, as a road is built: a flat bench under the road, cut and fill
 * slopes at a set angle beyond it down or up to the natural ground, grass and foliage cleared along
 * it and, optionally, the exposed earth of the slopes painted.
 *
 * The ground as it was before is kept with the road (RoadSpline.terrainBase) in tiles of the
 * height map, splat map and grass density maps. Fitting again first puts those tiles back, so a
 * road that moved leaves no trace of its old cut; committing drops them and makes the current
 * terrain the new ground. Foliage is not kept: what fitting removed comes back only through undo.
 */
import type { Nullable } from '@zephyr3d/base';
import { FoliageSystem, RoadSpline, createRoadFrame } from '@zephyr3d/scene';
import type { ClipmapTerrain, Scene, SceneNode } from '@zephyr3d/scene';
import type { SceneController } from '../controllers/scenecontroller';
import { CustomCommand } from '../commands/scenecommands';
import type { Command } from '../core/command';
import { eventBus } from '../core/eventbus';
import { readHeightTexels, readSplat, writeHeightTexels, writeSplat } from './mcpterrain';
import { captureFoliageState, restoreFoliageState } from './mcpfoliage';
import type { FoliageState } from './mcpfoliage';
import { findRoad } from './mcproad';
import { TerrainBase, summarizeTerrainBase } from './roadbase';
import type { MapSizes, TileStore } from './roadbase';

/** Settings of a terrain fitting, in meters unless noted */
export interface RoadFitParams {
  /** How far below the road surface the bench lies, at least; raised where half floats are coarser */
  depth: number;
  /** Width of the flat bench beyond each road edge */
  benchMargin: number;
  /** Cut slope, horizontal per vertical: 1 is 45 degrees */
  cutSlope: number;
  /** Fill slope, horizontal per vertical */
  fillSlope: number;
  /** How far beyond the bench the slopes may reach */
  maxReach: number;
  /** Horizontal length over which a slope eases in from the flat bench, a rounded toe */
  toeRounding: number;
  /** Horizontal length over which a slope eases into the natural ground at its top */
  crestRounding: number;
  /** Clear grass along the road */
  clearGrass: boolean;
  /** Grass cleared this far beyond the shoulders */
  grassClear: number;
  /** Then grows back over this distance */
  grassFade: number;
  /** Remove foliage instances along the road */
  clearFoliage: boolean;
  /** Foliage removed this far beyond the shoulders */
  foliageMargin: number;
  /** Detail layer painted where the ground was cut, null for none */
  cutLayer: Nullable<number>;
  /** Detail layer painted where the ground was filled, null for none */
  fillLayer: Nullable<number>;
}

const DEFAULT_PARAMS: RoadFitParams = {
  depth: 0.1,
  benchMargin: 1,
  cutSlope: 1,
  fillSlope: 1.5,
  maxReach: 30,
  toeRounding: 3,
  crestRounding: 2,
  clearGrass: true,
  grassClear: 0.5,
  grassFade: 1.5,
  clearFoliage: true,
  foliageMargin: 1.5,
  cutLayer: null,
  fillLayer: null
};

/** Height change over which grass fades out on the slopes and the slope paint fades in */
const EARTHWORK_FULL = 1;

// ---------------------------------------------------------------------------------------------
// The fitting

/** The center line in world space, a vertex per meter with what the cross section needs there */
interface CenterLine {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Rise of the surface per meter to the right, from the bank */
  lateralSlope: Float64Array;
  half: Float64Array;
  maxHalf: number;
  closed: boolean;
}

function centerLine(road: RoadSpline): CenterLine {
  const curve = road.curve;
  const poly = curve.getPolyline(1);
  const count = poly.length / 4;
  const line: CenterLine = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    lateralSlope: new Float64Array(count),
    half: new Float64Array(count),
    maxHalf: 0,
    closed: curve.closed
  };
  const frame = createRoadFrame();
  for (let k = 0; k < count; k++) {
    road.sampleAt(poly[k * 4 + 3], frame);
    line.x[k] = frame.position.x;
    line.y[k] = frame.position.y;
    line.z[k] = frame.position.z;
    const horizontal = Math.hypot(frame.right.x, frame.right.z);
    line.lateralSlope[k] = horizontal > 1e-6 ? frame.right.y / horizontal : 0;
    line.half[k] = frame.width * 0.5;
    line.maxHalf = Math.max(line.maxHalf, line.half[k]);
  }
  return line;
}

/**
 * Rise of a slope at a horizontal distance from the bench edge: from flat at the edge, its grade
 * grows linearly over the toe length to 1 / ratio (a parabola, so ground meets bench without a
 * crease), then stays there
 * @param ratio - Slope as horizontal per vertical
 */
function slopeRise(e: number, ratio: number, toe: number) {
  const grade = 1 / ratio;
  return e >= toe ? grade * (e - toe * 0.5) : (grade * e * e) / (2 * toe);
}

/** Polynomial smooth minimum: min(a, b) where they differ by k or more, rounded within (iq) */
function smoothMin(a: number, b: number, k: number) {
  if (k <= 0) {
    return Math.min(a, b);
  }
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smoothMax(a: number, b: number, k: number) {
  return -smoothMin(-a, -b, k);
}

/** Spacing of the half floats around a value: the height map precision there */
function halfStep(v: number) {
  const a = Math.max(Math.abs(v), 2 ** -14);
  return 2 ** (Math.floor(Math.log2(a)) - 10);
}

/** World placement of a terrain map: texel (i, j) is centered at (x0 + (i + 0.5) dx, z0 + (j + 0.5) dz) */
interface MapGrid {
  w: number;
  h: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
}

function mapGrid(terrain: ClipmapTerrain, w: number, h: number): MapGrid {
  const r = terrain.worldRegion;
  return { w, h, x0: r.x, z0: r.y, dx: (r.z - r.x) / w, dz: (r.w - r.y) / h };
}

/**
 * Visits the texels of a map within `radius` of the center line with, per segment, the closest
 * point on it: t along the segment and the signed distance to the right. On an open road, texels
 * beyond its ends are skipped. A texel is visited once per segment near it.
 */
function rasterizeCenterLine(
  line: CenterLine,
  grid: MapGrid,
  radius: number,
  visit: (index: number, k: number, t: number, distance: number, lateral: number) => void
) {
  const last = line.count - 2;
  for (let k = 0; k <= last; k++) {
    const ax = line.x[k];
    const az = line.z[k];
    const dx = line.x[k + 1] - ax;
    const dz = line.z[k + 1] - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-12) {
      continue;
    }
    const len = Math.sqrt(len2);
    const i0 = Math.max(0, Math.ceil((Math.min(ax, ax + dx) - radius - grid.x0) / grid.dx - 0.5));
    const i1 = Math.min(grid.w - 1, Math.floor((Math.max(ax, ax + dx) + radius - grid.x0) / grid.dx - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(az, az + dz) - radius - grid.z0) / grid.dz - 0.5));
    const j1 = Math.min(grid.h - 1, Math.floor((Math.max(az, az + dz) + radius - grid.z0) / grid.dz - 0.5));
    for (let j = j0; j <= j1; j++) {
      const wz = grid.z0 + (j + 0.5) * grid.dz;
      for (let i = i0; i <= i1; i++) {
        const wx = grid.x0 + (i + 0.5) * grid.dx;
        const along = (wx - ax) * dx + (wz - az) * dz;
        if (!line.closed && ((k === 0 && along < 0) || (k === last && along > len2))) {
          continue;
        }
        const t = Math.min(Math.max(along / len2, 0), 1);
        const ex = wx - (ax + dx * t);
        const ez = wz - (az + dz * t);
        const distance = Math.hypot(ex, ez);
        if (distance > radius) {
          continue;
        }
        // Right of the direction of travel is (-dz, dx)
        visit(j * grid.w + i, k, t, distance, (ex * -dz + ez * dx) / len);
      }
    }
  }
}

interface HeightFit {
  /** New world heights */
  heights: Float32Array;
  changed: Set<number>;
  tiles: Set<number>;
  maxCut: number;
  maxFill: number;
  cutVolume: number;
  fillVolume: number;
}

/**
 * Heights of the bench and the slopes: under the road and its bench margin, the road surface less
 * the depth; beyond, the natural height clamped between the fill and cut slopes rising and falling
 * from the bench edge. Constraints of every stretch of road near a texel combine, so where two
 * stretches pass close (hairpins) the ground satisfies both, or the nearest when it cannot.
 */
function fitHeights(
  line: CenterLine,
  grid: MapGrid,
  ground: Float32Array,
  precision: (y: number) => number,
  params: RoadFitParams,
  store: TileStore<Float32Array>
): HeightFit {
  const n = grid.w * grid.h;
  const benchY = new Float32Array(n).fill(NaN);
  const benchD = new Float32Array(n).fill(Infinity);
  const lower = new Float32Array(n).fill(-Infinity);
  const upper = new Float32Array(n).fill(Infinity);
  const nearD = new Float32Array(n).fill(Infinity);
  const nearLo = new Float32Array(n);
  const nearHi = new Float32Array(n);
  const touched: number[] = [];
  const radius = line.maxHalf + params.benchMargin + params.maxReach;
  rasterizeCenterLine(line, grid, radius, (index, k, t, distance, lateral) => {
    const half = line.half[k] + (line.half[k + 1] - line.half[k]) * t;
    const cy = line.y[k] + (line.y[k + 1] - line.y[k]) * t;
    const slope = line.lateralSlope[k] + (line.lateralSlope[k + 1] - line.lateralSlope[k]) * t;
    const depth = Math.max(params.depth, 2 * precision(cy));
    if (benchD[index] === Infinity && nearD[index] === Infinity) {
      touched.push(index);
    }
    if (distance <= half + params.benchMargin) {
      if (distance < benchD[index]) {
        benchD[index] = distance;
        benchY[index] = cy + slope * Math.min(Math.max(lateral, -half), half) - depth;
      }
      return;
    }
    const e = distance - half - params.benchMargin;
    const base = cy + slope * (lateral < 0 ? -half : half) - depth;
    const lo = base - slopeRise(e, params.fillSlope, params.toeRounding);
    const hi = base + slopeRise(e, params.cutSlope, params.toeRounding);
    lower[index] = Math.max(lower[index], lo);
    upper[index] = Math.min(upper[index], hi);
    if (distance < nearD[index]) {
      nearD[index] = distance;
      nearLo[index] = lo;
      nearHi[index] = hi;
    }
  });
  const heights = ground.slice();
  const fit: HeightFit = {
    heights,
    changed: new Set(),
    tiles: new Set(),
    maxCut: 0,
    maxFill: 0,
    cutVolume: 0,
    fillVolume: 0
  };
  const cellArea = grid.dx * grid.dz;
  for (const index of touched) {
    const h0 = ground[index];
    let h: number;
    if (!Number.isNaN(benchY[index])) {
      h = benchY[index];
    } else if (lower[index] <= upper[index]) {
      // Rounded where the slope meets the natural ground; the smooth max never falls below the
      // fill limit and the smooth min never rises above the cut limit, so the slopes keep within
      // them except in a band narrower than the rounding, close to the toe, which the clamp settles
      h = h0;
      if (lower[index] > -Infinity) {
        h = smoothMax(h, lower[index], params.crestRounding / params.fillSlope);
      }
      if (upper[index] < Infinity) {
        h = smoothMin(h, upper[index], params.crestRounding / params.cutSlope);
      }
      h = Math.min(Math.max(h, lower[index]), upper[index]);
    } else {
      h = Math.min(Math.max(h0, nearLo[index]), nearHi[index]);
    }
    const d = h - h0;
    if (Math.abs(d) < 1e-4) {
      continue;
    }
    heights[index] = h;
    fit.changed.add(index);
    fit.tiles.add(store.tileOf(index % grid.w, Math.floor(index / grid.w)));
    if (d > 0) {
      fit.maxFill = Math.max(fit.maxFill, d);
      fit.fillVolume += d * cellArea;
    } else {
      fit.maxCut = Math.max(fit.maxCut, -d);
      fit.cutVolume -= d * cellArea;
    }
  }
  return fit;
}

/** Bilinear sample of a height map sized field at a world position */
function sampleField(field: Float32Array, grid: MapGrid, x: number, z: number) {
  const u = Math.min(Math.max((x - grid.x0) / grid.dx - 0.5, 0), grid.w - 1);
  const v = Math.min(Math.max((z - grid.z0) / grid.dz - 0.5, 0), grid.h - 1);
  const i = Math.min(Math.floor(u), grid.w - 2);
  const j = Math.min(Math.floor(v), grid.h - 2);
  const fu = u - i;
  const fv = v - j;
  const a = field[j * grid.w + i];
  const b = field[j * grid.w + i + 1];
  const c = field[(j + 1) * grid.w + i];
  const d = field[(j + 1) * grid.w + i + 1];
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

function smoothstep(t: number) {
  t = Math.min(Math.max(t, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Grass density along the road: none over the road and shoulders and a margin, growing back over
 * the fade distance, and thinned where the ground was cut or filled
 */
function fitGrass(
  line: CenterLine,
  grid: MapGrid,
  density: Uint8Array,
  delta: Float32Array,
  heightGrid: MapGrid,
  shoulder: number,
  params: RoadFitParams,
  store: TileStore<Uint8Array>
) {
  const clear = shoulder + params.grassClear;
  const radius = line.maxHalf + clear + params.grassFade + params.benchMargin + params.maxReach;
  // Distance beyond the nearest road edge
  const edge = new Float32Array(grid.w * grid.h).fill(Infinity);
  const touched: number[] = [];
  rasterizeCenterLine(line, grid, radius, (index, k, t, distance) => {
    const half = line.half[k] + (line.half[k + 1] - line.half[k]) * t;
    const e = distance - half;
    if (edge[index] === Infinity) {
      touched.push(index);
    }
    if (e < edge[index]) {
      edge[index] = e;
    }
  });
  const out = density.slice();
  const tiles = new Set<number>();
  let changed = 0;
  for (const index of touched) {
    const e = edge[index];
    const i = index % grid.w;
    const j = Math.floor(index / grid.w);
    const dh = Math.abs(
      sampleField(delta, heightGrid, grid.x0 + (i + 0.5) * grid.dx, grid.z0 + (j + 0.5) * grid.dz)
    );
    const f =
      (params.grassFade > 0 ? smoothstep((e - clear) / params.grassFade) : e > clear ? 1 : 0) *
      (1 - Math.min(dh / EARTHWORK_FULL, 1));
    const v = Math.round(density[index] * f);
    if (v !== density[index]) {
      out[index] = v;
      tiles.add(store.tileOf(i, j));
      changed++;
    }
  }
  return { density: out, tiles, changed };
}

/** Paints the cut and fill layers over the slopes, by how much the ground changed */
function fitSplat(
  splat: Uint8Array,
  grid: MapGrid,
  pages: number,
  delta: Float32Array,
  heightGrid: MapGrid,
  bounds: [number, number, number, number],
  params: RoadFitParams,
  store: TileStore<Uint8Array>
) {
  const out = splat.slice();
  const tiles = new Set<number>();
  const plane = grid.w * grid.h * 4;
  const layers = pages * 4;
  const weights = new Float64Array(layers);
  const i0 = Math.max(0, Math.floor((bounds[0] - grid.x0) / grid.dx));
  const i1 = Math.min(grid.w - 1, Math.ceil((bounds[2] - grid.x0) / grid.dx));
  const j0 = Math.max(0, Math.floor((bounds[1] - grid.z0) / grid.dz));
  const j1 = Math.min(grid.h - 1, Math.ceil((bounds[3] - grid.z0) / grid.dz));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dh = sampleField(delta, heightGrid, grid.x0 + (i + 0.5) * grid.dx, grid.z0 + (j + 0.5) * grid.dz);
      const target = dh < 0 ? params.cutLayer : params.fillLayer;
      if (target === null || target >= layers || Math.abs(dh) < 0.05) {
        continue;
      }
      const w = Math.min(Math.abs(dh) / EARTHWORK_FULL, 1);
      const texel = (j * grid.w + i) * 4;
      for (let l = 0; l < layers; l++) {
        weights[l] = splat[(l >> 2) * plane + texel + (l & 3)] * (1 - w);
      }
      weights[target] += 255 * w;
      // Bytes summing to 255, the remainder to the largest weight
      let sum = 0;
      let largest = 0;
      for (let l = 0; l < layers; l++) {
        const b = Math.floor(weights[l]);
        out[(l >> 2) * plane + texel + (l & 3)] = b;
        sum += b;
        if (weights[l] > weights[largest]) {
          largest = l;
        }
      }
      out[(largest >> 2) * plane + texel + (largest & 3)] += 255 - sum;
      tiles.add(store.tileOf(i, j));
    }
  }
  return { splat: out, tiles };
}

// ---------------------------------------------------------------------------------------------
// The command

/** Everything a fitting changes, to apply or undo it as a whole */
interface TerrainState {
  texels: Float32Array;
  splat: Nullable<Uint8Array<ArrayBuffer>>;
  grass: Uint8Array[];
  base: Nullable<ArrayBuffer>;
  foliage: Map<string, FoliageState>;
}

function foliageOn(scene: Scene, terrain: ClipmapTerrain) {
  const out: FoliageSystem[] = [];
  const walk = (node: SceneNode) => {
    if (node instanceof FoliageSystem && node.terrain === terrain) {
      out.push(node);
    }
    for (const child of node.children) {
      if (!child.sealed) {
        walk(child);
      }
    }
  };
  walk(scene.rootNode);
  return out;
}

function parseParams(params: any): RoadFitParams {
  const out: RoadFitParams = { ...DEFAULT_PARAMS };
  const num = (key: string, field: keyof RoadFitParams, min: number, exclusive = false) => {
    const v = params[key];
    if (v === undefined) {
      return;
    }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || (exclusive && v === min)) {
      throw new Error(`\`${key}\` must be a number ${exclusive ? '>' : '>='} ${min}`);
    }
    (out as unknown as Record<string, unknown>)[field] = v;
  };
  const bool = (key: string, field: keyof RoadFitParams) => {
    const v = params[key];
    if (v === undefined) {
      return;
    }
    if (typeof v !== 'boolean') {
      throw new Error(`\`${key}\` must be true or false`);
    }
    (out as unknown as Record<string, unknown>)[field] = v;
  };
  const layer = (key: string, field: keyof RoadFitParams) => {
    const v = params[key];
    if (v === undefined || v === null) {
      return;
    }
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`\`${key}\` must be a detail layer index, or null for none`);
    }
    (out as unknown as Record<string, unknown>)[field] = v;
  };
  num('depth', 'depth', 0);
  num('bench_margin', 'benchMargin', 0);
  num('cut_slope', 'cutSlope', 0, true);
  num('fill_slope', 'fillSlope', 0, true);
  num('max_reach', 'maxReach', 0);
  num('toe_rounding', 'toeRounding', 0);
  num('crest_rounding', 'crestRounding', 0);
  bool('clear_grass', 'clearGrass');
  num('grass_clear', 'grassClear', 0);
  num('grass_fade', 'grassFade', 0);
  bool('clear_foliage', 'clearFoliage');
  num('foliage_margin', 'foliageMargin', 0);
  layer('cut_layer', 'cutLayer');
  layer('fill_layer', 'fillLayer');
  return out;
}

const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Runs an undoable command, as the command manager of the scene view does */
export type RoadCommandRunner = (command: Command<void>) => Promise<unknown>;

/** MCP road_apply_terrain: {@link fitTerrainToRoad} on the road with the persistent id node_id */
export async function applyRoadTerrain(controller: Nullable<SceneController>, params: any) {
  const { road, err } = findRoad(controller, params.node_id);
  if (!road || !controller) {
    return { result: null, err };
  }
  return fitTerrainToRoad(road, params, (command) => controller.view.cmdManager.execute(command));
}

/**
 * Fits the terrain to a road ('apply'), puts the ground kept with it back ('restore'), or drops
 * what is kept so the current terrain becomes the ground ('commit'), as one undoable command.
 * @param params - The settings as road_apply_terrain takes them (snake case), all optional
 */
export async function fitTerrainToRoad(road: RoadSpline, params: any, run: RoadCommandRunner) {
  const terrain = road.terrain;
  if (!terrain?.heightMap || !terrain.material) {
    return { result: null, err: 'The road is not on a terrain (a ClipmapTerrain ancestor)' };
  }
  const action = params.action ?? 'apply';
  if (action !== 'apply' && action !== 'restore' && action !== 'commit') {
    return { result: null, err: "`action` must be 'apply', 'restore' or 'commit'" };
  }
  const fit = parseParams(params);
  const numDetail = terrain.material.numDetailMaps;
  for (const l of [fit.cutLayer, fit.fillLayer]) {
    if (l !== null && l >= numDetail) {
      return { result: null, err: `The terrain has ${numDetail} detail layers; layer ${l} does not exist` };
    }
  }
  await terrain.whenHeightDataReady();
  const scene = road.scene!;
  const heightMap = terrain.heightMap;
  const splatMap = terrain.material.getSplatMap();
  const grassRenderer = terrain.grassRenderer;
  const grassLayers = Array.from({ length: grassRenderer.numLayers }, (_, i) => grassRenderer.getLayer(i)!);
  const sizes: MapSizes = {
    heightW: heightMap.width,
    heightH: heightMap.height,
    splatW: splatMap.width,
    splatH: splatMap.height,
    splatPages: splatMap.depth,
    grass: grassLayers.map((g) => ({ w: g.densityMapWidth, h: g.densityMapHeight }))
  };
  let base: TerrainBase;
  try {
    base = TerrainBase.decode(road.terrainBase, sizes);
  } catch (e) {
    if (action !== 'commit') {
      return { result: null, err: e instanceof Error ? e.message : String(e) };
    }
    // Committing only drops the kept ground, so one recorded for maps of other sizes (a grass
    // layer added since, say) need not be read
    base = new TerrainBase(sizes);
  }
  const earthworks = action === 'apply' && (fit.cutLayer !== null || fit.fillLayer !== null);
  const needSplat = base.hasSplat || earthworks;
  const foliage = foliageOn(scene, terrain);
  const before: TerrainState = {
    texels: await readHeightTexels(terrain),
    splat: needSplat ? await readSplat(terrain) : null,
    grass: grassLayers.map((g) => g.densityMap.slice()),
    base: road.terrainBase,
    foliage: new Map(foliage.map((f) => [f.persistentId, captureFoliageState(f)]))
  };
  // The ground as it was before the road
  const ground: TerrainState = {
    texels: before.texels.slice(),
    splat: before.splat?.slice() ?? null,
    grass: before.grass.map((g) => g.slice()),
    base: null,
    foliage: before.foliage
  };
  base.heights.restore(ground.texels);
  if (ground.splat) {
    base.splat.forEach((store, page) =>
      store.restore(
        new Uint8Array(
          ground.splat!.buffer,
          page * sizes.splatW * sizes.splatH * 4,
          sizes.splatW * sizes.splatH * 4
        )
      )
    );
  }
  base.grass.forEach((store, i) => store.restore(ground.grass[i]));
  const result: Record<string, unknown> = { action };
  let after: TerrainState;
  let removeFoliage: Nullable<() => number> = null;
  if (action === 'commit') {
    after = { ...before, base: null };
    result.kept_tiles_dropped = summarizeTerrainBase(road.terrainBase)?.tiles ?? 0;
  } else if (action === 'restore') {
    after = { ...ground, base: null };
    result.tiles_restored = base.numTiles;
  } else {
    const scaleY = terrain.scale.y;
    const baseY = terrain.worldMatrix.m13;
    const heightGrid = mapGrid(terrain, sizes.heightW, sizes.heightH);
    const groundWorld = new Float32Array(ground.texels.length);
    for (let i = 0; i < groundWorld.length; i++) {
      groundWorld[i] = ground.texels[i] * scaleY + baseY;
    }
    const line = centerLine(road);
    if (line.count < 2) {
      return { result: null, err: 'The road needs at least 2 points' };
    }
    const heights = fitHeights(
      line,
      heightGrid,
      groundWorld,
      (y) => halfStep((y - baseY) / scaleY) * Math.abs(scaleY),
      fit,
      base.heights
    );
    base.heights.record(ground.texels, heights.tiles);
    const texels = ground.texels.slice();
    const delta = new Float32Array(groundWorld.length);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const index of heights.changed) {
      texels[index] = (heights.heights[index] - baseY) / scaleY;
      delta[index] = heights.heights[index] - groundWorld[index];
      const x = heightGrid.x0 + ((index % heightGrid.w) + 0.5) * heightGrid.dx;
      const z = heightGrid.z0 + (Math.floor(index / heightGrid.w) + 0.5) * heightGrid.dz;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    let grassChanged = 0;
    const grass = ground.grass.map((g) => g.slice());
    if (fit.clearGrass) {
      grassLayers.forEach((layer, i) => {
        const grid = mapGrid(terrain, layer.densityMapWidth, layer.densityMapHeight);
        const r = fitGrass(
          line,
          grid,
          ground.grass[i],
          delta,
          heightGrid,
          road.shoulderWidth,
          fit,
          base.grass[i]
        );
        base.grass[i].record(ground.grass[i], r.tiles);
        grass[i] = r.density;
        grassChanged += r.changed;
      });
    }
    let splat = ground.splat;
    if (earthworks && heights.changed.size > 0 && ground.splat) {
      const grid = mapGrid(terrain, sizes.splatW, sizes.splatH);
      const r = fitSplat(
        ground.splat,
        grid,
        sizes.splatPages,
        delta,
        heightGrid,
        [minX, minZ, maxX, maxZ],
        fit,
        base.splat[0]
      );
      base.splat.forEach((store, page) =>
        store.record(
          new Uint8Array(
            ground.splat!.buffer,
            page * sizes.splatW * sizes.splatH * 4,
            sizes.splatW * sizes.splatH * 4
          ),
          r.tiles
        )
      );
      splat = r.splat as Uint8Array<ArrayBuffer>;
    }
    after = { texels, splat, grass, base: base.encode(), foliage: new Map() };
    if (fit.clearFoliage && foliage.length > 0) {
      const radiusBeyond = road.shoulderWidth + fit.foliageMargin;
      removeFoliage = () => {
        let removed = 0;
        for (const f of foliage) {
          const ox = f.worldMatrix.m03;
          const oz = f.worldMatrix.m23;
          for (let k = 0; k < line.count; k++) {
            removed += f.removeInstancesInCircle(line.x[k] - ox, line.z[k] - oz, line.half[k] + radiusBeyond);
          }
        }
        return removed;
      };
    }
    Object.assign(result, {
      texels_changed: heights.changed.size,
      max_cut: round(heights.maxCut),
      max_fill: round(heights.maxFill),
      cut_volume_m3: round(heights.cutVolume, 1),
      fill_volume_m3: round(heights.fillVolume, 1),
      grass_texels_changed: grassChanged,
      bounds:
        heights.changed.size > 0 ? [round(minX, 1), round(minZ, 1), round(maxX, 1), round(maxZ, 1)] : null
    });
  }
  const roadId = road.persistentId;
  const terrainId = terrain.persistentId;
  const getRoad = () => {
    const node = scene.findNodeById(roadId);
    if (!(node instanceof RoadSpline)) {
      throw new Error('The road no longer exists');
    }
    return node;
  };
  const getTerrain = () => {
    const node = scene.findNodeById(terrainId);
    if (!node?.isClipmapTerrain()) {
      throw new Error('The terrain no longer exists');
    }
    return node;
  };
  const write = (from: TerrainState, to: TerrainState, restoreFoliage: boolean) => {
    const t = getTerrain();
    if (from.texels !== to.texels && !sameArray(from.texels, to.texels)) {
      writeHeightTexels(t, to.texels);
    }
    if (to.splat && from.splat && !sameArray(from.splat, to.splat)) {
      writeSplat(t, to.splat);
    }
    to.grass.forEach((data, i) => {
      if (!sameArray(from.grass[i], data)) {
        const layer = t.grassRenderer.getLayer(i);
        layer?.setDensityData(
          layer.densityMapWidth,
          layer.densityMapHeight,
          layer.cellsPerTexel,
          data.slice()
        );
      }
    });
    getRoad().terrainBase = to.base;
    if (restoreFoliage) {
      for (const [id, state] of to.foliage) {
        const node = scene.findNodeById(id);
        if (node instanceof FoliageSystem) {
          restoreFoliageState(node, state);
        }
      }
    }
    eventBus.dispatchEvent('scene_changed');
    eventBus.dispatchEvent('refresh_properties');
  };
  let applied = false;
  const desc =
    action === 'apply'
      ? 'Fit terrain to road'
      : action === 'restore'
        ? 'Restore terrain under road'
        : 'Commit road terrain base';
  await run(
    new CustomCommand(
      () => {
        if (applied) {
          write(before, after, true);
          return;
        }
        applied = true;
        write(before, after, false);
        if (removeFoliage) {
          result.foliage_removed = removeFoliage();
        }
        after.foliage = new Map(foliage.map((f) => [f.persistentId, captureFoliageState(f)]));
      },
      () => write(after, before, true)
    ).setDesc(desc)
  );
  result.kept_tiles = TerrainBase.decode(getRoad().terrainBase, sizes).numTiles;
  return { result, err: null };
}

function sameArray(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
