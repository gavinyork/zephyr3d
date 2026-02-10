import { BatchGroup, GraphNode, type SceneNode } from '../../../scene';
import type { SerializableClass } from '../types';

/** @internal */
export function getBatchGroupClass(): SerializableClass {
  return {
    ctor: BatchGroup,
    parent: GraphNode,
    name: 'BatchGroup',
    createFunc(ctx: SceneNode) {
      const batchGroup = new BatchGroup(ctx.scene!);
      batchGroup.parent = ctx;
      return { obj: batchGroup };
    },
    getProps() {
      return [];
    }
  };
}
