import { FunctionInputNode, FunctionOutputNode } from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getFunctionNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Function',
      children: [
        {
          name: 'FunctionInput',
          create: () => new FunctionInputNode()
        },
        {
          name: 'FunctionOutput',
          create: () => new FunctionOutputNode()
        }
      ]
    }
  ];
}
