import { SceneNode } from '../../../scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';
import { ClipmapTerrain } from '../../../scene/terrain/terrain-cm';

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
          name: 'GridScale',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 1 },
          get(this: ClipmapTerrain, value) {
            value.num[0] = this.gridScale;
          },
          set(this: ClipmapTerrain, value) {
            this.gridScale = value.num[0];
          }
        },
        {
          name: 'SizeX',
          type: 'float',
          default: 256,
          options: { minValue: 0, maxValue: 4096 },
          get(this: ClipmapTerrain, value) {
            value.num[0] = this.sizeX;
          },
          set(this: ClipmapTerrain, value) {
            this.sizeX = value.num[0];
          }
        },
        {
          name: 'SizeZ',
          type: 'float',
          default: 256,
          options: { minValue: 0, maxValue: 4096 },
          get(this: ClipmapTerrain, value) {
            value.num[0] = this.sizeZ;
          },
          set(this: ClipmapTerrain, value) {
            this.sizeZ = value.num[0];
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
        }
      ];
    }
  };
}
