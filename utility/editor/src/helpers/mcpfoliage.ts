/**
 * Foliage tools of the editor MCP bridge: inspecting a FoliageSystem, setting its layers and
 * scattering instances with a script evaluated per candidate point in a worker.
 */
import type { SceneController } from '../controllers/scenecontroller';
import { FoliageSystem, FOLIAGE_INSTANCE_STRIDE } from '@zephyr3d/scene';
import type {
  FoliageCollision,
  FoliageDensityMask,
  FoliageGeneration,
  FoliageLayerSettings
} from '@zephyr3d/scene';
import { CustomCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import { readWorldHeights } from './mcpterrain';
import { runScatterWorker } from './foliagepaint';
import {
  applyPaintStrokes,
  layerCounts,
  parseLayerIndex,
  parsePaintStrokes,
  regenerateLayers
} from './mcpfoliage_paint';

const DEFAULT_SCATTER_TIMEOUT_MS = 120000;

type FoliageState = {
  chunkSize: number;
  maskCellSize: number;
  layers: {
    asset: string;
    settings: FoliageLayerSettings;
    generated: Float32Array;
    manual: Float32Array;
    mask: Uint8Array;
  }[];
};

/** A copy of a density mask, in its saved form */
function copyMask(mask: FoliageDensityMask) {
  const bytes = new Uint8Array(mask.byteSize);
  mask.write(new DataView(bytes.buffer), 0);
  return bytes;
}

function findFoliage(controller: SceneController | null, id: unknown) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { foliage: null, err: 'No scene is currently opened' };
  }
  const nodeId = typeof id === 'string' ? id.trim() : '';
  if (!nodeId) {
    return { foliage: null, err: 'Pass `node_id`, the persistent id of a FoliageSystem node' };
  }
  const node = scene.findNodeById(nodeId);
  if (!node) {
    return { foliage: null, err: `Node not found in current scene: ${nodeId}` };
  }
  if (!(node instanceof FoliageSystem)) {
    return { foliage: null, err: `Node ${nodeId} is not a FoliageSystem` };
  }
  return { foliage: node, err: null };
}

function captureState(foliage: FoliageSystem): FoliageState {
  const layers = [];
  for (let i = 0; i < foliage.numLayers; i++) {
    const layer = foliage.getLayer(i)!;
    layers.push({
      asset: layer.asset,
      settings: {
        castShadow: layer.castShadow,
        cullDistance: layer.cullDistance,
        alignToNormal: layer.alignToNormal,
        collision: layer.collision,
        generation: layer.generation
      },
      generated: layer.getInstances('generated'),
      manual: layer.getInstances('manual'),
      mask: copyMask(layer.mask)
    });
  }
  return { chunkSize: foliage.chunkSize, maskCellSize: foliage.maskCellSize, layers };
}

function restoreState(foliage: FoliageSystem, state: FoliageState) {
  foliage.chunkSize = state.chunkSize;
  foliage.maskCellSize = state.maskCellSize;
  // Layers whose asset is unchanged are kept, so their loaded meshes are reused
  for (let i = 0; i < state.layers.length; i++) {
    const info = state.layers[i];
    if (i < foliage.numLayers) {
      foliage.setLayerSettings(i, { ...info.settings, asset: info.asset });
    } else {
      foliage.addLayer(info.asset, info.settings);
    }
    foliage.setInstances(i, info.generated, 'generated');
    foliage.setInstances(i, info.manual, 'manual');
    foliage.getLayer(i)!.mask.read(new DataView(info.mask.buffer), 0);
  }
  while (foliage.numLayers > state.layers.length) {
    foliage.removeLayer(foliage.numLayers - 1);
  }
}

/** Applies a change as an undoable command restoring the whole foliage state */
async function commitChange(
  controller: SceneController,
  foliage: FoliageSystem,
  desc: string,
  change: () => void | Promise<void>
) {
  const id = foliage.persistentId;
  const scene = controller.model.scene;
  const getTarget = () => {
    const node = scene.findNodeById(id);
    if (!(node instanceof FoliageSystem)) {
      throw new Error('The foliage system no longer exists');
    }
    return node;
  };
  const before = captureState(foliage);
  let after: FoliageState | null = null;
  await controller.view.cmdManager.execute(
    new CustomCommand(
      async () => {
        const target = getTarget();
        if (after) {
          restoreState(target, after);
        } else {
          await change();
          after = captureState(target);
        }
        eventBus.dispatchEvent('scene_changed');
        eventBus.dispatchEvent('refresh_properties');
      },
      () => {
        restoreState(getTarget(), before);
        eventBus.dispatchEvent('scene_changed');
        eventBus.dispatchEvent('refresh_properties');
      }
    ).setDesc(desc)
  );
}

export function getFoliageInfo(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage) {
    return { info: null, err };
  }
  const layers = [];
  for (let i = 0; i < foliage.numLayers; i++) {
    const layer = foliage.getLayer(i)!;
    const data = layer.getInstances();
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < data.length; k += FOLIAGE_INSTANCE_STRIDE) {
      minX = Math.min(minX, data[k]);
      maxX = Math.max(maxX, data[k]);
      minZ = Math.min(minZ, data[k + 1]);
      maxZ = Math.max(maxZ, data[k + 1]);
    }
    layers.push({
      asset: layer.asset,
      count: layer.count,
      generation: generationInfo(layer.generation),
      generated_count: layer.generatedCount,
      placed_count: layer.manualCount,
      mask_tiles: layer.mask.numTiles,
      mask_bounds: layer.mask.getBounds(),
      cast_shadow: layer.castShadow,
      cull_distance: layer.cullDistance,
      align_to_normal: layer.alignToNormal,
      collision: layer.collision,
      local_bounds: layer.count > 0 ? { min: [minX, minZ], max: [maxX, maxZ] } : null
    });
  }
  const m = foliage.worldMatrix;
  return {
    info: {
      terrain_id: foliage.terrain?.persistentId ?? null,
      world_offset: [m.m03, m.m13, m.m23],
      chunk_size: foliage.chunkSize,
      mask_cell_size: foliage.maskCellSize,
      num_instances: foliage.numInstances,
      layers
    },
    err: null
  };
}

export async function setFoliageLayers(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage || !controller) {
    return { err };
  }
  const layers = params.layers;
  if (!Array.isArray(layers)) {
    return { err: '`layers` must be an array of foliage layer settings' };
  }
  const collisions: (FoliageCollision | null | undefined)[] = [];
  const generations: (Partial<FoliageGeneration> | undefined)[] = [];
  for (let i = 0; i < layers.length; i++) {
    const asset = layers[i]?.asset;
    if (typeof asset !== 'string' || !asset.trim()) {
      return { err: `Layer ${i}: \`asset\` must be the path of a .zprefab or model asset` };
    }
    const collision = parseCollision(layers[i]?.collision);
    if (typeof collision === 'string') {
      return { err: `Layer ${i}: ${collision}` };
    }
    collisions.push(collision);
    const generation = parseGeneration(layers[i]?.generation);
    if (typeof generation === 'string') {
      return { err: `Layer ${i}: ${generation}` };
    }
    generations.push(generation);
  }
  await commitChange(controller, foliage, 'Set foliage layers', () => {
    if (params.chunk_size !== undefined) {
      foliage.chunkSize = Number(params.chunk_size);
    }
    if (params.mask_cell_size !== undefined) {
      foliage.maskCellSize = Number(params.mask_cell_size);
    }
    for (let i = 0; i < layers.length; i++) {
      const info = layers[i];
      const settings = {
        asset: String(info.asset).trim(),
        castShadow: info.cast_shadow,
        cullDistance: info.cull_distance,
        alignToNormal: info.align_to_normal,
        collision: collisions[i],
        generation: generations[i]
      };
      if (i < foliage.numLayers) {
        const keep = foliage.getLayer(i)!.asset === settings.asset;
        foliage.setLayerSettings(i, settings);
        if (!keep || info.clear) {
          foliage.setInstances(i, [], 'all');
          foliage.getLayer(i)!.mask.clear();
        }
      } else {
        foliage.addLayer(settings.asset, settings);
      }
    }
    while (foliage.numLayers > layers.length) {
      foliage.removeLayer(foliage.numLayers - 1);
    }
  });
  return { num_layers: foliage.numLayers, err: null };
}

const COLLISION_SHAPES = ['box', 'sphere', 'capsule', 'cylinder', 'asset'];

/** The collision of a layer from MCP parameters: undefined keeps it, null removes it, a string is an error */
function parseCollision(value: any): FoliageCollision | null | undefined | string {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === false) {
    return null;
  }
  if (typeof value !== 'object' || !COLLISION_SHAPES.includes(value.shape)) {
    return `\`collision.shape\` must be one of ${COLLISION_SHAPES.join(', ')}`;
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const vec3 = (v: unknown) =>
    Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? (v as [number, number, number])
      : undefined;
  for (const key of ['size', 'offset']) {
    if (value[key] !== undefined && !vec3(value[key])) {
      return `\`collision.${key}\` must be [x, y, z]`;
    }
  }
  return {
    shape: value.shape,
    radius: num(value.radius),
    height: num(value.height),
    size: vec3(value.size),
    offset: vec3(value.offset),
    friction: num(value.friction),
    restitution: num(value.restitution),
    layer: num(value.layer)
  };
}

export async function scatterFoliage(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage || !controller) {
    return { result: null, err };
  }
  const layerIndex = Number(params.layer ?? 0);
  if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= foliage.numLayers) {
    return {
      result: null,
      err: `\`layer\` must be an index below ${foliage.numLayers}; add layers with foliage_set_layers`
    };
  }
  const terrain = foliage.terrain;
  if (!terrain || !terrain.heightMap) {
    return { result: null, err: 'The foliage system must be a descendant of a ClipmapTerrain' };
  }
  const source = typeof params.source === 'string' ? params.source : '';
  if (!source.trim()) {
    return { result: null, err: '`source` must define function place(p, api, input)' };
  }
  const spacing = Number(params.spacing);
  if (!(spacing > 0)) {
    return { result: null, err: '`spacing` must be a positive distance in meters' };
  }
  const mode = params.mode === 'add' ? 'add' : 'replace';
  const timeoutMs = Math.max(
    1000,
    Math.min(10 * 60 * 1000, Number(params.timeout_ms ?? DEFAULT_SCATTER_TIMEOUT_MS))
  );
  const region = terrain.worldRegion;
  const area: [number, number, number, number] = Array.isArray(params.region)
    ? [
        Math.max(region.x, Number(params.region[0])),
        Math.max(region.y, Number(params.region[1])),
        Math.min(region.z, Number(params.region[2])),
        Math.min(region.w, Number(params.region[3]))
      ]
    : [region.x, region.y, region.z, region.w];
  if (!(area[2] > area[0] && area[3] > area[1])) {
    return { result: null, err: '`region` must be [minX, minZ, maxX, maxZ] overlapping the terrain' };
  }
  const ox = foliage.worldMatrix.m03;
  const oz = foliage.worldMatrix.m23;
  // Instances to keep away from, in world space
  const avoidLayers: number[] = Array.isArray(params.avoid_layers) ? params.avoid_layers.map(Number) : [];
  if (mode === 'add' && !avoidLayers.includes(layerIndex)) {
    avoidLayers.push(layerIndex);
  }
  const avoid: number[] = [];
  for (const index of avoidLayers) {
    // Replacing removes only the placed instances of the layer; the painted ones stay
    const data = foliage
      .getLayer(index)
      ?.getInstances(index === layerIndex && mode === 'replace' ? 'generated' : 'all');
    if (!data) {
      return { result: null, err: `avoid_layers: no layer ${index}` };
    }
    for (let k = 0; k < data.length; k += FOLIAGE_INSTANCE_STRIDE) {
      avoid.push(data[k], data[k + 1]);
    }
  }
  const scaleRange = Array.isArray(params.scale_range) ? params.scale_range.map(Number) : [0.8, 1.2];
  const heights = await readWorldHeights(terrain);
  const oy = foliage.worldMatrix.m13;
  const result = await runScatterWorker(
    {
      type: 'scatter',
      source,
      entry: typeof params.entry === 'string' && params.entry.trim() ? params.entry.trim() : 'place',
      input: params.input ?? null,
      settings: {
        spacing,
        scaleRange: [scaleRange[0] ?? 1, scaleRange[1] ?? scaleRange[0] ?? 1],
        // The script decides; the layer filters are for painting
        slopeRange: [0, 90],
        heightRange: null,
        yOffset: 0,
        randomYaw: true,
        seed: Number(params.seed ?? 1) | 0
      },
      area: [area[0] - ox, area[1] - oz, area[2] - ox, area[3] - oz],
      origin: [ox, oy, oz],
      density: null,
      surfaces: null,
      storeHeight: false,
      region: [region.x, region.y, region.z, region.w],
      heights: heights.heights,
      heightsWidth: heights.width,
      heightsDepth: heights.depth,
      avoid: new Float32Array(avoid),
      avoidRadius: Number(params.avoid_radius ?? spacing),
      deadlineAt: Date.now() + timeoutMs
    },
    timeoutMs
  );
  const instances = result.instances;
  // A region scatter in replace mode only replaces the instances inside the region
  const kept: number[] = [];
  if (mode === 'replace' && Array.isArray(params.region)) {
    const old = foliage.getLayer(layerIndex)!.getInstances('manual');
    for (let k = 0; k < old.length; k += FOLIAGE_INSTANCE_STRIDE) {
      const wx = old[k] + ox;
      const wz = old[k + 1] + oz;
      if (wx < area[0] || wx > area[2] || wz < area[1] || wz > area[3]) {
        for (let c = 0; c < FOLIAGE_INSTANCE_STRIDE; c++) {
          kept.push(old[k + c]);
        }
      }
    }
  }
  await commitChange(controller, foliage, 'Scatter foliage', () => {
    if (mode === 'add') {
      foliage.addInstances(layerIndex, instances);
    } else {
      const merged = new Float32Array(kept.length + instances.length);
      merged.set(kept);
      merged.set(instances, kept.length);
      foliage.setInstances(layerIndex, merged);
    }
  });
  return {
    result: {
      layer: layerIndex,
      candidates: result.candidates,
      placed: instances.length / FOLIAGE_INSTANCE_STRIDE,
      layer_count: foliage.getLayer(layerIndex)!.count
    },
    err: null
  };
}

export async function eraseFoliage(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage || !controller) {
    return { removed: 0, err };
  }
  const center = params.center;
  const radius = Number(params.radius);
  if (!Array.isArray(center) || center.length < 2 || !(radius > 0)) {
    return { removed: 0, err: '`center` must be a world [x, z] and `radius` positive' };
  }
  const layer = params.layer === undefined ? -1 : Number(params.layer);
  const group = params.group === 'painted' ? 'generated' : params.group === 'placed' ? 'manual' : 'all';
  const x = Number(center[0]) - foliage.worldMatrix.m03;
  const z = Number(center[1]) - foliage.worldMatrix.m23;
  let removed = 0;
  await commitChange(controller, foliage, 'Erase foliage', () => {
    removed = foliage.removeInstancesInCircle(x, z, radius, layer, group);
  });
  return { removed, err: null };
}

/** Generation settings of a layer as MCP reports them */
function generationInfo(g: FoliageGeneration) {
  return {
    spacing: g.spacing,
    scale_range: g.scaleRange,
    slope_range: g.slopeRange,
    height_range: g.heightRange,
    y_offset: g.yOffset,
    random_yaw: g.randomYaw,
    seed: g.seed,
    surface: g.surface,
    place_script: g.placeScript
  };
}

/** Generation settings of a layer from MCP parameters: undefined keeps them, a string is an error */
function parseGeneration(value: any): Partial<FoliageGeneration> | undefined | string {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object') {
    return '`generation` must be an object';
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const pair = (v: unknown) =>
    Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? (v as [number, number])
      : undefined;
  for (const key of ['scale_range', 'slope_range']) {
    if (value[key] !== undefined && !pair(value[key])) {
      return `\`generation.${key}\` must be [min, max]`;
    }
  }
  if (value.height_range !== undefined && value.height_range !== null && !pair(value.height_range)) {
    return '`generation.height_range` must be [min, max] or null';
  }
  if (value.surface !== undefined && value.surface !== 'terrain' && value.surface !== 'any') {
    return '`generation.surface` must be terrain or any';
  }
  if (value.spacing !== undefined && !((num(value.spacing) ?? 0) > 0)) {
    return '`generation.spacing` must be a positive distance in meters';
  }
  const out: Partial<FoliageGeneration> = {};
  if (value.spacing !== undefined) {
    out.spacing = num(value.spacing);
  }
  if (value.scale_range !== undefined) {
    out.scaleRange = pair(value.scale_range);
  }
  if (value.slope_range !== undefined) {
    out.slopeRange = pair(value.slope_range);
  }
  if (value.height_range !== undefined) {
    out.heightRange = value.height_range === null ? null : pair(value.height_range);
  }
  if (value.y_offset !== undefined) {
    out.yOffset = num(value.y_offset);
  }
  if (typeof value.random_yaw === 'boolean') {
    out.randomYaw = value.random_yaw;
  }
  if (value.seed !== undefined) {
    out.seed = num(value.seed);
  }
  if (value.surface !== undefined) {
    out.surface = value.surface;
  }
  if (typeof value.place_script === 'string') {
    out.placeScript = value.place_script;
  }
  return out;
}

export async function paintFoliage(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage || !controller) {
    return { result: null, err };
  }
  const { index, err: layerErr } = parseLayerIndex(foliage, params.layer);
  if (layerErr) {
    return { result: null, err: layerErr };
  }
  const strokes = parsePaintStrokes(foliage, params);
  if (typeof strokes === 'string') {
    return { result: null, err: strokes };
  }
  const mode = params.mode === 'add' || params.mode === 'erase' ? params.mode : 'set';
  const density = params.density === undefined ? 1 : Number(params.density);
  const falloff = params.falloff === undefined ? 0.5 : Number(params.falloff);
  if (!(density >= 0 && density <= 1) || !(falloff >= 0 && falloff <= 1)) {
    return { result: null, err: '`density` and `falloff` must be within 0..1' };
  }
  await commitChange(controller, foliage, mode === 'erase' ? 'Erase foliage' : 'Paint foliage', () =>
    applyPaintStrokes(foliage, index, strokes, mode, density, falloff)
  );
  return {
    result: {
      layer: index,
      ...layerCounts(foliage, index),
      mask_tiles: foliage.getLayer(index)!.mask.numTiles
    },
    err: null
  };
}

export async function regenerateFoliage(controller: SceneController | null, params: any) {
  const { foliage, err } = findFoliage(controller, params.node_id);
  if (!foliage || !controller) {
    return { result: null, err };
  }
  let indices: number[];
  if (params.layer === undefined) {
    indices = Array.from({ length: foliage.numLayers }, (_, i) => i);
  } else {
    const { index, err: layerErr } = parseLayerIndex(foliage, params.layer);
    if (layerErr) {
      return { result: null, err: layerErr };
    }
    indices = [index];
  }
  await commitChange(controller, foliage, 'Regenerate foliage', () => regenerateLayers(foliage, indices));
  return { result: { layers: indices.map((i) => ({ layer: i, ...layerCounts(foliage, i) })) }, err: null };
}
