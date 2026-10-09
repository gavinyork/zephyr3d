/**
 * Foliage tools of the editor MCP bridge: inspecting a FoliageSystem, setting its layers and
 * scattering instances with a script evaluated per candidate point in a worker.
 */
import type { SceneController } from '../controllers/scenecontroller';
import { FoliageSystem, FOLIAGE_INSTANCE_STRIDE } from '@zephyr3d/scene';
import type { FoliageLayerSettings } from '@zephyr3d/scene';
import { CustomCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import { readWorldHeights } from './mcpterrain';
import type { FoliageScatterMessage, FoliageScatterResult } from '../workers/foliage_scatter';

const DEFAULT_SCATTER_TIMEOUT_MS = 120000;

type FoliageState = {
  chunkSize: number;
  layers: { asset: string; settings: FoliageLayerSettings; instances: Float32Array }[];
};

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
        alignToNormal: layer.alignToNormal
      },
      instances: layer.getInstances()
    });
  }
  return { chunkSize: foliage.chunkSize, layers };
}

function restoreState(foliage: FoliageSystem, state: FoliageState) {
  foliage.chunkSize = state.chunkSize;
  // Layers whose asset is unchanged are kept, so their loaded meshes are reused
  for (let i = 0; i < state.layers.length; i++) {
    const info = state.layers[i];
    if (i < foliage.numLayers) {
      foliage.setLayerSettings(i, { ...info.settings, asset: info.asset });
    } else {
      foliage.addLayer(info.asset, info.settings);
    }
    foliage.setInstances(i, info.instances);
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
  change: () => void
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
      () => {
        const target = getTarget();
        if (after) {
          restoreState(target, after);
        } else {
          change();
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
      cast_shadow: layer.castShadow,
      cull_distance: layer.cullDistance,
      align_to_normal: layer.alignToNormal,
      local_bounds: layer.count > 0 ? { min: [minX, minZ], max: [maxX, maxZ] } : null
    });
  }
  const m = foliage.worldMatrix;
  return {
    info: {
      terrain_id: foliage.terrain?.persistentId ?? null,
      world_offset: [m.m03, m.m13, m.m23],
      chunk_size: foliage.chunkSize,
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
  for (let i = 0; i < layers.length; i++) {
    const asset = layers[i]?.asset;
    if (typeof asset !== 'string' || !asset.trim()) {
      return { err: `Layer ${i}: \`asset\` must be the path of a .zprefab or model asset` };
    }
  }
  await commitChange(controller, foliage, 'Set foliage layers', () => {
    if (params.chunk_size !== undefined) {
      foliage.chunkSize = Number(params.chunk_size);
    }
    for (let i = 0; i < layers.length; i++) {
      const info = layers[i];
      const settings = {
        asset: String(info.asset).trim(),
        castShadow: info.cast_shadow,
        cullDistance: info.cull_distance,
        alignToNormal: info.align_to_normal
      };
      if (i < foliage.numLayers) {
        const keep = foliage.getLayer(i)!.asset === settings.asset;
        foliage.setLayerSettings(i, settings);
        if (!keep || info.clear) {
          foliage.setInstances(i, []);
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

function runScatterWorker(message: FoliageScatterMessage, timeoutMs: number): Promise<FoliageScatterResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/foliage_scatter.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`Foliage scatter timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = () => {
      window.clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<any>) => {
      const msg = event.data;
      if (msg?.type === 'success') {
        finish();
        resolve(msg);
      } else if (msg?.type === 'error') {
        finish();
        reject(new Error(String(msg.error)));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Foliage scatter worker failed'));
    };
    worker.postMessage(message, [message.heights.buffer, message.avoid.buffer]);
  });
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
    if (index === layerIndex && mode === 'replace') {
      continue;
    }
    const data = foliage.getLayer(index)?.getInstances();
    if (!data) {
      return { result: null, err: `avoid_layers: no layer ${index}` };
    }
    for (let k = 0; k < data.length; k += FOLIAGE_INSTANCE_STRIDE) {
      avoid.push(data[k] + ox, data[k + 1] + oz);
    }
  }
  const scaleRange = Array.isArray(params.scale_range) ? params.scale_range.map(Number) : [0.8, 1.2];
  const heights = await readWorldHeights(terrain);
  const result = await runScatterWorker(
    {
      type: 'scatter',
      source,
      entry: typeof params.entry === 'string' && params.entry.trim() ? params.entry.trim() : 'place',
      input: params.input ?? null,
      seed: Number(params.seed ?? 1) | 0,
      spacing,
      scaleRange: [scaleRange[0] ?? 1, scaleRange[1] ?? scaleRange[0] ?? 1],
      area,
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
  // World to foliage space
  const instances = result.instances;
  for (let k = 0; k < instances.length; k += FOLIAGE_INSTANCE_STRIDE) {
    instances[k] -= ox;
    instances[k + 1] -= oz;
  }
  // A region scatter in replace mode only replaces the instances inside the region
  const kept: number[] = [];
  if (mode === 'replace' && Array.isArray(params.region)) {
    const old = foliage.getLayer(layerIndex)!.getInstances();
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
  const x = Number(center[0]) - foliage.worldMatrix.m03;
  const z = Number(center[1]) - foliage.worldMatrix.m23;
  let removed = 0;
  await commitChange(controller, foliage, 'Erase foliage', () => {
    removed = foliage.removeInstancesInCircle(x, z, radius, layer);
  });
  return { removed, err: null };
}
