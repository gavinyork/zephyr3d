import { GraphNode, type SceneNode } from '../../../scene';
import { defineProps, type SerializableClass } from '../types';
import { ClipmapTerrain } from '../../../scene/terrain-cm/terrain-cm';
import { DEFAULT_BLADE_HEIGHT, DEFAULT_BLADE_WIDTH } from '../../../scene/terrain-cm/grass';
import type { TerrainDebugMode } from '../../../material';
import type { Texture2D } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import type { ResourceManager } from '../manager';
import { JSONArray } from '../json';
import { getDevice } from '../../../app/api';

// 'GRAS' in little endian. The legacy per-instance format starts with the
// layer count, so any realistic legacy file can not collide with this magic.
const GRASS_DATA_MAGIC = 0x53415247;
const GRASS_DATA_VERSION = 1;

/** One entry of the GrassMaps property */
type GrassLayerData = {
  texture: string;
  bladeWidth: number;
  bladeHeight: number;
  drawDistance?: number;
  farDensity?: number;
  /** Absent in scenes saved before blade layers, which are all card layers */
  kind?: 'card' | 'blade';
  blade?: {
    heightRandomness?: number;
    widthRandomness?: number;
    tilt?: number;
    tiltRandomness?: number;
    bend?: number;
    bendRandomness?: number;
    taper?: number;
    tipDetail?: number;
    clumpSize?: number;
    clumpHeightVariation?: number;
    clumpPull?: number;
    clumpSameDirection?: number;
    clumpFaceAway?: number;
    clumpColorVariation?: number;
    rootOcclusion?: number;
    roundness?: number;
    viewThickening?: number;
    farNormalStart?: number;
    farNormalEnd?: number;
    farRoughness?: number;
    minScreenWidth?: number;
    windFacing?: number;
    windLean?: number;
    swayAmplitude?: number;
    swaySpeed?: number;
    lodDistance?: number;
    rootColor?: [number, number, number];
    tipColor?: [number, number, number];
    transmissionColor?: [number, number, number];
  };
  card?: {
    windLean?: number;
    swayAmplitude?: number;
    swaySpeed?: number;
  };
};

function getTerrainGrassContent(terrain: ClipmapTerrain): ArrayBuffer {
  const grassRenderer = terrain.grassRenderer;
  const numLayers = grassRenderer.numLayers;
  let dataSize = 3 * 4;
  for (let i = 0; i < numLayers; i++) {
    dataSize += 4 * 4 + grassRenderer.getLayer(i).densityMap.length;
  }
  const data = new DataView(new ArrayBuffer(dataSize));
  const view = new Uint8Array(data.buffer);
  let offset = 0;
  data.setUint32(offset, GRASS_DATA_MAGIC, true);
  offset += 4;
  data.setUint32(offset, GRASS_DATA_VERSION, true);
  offset += 4;
  data.setUint32(offset, numLayers, true);
  offset += 4;
  for (let i = 0; i < numLayers; i++) {
    const layer = grassRenderer.getLayer(i);
    data.setUint32(offset, layer.densityMapWidth, true);
    offset += 4;
    data.setUint32(offset, layer.densityMapHeight, true);
    offset += 4;
    data.setUint32(offset, layer.cellsPerTexel, true);
    offset += 4;
    data.setUint32(offset, layer.densityMap.length, true);
    offset += 4;
    view.set(layer.densityMap, offset);
    offset += layer.densityMap.length;
  }
  return data.buffer;
}

/**
 * Imports grass data saved by the legacy per-instance format by baking the
 * blade instances into the per-layer density maps. Blade positions will be
 * re-derived from the density, so they will not match the original ones
 * exactly, but the local density is preserved.
 */
function importLegacyGrassInstances(terrain: ClipmapTerrain, dataView: DataView): boolean {
  const grassRenderer = terrain.grassRenderer;
  const numLayers = dataView.getUint32(0, true);
  if (numLayers !== grassRenderer.numLayers) {
    console.error('Number of grass layers mismatch');
    return false;
  }
  let offset = 4;
  for (let i = 0; i < numLayers; i++) {
    const dataSize = dataView.getUint32(offset, true);
    offset += 4;
    if (dataSize > 0) {
      const layer = grassRenderer.getLayer(i);
      const w = layer.densityMapWidth;
      const h = layer.densityMapHeight;
      const counts = new Uint32Array(w * h);
      // legacy instance layout: x, y, sin(angle), cos(angle) as floats
      const floats = new Float32Array(dataView.buffer, dataView.byteOffset + offset, dataSize >> 2);
      const numInstances = floats.length >> 2;
      for (let j = 0; j < numInstances; j++) {
        const x = Math.min(Math.max(Math.floor(floats[j * 4 + 0] * w), 0), w - 1);
        const z = Math.min(Math.max(Math.floor(floats[j * 4 + 1] * h), 0), h - 1);
        counts[z * w + x]++;
      }
      const density = layer.densityMap;
      const maxPerTexel = layer.cellsPerTexel * layer.cellsPerTexel;
      for (let t = 0; t < counts.length; t++) {
        if (counts[t] > 0) {
          density[t] = Math.min(255, Math.round((counts[t] / maxPerTexel) * 255));
        }
      }
      layer.updateDensityRegion(0, 0, w, h);
      offset += dataSize;
    }
  }
  return true;
}

async function getTerrainHeightMapContent(terrain: ClipmapTerrain): Promise<ArrayBuffer> {
  const heightmap = terrain.heightMap!;
  const buffer = new ArrayBuffer(2 * 4 + heightmap.width * heightmap.height * 2);
  const head = new DataView(buffer);
  head.setUint32(0, heightmap.width, true);
  head.setUint32(4, heightmap.height, true);
  const data = new Uint16Array(buffer, 2 * 4);
  if (heightmap.format === 'r16f') {
    await heightmap.readPixels(0, 0, heightmap.width, heightmap.height, 0, 0, data);
  } else if (heightmap.format === 'rgba16f') {
    // WebGL1 uses rgba16f for height map, so we need to convert
    const tmpData = new Uint16Array(heightmap.width * heightmap.height * 4);
    await heightmap.readPixels(0, 0, heightmap.width, heightmap.height, 0, 0, tmpData);
    for (let i = 0; i < heightmap.width * heightmap.height; i++) {
      data[i] = tmpData[i * 4 + 0]; // Use the red channel as height
    }
  }
  return buffer;
}

async function getTerrainSplatMapContent(terrain: ClipmapTerrain): Promise<ArrayBuffer> {
  const device = getDevice();
  const splatMap = terrain.splatMap!;
  const numLayers = (terrain.material!.numDetailMaps + 3) >> 2;
  const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo(splatMap.format);
  const buffer = new ArrayBuffer(
    3 * 4 + numLayers * splatMap.width * splatMap.height * info.blockWidth * info.blockHeight * info.size
  );
  const head = new DataView(buffer);
  head.setUint32(0, splatMap.width, true);
  head.setUint32(4, splatMap.height, true);
  head.setUint32(8, numLayers, true);
  for (let i = 0; i < numLayers; i++) {
    const layerData = new Uint8Array(
      buffer,
      3 * 4 + i * splatMap.width * splatMap.height * info.blockWidth * info.blockHeight * info.size
    );
    // Layer i holds the weights of detail layers 4i..4i+3
    await splatMap.readPixels(0, 0, splatMap.width, splatMap.height, i, 0, layerData);
  }
  return buffer;
}

/** @internal */
export function getTerrainClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: ClipmapTerrain,
    name: 'ClipmapTerrain',
    parent: GraphNode,
    createFunc(ctx: SceneNode, init: number) {
      const node = new ClipmapTerrain(ctx.scene!);
      node.numDetailMaps = init;
      node.parent = ctx;
      return { obj: node };
    },
    getInitParams(obj: ClipmapTerrain) {
      return obj.numDetailMaps;
    },
    getProps() {
      return defineProps([
        {
          name: 'Resolution',
          description: 'Terrain resolution',
          type: 'int2',
          default: [256, 256],
          options: { minValue: 1, maxValue: 4096 },
          get(this: ClipmapTerrain, value) {
            value.num[0] = this.sizeX;
            value.num[1] = this.sizeZ;
          },
          set(this: ClipmapTerrain, value) {
            this.setSize(value.num[0], value.num[1]);
          }
        },
        {
          name: 'CastShadow',
          description: 'If true, the terrain can cast shadows',
          type: 'bool',
          default: true,
          get(this: ClipmapTerrain, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: ClipmapTerrain, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'RuntimeVirtualTexture',
          description:
            'Blends the detail layers once into a texture cache instead of every frame for every pixel. ' +
            'Shading cost no longer grows with the number of layers; close up the ground can look a bit ' +
            'softer while the finest detail streams in. WebGPU only',
          type: 'bool',
          default: false,
          get(this: ClipmapTerrain, value) {
            value.bool[0] = this.runtimeVirtualTexture;
          },
          set(this: ClipmapTerrain, value) {
            this.runtimeVirtualTexture = value.bool[0];
          }
        },
        {
          name: 'Wireframe',
          description: 'If true, the terrain will be rendered as wireframe',
          type: 'bool',
          default: false,
          isPersistent() {
            return false;
          },
          get(this: ClipmapTerrain, value) {
            value.bool[0] = this.wireframe;
          },
          set(this: ClipmapTerrain, value) {
            this.wireframe = value.bool[0];
          }
        },
        {
          name: 'Debug',
          description: 'Debug visualization mode for the terrain material',
          type: 'string',
          options: {
            enum: {
              labels: ['None', 'UV', 'VertexNormal', 'DetailNormal', 'Tangent', 'Binormal', 'Albedo'],
              values: ['none', 'uv', 'vertex_normal', 'detail_normal', 'tangent', 'bitangent', 'albedo']
            }
          },
          default: 'none',
          isPersistent() {
            return false;
          },
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.material!.debugMode;
          },
          set(this: ClipmapTerrain, value) {
            this.material!.debugMode = value.str[0] as TerrainDebugMode;
          }
        },
        {
          name: 'GrassMaps',
          description: 'Serialized grass texture layers and blade settings',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONArray] },
          phase: 0,
          isNullable() {
            return true;
          },
          isHidden() {
            return false;
          },
          get(this: ClipmapTerrain, value) {
            const data: GrassLayerData[] = [];
            const numLayers = this.grassRenderer.numLayers;
            for (let i = 0; i < numLayers; i++) {
              const grassTexture = this.grassRenderer.getGrassTexture(i);
              const assetId = grassTexture ? (manager.getAssetId(grassTexture) ?? '') : '';
              const layer = this.grassRenderer.getLayer(i);
              const info: GrassLayerData = {
                texture: assetId,
                bladeWidth: this.grassRenderer.getBladeWidth(i),
                bladeHeight: this.grassRenderer.getBladeHeight(i),
                drawDistance: this.grassRenderer.getDrawDistance(i),
                farDensity: this.grassRenderer.getFarDensity(i)
              };
              if (layer.kind === 'blade') {
                info.kind = 'blade';
                info.blade = {
                  heightRandomness: layer.heightRandomness,
                  widthRandomness: layer.widthRandomness,
                  tilt: layer.tilt,
                  tiltRandomness: layer.tiltRandomness,
                  bend: layer.bend,
                  bendRandomness: layer.bendRandomness,
                  taper: layer.taper,
                  tipDetail: layer.tipDetail,
                  clumpSize: layer.clumpSize,
                  clumpHeightVariation: layer.clumpHeightVariation,
                  clumpPull: layer.clumpPull,
                  clumpSameDirection: layer.clumpSameDirection,
                  clumpFaceAway: layer.clumpFaceAway,
                  clumpColorVariation: layer.clumpColorVariation,
                  rootOcclusion: layer.rootOcclusion,
                  roundness: layer.roundness,
                  viewThickening: layer.viewThickening,
                  farNormalStart: layer.farNormalStart,
                  farNormalEnd: layer.farNormalEnd,
                  farRoughness: layer.farRoughness,
                  minScreenWidth: layer.minScreenWidth,
                  windFacing: layer.windFacing,
                  windLean: layer.windLean,
                  swayAmplitude: layer.swayAmplitude,
                  swaySpeed: layer.swaySpeed,
                  lodDistance: layer.lodDistance,
                  rootColor: [layer.rootColor.x, layer.rootColor.y, layer.rootColor.z],
                  tipColor: [layer.tipColor.x, layer.tipColor.y, layer.tipColor.z],
                  transmissionColor: [
                    layer.transmissionColor.x,
                    layer.transmissionColor.y,
                    layer.transmissionColor.z
                  ]
                };
              } else {
                info.card = {
                  windLean: layer.windLean,
                  swayAmplitude: layer.swayAmplitude,
                  swaySpeed: layer.swaySpeed
                };
              }
              data.push(info);
            }
            value.object[0] = new JSONArray(null, data);
          },
          async set(this: ClipmapTerrain, value) {
            const json = value.object[0] as JSONArray;
            const data = (json?.data as GrassLayerData[]) ?? [];
            for (let i = 0; i < data.length; i++) {
              const info = data[i];
              const assetId = info.texture;
              let texture: Nullable<Texture2D> = null;
              if (assetId) {
                try {
                  texture = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  texture = null;
                }
                if (!texture?.isTexture2D()) {
                  console.error('Invalid texture type');
                  texture?.dispose();
                  texture = null;
                }
              }
              const isBlade = info.kind === 'blade';
              const layer = this.grassRenderer.addLayer(
                info.bladeWidth ?? (isBlade ? DEFAULT_BLADE_WIDTH : 1),
                info.bladeHeight ?? (isBlade ? DEFAULT_BLADE_HEIGHT : 1),
                texture,
                isBlade ? 'blade' : 'card'
              );
              const blade = info.blade;
              const card = info.card;
              if (info.kind !== 'blade' && card) {
                const grassLayer = this.grassRenderer.getLayer(layer);
                grassLayer.windLean = card.windLean ?? grassLayer.windLean;
                grassLayer.swayAmplitude = card.swayAmplitude ?? grassLayer.swayAmplitude;
                grassLayer.swaySpeed = card.swaySpeed ?? grassLayer.swaySpeed;
              }
              if (info.kind === 'blade' && blade) {
                const grassLayer = this.grassRenderer.getLayer(layer);
                grassLayer.heightRandomness = blade.heightRandomness ?? grassLayer.heightRandomness;
                grassLayer.widthRandomness = blade.widthRandomness ?? grassLayer.widthRandomness;
                grassLayer.tilt = blade.tilt ?? grassLayer.tilt;
                grassLayer.tiltRandomness = blade.tiltRandomness ?? grassLayer.tiltRandomness;
                grassLayer.bend = blade.bend ?? grassLayer.bend;
                grassLayer.bendRandomness = blade.bendRandomness ?? grassLayer.bendRandomness;
                grassLayer.taper = blade.taper ?? grassLayer.taper;
                grassLayer.tipDetail = blade.tipDetail ?? grassLayer.tipDetail;
                grassLayer.clumpSize = blade.clumpSize ?? grassLayer.clumpSize;
                grassLayer.clumpHeightVariation =
                  blade.clumpHeightVariation ?? grassLayer.clumpHeightVariation;
                grassLayer.clumpPull = blade.clumpPull ?? grassLayer.clumpPull;
                grassLayer.clumpSameDirection = blade.clumpSameDirection ?? grassLayer.clumpSameDirection;
                grassLayer.clumpFaceAway = blade.clumpFaceAway ?? grassLayer.clumpFaceAway;
                grassLayer.clumpColorVariation = blade.clumpColorVariation ?? grassLayer.clumpColorVariation;
                grassLayer.rootOcclusion = blade.rootOcclusion ?? grassLayer.rootOcclusion;
                grassLayer.roundness = blade.roundness ?? grassLayer.roundness;
                grassLayer.viewThickening = blade.viewThickening ?? grassLayer.viewThickening;
                grassLayer.farNormalStart = blade.farNormalStart ?? grassLayer.farNormalStart;
                grassLayer.farNormalEnd = blade.farNormalEnd ?? grassLayer.farNormalEnd;
                grassLayer.farRoughness = blade.farRoughness ?? grassLayer.farRoughness;
                grassLayer.minScreenWidth = blade.minScreenWidth ?? grassLayer.minScreenWidth;
                grassLayer.windFacing = blade.windFacing ?? grassLayer.windFacing;
                grassLayer.windLean = blade.windLean ?? grassLayer.windLean;
                grassLayer.swayAmplitude = blade.swayAmplitude ?? grassLayer.swayAmplitude;
                grassLayer.swaySpeed = blade.swaySpeed ?? grassLayer.swaySpeed;
                grassLayer.lodDistance = blade.lodDistance ?? grassLayer.lodDistance;
                if (blade.rootColor) {
                  grassLayer.rootColor = new Vector4(
                    blade.rootColor[0],
                    blade.rootColor[1],
                    blade.rootColor[2],
                    1
                  );
                }
                if (blade.tipColor) {
                  grassLayer.tipColor = new Vector4(
                    blade.tipColor[0],
                    blade.tipColor[1],
                    blade.tipColor[2],
                    1
                  );
                }
                if (blade.transmissionColor) {
                  grassLayer.transmissionColor = new Vector4(
                    blade.transmissionColor[0],
                    blade.transmissionColor[1],
                    blade.transmissionColor[2],
                    1
                  );
                }
              }
              if (info.drawDistance !== undefined) {
                this.grassRenderer.setDrawDistance(layer, info.drawDistance);
              }
              if (info.farDensity !== undefined) {
                this.grassRenderer.setFarDensity(layer, info.farDensity);
              }
            }
          }
        },
        {
          name: 'DetailMaps',
          description: 'Serialized terrain detail texture layers',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONArray] },
          isNullable() {
            return true;
          },
          isHidden() {
            return false;
          },
          get(this: ClipmapTerrain, value) {
            const data: {
              albedo: string;
              normal: string;
              roughness: number;
              uvscale: number;
              hexTiling: boolean;
              hexParams: [number, number, number];
            }[] = [];
            const material = this.material!;
            for (let i = 0; i < material.numDetailMaps; i++) {
              data.push({
                albedo: manager.getAssetId(material.getDetailMap(i)) ?? '',
                normal: manager.getAssetId(material.getDetailNormalMap(i)) ?? '',
                roughness: material.getDetailMapRoughness(i),
                uvscale: material.getDetailMapUVScale(i),
                hexTiling: material.getDetailMapHexTiling(i),
                hexParams: material.getDetailMapHexParams(i)
              });
            }
            value.object[0] = new JSONArray(null, data);
          },
          async set(this: ClipmapTerrain, value) {
            const json = value.object[0] as JSONArray;
            if (!json) {
              this.material!.numDetailMaps = 0;
              return;
            }
            const data =
              (json.data as {
                albedo: string;
                normal: string;
                roughness: number;
                uvscale: number;
                hexTiling?: boolean;
                hexParams?: [number, number, number];
              }[]) ?? [];
            const material = this.material!;
            material.numDetailMaps = data.length;
            for (let i = 0; i < this.numDetailMaps; i++) {
              const info = data[i];
              if (!info?.albedo) {
                material.setDetailMap(i, null);
              } else {
                let tex: Nullable<Texture2D>;
                try {
                  tex = await manager.fetchTexture<Texture2D>(info.albedo);
                } catch (err) {
                  console.error(`Load asset failed: ${info.albedo}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  material.setDetailMap(i, tex);
                } else {
                  console.error('Invalid texture type');
                }
              }
              if (!info?.normal) {
                material.setDetailNormalMap(i, null);
              } else {
                let tex: Nullable<Texture2D>;
                try {
                  // Normal maps hold vectors, not colors: loaded as sRGB, 0.5 would decode to 0.21
                  // and tilt every normal (the editor picks them with linearColorSpace too)
                  tex = await manager.fetchTexture<Texture2D>(info.normal, { linearColorSpace: true });
                } catch (err) {
                  console.error(`Load asset failed: ${info.normal}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  material.setDetailNormalMap(i, tex);
                } else {
                  console.error('Invalid texture type');
                }
              }
              material.setDetailMapRoughness(i, info.roughness ?? 1);
              material.setDetailMapUVScale(i, info.uvscale ?? 100);
              if (info.hexParams) {
                material.setDetailMapHexParams(i, info.hexParams[0], info.hexParams[1], info.hexParams[2]);
              }
              material.setDetailMapHexTiling(i, !!info.hexTiling);
            }
          }
        },
        {
          name: 'SplatMap',
          description: 'Serialized splat-map texture data for terrain layers',
          type: 'embedded',
          default: null,
          isHidden() {
            return true;
          },
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.splatMapAssetId;
            value.object[0] = getTerrainSplatMapContent(this);
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const path = value.str[0];
              const data = (await manager.VFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
              if (!data) {
                console.error('Load height map failed');
                return;
              }
              const dataView = new DataView(data);
              const width = dataView.getUint32(0, true);
              const height = dataView.getUint32(4, true);
              const numLayers = dataView.getUint32(8, true);
              const splatMap = this.splatMap!;
              if (splatMap.width !== width || splatMap.height !== height) {
                console.error('Invalid splatmap data');
                return;
              }
              for (let i = 0; i < numLayers; i++) {
                const content = new Uint8Array(data, 3 * 4 + i * width * height * 4, width * height * 4);
                splatMap.update(content, 0, 0, i, width, height, 1);
              }
              this.invalidateRuntimeVirtualTexture();
              this.splatMapAssetId = value.str[0];
            }
          }
        },
        {
          name: 'Grass',
          description: 'Serialized grass instance data for the terrain',
          type: 'embedded',
          default: null,
          phase: 1,
          isHidden() {
            return true;
          },
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.grassAssetId;
            value.object[0] = getTerrainGrassContent(this);
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const path = value.str[0];
              const data = (await manager.VFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
              if (!data || data.byteLength < 4) {
                console.error('Load grass data failed');
                return;
              }
              const dataView = new DataView(data);
              if (dataView.getUint32(0, true) === GRASS_DATA_MAGIC) {
                // density map format, version at offset 4 is currently always 1
                const numLayers = dataView.getUint32(8, true);
                if (numLayers !== this.grassRenderer.numLayers) {
                  console.error('Number of grass layers mismatch');
                  return;
                }
                let offset = 12;
                for (let i = 0; i < numLayers; i++) {
                  const width = dataView.getUint32(offset, true);
                  const height = dataView.getUint32(offset + 4, true);
                  const cellsPerTexel = dataView.getUint32(offset + 8, true);
                  const byteLength = dataView.getUint32(offset + 12, true);
                  offset += 16;
                  const densityData = new Uint8Array(data, offset, byteLength).slice();
                  offset += byteLength;
                  this.grassRenderer.getLayer(i).setDensityData(width, height, cellsPerTexel, densityData);
                }
              } else if (!importLegacyGrassInstances(this, dataView)) {
                return;
              }
              this.grassAssetId = value.str[0];
            }
          }
        },
        {
          name: 'HeightMap',
          description: 'Serialized terrain height map data',
          type: 'embedded',
          default: null,
          isHidden() {
            return true;
          },
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.heightMapAssetId;
            value.object[0] = getTerrainHeightMapContent(this);
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const path = value.str[0];
              const data = (await manager.VFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
              if (!data) {
                console.error('Load height map failed');
                return;
              }
              const dataView = new DataView(data);
              const width = dataView.getUint32(0, true);
              const height = dataView.getUint32(4, true);
              const heightMap = this.createHeightMapTexture(width, height)!;
              if (heightMap.format !== 'r16f') {
                if (heightMap.format === 'rgba16f') {
                  // WebGL1 uses rgba16f for height map, so we need to convert
                  const rgbaData = new Uint16Array(width * height * 4);
                  const rData = new Uint16Array(data, 8);
                  for (let i = 0; i < width * height; i++) {
                    rgbaData[i * 4 + 0] = rData[i];
                  }
                  heightMap.update(rgbaData, 0, 0, width, height);
                } else {
                  throw new Error(`Unsupported height map format: ${heightMap.format}`);
                }
              } else {
                heightMap.update(new Uint16Array(data, 8), 0, 0, width, height);
              }
              this.heightMap = heightMap;
              this.heightMapAssetId = value.str[0];
              // Known right away from the loaded data, no GPU read back needed
              this.setHeightRangeFromHalfData(new Uint16Array(data, 8, width * height));
            }
          }
        }
      ]);
    }
  };
}
