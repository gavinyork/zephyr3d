import {
  VertexColorNode,
  VertexNormalNode,
  PixelNormalNode,
  VertexTangentNode,
  VertexBinormalNode,
  CameraPositionNode,
  CameraVectorNode,
  VertexPositionNode,
  PixelWorldPositionNode,
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
          name: 'PixelNormalWS',
          create: () => new PixelNormalNode()
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
          name: 'PixelWorldPosition',
          create: () => new PixelWorldPositionNode()
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
          name: 'CameraVectorWS',
          create: () => new CameraVectorNode()
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
