import { BatchGroup } from '../../../scene';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { getGraphNodeClass } from './node';

export function getBatchGroupClass(): SerializableClass {
  return {
    ctor: BatchGroup,
    parent: getGraphNodeClass(),
    className: 'BatchGroup',
    createFunc(scene: Scene) {
      return new BatchGroup(scene);
    },
    getProps() {
      return [];
    }
  };
}
