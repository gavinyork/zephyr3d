import { BatchGroup, SceneNode } from '../../../scene';
import { Scene } from '../../../scene/scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import { getGraphNodeClass } from './node';

export function getBatchGroupClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: BatchGroup,
    parent: getGraphNodeClass(assetRegistry),
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return { obj: new BatchGroup(scene) };
      } else if (scene instanceof SceneNode) {
        const batchGroup = new BatchGroup(scene.scene);
        batchGroup.parent = scene;
        return { obj: batchGroup };
      } else {
        return null;
      }
    },
    getProps() {
      return [];
    }
  };
}
