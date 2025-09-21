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
      { id: 2, name: 'x' },
      { id: 3, name: 'y' }
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
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id === 1 ? 'vec2' : 'float';
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
      { id: 2, name: 'x' },
      { id: 3, name: 'y' },
      { id: 4, name: 'z' }
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
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id === 1 ? 'vec3' : 'float';
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
      { id: 2, name: 'x' },
      { id: 3, name: 'y' },
      { id: 4, name: 'z' },
      { id: 5, name: 'w' }
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
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id === 1 ? 'vec4' : 'float';
  }
}
