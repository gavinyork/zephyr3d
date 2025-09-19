import { Observable } from '@zephyr3d/base';
import type { GraphNodeInput, GraphNodeOutput, IGraphNode } from '../node';
import { getParamName } from './common';

export class ConstantTexture2DNode extends Observable<{ changed: [] }> implements IGraphNode {
  private _name: string;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._name = getParamName();
    this._inputs = [];
    this._outputs = [
      {
        id: 1,
        name: '',
        type: 'texture2d'
      }
    ];
  }
  toString() {
    return this._name;
  }
  get paramName() {
    return this._name;
  }
  set paramName(val: string) {
    if (val !== this._name) {
      this._name = val;
      this.dispatchEvent('changed');
    }
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  get isUniform() {
    return true;
  }
}

export class ConstantTextureCubeNode extends Observable<{ changed: [] }> implements IGraphNode {
  private _name: string;
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  constructor() {
    super();
    this._name = getParamName();
    this._inputs = [];
    this._outputs = [
      {
        id: 1,
        name: '',
        type: 'textureCube'
      }
    ];
  }
  toString() {
    return this._name;
  }
  get paramName() {
    return this._name;
  }
  set paramName(val: string) {
    if (val !== this._name) {
      this._name = val;
      this.dispatchEvent('changed');
    }
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  get isUniform() {
    return true;
  }
}
