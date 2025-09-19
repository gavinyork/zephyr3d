import {
  CompAddNode,
  CompSubtractNode,
  CompMultiplyNode,
  CompDivNode,
  DotProduct2Node,
  DotProduct3Node,
  DotProduct4Node,
  CrossProduct2Node,
  CrossProduct3Node
} from '@zephyr3d/scene';
import type { NodeCategory } from '../../api';

export function getMathNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Math',
      children: [
        {
          name: 'CompAdd',
          create: () => new CompAddNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompSubtract',
          create: () => new CompSubtractNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompMultiply',
          create: () => new CompMultiplyNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompDiv',
          create: () => new CompDivNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'DotProductVec2',
          create: () => new DotProduct2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'DotProductVec3',
          create: () => new DotProduct3Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'DotProductVec4',
          create: () => new DotProduct4Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'CrossProductVec2',
          create: () => new CrossProduct2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['vec2']
        },
        {
          name: 'CrossProductVec3',
          create: () => new CrossProduct3Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['vec3']
        }
      ]
    }
  ];
}
