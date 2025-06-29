import type { GrassInstanceInfo } from '../../../scene';
import { GraphNode, SceneNode } from '../../../scene';
import type { AssetRegistry, EmbeddedAssetInfo } from '../asset/asset';
import type { PropertyAccessor, SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { ClipmapTerrain } from '../../../scene/terrain-cm/terrain-cm';
import type { TerrainDebugMode } from '../../../material';
import { Application } from '../../../app';
import type { Texture2D } from '@zephyr3d/device';
import type { TypedArray, TypedArrayConstructor } from '@zephyr3d/base';
import { MAX_TERRAIN_MIPMAP_LEVELS } from '../../../values';

function writeUUID(dataView: DataView, offset: number, str: string) {
  if (str && str.length === 36) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    for (let i = 0; i < bytes.length; i++) {
      dataView.setUint8(offset + i, bytes[i]);
    }
  }
}

function readUUID(dataView: DataView, offset: number) {
  const bytes = new Uint8Array(36);
  for (let i = 0; i < 36; i++) {
    bytes[i] = dataView.getUint8(offset + i);
  }
  return bytes[0] ? new TextDecoder().decode(bytes) : '';
}

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

async function getTerrainGrassContent(
  terrain: ClipmapTerrain,
  assetRegistry: AssetRegistry
): Promise<EmbeddedAssetInfo> {
  const grassRenderer = terrain.grassRenderer;
  const layerDatas: Uint8Array[] = [];
  let dataSize = 4 + (4 * 3 + 36) * grassRenderer.numLayers;
  for (let i = 0; i < grassRenderer.numLayers; i++) {
    const promises: Promise<Uint8Array>[] = [];
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
      const merged = mergeTypedArrays(Uint8Array, data);
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
    const grassTexture = grassRenderer.getGrassTexture(i);
    const assetId = grassTexture ? assetRegistry.getAssetId(grassTexture) ?? '' : '';
    writeUUID(data, offset, assetId);
    offset += 36;
    data.setUint32(offset, layerDatas[i].length, true);
    offset += 4;
    data.setFloat32(offset, grassRenderer.getBladeWidth(i), true);
    offset += 4;
    data.setFloat32(offset, grassRenderer.getBladeHeight(i), true);
    offset += 4;
    view.set(layerDatas[i], offset);
    offset += layerDatas[i].length;
  }
  return {
    assetType: 'binary',
    assetId: terrain.grassAssetId,
    data: new Blob([data.buffer]),
    pkgId: terrain.id,
    path: 'grass.bin'
  };
}

async function getTerrainHeightMapContent(terrain: ClipmapTerrain): Promise<EmbeddedAssetInfo> {
  const device = Application.instance.device;
  const heightmap = terrain.heightMap;
  const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo(heightmap.format);
  const head = new DataView(new ArrayBuffer(2 * 4));
  head.setUint32(0, heightmap.width, true);
  head.setUint32(4, heightmap.height, true);
  const data = new Uint8Array(
    heightmap.width * heightmap.height * info.blockWidth * info.blockHeight * info.size
  );
  await heightmap.readPixels(0, 0, heightmap.width, heightmap.height, 0, 0, data);
  return {
    assetType: 'binary',
    assetId: terrain.heightMapAssetId,
    data: new Blob([head.buffer, data]),
    pkgId: terrain.id,
    path: 'heightmap.raw'
  };
}

async function getTerrainSplatMapContent(terrain: ClipmapTerrain): Promise<EmbeddedAssetInfo> {
  const device = Application.instance.device;
  const splatMap = terrain.splatMap;
  const numLayers = (terrain.material.numDetailMaps + 3) >> 2;
  const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo(splatMap.format);
  const data: BufferSource[] = [];
  const head = new DataView(new ArrayBuffer(3 * 4));
  head.setUint32(0, splatMap.width, true);
  head.setUint32(4, splatMap.height, true);
  head.setUint32(8, numLayers, true);
  data.push(head);
  for (let i = 0; i < numLayers; i++) {
    const layerData = new Uint8Array(
      splatMap.width * splatMap.height * info.blockWidth * info.blockHeight * info.size
    );
    await splatMap.readPixels(0, 0, splatMap.width, splatMap.height, 0, 0, layerData);
    data.push(layerData);
  }
  return {
    assetType: 'binary',
    assetId: terrain.splatMapAssetId,
    data: new Blob(data),
    pkgId: terrain.id,
    path: 'splatmap.raw'
  };
}

function getDetailMapProps(assetRegistry: AssetRegistry) {
  const props: PropertyAccessor<ClipmapTerrain>[] = [];
  for (let i = 0; i < MAX_TERRAIN_MIPMAP_LEVELS; i++) {
    const accessorDetailAlbedo: PropertyAccessor<ClipmapTerrain> = {
      name: `DetailAlbedoMap${i}`,
      type: 'object',
      hidden: true,
      default: null,
      isValid(this: ClipmapTerrain) {
        return this.numDetailMaps > i;
      },
      isNullable() {
        return true;
      },
      get(this: ClipmapTerrain, value) {
        value.str[0] = assetRegistry.getAssetId(this.material.getDetailMap(i)) ?? '';
      },
      async set(value) {
        if (!value) {
          this.material.setDetailMap(i, null);
        } else {
          if (value.str[0]) {
            const assetId = value.str[0];
            const assetInfo = assetRegistry.getAssetInfo(assetId);
            if (assetInfo && assetInfo.type === 'texture') {
              let tex: Texture2D;
              try {
                tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
              } catch (err) {
                console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                tex = null;
              }
              if (tex?.isTexture2D()) {
                tex.name = assetInfo.name;
                this.material.setDetailMap(i, tex);
              } else {
                console.error('Invalid texture type');
              }
            }
          }
        }
      }
    };
    const accessorDetailNormal: PropertyAccessor<ClipmapTerrain> = {
      name: `DetailNormalMap${i}`,
      type: 'object',
      hidden: true,
      default: null,
      isNullable() {
        return true;
      },
      isValid() {
        return this.numDetailMaps > i;
      },
      get(this: ClipmapTerrain, value) {
        value.str[0] = assetRegistry.getAssetId(this.material.getDetailNormalMap(i)) ?? '';
      },
      async set(value) {
        if (!value) {
          this.material.setDetailNormalMap(i, null);
        } else {
          if (value.str[0]) {
            const assetId = value.str[0];
            const assetInfo = assetRegistry.getAssetInfo(assetId);
            if (assetInfo && assetInfo.type === 'texture') {
              let tex: Texture2D;
              try {
                tex = await assetRegistry.fetchTexture<Texture2D>(assetId, {
                  ...assetInfo.textureOptions,
                  linearColorSpace: true
                });
              } catch (err) {
                console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                tex = null;
              }
              if (tex?.isTexture2D()) {
                tex.name = assetInfo.name;
                this.material.setDetailNormalMap(i, tex);
              } else {
                console.error('Invalid texture type');
              }
            }
          }
        }
      }
    };
    const accessorDetailUVScale: PropertyAccessor<ClipmapTerrain> = {
      name: `DetailUVScale${i}`,
      type: 'float',
      hidden: true,
      default: 80,
      isValid() {
        return this.numDetailMaps > i;
      },
      get(this: ClipmapTerrain, value) {
        value.num[0] = this.material.getDetailMapUVScale(i);
      },
      async set(this: ClipmapTerrain, value) {
        this.material.setDetailMapUVScale(i, value.num[0]);
      }
    };
    const accessorDetailRoughness: PropertyAccessor<ClipmapTerrain> = {
      name: `DetailRoughness${i}`,
      type: 'float',
      hidden: true,
      default: 80,
      isValid() {
        return this.numDetailMaps > i;
      },
      get(this: ClipmapTerrain, value) {
        value.num[0] = this.material.getDetailMapRoughness(i);
      },
      async set(this: ClipmapTerrain, value) {
        this.material.setDetailMapRoughness(i, value.num[0]);
      }
    };
    props.push(accessorDetailAlbedo, accessorDetailNormal, accessorDetailUVScale, accessorDetailRoughness);
  }
  return props;
}
export function getTerrainClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: ClipmapTerrain,
    parent: GraphNode,
    createFunc(ctx: NodeHierarchy | SceneNode, init: number) {
      const node = new ClipmapTerrain(ctx.scene);
      node.numDetailMaps = init;
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getInitParams(obj: ClipmapTerrain) {
      return obj.numDetailMaps;
    },
    getEmbeddedAssets(obj: ClipmapTerrain) {
      return [
        getTerrainHeightMapContent(obj),
        getTerrainSplatMapContent(obj),
        getTerrainGrassContent(obj, assetRegistry)
      ];
    },
    getAssets(obj: ClipmapTerrain) {
      const assets: string[] = [];
      for (let i = 0; i < obj.grassRenderer.numLayers; i++) {
        const grassTexture = obj.grassRenderer.getGrassTexture(i);
        const assetId = grassTexture ? assetRegistry.getAssetId(grassTexture) ?? '' : '';
        if (assetId) {
          assets.push(assetId);
        }
      }
      return assets;
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
          enum: {
            labels: ['None', 'UV', 'VertexNormal', 'DetailNormal', 'Tangent', 'Binormal', 'Albedo'],
            values: ['none', 'uv', 'vertex_normal', 'detail_normal', 'tangent', 'bitangent', 'albedo']
          },
          default: 'none',
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.material.debugMode;
          },
          set(this: ClipmapTerrain, value) {
            this.material.debugMode = value.str[0] as TerrainDebugMode;
          }
        },
        ...getDetailMapProps(assetRegistry),
        {
          name: 'SplatMap',
          type: 'object',
          default: null,
          hidden: true,
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.splatMapAssetId;
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'binary') {
                let data: ArrayBuffer = null;
                try {
                  data = await assetRegistry.fetchBinary(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  data = null;
                }
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
          }
        },
        {
          name: 'Grass',
          type: 'object',
          default: null,
          hidden: true,
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.grassAssetId;
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'binary') {
                let data: ArrayBuffer = null;
                try {
                  data = await assetRegistry.fetchBinary(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  data = null;
                }
                if (!data) {
                  console.error('Load grass data failed');
                  return;
                }
                const dataView = new DataView(data);
                let offset = 0;
                const numLayers = dataView.getUint32(offset, true);
                offset += 4;
                for (let i = 0; i < numLayers; i++) {
                  const assetId = readUUID(dataView, offset);
                  offset += 36;
                  let texture: Texture2D = null;
                  if (assetId) {
                    const assetInfo = assetRegistry.getAssetInfo(assetId);
                    if (assetInfo && assetInfo.type === 'texture') {
                      try {
                        texture = await assetRegistry.fetchTexture<Texture2D>(
                          assetId,
                          assetInfo.textureOptions
                        );
                      } catch (err) {
                        console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                        texture = null;
                      }
                      if (texture?.isTexture2D()) {
                        texture.name = assetInfo.name;
                      } else {
                        console.error('Invalid texture type');
                        texture?.dispose();
                        texture = null;
                      }
                    }
                  }
                  const dataSize = dataView.getUint32(offset, true);
                  offset += 4;
                  const bladeWidth = dataView.getFloat32(offset, true);
                  offset += 4;
                  const bladeHeight = dataView.getFloat32(offset, true);
                  offset += 4;
                  this.grassRenderer.addLayer(bladeWidth, bladeHeight, texture);
                  if (dataSize > 0) {
                    const data = new Float32Array(
                      dataView.buffer,
                      dataView.byteOffset + offset,
                      dataSize >> 2
                    );
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
          }
        },
        {
          name: 'HeightMap',
          type: 'object',
          default: null,
          hidden: true,
          get(this: ClipmapTerrain, value) {
            value.str[0] = this.heightMapAssetId;
          },
          async set(this: ClipmapTerrain, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'binary') {
                let data: ArrayBuffer = null;
                try {
                  data = await assetRegistry.fetchBinary(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  data = null;
                }
                if (!data) {
                  console.error('Load height map failed');
                  return;
                }
                const dataView = new DataView(data);
                const width = dataView.getUint32(0, true);
                const height = dataView.getUint32(4, true);
                const heightMap = this.createHeightMapTexture(width, height);
                heightMap.update(new Uint16Array(data, 8), 0, 0, width, height);
                this.heightMap = heightMap;
                this.heightMapAssetId = value.str[0];
                this.updateBoundingBox();
              }
            }
          }
        }
      ];
    }
  };
}
