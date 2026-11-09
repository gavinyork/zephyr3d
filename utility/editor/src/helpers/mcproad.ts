/**
 * Road tools of the editor MCP bridge: creating a RoadSpline on a terrain, changing its control
 * points and settings, and describing how drivable it is.
 */
import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { MeshMaterial, Scene, SceneNode } from '@zephyr3d/scene';
import { ClipmapTerrain, RoadControlPoint, RoadSpline, createRoadFrame, getEngine } from '@zephyr3d/scene';
import type { SceneController } from '../controllers/scenecontroller';
import { CustomCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import { ensureNodeDefaultName } from './defaultnodename';
import { summarizeTerrainBase } from './roadbase';

const MAX_POINTS = 2000;

/** Everything about a road a tool can change */
type RoadState = {
  points: RoadControlPoint[];
  closed: boolean;
  width: number;
  shoulderWidth: number;
  sampleSpacing: number;
  chunkLength: number;
  uvTileLength: number;
  uvTileWidth: number;
  surfaceTag: string;
  collision: boolean;
  friction: number;
  castShadow: boolean;
  material: Nullable<MeshMaterial>;
  shoulderMaterial: Nullable<MeshMaterial>;
  name: string;
};

function captureState(road: RoadSpline): RoadState {
  const points: RoadControlPoint[] = [];
  for (let i = 0; i < road.numPoints; i++) {
    points.push(road.getPoint(i)!.clone());
  }
  return {
    points,
    closed: road.closed,
    width: road.width,
    shoulderWidth: road.shoulderWidth,
    sampleSpacing: road.sampleSpacing,
    chunkLength: road.chunkLength,
    uvTileLength: road.uvTileLength,
    uvTileWidth: road.uvTileWidth,
    surfaceTag: road.surfaceTag,
    collision: road.collision,
    friction: road.friction,
    castShadow: road.castShadow,
    material: road.material,
    shoulderMaterial: road.shoulderMaterial,
    name: road.name
  };
}

function restoreState(road: RoadSpline, state: RoadState) {
  road.setPoints(state.points.map((p) => p.clone()));
  road.closed = state.closed;
  road.width = state.width;
  road.shoulderWidth = state.shoulderWidth;
  road.sampleSpacing = state.sampleSpacing;
  road.chunkLength = state.chunkLength;
  road.uvTileLength = state.uvTileLength;
  road.uvTileWidth = state.uvTileWidth;
  road.surfaceTag = state.surfaceTag;
  road.collision = state.collision;
  road.friction = state.friction;
  road.castShadow = state.castShadow;
  road.material = state.material;
  road.shoulderMaterial = state.shoulderMaterial;
  road.name = state.name;
}

function notifyChanged() {
  eventBus.dispatchEvent('scene_changed');
  eventBus.dispatchEvent('refresh_properties');
}

export function findRoad(controller: Nullable<SceneController>, id: unknown) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { road: null, err: 'No scene is currently opened' };
  }
  const nodeId = typeof id === 'string' ? id.trim() : '';
  if (!nodeId) {
    return { road: null, err: 'Pass `node_id`, the persistent id of a RoadSpline node' };
  }
  const node = scene.findNodeById(nodeId);
  if (!node) {
    return { road: null, err: `Node not found in current scene: ${nodeId}` };
  }
  if (!(node instanceof RoadSpline)) {
    return { road: null, err: `Node ${nodeId} is not a RoadSpline` };
  }
  return { road: node, err: null };
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A point as the tools take it: [x, z], [x, y, z], or { position, width?, bank? } */
type PointInput = {
  x: number;
  y: Nullable<number>;
  z: number;
  width: Nullable<number>;
  bank: Nullable<number>;
};

function parsePoint(value: unknown, label: string): PointInput {
  let pos: unknown = value;
  let width: Nullable<number> = null;
  let bank: Nullable<number> = null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    pos = v.position;
    if (v.width !== undefined) {
      if (!finite(v.width) || v.width < 0) {
        throw new Error(`${label}.width must be a number >= 0`);
      }
      width = v.width;
    }
    if (v.bank !== undefined) {
      if (!finite(v.bank)) {
        throw new Error(`${label}.bank must be a number of degrees`);
      }
      bank = v.bank;
    }
  }
  if (!Array.isArray(pos) || (pos.length !== 2 && pos.length !== 3) || !pos.every(finite)) {
    throw new Error(`${label} must be [x, z], [x, y, z] or { position, width?, bank? } in world space`);
  }
  return pos.length === 2
    ? { x: pos[0], y: null, z: pos[1], width, bank }
    : { x: pos[0], y: pos[1], z: pos[2], width, bank };
}

/** World height of a point: the terrain's, or the given one */
function resolveHeight(
  p: PointInput,
  terrain: Nullable<ClipmapTerrain>,
  yMode: string,
  yOffset: number,
  label: string
) {
  if (yMode === 'given') {
    if (p.y === null) {
      throw new Error(`${label} needs a height: pass [x, y, z] with y_mode 'given'`);
    }
    return p.y;
  }
  const h = terrain?.getHeightAt(p.x, p.z) ?? null;
  if (h === null) {
    throw new Error(`${label} (${p.x}, ${p.z}) is off the terrain; pass [x, y, z] with y_mode 'given'`);
  }
  return h + yOffset;
}

function parseOptions(params: any) {
  const yMode = params.y_mode ?? 'terrain';
  if (yMode !== 'terrain' && yMode !== 'given') {
    throw new Error("`y_mode` must be 'terrain' or 'given'");
  }
  const yOffset = params.y_offset ?? 0;
  if (!finite(yOffset)) {
    throw new Error('`y_offset` must be a number');
  }
  return { yMode, yOffset };
}

/** World to road space; a new road sits at the origin of its terrain */
type ToLocal = (x: number, y: number, z: number) => Vector3;

function toLocalOf(node: SceneNode): ToLocal {
  const inv = node.invWorldMatrix;
  return (x, y, z) => inv.transformPointAffine(new Vector3(x, y, z), new Vector3());
}

function buildPoints(toLocal: ToLocal, terrain: Nullable<ClipmapTerrain>, points: unknown, params: any) {
  if (!Array.isArray(points) || points.length > MAX_POINTS) {
    throw new Error(`\`points\` must be an array of at most ${MAX_POINTS} points`);
  }
  const { yMode, yOffset } = parseOptions(params);
  return points.map((value, i) => {
    const label = `points[${i}]`;
    const p = parsePoint(value, label);
    const y = resolveHeight(p, terrain, yMode, yOffset, label);
    return new RoadControlPoint(toLocal(p.x, y, p.z), p.width ?? 0, p.bank ?? 0);
  });
}

async function fetchMaterialParam(value: unknown, label: string): Promise<Nullable<MeshMaterial>> {
  if (value === '' || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`\`${label}\` must be the path of a .zmtl material asset, or '' for none`);
  }
  const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(value);
  if (!material) {
    throw new Error(`Material not found: ${value}`);
  }
  return material;
}

/** Settings shared by road_create and road_update, checked before anything changes */
async function parseSettings(params: any) {
  const out: Partial<RoadState> = {};
  const num = (key: string, field: keyof RoadState, min: number) => {
    const v = params[key];
    if (v === undefined) {
      return;
    }
    if (!finite(v) || v < min) {
      throw new Error(`\`${key}\` must be a number >= ${min}`);
    }
    (out as Record<string, unknown>)[field] = v;
  };
  const bool = (key: string, field: keyof RoadState) => {
    const v = params[key];
    if (v === undefined) {
      return;
    }
    if (typeof v !== 'boolean') {
      throw new Error(`\`${key}\` must be true or false`);
    }
    (out as Record<string, unknown>)[field] = v;
  };
  num('width', 'width', 0.1);
  num('shoulder_width', 'shoulderWidth', 0);
  num('sample_spacing', 'sampleSpacing', 0.1);
  num('chunk_length', 'chunkLength', 4);
  num('uv_tile_length', 'uvTileLength', 0.01);
  num('uv_tile_width', 'uvTileWidth', 0.01);
  num('friction', 'friction', 0);
  bool('closed', 'closed');
  bool('collision', 'collision');
  bool('cast_shadow', 'castShadow');
  if (params.surface_tag !== undefined) {
    if (typeof params.surface_tag !== 'string') {
      throw new Error('`surface_tag` must be a string');
    }
    out.surfaceTag = params.surface_tag;
  }
  if (params.name !== undefined) {
    if (typeof params.name !== 'string') {
      throw new Error('`name` must be a string');
    }
    out.name = params.name.trim();
  }
  if (params.material !== undefined) {
    out.material = await fetchMaterialParam(params.material, 'material');
  }
  if (params.shoulder_material !== undefined) {
    out.shoulderMaterial = await fetchMaterialParam(params.shoulder_material, 'shoulder_material');
  }
  return out;
}

function applySettings(road: RoadSpline, settings: Partial<RoadState>) {
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'points' || value === undefined) {
      continue;
    }
    if (key === 'name' && !value) {
      continue;
    }
    (road as unknown as Record<string, unknown>)[key] = value;
  }
}

function findTerrainNode(scene: Scene, id: unknown) {
  const nodeId = typeof id === 'string' ? id.trim() : '';
  if (!nodeId) {
    return {
      terrain: null,
      err: 'Pass `terrain_id`, the persistent id of the ClipmapTerrain to lay the road on'
    };
  }
  const node = scene.findNodeById(nodeId);
  if (!(node instanceof ClipmapTerrain)) {
    return { terrain: null, err: `Node ${nodeId} is not a ClipmapTerrain` };
  }
  return { terrain: node, err: null };
}

export async function createRoad(controller: Nullable<SceneController>, params: any) {
  const scene = controller?.model?.scene ?? null;
  if (!controller || !scene) {
    return { node_id: null, err: 'No scene is currently opened' };
  }
  const { terrain, err } = findTerrainNode(scene, params.terrain_id);
  if (!terrain) {
    return { node_id: null, err };
  }
  await terrain.whenHeightDataReady();
  const settings = await parseSettings(params);
  const points = buildPoints(toLocalOf(terrain), terrain, params.points ?? [], params);
  const terrainId = terrain.persistentId;
  let roadId = '';
  await controller.view.cmdManager.execute(
    new CustomCommand(
      () => {
        const parent = scene.findNodeById(terrainId);
        if (!(parent instanceof ClipmapTerrain)) {
          throw new Error('The terrain no longer exists');
        }
        const road = new RoadSpline(scene);
        road.parent = parent;
        if (roadId) {
          road.persistentId = roadId;
        } else {
          roadId = road.persistentId;
        }
        ensureNodeDefaultName(road, 'Road');
        applySettings(road, settings);
        road.setPoints(points.map((p) => p.clone()));
        notifyChanged();
      },
      () => {
        const road = scene.findNodeById(roadId);
        road?.remove();
        notifyChanged();
      }
    ).setDesc('Create road')
  );
  const road = scene.findNodeById(roadId);
  return {
    node_id: roadId,
    info: road instanceof RoadSpline ? describeRoad(road) : null,
    err: null
  };
}

export async function updateRoad(controller: Nullable<SceneController>, params: any) {
  const { road, err } = findRoad(controller, params.node_id);
  if (!road || !controller) {
    return { info: null, err };
  }
  const terrain = road.terrain;
  await terrain?.whenHeightDataReady();
  const settings = await parseSettings(params);
  const before = captureState(road);
  let points: Nullable<RoadControlPoint[]> = null;
  if (params.points !== undefined) {
    points = buildPoints(toLocalOf(road), terrain, params.points, params);
  }
  if (params.patch !== undefined) {
    if (!Array.isArray(params.patch)) {
      throw new Error('`patch` must be an array of { index, position?, width?, bank? }');
    }
    const { yMode, yOffset } = parseOptions(params);
    points = (points ?? before.points).map((p) => p.clone());
    for (let i = 0; i < params.patch.length; i++) {
      const item = params.patch[i];
      const label = `patch[${i}]`;
      const index = item?.index;
      if (!Number.isInteger(index) || index < 0 || index >= points.length) {
        throw new Error(`${label}.index must be a point index below ${points.length}`);
      }
      const p = points[index];
      if (item.position !== undefined) {
        const parsed = parsePoint(item.position, `${label}.position`);
        const y = resolveHeight(parsed, terrain, yMode, yOffset, `${label}.position`);
        p.position = toLocalOf(road)(parsed.x, y, parsed.z);
      }
      if (item.width !== undefined) {
        if (!finite(item.width) || item.width < 0) {
          throw new Error(`${label}.width must be a number >= 0`);
        }
        p.width = item.width;
      }
      if (item.bank !== undefined) {
        if (!finite(item.bank)) {
          throw new Error(`${label}.bank must be a number of degrees`);
        }
        p.bank = item.bank;
      }
    }
  }
  const after: RoadState = { ...before, ...settings, points: points ?? before.points };
  if (!after.name) {
    after.name = before.name;
  }
  return {
    info: describeRoad(await commitRoadState(controller, road, before, after, 'Edit road')),
    err: null
  };
}

/** Changes a road from one state to another as an undoable command; returns the road */
async function commitRoadState(
  controller: SceneController,
  road: RoadSpline,
  before: RoadState,
  after: RoadState,
  desc: string
) {
  const id = road.persistentId;
  const scene = controller.model.scene;
  const getTarget = () => {
    const node = scene.findNodeById(id);
    if (!(node instanceof RoadSpline)) {
      throw new Error('The road no longer exists');
    }
    return node;
  };
  await controller.view.cmdManager.execute(
    new CustomCommand(
      () => {
        restoreState(getTarget(), after);
        notifyChanged();
      },
      () => {
        restoreState(getTarget(), before);
        notifyChanged();
      }
    ).setDesc(desc)
  );
  return getTarget();
}

/**
 * Sets the heights of the control points to a smoothed, grade limited profile of the ground under
 * the center line: the ground sampled every meter, averaged over a window, then limited to the
 * steepest grade going forward and backward. Undoable.
 */
export async function fitRoadProfile(controller: Nullable<SceneController>, params: any) {
  const { road, err } = findRoad(controller, params.node_id);
  if (!road || !controller) {
    return { info: null, err };
  }
  const terrain = road.terrain;
  if (!terrain) {
    return { info: null, err: 'The road is not on a terrain (a ClipmapTerrain ancestor)' };
  }
  if (road.numPoints < 2) {
    return { info: null, err: 'The road needs at least 2 points' };
  }
  const windowM = params.window_m ?? 30;
  const maxGrade = (params.max_grade_percent ?? 12) / 100;
  const yOffset = params.y_offset ?? 0;
  if (!finite(windowM) || windowM < 0 || !finite(maxGrade) || maxGrade <= 0 || !finite(yOffset)) {
    return {
      info: null,
      err: '`window_m` must be >= 0, `max_grade_percent` > 0 and `y_offset` a number'
    };
  }
  await terrain.whenHeightDataReady();
  const curve = road.curve;
  const closed = curve.closed;
  const length = curve.length;
  const count = Math.max(2, Math.ceil(length) + 1);
  const ds = length / (count - 1);
  const frame = createRoadFrame();
  const ground = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    road.sampleAt(k * ds, frame);
    ground[k] = terrain.getHeightAt(frame.position.x, frame.position.z) ?? frame.position.y;
  }
  // On a loop the last sample is the first one again
  const n = closed ? count - 1 : count;
  const at = (i: number) => (closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));
  // Two box passes, about a triangle filter over the window
  let profile = ground.slice(0, n);
  const r = Math.max(0, Math.round(windowM / 2 / Math.max(ds, 1e-6) / 2));
  for (let pass = 0; pass < 2 && r > 0; pass++) {
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) {
        sum += profile[at(i + j)];
      }
      next[i] = sum / (2 * r + 1);
    }
    profile = next;
  }
  const step = maxGrade * ds;
  for (let pass = 0; pass < (closed ? 3 : 1); pass++) {
    for (let i = closed ? 0 : 1; i < n; i++) {
      const prev = profile[at(i - 1)];
      profile[i] = Math.min(Math.max(profile[i], prev - step), prev + step);
    }
    for (let i = closed ? n - 1 : n - 2; i >= 0; i--) {
      const next = profile[at(i + 1)];
      profile[i] = Math.min(Math.max(profile[i], next - step), next + step);
    }
  }
  const before = captureState(road);
  const oy = road.worldMatrix.m13;
  const points = before.points.map((p, i) => {
    const s = curve.getPointS(i) / Math.max(ds, 1e-6);
    const k = Math.floor(s);
    const f = s - k;
    const y = profile[at(k)] + (profile[at(k + 1)] - profile[at(k)]) * f + yOffset;
    const q = p.clone();
    q.position = q.position.clone().setXYZ(q.position.x, y - oy, q.position.z);
    return q;
  });
  const after: RoadState = { ...before, points };
  return {
    info: describeRoad(await commitRoadState(controller, road, before, after, 'Fit road profile')),
    err: null
  };
}

export function getRoadInfo(controller: Nullable<SceneController>, params: any) {
  const { road, err } = findRoad(controller, params.node_id);
  if (!road) {
    return { info: null, err };
  }
  return { info: describeRoad(road, params.profile_spacing), err: null };
}

const round = (v: number, digits = 3) => {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
};

function describeRoad(road: RoadSpline, profileSpacing?: unknown) {
  const terrain = road.terrain;
  const m = road.worldMatrix;
  const curve = road.curve;
  const stats = road.getStats();
  const frame = createRoadFrame();
  const warnings: string[] = [];
  const points = [];
  for (let i = 0; i < road.numPoints; i++) {
    const p = road.getPoint(i)!;
    const w = m.transformPointAffine(p.position, new Vector3());
    const ground = terrain?.getHeightAt(w.x, w.z) ?? null;
    if (terrain && ground === null) {
      warnings.push(`Point ${i} is off the terrain`);
    }
    points.push({
      index: i,
      position: [round(w.x), round(w.y), round(w.z)],
      s: round(curve.getPointS(i), 2),
      width: p.width > 0 ? p.width : road.width,
      bank: p.bank,
      handle_mode: p.handleMode,
      ground_height: ground === null ? null : round(ground),
      above_ground: ground === null ? null : round(w.y - ground)
    });
  }
  // How far the center line runs above (fill) or below (cut) the current ground
  const spacing = finite(profileSpacing) && profileSpacing > 0 ? profileSpacing : 2;
  let maxFill = 0;
  let maxFillS = 0;
  let maxCut = 0;
  let maxCutS = 0;
  let offTerrain = 0;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const length = curve.length;
  const steps = length > 0 ? Math.max(1, Math.ceil(length / spacing)) : 0;
  for (let k = 0; k <= steps && curve.numSegments > 0; k++) {
    const s = (length * k) / steps;
    road.sampleAt(s, frame);
    const c = frame.position;
    const half = frame.width * 0.5 + road.shoulderWidth;
    for (const side of [-half, half]) {
      const x = c.x + frame.right.x * side;
      const z = c.z + frame.right.z * side;
      min.setXYZ(Math.min(min.x, x), Math.min(min.y, c.y), Math.min(min.z, z));
      max.setXYZ(Math.max(max.x, x), Math.max(max.y, c.y), Math.max(max.z, z));
    }
    const ground = terrain?.getHeightAt(c.x, c.z) ?? null;
    if (ground === null) {
      offTerrain++;
      continue;
    }
    const d = c.y - ground;
    if (d > maxFill) {
      maxFill = d;
      maxFillS = s;
    }
    if (-d > maxCut) {
      maxCut = -d;
      maxCutS = s;
    }
  }
  if (terrain && offTerrain > 0) {
    warnings.push(`${offTerrain} of ${steps + 1} center line samples are off the terrain`);
  }
  for (const [s0, s1] of stats.narrowed) {
    warnings.push(
      `Bend too tight for the road width at s=${round(s0, 1)}..${round(s1, 1)}: the inner side is narrowed`
    );
  }
  if (road.numPoints < 2) {
    warnings.push('A road needs at least 2 points');
  }
  if (road.closed && road.numPoints < 3) {
    warnings.push('A closed road needs at least 3 points; drawn open');
  }
  const at = (s: number) => {
    road.sampleAt(s, frame);
    return [round(frame.position.x, 2), round(frame.position.z, 2)];
  };
  return {
    node_id: road.persistentId,
    name: road.name,
    terrain_id: terrain?.persistentId ?? null,
    closed: road.closed,
    width: road.width,
    shoulder_width: road.shoulderWidth,
    surface_tag: road.surfaceTag,
    material: materialPath(road.material),
    shoulder_material: materialPath(road.shoulderMaterial),
    uv_tile_length: road.uvTileLength,
    uv_tile_width: road.uvTileWidth,
    sample_spacing: road.sampleSpacing,
    chunk_length: road.chunkLength,
    collision: road.collision,
    friction: road.friction,
    // Ground kept by road_apply_terrain, null when the terrain was not fitted or was committed
    terrain_base: summarizeTerrainBase(road.terrainBase),
    length: round(stats.length, 2),
    num_points: road.numPoints,
    num_chunks: road.numChunks,
    bounds:
      steps > 0
        ? {
            min: [round(min.x, 2), round(min.y, 2), round(min.z, 2)],
            max: [round(max.x, 2), round(max.y, 2), round(max.z, 2)]
          }
        : null,
    min_radius: Number.isFinite(stats.minRadius) ? round(stats.minRadius, 2) : null,
    min_radius_at: Number.isFinite(stats.minRadius)
      ? { s: round(stats.minRadiusS, 1), position: at(stats.minRadiusS) }
      : null,
    max_grade_percent: round(stats.maxGrade * 100, 2),
    max_grade_at: { s: round(stats.maxGradeS, 1), position: at(stats.maxGradeS) },
    max_bank: round(stats.maxBank, 2),
    profile: terrain
      ? {
          max_above_ground: round(maxFill, 2),
          max_above_ground_at: { s: round(maxFillS, 1), position: at(maxFillS) },
          max_below_ground: round(maxCut, 2),
          max_below_ground_at: { s: round(maxCutS, 1), position: at(maxCutS) }
        }
      : null,
    points,
    warnings
  };
}

function materialPath(material: Nullable<MeshMaterial>) {
  if (!material) {
    return '';
  }
  return getEngine().resourceManager.getAssetId(material.coreMaterial) ?? '';
}
