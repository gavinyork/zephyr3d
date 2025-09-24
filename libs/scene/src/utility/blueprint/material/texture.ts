import { BaseGraphNode } from '../node';
import { getParamName } from '../common';
import type {
  BaseTexture,
  Texture2D,
  Texture2DArray,
  TextureAddressMode,
  TextureCube,
  TextureFilterMode
} from '@zephyr3d/device';
import { DRef } from '@zephyr3d/base';
import { getDevice } from '../../../app/api';

const defaultTexture2D: DRef<Texture2D> = new DRef();
const defaultTextureCube: DRef<TextureCube> = new DRef();
const defaultTexture2DArray: DRef<Texture2DArray> = new DRef();

/** @internal */
export function getDefaultTexture2D(): Texture2D {
  if (!defaultTexture2D.get()) {
    const defaultTex = getDevice().createTexture2D('rgba8unorm', 1, 1, {
      samplerOptions: { mipFilter: 'none' }
    });
    defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1);
    defaultTexture2D.set(defaultTex);
  }
  return defaultTexture2D.get();
}

/** @internal */
export function getDefaultTexture2DArray(): Texture2DArray {
  if (!defaultTexture2DArray.get()) {
    const defaultTex = getDevice().createTexture2DArray('rgba8unorm', 1, 1, 1, {
      samplerOptions: { mipFilter: 'none' }
    });
    defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 0, 1, 1, 1);
    defaultTexture2DArray.set(defaultTex);
  }
  return defaultTexture2DArray.get();
}

/** @internal */
export function getDefaultTextureCube(): TextureCube {
  if (!defaultTextureCube.get()) {
    const defaultTex = getDevice().createCubeTexture('rgba8unorm', 1, {
      samplerOptions: { mipFilter: 'none' }
    });
    for (let i = 0; i < 6; i++) {
      defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1, i);
    }
    defaultTextureCube.set(defaultTex);
  }
  return defaultTextureCube.get();
}

export class BaseTextureNode<T extends BaseTexture = BaseTexture> extends BaseGraphNode {
  private _paramName: string;
  addressU: TextureAddressMode;
  addressV: TextureAddressMode;
  filterMin: TextureFilterMode;
  filterMag: TextureFilterMode;
  filterMip: TextureFilterMode;
  textureId: string;
  texture: DRef<T>;
  constructor() {
    super();
    this._paramName = getParamName();
    this.addressU = 'clamp';
    this.addressV = 'clamp';
    this.filterMin = 'nearest';
    this.filterMag = 'nearest';
    this.filterMip = 'none';
    this.textureId = '';
    this.texture = new DRef();
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
  protected getType(): string {
    return '';
  }
}

export class ConstantTexture2DNode extends BaseTextureNode<Texture2D> {
  constructor() {
    super();
    this.texture.set(getDefaultTexture2D());
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

export class ConstantTexture2DArrayNode extends BaseTextureNode<Texture2DArray> {
  constructor() {
    super();
    this.texture.set(getDefaultTexture2DArray());
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

export class ConstantTextureCubeNode extends BaseTextureNode<TextureCube> {
  constructor() {
    super();
    this.texture.set(getDefaultTextureCube());
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
        type: ['tex2D', 'tex2DArray', 'texCube'],
        required: true
      },
      {
        id: 2,
        name: 'coord',
        type: ['vec2', 'vec3'],
        required: true
      },
      {
        id: 3,
        name: 'lod',
        type: ['float']
      }
    ];
  }
  protected validate(): string {
    const type0 = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type0) {
      return `Cannot determine type of argument \`${this._inputs[0].name}\``;
    }
    if (!this._inputs[0].type.includes(type0)) {
      return `Invalid input type of argument \`${this._inputs[0].name}\`: ${type0}`;
    }
    const type1 = this._inputs[1].inputNode.getOutputType(this._inputs[1].inputId);
    if (!type1) {
      return `Cannot determine type of argument \`${this._inputs[1].name}\``;
    }
    const expectedType1 = type0 === 'tex2D' ? 'vec2' : 'vec3';
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
