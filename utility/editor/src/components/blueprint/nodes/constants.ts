import {
  ConstantScalarNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getConstantNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Constants',
      children: [
        {
          name: 'Scalar',
          create: () => new ConstantScalarNode(),
          outTypes: ['float']
        },
        {
          name: 'Vec2',
          create: () => new ConstantVec2Node(),
          outTypes: ['float', 'vec2']
        },
        {
          name: 'Vec3',
          create: () => new ConstantVec3Node(),
          outTypes: ['float', 'vec3']
        },
        {
          name: 'Vec4',
          create: () => new ConstantVec4Node(),
          outTypes: ['float', 'vec4']
        },
        {
          name: 'Texture2D',
          create: () => new ConstantTexture2DNode(),
          outTypes: ['texture2d']
        },
        {
          name: 'TextureCube',
          create: () => new ConstantTextureCubeNode(),
          outTypes: ['textureCube']
        }
      ]
    }
  ];
}
