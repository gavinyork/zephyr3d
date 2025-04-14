import { SceneNode } from '../../../scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';
import { ClipmapTerrain } from '../../../scene/terrain/terrain-cm';
import type { TerrainDebugMode } from '../../../material';

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
        }
      ];
    }
  };
}
