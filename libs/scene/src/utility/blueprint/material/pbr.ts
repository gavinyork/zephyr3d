import { BaseGraphNode } from '../node';

export class PBRBlockNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'BaseColor',
        type: ['float', 'vec2', 'vec3', 'vec4']
      },
      {
        id: 2,
        name: 'Metallic',
        type: ['float']
      },
      {
        id: 3,
        name: 'Roughness',
        type: ['float']
      },
      {
        id: 4,
        name: 'Specular',
        type: ['float', 'vec2', 'vec3', 'vec4']
      },
      {
        id: 5,
        name: 'Emissive',
        type: ['float', 'vec2', 'vec3', 'vec4']
      },
      {
        id: 6,
        name: 'Normal',
        type: ['vec3']
      },
      {
        id: 7,
        name: 'Tangent',
        type: ['vec3']
      },
      {
        id: 8,
        name: 'Opacity',
        type: ['float']
      }
    ];
  }
  toString(): string {
    return 'Output';
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return '';
  }
}
