import { VertexColorNode, VertexNormalNode, VertexTangentNode, VertexBinormalNode } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getInputNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Inputs',
      children: [
        {
          name: 'VertexColor',
          create: () => new VertexColorNode()
        },
        {
          name: 'VertexNormalWS',
          create: () => new VertexNormalNode()
        },
        {
          name: 'VertexTangentWS',
          create: () => new VertexTangentNode()
        },
        {
          name: 'VertexBinormalWS',
          create: () => new VertexBinormalNode()
        }
      ]
    }
  ];
}
