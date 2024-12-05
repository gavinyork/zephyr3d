import type { SceneNode, SceneNodeVisible } from '@zephyr3d/scene';
import type { PropertyAccessor } from './grid';

export const SceneNodeProps: PropertyAccessor<SceneNode>[] = [
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
