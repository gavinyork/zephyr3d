import { Mesh, type SceneNode } from '../../../scene';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { graphNodeClass } from './node';

export const meshNodeClass: SerializableClass<SceneNode> = {
  ctor: Mesh,
  parent: graphNodeClass,
  className: 'Mesh',
  createFunc(scene: Scene) {
    return new Mesh(scene);
  },
  getProps() {
    return [
      {
        name: 'CastShadow',
        type: 'bool',
        default: { bool: [false] },
        get(this: Mesh, value) {
          value.bool[0] = this.castShadow;
        },
        set(this: Mesh, value) {
          this.castShadow = value.bool[0];
        }
      }
    ];
  }
};
