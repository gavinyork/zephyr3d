/**
 * Terrain tools of the editor MCP bridge: inspecting a ClipmapTerrain and generating its height map,
 * splat map and grass density from a script evaluated per texel in a worker.
 */
import type { Editor } from '../core/editor';
import type { SceneController } from '../controllers/scenecontroller';
import { ClipmapTerrain, getEngine } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import { float2half, half2float, Vector4 } from '@zephyr3d/base';
import { CustomCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import type { TerrainFieldMessage, TerrainFieldResult, TerrainFieldTarget } from '../workers/terrain_field';

const DEFAULT_FIELD_TIMEOUT_MS = 120000;

type TerrainLookup = { terrain: ClipmapTerrain | null; err: string | null };

export function findTerrain(controller: SceneController | null, id: unknown): TerrainLookup {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { terrain: null, err: 'No scene is currently opened' };
  }
  const nodeId = typeof id === 'string' ? id.trim() : '';
  if (!nodeId) {
    return { terrain: null, err: 'Pass `node_id`, the persistent id of a ClipmapTerrain node' };
  }
  const node = scene.findNodeById(nodeId);
  if (!node) {
    return { terrain: null, err: `Node not found in current scene: ${nodeId}` };
  }
  if (!(node instanceof ClipmapTerrain)) {
    return { terrain: null, err: `Node ${nodeId} is not a ClipmapTerrain` };
  }
  if (!node.heightMap) {
    return { terrain: null, err: `Terrain ${nodeId} has no height map` };
  }
  return { terrain: node, err: null };
}

/** World heights of the height map texels, row by row */
export async function readWorldHeights(terrain: ClipmapTerrain) {
  const heightMap = terrain.heightMap!;
  const w = heightMap.width;
  const h = heightMap.height;
  const raw = await readHeightTexels(terrain);
  const scaleY = terrain.scale.y;
  const baseY = terrain.worldMatrix.m13;
  const heights = new Float32Array(w * h);
  for (let i = 0; i < heights.length; i++) {
    heights[i] = raw[i] * scaleY + baseY;
  }
  return { heights, width: w, depth: h };
}

/** Height map texel values as stored, before the terrain scale and translation */
async function readHeightTexels(terrain: ClipmapTerrain): Promise<Float32Array> {
  const heightMap = terrain.heightMap!;
  const w = heightMap.width;
  const h = heightMap.height;
  const out = new Float32Array(w * h);
  const cpu = terrain.heightData;
  if (cpu && cpu.width === w && cpu.height === h) {
    for (let i = 0; i < out.length; i++) {
      out[i] = half2float(cpu.data[i]);
    }
    return out;
  }
  // readPixels returns raw bytes: half floats have to be decoded by hand
  if (heightMap.format === 'r16f') {
    const data = new Uint16Array(w * h);
    await heightMap.readPixels(0, 0, w, h, 0, 0, data);
    for (let i = 0; i < out.length; i++) {
      out[i] = half2float(data[i]);
    }
  } else if (heightMap.format === 'rgba16f') {
    const data = new Uint16Array(w * h * 4);
    await heightMap.readPixels(0, 0, w, h, 0, 0, data);
    for (let i = 0; i < out.length; i++) {
      out[i] = half2float(data[i * 4]);
    }
  } else if (heightMap.format === 'r32f') {
    await heightMap.readPixels(0, 0, w, h, 0, 0, out);
  } else if (heightMap.format === 'rgba32f') {
    const data = new Float32Array(w * h * 4);
    await heightMap.readPixels(0, 0, w, h, 0, 0, data);
    for (let i = 0; i < out.length; i++) {
      out[i] = data[i * 4];
    }
  } else {
    throw new Error(`Unsupported height map format: ${heightMap.format}`);
  }
  return out;
}

/** Writes height map texel values (before the terrain scale and translation) */
function writeHeightTexels(terrain: ClipmapTerrain, texels: Float32Array) {
  const heightMap = terrain.heightMap!;
  const w = heightMap.width;
  const h = heightMap.height;
  if (heightMap.format === 'r16f') {
    const data = new Uint16Array(w * h);
    for (let i = 0; i < data.length; i++) {
      data[i] = float2half(texels[i]);
    }
    terrain.setHeights(data);
  } else if (heightMap.format === 'r32f') {
    heightMap.update(texels as Float32Array<ArrayBuffer>, 0, 0, w, h);
    terrain.updateBoundingBox();
    terrain.invalidateRuntimeVirtualTexture();
  } else {
    throw new Error(`Unsupported height map format: ${heightMap.format}`);
  }
}

async function readSplat(terrain: ClipmapTerrain) {
  const splatMap = terrain.material!.getSplatMap();
  const w = splatMap.width;
  const h = splatMap.height;
  const pages = splatMap.depth;
  const data = new Uint8Array(w * h * 4 * pages);
  for (let page = 0; page < pages; page++) {
    await splatMap.readPixels(0, 0, w, h, page, 0, new Uint8Array(data.buffer, w * h * 4 * page, w * h * 4));
  }
  return data;
}

function writeSplat(terrain: ClipmapTerrain, data: Uint8Array<ArrayBuffer>) {
  const splatMap = terrain.material!.getSplatMap();
  splatMap.update(data, 0, 0, 0, splatMap.width, splatMap.height, splatMap.depth);
  terrain.invalidateRuntimeVirtualTexture();
}

function writeGrass(
  terrain: ClipmapTerrain,
  layerIndex: number,
  width: number,
  depth: number,
  data: Uint8Array
) {
  const layer = terrain.grassRenderer.getLayer(layerIndex);
  layer.setDensityData(width, depth, layer.cellsPerTexel, data.slice());
}

function runFieldWorker(message: TerrainFieldMessage, timeoutMs: number): Promise<TerrainFieldResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/terrain_field.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`Terrain generation timed out after ${timeoutMs}ms`));
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
      reject(new Error(event.message || 'Terrain generation worker failed'));
    };
    worker.postMessage(message, [message.heights.buffer]);
  });
}

function round(v: number) {
  return Math.round(v * 1000) / 1000;
}

export async function getTerrainInfo(controller: SceneController | null, params: any) {
  const { terrain, err } = findTerrain(controller, params.node_id);
  if (!terrain) {
    return { info: null, err };
  }
  const { heights, width, depth } = await readWorldHeights(terrain);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < heights.length; i++) {
    min = Math.min(min, heights[i]);
    max = Math.max(max, heights[i]);
  }
  const region = terrain.worldRegion;
  const material = terrain.material!;
  const manager = getEngine().resourceManager;
  const detailLayers = [];
  for (let i = 0; i < material.numDetailMaps; i++) {
    detailLayers.push({
      albedo: manager.getAssetId(material.getDetailMap(i)) ?? '',
      normal: manager.getAssetId(material.getDetailNormalMap(i)) ?? '',
      uv_scale: material.getDetailMapUVScale(i),
      roughness: material.getDetailMapRoughness(i)
    });
  }
  const grass = terrain.grassRenderer;
  const grassLayers = [];
  for (let i = 0; i < grass.numLayers; i++) {
    const layer = grass.getLayer(i);
    grassLayers.push({
      kind: layer.kind,
      texture: manager.getAssetId(grass.getGrassTexture(i)) ?? '',
      blade_width: grass.getBladeWidth(i),
      blade_height: grass.getBladeHeight(i),
      draw_distance: grass.getDrawDistance(i),
      far_density: grass.getFarDensity(i),
      density_map_size: [layer.densityMapWidth, layer.densityMapHeight],
      cells_per_texel: layer.cellsPerTexel
    });
  }
  const splatMap = material.getSplatMap();
  return {
    info: {
      resolution: [terrain.sizeX, terrain.sizeZ],
      height_map_size: [width, depth],
      height_map_format: terrain.heightMap!.format,
      world_region: { min: [round(region.x), round(region.y)], max: [round(region.z), round(region.w)] },
      cell_size: [round((region.z - region.x) / width), round((region.w - region.y) / depth)],
      height_scale: terrain.scale.y,
      base_height: terrain.worldMatrix.m13,
      height_range: [round(min), round(max)],
      splat_map_size: [splatMap.width, splatMap.height],
      max_detail_layers: splatMap.depth * 4,
      detail_layers: detailLayers,
      grass_layers: grassLayers
    },
    err: null
  };
}

export async function generateTerrainField(editor: Editor, controller: SceneController | null, params: any) {
  const { terrain, err } = findTerrain(controller, params.node_id);
  if (!terrain || !controller) {
    return { result: null, err };
  }
  const target = String(params.target ?? '') as TerrainFieldTarget;
  if (target !== 'height' && target !== 'splat' && target !== 'grass') {
    return { result: null, err: '`target` must be one of: height, splat, grass' };
  }
  const source = typeof params.source === 'string' ? params.source : '';
  if (!source.trim()) {
    return { result: null, err: '`source` must define function sample(p, api, input)' };
  }
  const entry = typeof params.entry === 'string' && params.entry.trim() ? params.entry.trim() : 'sample';
  const timeoutMs = Math.max(
    1000,
    Math.min(10 * 60 * 1000, Number(params.timeout_ms ?? DEFAULT_FIELD_TIMEOUT_MS))
  );
  const material = terrain.material!;
  const splatMap = material.getSplatMap();
  let width: number;
  let depth: number;
  let grassLayer = -1;
  if (target === 'height') {
    width = terrain.heightMap!.width;
    depth = terrain.heightMap!.height;
  } else if (target === 'splat') {
    if (material.numDetailMaps < 1) {
      return {
        result: null,
        err: 'The terrain has no detail layers; add some with terrain_set_detail_layers first'
      };
    }
    width = splatMap.width;
    depth = splatMap.height;
  } else {
    grassLayer = Number(params.grass_layer ?? 0);
    if (!Number.isInteger(grassLayer) || grassLayer < 0 || grassLayer >= terrain.grassRenderer.numLayers) {
      return {
        result: null,
        err: `\`grass_layer\` must be an index below ${terrain.grassRenderer.numLayers}; add layers with terrain_set_grass_layers`
      };
    }
    const layer = terrain.grassRenderer.getLayer(grassLayer);
    width = layer.densityMapWidth;
    depth = layer.densityMapHeight;
  }
  const region = terrain.worldRegion;
  const current = await readWorldHeights(terrain);
  const result = await runFieldWorker(
    {
      type: 'field',
      target,
      source,
      entry,
      input: params.input ?? null,
      width,
      depth,
      region: [region.x, region.y, region.z, region.w],
      heights: current.heights,
      heightsWidth: current.width,
      heightsDepth: current.depth,
      layers: material.numDetailMaps,
      deadlineAt: Date.now() + timeoutMs
    },
    timeoutMs
  );
  // Snapshot what is replaced so the generation can be undone
  const terrainId = terrain.persistentId;
  const scene = controller.model.scene;
  const getTarget = () => {
    const node = scene.findNodeById(terrainId);
    if (!(node instanceof ClipmapTerrain)) {
      throw new Error('The terrain no longer exists');
    }
    return node;
  };
  let apply: (after: boolean) => void;
  if (target === 'height') {
    const before = await readHeightTexels(terrain);
    const scaleY = terrain.scale.y || 1;
    const baseY = terrain.worldMatrix.m13;
    const after = new Float32Array(result.data.length);
    for (let i = 0; i < after.length; i++) {
      after[i] = ((result.data as Float32Array)[i] - baseY) / scaleY;
    }
    apply = (useAfter) => writeHeightTexels(getTarget(), useAfter ? after : before);
  } else if (target === 'splat') {
    const before = await readSplat(terrain);
    const after = new Uint8Array(splatMap.width * splatMap.height * 4 * splatMap.depth);
    after.set((result.data as Uint8Array).subarray(0, Math.min(after.length, result.data.length)));
    apply = (useAfter) => writeSplat(getTarget(), useAfter ? after : before);
  } else {
    const layer = terrain.grassRenderer.getLayer(grassLayer);
    const before = {
      width: layer.densityMapWidth,
      depth: layer.densityMapHeight,
      data: layer.densityMap.slice()
    };
    const after = result.data as Uint8Array;
    apply = (useAfter) =>
      useAfter
        ? writeGrass(getTarget(), grassLayer, width, depth, after)
        : writeGrass(getTarget(), grassLayer, before.width, before.depth, before.data);
  }
  await controller.view.cmdManager.execute(
    new CustomCommand(
      () => {
        apply(true);
        eventBus.dispatchEvent('scene_changed');
      },
      () => {
        apply(false);
        eventBus.dispatchEvent('scene_changed');
      }
    ).setDesc(`Generate terrain ${target}`)
  );
  return {
    result: {
      target,
      grid_size: [width, depth],
      value_range: target === 'splat' ? null : [round(result.min), round(result.max)]
    },
    err: null
  };
}

const GRASS_LAYER_NUMBER_KEYS = [
  'heightRandomness',
  'widthRandomness',
  'tilt',
  'tiltRandomness',
  'bend',
  'bendRandomness',
  'taper',
  'tipDetail',
  'clumpSize',
  'clumpHeightVariation',
  'clumpPull',
  'clumpSameDirection',
  'clumpFaceAway',
  'clumpColorVariation',
  'rootOcclusion',
  'roundness',
  'viewThickening',
  'farNormalStart',
  'farNormalEnd',
  'farRoughness',
  'minScreenWidth',
  'windFacing',
  'windLean',
  'swayAmplitude',
  'swaySpeed',
  'lodDistance'
];
const GRASS_LAYER_COLOR_KEYS = ['rootColor', 'tipColor', 'transmissionColor'];

async function fetchTextureAsset(path: string, linear: boolean): Promise<Texture2D> {
  const tex = await getEngine().resourceManager.fetchTexture<Texture2D>(
    path,
    linear ? { linearColorSpace: true } : undefined
  );
  if (!tex?.isTexture2D()) {
    throw new Error(`Not a 2D texture: ${path}`);
  }
  return tex;
}

export async function setTerrainDetailLayers(controller: SceneController | null, params: any) {
  const { terrain, err } = findTerrain(controller, params.node_id);
  if (!terrain) {
    return { err };
  }
  const layers = params.layers;
  const material = terrain.material!;
  const maxLayers = material.getSplatMap().depth * 4;
  if (!Array.isArray(layers) || layers.length > maxLayers) {
    return { err: `\`layers\` must be an array of at most ${maxLayers} detail layers` };
  }
  // Load everything first so a bad path leaves the terrain untouched
  const loaded: { albedo: Texture2D | null; normal: Texture2D | null; uvScale: number; roughness: number }[] =
    [];
  for (let i = 0; i < layers.length; i++) {
    const info = layers[i] ?? {};
    try {
      loaded.push({
        albedo: info.albedo ? await fetchTextureAsset(String(info.albedo), false) : null,
        normal: info.normal ? await fetchTextureAsset(String(info.normal), true) : null,
        uvScale: Number(info.uv_scale ?? 100),
        roughness: Number(info.roughness ?? 1)
      });
    } catch (e) {
      return { err: `Detail layer ${i}: ${e}` };
    }
  }
  material.numDetailMaps = loaded.length;
  for (let i = 0; i < loaded.length; i++) {
    material.setDetailMap(i, loaded[i].albedo);
    material.setDetailNormalMap(i, loaded[i].normal);
    material.setDetailMapUVScale(i, loaded[i].uvScale);
    material.setDetailMapRoughness(i, loaded[i].roughness);
  }
  terrain.invalidateRuntimeVirtualTexture();
  eventBus.dispatchEvent('scene_changed');
  eventBus.dispatchEvent('refresh_properties');
  return { err: null };
}

export async function setTerrainGrassLayers(controller: SceneController | null, params: any) {
  const { terrain, err } = findTerrain(controller, params.node_id);
  if (!terrain) {
    return { err };
  }
  const layers = params.layers;
  if (!Array.isArray(layers)) {
    return { err: '`layers` must be an array of grass layer settings' };
  }
  const grass = terrain.grassRenderer;
  if (layers.length < grass.numLayers) {
    return {
      err: `The terrain has ${grass.numLayers} grass layers and they cannot be removed; pass at least that many (existing layers are updated in order, extra ones are added)`
    };
  }
  // Validate and load textures before changing anything
  const textures: (Texture2D | null)[] = [];
  for (let i = 0; i < layers.length; i++) {
    const info = layers[i] ?? {};
    const kind = info.kind ?? (i < grass.numLayers ? grass.getLayer(i).kind : 'card');
    if (kind !== 'card' && kind !== 'blade') {
      return { err: `Grass layer ${i}: kind must be card or blade` };
    }
    if (i < grass.numLayers && kind !== grass.getLayer(i).kind) {
      return { err: `Grass layer ${i}: the kind of an existing layer cannot be changed` };
    }
    const settings = info.settings ?? {};
    for (const key of Object.keys(settings)) {
      if (!GRASS_LAYER_NUMBER_KEYS.includes(key) && !GRASS_LAYER_COLOR_KEYS.includes(key)) {
        return {
          err: `Grass layer ${i}: unknown setting "${key}"; supported: ${[...GRASS_LAYER_NUMBER_KEYS, ...GRASS_LAYER_COLOR_KEYS].join(', ')}`
        };
      }
    }
    try {
      textures.push(info.texture ? await fetchTextureAsset(String(info.texture), false) : null);
    } catch (e) {
      return { err: `Grass layer ${i}: ${e}` };
    }
  }
  for (let i = 0; i < layers.length; i++) {
    const info = layers[i] ?? {};
    let index = i;
    if (i >= grass.numLayers) {
      const kind = info.kind ?? 'card';
      index = grass.addLayer(
        Number(info.blade_width ?? (kind === 'blade' ? 0.08 : 1)),
        Number(info.blade_height ?? (kind === 'blade' ? 1.5 : 1)),
        textures[i],
        kind
      );
    } else {
      if (textures[i]) {
        grass.setGrassTexture(index, textures[i]!);
      }
      if (info.blade_width !== undefined || info.blade_height !== undefined) {
        grass.setBladeSize(
          index,
          Number(info.blade_width ?? grass.getBladeWidth(index)),
          Number(info.blade_height ?? grass.getBladeHeight(index))
        );
      }
    }
    if (info.draw_distance !== undefined) {
      grass.setDrawDistance(index, Number(info.draw_distance));
    }
    if (info.far_density !== undefined) {
      grass.setFarDensity(index, Number(info.far_density));
    }
    const layer = grass.getLayer(index) as any;
    if (info.cells_per_texel !== undefined) {
      layer.cellsPerTexel = Number(info.cells_per_texel);
    }
    const settings = info.settings ?? {};
    for (const key of Object.keys(settings)) {
      const value = settings[key];
      if (GRASS_LAYER_COLOR_KEYS.includes(key)) {
        if (Array.isArray(value) && value.length >= 3) {
          layer[key] = new Vector4(Number(value[0]), Number(value[1]), Number(value[2]), 1);
        }
      } else if (typeof value === 'number') {
        layer[key] = value;
      }
    }
  }
  eventBus.dispatchEvent('scene_changed');
  eventBus.dispatchEvent('refresh_properties');
  return { num_layers: grass.numLayers, err: null };
}

function bilinear(heights: Float32Array, w: number, h: number, u: number, v: number) {
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

/** Finds the terrain by id, or the only terrain of the scene when no id is given */
function findTerrainOrOnly(controller: SceneController | null, id: unknown): TerrainLookup {
  if (typeof id === 'string' && id.trim()) {
    return findTerrain(controller, id);
  }
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { terrain: null, err: 'No scene is currently opened' };
  }
  const terrains: ClipmapTerrain[] = [];
  scene.rootNode.iterate((node) => {
    if (node instanceof ClipmapTerrain) {
      terrains.push(node);
    }
    return false;
  });
  if (terrains.length !== 1) {
    return {
      terrain: null,
      err:
        terrains.length === 0
          ? 'The scene has no ClipmapTerrain'
          : 'The scene has several terrains; pass `node_id` to pick one'
    };
  }
  return findTerrain(controller, terrains[0].persistentId);
}

export async function sampleTerrainHeight(controller: SceneController | null, params: any) {
  const { terrain, err } = findTerrainOrOnly(controller, params.node_id);
  if (!terrain) {
    return { samples: null, err };
  }
  const points = params.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > 10000) {
    return { samples: null, err: '`points` must be an array of 1 to 10000 [x, z] world positions' };
  }
  const { heights, width, depth } = await readWorldHeights(terrain);
  const region = terrain.worldRegion;
  const rw = region.z - region.x;
  const rh = region.w - region.y;
  const cellX = rw / width;
  const cellZ = rh / depth;
  const samples = [];
  for (let k = 0; k < points.length; k++) {
    const pt = points[k];
    if (!Array.isArray(pt) || pt.length < 2 || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
      return { samples: null, err: `points[${k}] must be [x, z]` };
    }
    const x = Number(pt[0]);
    const z = Number(pt[1]);
    const u = (x - region.x) / rw;
    const v = (z - region.y) / rh;
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      samples.push({ x, z, height: null, inside: false });
      continue;
    }
    const height = bilinear(heights, width, depth, u, v);
    const nx =
      -(
        bilinear(heights, width, depth, u + 1 / width, v) - bilinear(heights, width, depth, u - 1 / width, v)
      ) /
      (2 * cellX);
    const nz =
      -(
        bilinear(heights, width, depth, u, v + 1 / depth) - bilinear(heights, width, depth, u, v - 1 / depth)
      ) /
      (2 * cellZ);
    const len = Math.sqrt(nx * nx + 1 + nz * nz);
    samples.push({
      x,
      z,
      height: round(height),
      normal: [round(nx / len), round(1 / len), round(nz / len)],
      slope: round((Math.acos(Math.min(1, 1 / len)) * 180) / Math.PI),
      inside: true
    });
  }
  return { terrain_id: terrain.persistentId, samples, err: null };
}
