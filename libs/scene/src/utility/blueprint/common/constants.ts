import type { SerializableClass } from '../../serialization';
import { getParamName } from '../common';
import { BaseGraphNode } from '../node';

export class ConstantScalarNode extends BaseGraphNode {
  private _value: number;
  private _isUniform: boolean;
  private _paramName: string;
  constructor() {
    super();
    this._value = 0;
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [{ id: 1, name: '' }];
  }
  toString() {
    return this._isUniform ? this._paramName : `${Math.round(this._value * 1000) / 1000}`;
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantScalarNode,
      name: 'ConstantScalarNode',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantScalarNode, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantScalarNode, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantScalarNode, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantScalarNode, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantScalarNode, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantScalarNode, value) {
              this.x = value.num[0];
            }
          }
        ];
      }
    };
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this.paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  get x() {
    return this._value;
  }
  set x(val: number) {
    if (val !== this._value) {
      this._value = val;
      this.dispatchEvent('changed');
    }
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'float';
  }
}

export class ConstantVec2Node extends BaseGraphNode {
  private _value: number[];
  private _isUniform: boolean;
  private _paramName: string;
  constructor() {
    super();
    this._value = [0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' }
    ];
  }
  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000}`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }

  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec2Node,
      name: 'ConstantVec2Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec2Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec2Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec2Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec2Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec2Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec2Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
            get(this: ConstantVec2Node, value) {
              value.num[0] = this.y;
            },
            set(this: ConstantVec2Node, value) {
              this.y = value.num[0];
            }
          }
        ];
      }
    };
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec2';
  }
}

export class ConstantVec3Node extends BaseGraphNode {
  private _value: number[];
  private _isUniform: boolean;
  private _paramName: string;
  constructor() {
    super();
    this._value = [0, 0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }

  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
          Math.round(this._value[2] * 1000) / 1000
        }`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }

  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  get z() {
    return this._value[2];
  }
  set z(val: number) {
    if (val !== this._value[2]) {
      this._value[2] = val;
      this.dispatchEvent('changed');
    }
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec3Node,
      name: 'ConstantVec3Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec3Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec3Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec3Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec3Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec3Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.y;
            },
            set(this: ConstantVec3Node, value) {
              this.y = value.num[0];
            }
          },
          {
            name: 'z',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.z;
            },
            set(this: ConstantVec3Node, value) {
              this.z = value.num[0];
            }
          },
          {
            name: 'rgb',
            type: 'rgb',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.x;
              value.num[1] = this.y;
              value.num[2] = this.z;
            },
            set(this: ConstantVec3Node, value) {
              this.x = value.num[0];
              this.y = value.num[1];
              this.z = value.num[2];
            }
          }
        ];
      }
    };
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

export class ConstantVec4Node extends BaseGraphNode {
  private _value: number[];
  private _paramName: string;
  private _isUniform: boolean;
  constructor() {
    super();
    this._value = [0, 0, 0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' },
      { id: 5, name: 'w', swizzle: 'w' }
    ];
  }
  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
          Math.round(this._value[2] * 1000) / 1000
        },${Math.round(this._value[3] * 1000) / 1000}`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }

  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  get z() {
    return this._value[2];
  }
  set z(val: number) {
    if (val !== this._value[2]) {
      this._value[2] = val;
      this.dispatchEvent('changed');
    }
  }
  get w() {
    return this._value[3];
  }
  set w(val: number) {
    if (val !== this._value[3]) {
      this._value[3] = val;
      this.dispatchEvent('changed');
    }
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec4Node,
      name: 'ConstantVec4Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec4Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec4Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec4Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec4Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec4Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.y;
            },
            set(this: ConstantVec4Node, value) {
              this.y = value.num[0];
            }
          },
          {
            name: 'z',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.z;
            },
            set(this: ConstantVec4Node, value) {
              this.z = value.num[0];
            }
          },
          {
            name: 'w',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.w;
            },
            set(this: ConstantVec4Node, value) {
              this.w = value.num[0];
            }
          },
          {
            name: 'rgba',
            type: 'rgba',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.x;
              value.num[1] = this.y;
              value.num[2] = this.z;
              value.num[3] = this.w;
            },
            set(this: ConstantVec4Node, value) {
              this.x = value.num[0];
              this.y = value.num[1];
              this.z = value.num[2];
              this.w = value.num[3];
            }
          }
        ];
      }
    };
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec4';
  }
}
