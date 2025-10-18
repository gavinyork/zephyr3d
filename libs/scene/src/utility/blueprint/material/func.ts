import type { SerializableClass, SerializationManager } from '../../serialization';
import { BaseGraphNode } from '../node';
import type { MaterialBlueprintIR } from './ir';

export class FunctionCallNode extends BaseGraphNode {
  private _name: string;
  private _path: string;
  private _IR: MaterialBlueprintIR;
  private _args: { index: number; name: string; type: string }[];
  private _outs: { index: number; name: string; type: string }[];
  constructor(path: string, name: string, IR: MaterialBlueprintIR) {
    super();
    this._path = path;
    this._name = name;
    this._IR = IR;
    this._args = [];
    this._outs = [];
    this._inputs = [];
    this._outputs = [];
    for (const k of Object.keys(this._IR.DAG.nodeMap)) {
      const node = this._IR.DAG.nodeMap[k];
      if (node instanceof FunctionInputNode) {
        const name = node.name || `arg_${k}`;
        this._args.push({
          index: Number(k),
          name,
          type: node.type
        });
        this._inputs.push({
          id: this._inputs.length + 1,
          name,
          type: [node.type]
        });
      } else if (node instanceof FunctionOutputNode) {
        const name = node.name || `out_${k}`;
        this._outs.push({
          index: Number(k),
          name,
          type: node.type
        });
        this._outputs.push({
          id: this._outputs.length + 1,
          name,
          swizzle: name
        });
      }
    }
  }
  get path() {
    return this._path;
  }
  get name() {
    return this._name;
  }
  get IR() {
    return this._IR;
  }
  get args() {
    return this._args;
  }
  get outs() {
    return this._outs;
  }
  static getSerializationCls(manager: SerializationManager): SerializableClass {
    return {
      ctor: FunctionCallNode,
      name: 'FunctionCallNode',
      async createFunc(_, init: string) {
        const IR = await manager.loadBluePrint(init);
        const funcName = manager.VFS.basename(init, manager.VFS.extname(init));
        return { obj: new FunctionCallNode(init, funcName, IR) };
      },
      getInitParams(obj: FunctionCallNode) {
        return obj.path;
      },
      getProps() {
        return [];
      }
    };
  }
  toString() {
    return this._name;
  }
  protected validate(): string {
    for (let i = 0; i < this._inputs.length; i++) {
      const name = this._inputs[i].name;
      if (!this._inputs[i].inputNode) {
        return `Missing argument \`${name}\``;
      }
      const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!type) {
        return `Cannot determine type of argument \`${name}\``;
      }
      if (!this._inputs[i].type.includes(type)) {
        return `Invalid input type ${type}`;
      }
    }
    return '';
  }
  protected getType(id: number): string {
    return this._outs[id - 1].type;
  }
}
export class FunctionInputNode extends BaseGraphNode {
  static argId = 1;
  private _type: string;
  constructor() {
    super();
    this._type = 'vec4';
    this._outputs = [{ id: 1, name: `arg_${FunctionInputNode.argId++}` }];
  }
  get type() {
    return this._type;
  }
  get name() {
    return this._outputs[0].name;
  }
  set name(val: string) {
    if (val) {
      this._outputs[0].name = val;
    }
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
          },
          {
            name: 'name',
            type: 'string',
            get(this: FunctionInputNode, value) {
              value.str[0] = this.name;
            },
            set(this: FunctionInputNode, value) {
              this.name = value.str[0];
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
  static outId = 1;
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: `out_${FunctionOutputNode.outId++}`,
        type: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']
      }
    ];
  }
  get name() {
    return this._inputs[0].name;
  }
  set name(val: string) {
    if (val) {
      this._inputs[0].name = val;
    }
  }
  get type() {
    return this.getType();
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FunctionOutputNode,
      name: 'FunctionOutputNode',
      getProps() {
        return [
          {
            name: 'name',
            type: 'string',
            get(this: FunctionOutputNode, value) {
              value.str[0] = this.name;
            },
            set(this: FunctionOutputNode, value) {
              this.name = value.str[0];
            }
          }
        ];
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
