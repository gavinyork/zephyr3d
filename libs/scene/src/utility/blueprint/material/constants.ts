import { Observable } from '@zephyr3d/base';
import type { GraphNodeInput, GraphNodeOutput, IGraphNode } from '../../blueprint/node';

export class ConstantScalarNode extends Observable<{ changed: [] }> implements IGraphNode {
  private _value: number;
  private _isUniform: boolean;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._value = 0;
    this._isUniform = false;
    this._inputs = [];
    this._outputs = [{ id: 1, name: 'value', type: 'float' }];
  }
  toString() {
    return `${Math.round(this._value * 1000) / 1000}`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    this._isUniform = val;
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
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
}

export class ConstantVec2Node extends Observable<{ changed: [] }> implements IGraphNode {
  private _value: number[];
  private _isUniform: boolean;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._value = [0, 0];
    this._isUniform = false;
    this._inputs = [];
    this._outputs = [
      { id: 1, name: 'value', type: 'vec2' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' }
    ];
  }
  toString() {
    return `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000}`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    this._isUniform = val;
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
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
}

export class ConstantVec3Node extends Observable<{ changed: [] }> implements IGraphNode {
  private _value: number[];
  private _isUniform: boolean;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._value = [0, 0, 0];
    this._isUniform = false;
    this._inputs = [];
    this._outputs = [
      { id: 1, name: 'value', type: 'vec3' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' },
      { id: 4, name: 'z', type: 'float' }
    ];
  }

  toString() {
    return `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
      Math.round(this._value[2] * 1000) / 1000
    }`;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    this._isUniform = val;
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
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
}

export class ConstantVec4Node extends Observable<{ changed: [] }> implements IGraphNode {
  private _value: number[];
  private _isUniform: boolean;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._value = [0, 0, 0, 0];
    this._isUniform = false;
    this._inputs = [];
    this._outputs = [
      { id: 1, name: 'value', type: 'vec4' },
      { id: 2, name: 'x', type: 'float' },
      { id: 3, name: 'y', type: 'float' },
      { id: 4, name: 'z', type: 'float' },
      { id: 5, name: 'w', type: 'float' }
    ];
  }
  toString() {
    return `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
      Math.round(this._value[2] * 1000) / 1000
    },${Math.round(this._value[3] * 1000) / 1000}`;
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    this._isUniform = val;
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
}
