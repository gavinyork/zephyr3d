import type { SerializableClass } from '../../serialization';
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
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexColorNode,
      name: 'VertexColorNode',
      getProps() {
        return [];
      }
    };
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

export class VertexUVNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' }
    ];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexUVNode,
      name: 'VertexUVNode',
      getProps() {
        return [];
      }
    };
  }
  toString() {
    return 'vertex UV';
  }
  protected validate(): string {
    return '';
  }
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec2';
  }
}

export class VertexPositionNode extends BaseGraphNode {
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
    return 'world position';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexPositionNode,
      name: 'VertexPositionNode',
      getProps() {
        return [];
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
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexNormalNode,
      name: 'VertexNormalNode',
      getProps() {
        return [];
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
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexTangentNode,
      name: 'VertexTangentNode',
      getProps() {
        return [];
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
  static getSerializationCls(): SerializableClass {
    return {
      ctor: VertexBinormalNode,
      name: 'VertexBinormalNode',
      getProps() {
        return [];
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

export class ElapsedTimeNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  toString() {
    return 'Elapsed time';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ElapsedTimeNode,
      name: 'ElapsedTimeNode',
      getProps() {
        return [];
      }
    };
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'float';
  }
}

export class CameraPositionNode extends BaseGraphNode {
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
    return 'camera position';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CameraPositionNode,
      name: 'CameraPositionNode',
      getProps() {
        return [];
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

export class SkyEnvTextureNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [{ id: 1, name: '' }];
  }
  toString(): string {
    return 'SkyEnvTexture';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SkyEnvTextureNode,
      name: 'SkyEnvTextureNode',
      getProps() {
        return [];
      }
    };
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'texCube';
  }
}
export class CameraNearFarNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'near', swizzle: 'x' },
      { id: 3, name: 'far', swizzle: 'y' }
    ];
  }
  toString() {
    return 'camera near far';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CameraNearFarNode,
      name: 'CameraNearFarNode',
      getProps() {
        return [];
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
