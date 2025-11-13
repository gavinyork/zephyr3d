import type { GrassInstanceInfo } from '../../../scene';
import { GraphNode, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';
import { ClipmapTerrain } from '../../../scene/terrain-cm/terrain-cm';
import type { TerrainDebugMode } from '../../../material';
import type { Texture2D } from '@zephyr3d/device';
import type { TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import type { ResourceManager } from '../manager';
import { JSONArray } from '../json';
import { getDevice } from '../../../app/api';

function mergeTypedArrays<T extends TypedArray>(ctor: TypedArrayConstructor<T>, arrays: T[]): T {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new ctor(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

async function getTerrainGrassContent(terrain: ClipmapTerrain): Promise<ArrayBuffer> {
  const grassRenderer = terrain.grassRenderer;
  const layerDatas: Uint8Array<ArrayBuffer>[] = [];
  let dataSize = 4 + 4 * grassRenderer.numLayers;
  for (let i = 0; i < grassRenderer.numLayers; i++) {
    const promises: Promise<Uint8Array<ArrayBuffer>>[] = [];
    const layer = grassRenderer.getLayer(i);
    const queue = [layer.quadtree];
    while (queue.length > 0) {
      const quadtreeNode = queue.shift();
      if (quadtreeNode.children) {
        queue.push(...quadtreeNode.children);
      }
      const grassInstances = quadtreeNode.grassInstances;
      if (grassInstances.numInstances > 0) {
        const instanceBuffer = grassInstances.instanceBuffer;
        const P = instanceBuffer.getBufferSubData(null, 0, grassInstances.numInstances * 4 * 4);
        promises.push(P);
      }
    }
    if (promises.length > 0) {
      const data = await Promise.all(promises);
      const merged = mergeTypedArrays(Uint8Array, data) as Uint8Array<ArrayBuffer>;
      dataSize += merged.length;
      layerDatas.push(merged);
    } else {
      layerDatas.push(new Uint8Array());
    }
  }
  const data = new DataView(new ArrayBuffer(dataSize));
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  data.setUint32(offset, grassRenderer.numLayers, true);
  offset += 4;
  for (let i = 0; i < grassRenderer.numLayers; i++) {
    data.setUint32(offset, layerDatas[i].length, true);
    offset += 4;
    view.set(layerDatas[i], offset);
    offset += layerDatas[i].length;
  }
  return data.buffer;
}

async function getTerrainHeightMapContent(terrain: ClipmapTerrain): Promise<ArrayBuffer> {
  const heightmap = terrain.heightMap;
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
  const splatMap = terrain.splatMap;
  const numLayers = (terrain.material.numDetailMaps + 3) >> 2;
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
    await splatMap.readPixels(0, 0, splatMap.width, splatMap.height, 0, 0, layerData);
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
      const node = new ClipmapTerrain(ctx.scene);
      node.numDetailMaps = init;
      node.parent = ctx;
      return { obj: node };
    },
    getInitParams(obj: ClipmapTerrain) {
      return obj.numDetailMaps;
    },
    getProps() {
      return [
        {
          name: 'Resolution',
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
          name: 'Wireframe',
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
            value.str[0] = this.material.debugMode;
          },
          set(this: ClipmapTerrain, value) {
            this.material.debugMode = value.str[0] as TerrainDebugMode;
          }
        },
        {
          name: 'GrassMaps',
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
            const data: { texture: string; bladeWidth: number; bladeHeight: number }[] = [];
            const numLayers = this.grassRenderer.numLayers;
            for (let i = 0; i < numLayers; i++) {
              const grassTexture = this.grassRenderer.getGrassTexture(i);
              const assetId = grassTexture ? (manager.getAssetId(grassTexture) ?? '') : '';
              data.push({
                texture: assetId,
                bladeWidth: this.grassRenderer.getBladeWidth(i),
                bladeHeight: this.grassRenderer.getBladeHeight(i)
              });
            }
            value.object[0] = new JSONArray(null, data);
          },
          async set(this: ClipmapTerrain, value) {
            const json = value.object[0] as JSONArray;
            const data =
              (json?.data as {
                texture: string;
                bladeWidth: number;
                bladeHeight: number;
              }[]) ?? [];
            for (let i = 0; i < data.length; i++) {
              const info = data[i];
              const assetId = info.texture;
              let texture: Texture2D = null;
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
              this.grassRenderer.addLayer(info.bladeWidth ?? 1, info.bladeHeight ?? 1, texture);
            }
          }
        },
        {
          name: 'DetailMaps',
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
            const data: { albedo: string; normal: string; roughness: number; uvscale: number }[] = [];
            const material = this.material;
            for (let i = 0; i < material.numDetailMaps; i++) {
              data.push({
                albedo: manager.getAssetId(material.getDetailMap(i)) ?? '',
                normal: manager.getAssetId(material.getDetailNormalMap(i)) ?? '',
                roughness: material.getDetailMapRoughness(i),
                uvscale: material.getDetailMapUVScale(i)
              });
            }
            value.object[0] = new JSONArray(null, data);
          },
          async set(this: ClipmapTerrain, value) {
            const json = value.object[0] as JSONArray;
            if (!json) {
              this.material.numDetailMaps = 0;
              return;
            }
            const data =
              (json.data as {
                albedo: string;
                normal: string;
                roughness: number;
                uvscale: number;
              }[]) ?? [];
            const material = this.material;
            material.numDetailMaps = data.length;
            for (let i = 0; i < this.numDetailMaps; i++) {
              const info = data[i];
              if (!info?.albedo) {
                material.setDetailMap(i, null);
              } else {
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(info.albedo);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
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
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(info.normal);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  material.setDetailMap(i, tex);
                } else {
                  console.error('Invalid texture type');
                }
              }
              material.setDetailMapRoughness(i, info.roughness ?? 1);
              material.setDetailMapUVScale(i, info.uvscale ?? 100);
            }
          }
        },
        {
          name: 'SplatMap',
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
              const splatMap = this.splatMap;
              if (splatMap.width !== width || splatMap.height !== height) {
                console.error('Invalid splatmap data');
                return;
              }
              for (let i = 0; i < numLayers; i++) {
                const content = new Uint8Array(data, 3 * 4 + i * width * height * 4, width * height * 4);
                splatMap.update(content, 0, 0, i, width, height, 1);
              }
              this.splatMapAssetId = value.str[0];
            }
          }
        },
        {
          name: 'Grass',
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
              if (!data) {
                console.error('Load grass data failed');
                return;
              }
              const dataView = new DataView(data);
              let offset = 0;
              const numLayers = dataView.getUint32(offset, true);
              if (numLayers !== this.grassRenderer.numLayers) {
                console.error('Number of grass layers mismatch');
                return;
              }
              offset += 4;
              for (let i = 0; i < numLayers; i++) {
                const dataSize = dataView.getUint32(offset, true);
                offset += 4;
                if (dataSize > 0) {
                  const data = new Float32Array(dataView.buffer, dataView.byteOffset + offset, dataSize >> 2);
                  const numInstances = data.length >> 2;
                  const instances: GrassInstanceInfo[] = [];
                  for (let i = 0; i < numInstances; i++) {
                    instances.push({
                      x: data[i * 4 + 0],
                      y: data[i * 4 + 1],
                      angle: Math.atan2(data[i * 4 + 2], data[i * 4 + 3])
                    });
                  }
                  this.grassRenderer.addInstances(i, instances);
                  offset += dataSize;
                }
              }
              this.grassAssetId = value.str[0];
            }
          }
        },
        {
          name: 'HeightMap',
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
              const heightMap = this.createHeightMapTexture(width, height);
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
              this.updateBoundingBox();
            }
          }
        }
      ];
    }
  };
}
