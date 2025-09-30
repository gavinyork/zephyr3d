import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

export class PBRBlockNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'BaseColor',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [1, 1, 1, 1],
        originType: 'vec4'
      },
      {
        id: 2,
        name: 'Metallic',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      },
      {
        id: 3,
        name: 'Roughness',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      },
      {
        id: 4,
        name: 'Specular',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [1, 1, 1],
        originType: 'vec3'
      },
      {
        id: 5,
        name: 'Emissive',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        defaultValue: [0, 0, 0],
        originType: 'vec3'
      },
      {
        id: 6,
        name: 'Normal',
        type: ['vec3', 'vec4'],
        originType: 'vec3'
      },
      {
        id: 7,
        name: 'Tangent',
        type: ['vec3'],
        originType: 'vec3'
      },
      {
        id: 8,
        name: 'Opacity',
        type: ['float'],
        defaultValue: 1,
        originType: 'float'
      }
    ];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: PBRBlockNode,
      name: 'PBRBlockNode',
      getProps() {
        return [];
      }
    };
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
