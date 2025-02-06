import { AABB } from '@zephyr3d/base';
import type { SerializableClass } from '../types';

export function getAABBClass(): SerializableClass {
  return {
    ctor: AABB,
    className: 'AABB',
    getProps() {
      return [
        {
          name: 'Min',
          type: 'vec3',
          get(this: AABB, value) {
            value.num[0] = this.minPoint.x;
            value.num[1] = this.minPoint.y;
            value.num[2] = this.minPoint.z;
          },
          set(this: AABB, value) {
            this.minPoint.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Max',
          type: 'vec3',
          get(this: AABB, value) {
            value.num[0] = this.maxPoint.x;
            value.num[1] = this.maxPoint.y;
            value.num[2] = this.maxPoint.z;
          },
          set(this: AABB, value) {
            this.maxPoint.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        }
      ];
    }
  };
}
