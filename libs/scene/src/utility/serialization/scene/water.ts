import { Vector4 } from '@zephyr3d/base';
import { SceneNode } from '../../../scene';
import { Water } from '../../../scene/water';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';

export function getWaterClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Water,
    parent: getGraphNodeClass(assetRegistry),
    className: 'Water',
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new Water(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'Region',
          type: 'vec4',
          get(this: Water, value) {
            value.num[0] = this.region.x;
            value.num[1] = this.region.y;
            value.num[2] = this.region.z;
            value.num[3] = this.region.w;
          },
          set(this: Water, value) {
            this.region = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        }
      ];
    }
  };
}
