import {
  ConstantBooleanNode,
  ConstantBVec2Node,
  ConstantBVec3Node,
  ConstantBVec4Node,
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
        },
        {
          name: 'Boolean',
          create: () => new ConstantBooleanNode()
        },
        {
          name: 'BooleanVec2',
          create: () => new ConstantBVec2Node()
        },
        {
          name: 'BooleanVec3',
          create: () => new ConstantBVec3Node()
        },
        {
          name: 'BooleanVec4',
          create: () => new ConstantBVec4Node()
        },
        {
          name: 'Texture2D',
          create: () => new ConstantTexture2DNode()
        },
        {
          name: 'TextureCube',
          create: () => new ConstantTextureCubeNode()
        }
      ]
    }
  ];
}
