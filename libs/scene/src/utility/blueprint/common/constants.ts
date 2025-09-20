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
    this._outputs = [{ id: 1, name: '', type: 'float' }];
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
  protected getProps(): Record<string, unknown> {
    return {
      value: this._value,
      paramName: this._paramName,
      isUniform: this._isUniform
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props) {
      if (typeof props['value'] === 'number') {
        this._value = props['value'];
      }
      if (typeof props['paramName'] === 'string') {
        this._paramName = props['paramName'];
      }
      if (typeof props['isUniform'] === 'boolean') {
        this._isUniform = props['isUniform'];
      }
    }
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
      { id: 1, name: '', type: 'vec2' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' }
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
  protected getProps(): Record<string, unknown> {
    return {
      value: this._value,
      paramName: this._paramName,
      isUniform: this._isUniform
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props) {
      if (Array.isArray(props['value'])) {
        this._value = props['value'];
      }
      if (typeof props['paramName'] === 'string') {
        this._paramName = props['paramName'];
      }
      if (typeof props['isUniform'] === 'boolean') {
        this._isUniform = props['isUniform'];
      }
    }
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
      { id: 1, name: '', type: 'vec3' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' },
      { id: 4, name: 'z', type: 'float' }
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
  protected getProps(): Record<string, unknown> {
    return {
      value: this._value,
      paramName: this._paramName,
      isUniform: this._isUniform
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props) {
      if (Array.isArray(props['value'])) {
        this._value = props['value'];
      }
      if (typeof props['paramName'] === 'string') {
        this._paramName = props['paramName'];
      }
      if (typeof props['isUniform'] === 'boolean') {
        this._isUniform = props['isUniform'];
      }
    }
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
      { id: 1, name: '', type: 'vec4' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' },
      { id: 4, name: 'z', type: 'float' },
      { id: 5, name: 'w', type: 'float' }
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
  protected getProps(): Record<string, unknown> {
    return {
      value: this._value,
      paramName: this._paramName,
      isUniform: this._isUniform
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props) {
      if (Array.isArray(props['value'])) {
        this._value = props['value'];
      }
      if (typeof props['paramName'] === 'string') {
        this._paramName = props['paramName'];
      }
      if (typeof props['isUniform'] === 'boolean') {
        this._isUniform = props['isUniform'];
      }
    }
  }
}
