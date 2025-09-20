import { BaseGraphNode } from '../node';
import { getParamName } from '../common';

export class ConstantTexture2DNode extends BaseGraphNode {
  private _paramName: string;
  constructor() {
    super();
    this._paramName = getParamName();
    this._outputs = [
      {
        id: 1,
        name: '',
        type: 'texture2d'
      }
    ];
  }
  toString() {
    return this._paramName;
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
  get isUniform() {
    return true;
  }
  protected getProps(): Record<string, unknown> {
    return {
      paramName: this._paramName
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['paramName'] === 'string') {
      this._paramName = props['paramName'];
    }
  }
}

export class ConstantTextureCubeNode extends BaseGraphNode {
  private _paramName: string;
  constructor() {
    super();
    this._paramName = getParamName();
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
    return this._paramName;
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
  get isUniform() {
    return true;
  }
  protected getProps(): Record<string, unknown> {
    return {
      paramName: this._paramName
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['paramName'] === 'string') {
      this._paramName = props['paramName'];
    }
  }
}
