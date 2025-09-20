import { BaseGraphNode } from '../node';

export class PBRBlockNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'BaseColor',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      },
      {
        id: 2,
        name: 'Metallic',
        type: ['float'],
        value: 0
      },
      {
        id: 3,
        name: 'Roughness',
        type: ['float'],
        value: 1
      },
      {
        id: 4,
        name: 'Specular',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      },
      {
        id: 5,
        name: 'Emissive',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [0, 0, 0, 0]
      },
      {
        id: 6,
        name: 'Normal',
        type: ['vec3'],
        value: [0, 0, 0]
      },
      {
        id: 7,
        name: 'Tangent',
        type: ['vec3'],
        value: [0, 0, 0]
      },
      {
        id: 8,
        name: 'Opacity',
        type: ['float'],
        value: 1
      }
    ];
  }
  toString(): string {
    return 'Output';
  }
}
