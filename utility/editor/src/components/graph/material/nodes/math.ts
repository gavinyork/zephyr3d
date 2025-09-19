import { CompAddNode, CompSubtractNode, CompMultiplyNode, CompDivNode } from '@zephyr3d/scene';
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
        }
      ]
    }
  ];
}
