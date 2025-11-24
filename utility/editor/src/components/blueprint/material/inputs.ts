import {
  VertexColorNode,
  VertexNormalNode,
  VertexTangentNode,
  VertexBinormalNode,
  CameraPositionNode,
  VertexPositionNode,
  VertexUVNode,
  ElapsedTimeNode,
  CameraNearFarNode,
  SkyEnvTextureNode,
  ViewMatrixNode,
  ProjectionMatrixNode,
  ViewProjMatrixNode,
  InvProjMatrixNode,
  InvViewProjMatrixNode,
  ResolveVertexPositionNode,
  ResolveVertexNormalNode,
  ResolveVertexTangentNode,
  BillboardMatrixNode
} from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getInputNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Inputs',
      children: [
        {
          name: 'VertexPositionResolver',
          create: () => new ResolveVertexPositionNode()
        },
        {
          name: 'VertexNormalResolver',
          create: () => new ResolveVertexNormalNode()
        },
        {
          name: 'VertexTangentResolver',
          create: () => new ResolveVertexTangentNode()
        },
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
          name: 'WorldToViewMatrix',
          create: () => new ViewMatrixNode()
        },
        {
          name: 'ViewToClipMatrix',
          create: () => new ProjectionMatrixNode()
        },
        {
          name: 'WorldToClipMatrix',
          create: () => new ViewProjMatrixNode()
        },
        {
          name: 'ClipToViewMatrix',
          create: () => new InvProjMatrixNode()
        },
        {
          name: 'ClipToWorldMatrix',
          create: () => new InvViewProjMatrixNode()
        },
        {
          name: 'BillboardMatrix',
          create: () => new BillboardMatrixNode()
        },
        {
          name: 'CameraPositionWS',
          create: () => new CameraPositionNode()
        },
        {
          name: 'CameraNearFar',
          create: () => new CameraNearFarNode()
        },
        {
          name: 'SkyEnvTexture',
          create: () => new SkyEnvTextureNode()
        },
        {
          name: 'ElapsedTime',
          create: () => new ElapsedTimeNode()
        }
      ]
    }
  ];
}
