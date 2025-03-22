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
        }
      ];
    }
  };
}
