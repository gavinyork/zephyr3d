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
      return [];
    }
  };
}
