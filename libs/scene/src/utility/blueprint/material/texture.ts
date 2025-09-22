import { BaseGraphNode } from '../node';
import { getParamName } from '../common';
import { TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';

export class BaseTextureNode extends BaseGraphNode {
  private _paramName: string;
  addressU: TextureAddressMode;
  addressV: TextureAddressMode;
  filterMin: TextureFilterMode;
  filterMag: TextureFilterMode;
  filterMip: TextureFilterMode;
  constructor() {
    super();
    this._paramName = getParamName();
    this.addressU = 'clamp';
    this.addressV = 'clamp';
    this.filterMin = 'nearest';
    this.filterMag = 'nearest';
    this.filterMip = 'none';
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
  toString() {
    return this._paramName;
  }
  protected validate(): string {
    return '';
  }
  protected getType(_id?: number): string {
    return '';
  }
}

export class ConstantTexture2DNode extends BaseTextureNode {
  constructor() {
    super();
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'tex2D';
  }
}

export class ConstantTexture2DArrayNode extends BaseTextureNode {
  constructor() {
    super();
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'tex2DArray';
  }
}

export class ConstantTextureCubeNode extends BaseTextureNode {
  constructor() {
    super();
    this._inputs = [];
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  protected validate(): string {
    return '';
  }
  protected getType(): string {
    return 'texCube';
  }
}

export class TextureSampleNode extends BaseGraphNode {
  constructor() {
    super();
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
    this._inputs = [
      {
        id: 1,
        name: 'texture',
        type: ['tex2D', 'tex2DArray', 'texCube']
      },
      {
        id: 2,
        name: 'coord',
        type: ['vec2', 'vec3']
      },
      {
        id: 3,
        name: 'lod',
        type: ['float']
      }
    ];
  }
  protected validate(): string {
    if (!this._inputs[0].inputNode) {
      return `Missing argument \`${this._inputs[0].name}\``;
    }
    const type0 = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type0) {
      return `Cannot determine type of argument \`${this._inputs[0].name}\``;
    }
    if (!this._inputs[0].type.includes(type0)) {
      return `Invalid input type of argument \`${this._inputs[0].name}\`: ${type0}`;
    }
    if (!this._inputs[1].inputNode) {
      return `Missing argument \`${this._inputs[1].name}\``;
    }
    const type1 = this._inputs[1].inputNode.getOutputType(this._inputs[1].inputId);
    if (!type1) {
      return `Cannot determine type of argument \`${this._inputs[1].name}\``;
    }
    let expectedType1 = type0 === 'tex2D' ? 'vec2' : 'vec3';
    if (type1 !== expectedType1) {
      return `Texture coordinate type should be ${expectedType1}`;
    }
    if (this._inputs[2].inputNode) {
      const type2 = this._inputs[2].inputNode.getOutputType(this._inputs[2].inputId);
      if (!type2) {
        return `Cannot determine typeof argument \`${this._inputs[2].name}\``;
      }
      if (!this._inputs[2].type.includes(type2)) {
        return `Invalid input type of argument \`${this._inputs[2].name}\`: ${type2}`;
      }
    }
    return '';
  }
  protected getType(): string {
    return 'vec4';
  }
}
