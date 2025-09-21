import { ConstantTexture2DNode, ConstantTextureCubeNode } from '@zephyr3d/scene';
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
          name: 'TextureCube',
          create: () => new ConstantTextureCubeNode()
        }
      ]
    }
  ];
}
