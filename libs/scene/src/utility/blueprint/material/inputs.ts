import { BaseGraphNode } from '../node';
export class VertexColorNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'r', swizzle: 'x' },
      { id: 3, name: 'g', swizzle: 'y' },
      { id: 4, name: 'b', swizzle: 'z' },
      { id: 5, name: 'a', swizzle: 'w' }
    ];
  }
  toString() {
    return 'vertex color';
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec4';
  }
}

export class VertexNormalNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  toString() {
    return 'vertex normal';
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

export class VertexTangentNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  toString() {
    return 'vertex tangent';
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

export class VertexBinormalNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  toString() {
    return 'vertex binormal';
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}
