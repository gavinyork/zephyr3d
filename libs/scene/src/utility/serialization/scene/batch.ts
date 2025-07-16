import { BatchGroup, GraphNode, SceneNode } from '../../../scene';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';

/** @internal */
export function getBatchGroupClass(): SerializableClass {
  return {
    ctor: BatchGroup,
    parent: GraphNode,
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
