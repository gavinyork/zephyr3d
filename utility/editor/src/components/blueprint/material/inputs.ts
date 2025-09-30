import {
  VertexColorNode,
  VertexNormalNode,
  VertexTangentNode,
  VertexBinormalNode,
  CameraPositionNode,
  VertexPositionNode,
  VertexUVNode
} from '@zephyr3d/scene';
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
          name: 'VertexUV',
          create: () => new VertexUVNode()
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
        },
        {
          name: 'WorldPosition',
          create: () => new VertexPositionNode()
        },
        {
          name: 'CameraPositionWS',
          create: () => new CameraPositionNode()
        }
      ]
    }
  ];
}
