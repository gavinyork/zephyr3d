import { ConstantScalarNode, ConstantVec2Node, ConstantVec3Node, ConstantVec4Node } from '@zephyr3d/scene';
import type { NodeCategory } from '../../api';

export function getConstantNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Constants',
      children: [
        {
          name: 'Scalar',
          create: () => new ConstantScalarNode()
        },
        {
          name: 'Vec2',
          create: () => new ConstantVec2Node()
        },
        {
          name: 'Vec3',
          create: () => new ConstantVec3Node()
        },
        {
          name: 'Vec4',
          create: () => new ConstantVec4Node()
        }
      ]
    }
  ];
}
