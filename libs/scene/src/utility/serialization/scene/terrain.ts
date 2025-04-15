import { SceneNode } from '../../../scene';
import type { AssetRegistry, EmbeddedAssetInfo } from '../asset/asset';
import type { SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';
import { ClipmapTerrain } from '../../../scene/terrain/terrain-cm';
import type { TerrainDebugMode } from '../../../material';
import { Application } from '../../../app';
import { CopyBlitter } from '../../../blitter';

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
    assetId: terrain.heightMapAssetId,
    data: new Blob(data),
    pkgId: terrain.id,
    path: 'splatmap.raw'
  };
}
export function getTerrainClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: ClipmapTerrain,
    parent: getGraphNodeClass(assetRegistry),
    className: 'ClipmapTerrain',
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new ClipmapTerrain(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getEmbeddedAssets(obj: ClipmapTerrain) {
      return [getTerrainHeightMapContent(obj), getTerrainSplatMapContent(obj)];
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
                  const content = new Uint8Array(data, 3 + i * width * height * 4);
                  splatMap.update(content, 0, 0, i, width, height, 1);
                }
                this.splatMapAssetId = value.str[0];
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
                heightMap.update(new Uint8Array(data, 8), 0, 0, width, height);
                this.heightMap = heightMap;
                this.heightMapAssetId = value.str[0];
              }
            }
          }
        }
      ];
    }
  };
}
