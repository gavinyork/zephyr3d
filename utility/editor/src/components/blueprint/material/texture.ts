import {
  ConstantTexture2DArrayNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  TextureSampleNode
} from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getTextureNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Texture',
      children: [
        {
          name: 'Texture2D',
          create: () => new ConstantTexture2DNode()
        },
        {
          name: 'Texture2DArray',
          create: () => new ConstantTexture2DArrayNode()
        },
        {
          name: 'TextureCube',
          create: () => new ConstantTextureCubeNode()
        },
        {
          name: 'TextureSample',
          create: () => new TextureSampleNode()
        }
      ]
    }
  ];
}
