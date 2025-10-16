import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

export class FunctionInputNode extends BaseGraphNode {
  private _type: string;
  constructor() {
    super();
    this._type = 'vec4';
    this._outputs = [{ id: 1, name: '' }];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FunctionInputNode,
      name: 'FunctionInputNode',
      getProps() {
        return [
          {
            name: 'type',
            type: 'string',
            options: {
              enum: {
                labels: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'],
                values: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']
              }
            },
            get(this: FunctionInputNode, value) {
              value.str[0] = this._type;
            },
            set(this: FunctionInputNode, value) {
              this._type = value.str[0];
            }
          }
        ];
      }
    };
  }
  toString() {
    return 'FunctionInput';
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return this._type;
  }
}

export class FunctionOutputNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [{ id: 1, name: '', type: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'] }];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FunctionOutputNode,
      name: 'FunctionOutputNode',
      getProps() {
        return [];
      }
    };
  }
  toString() {
    return 'FunctionOutput';
  }
  protected validate(): string {
    if (!this._inputs[0].inputNode) {
      return 'Missing result';
    }
    const type = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type) {
      return 'Cannot determin result type';
    }
    return '';
  }
  protected getType(): string {
    return this._inputs[0].inputNode ? this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId) : '';
  }
}
