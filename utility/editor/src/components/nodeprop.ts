import type { BaseLight, SceneNode, SceneNodeVisible } from '@zephyr3d/scene';
import type { PropertyAccessor } from './grid';
import { degree2radian, radian2degree, Vector3 } from '@zephyr3d/base';

const tmpVec3 = new Vector3();

export const baseLightProps: PropertyAccessor<BaseLight>[] = [];

export const sceneNodeProps: PropertyAccessor<SceneNode>[] = [
  {
    name: 'Name',
    type: 'string',
    get(value) {
      value.str[0] = this.name ?? '';
    },
    set(value) {
      this.name = value.str[0] ?? '';
    }
  },
  {
    name: 'Position',
    type: 'vec3',
    get(value) {
      value.num[0] = this.position.x;
      value.num[1] = this.position.y;
      value.num[2] = this.position.z;
    },
    set(value) {
      this.position.setXYZ(value.num[0], value.num[1], value.num[2]);
    }
  },
  {
    name: 'Scale',
    type: 'vec3',
    get(value) {
      value.num[0] = this.scale.x;
      value.num[1] = this.scale.y;
      value.num[2] = this.scale.z;
    },
    set(value) {
      this.scale.setXYZ(value.num[0], value.num[1], value.num[2]);
    }
  },
  {
    name: 'Rotation',
    type: 'vec3',
    get(value) {
      this.rotation.toEulerAngles(tmpVec3);
      value.num[0] = Math.round(radian2degree(tmpVec3.x));
      value.num[1] = Math.round(radian2degree(tmpVec3.y));
      value.num[2] = Math.round(radian2degree(tmpVec3.z));
    },
    set(value) {
      this.rotation.fromEulerAngle(
        degree2radian(value.num[0]),
        degree2radian(value.num[1]),
        degree2radian(value.num[2]),
        'ZYX'
      );
    }
  },
  {
    name: 'Pickable',
    type: 'bool',
    get(value) {
      value.bool[0] = this.pickable;
    },
    set(value) {
      this.pickable = value.bool[0];
    }
  },
  {
    name: 'Visible',
    type: 'string',
    enum: {
      labels: ['Visible', 'Hidden', 'Inherit'],
      values: ['visible', 'hidden', 'inherit']
    },
    get(value) {
      value.str[0] = this.showState;
    },
    set(value) {
      this.showState = value.str[0] as SceneNodeVisible;
    }
  }
];
