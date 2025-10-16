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
import type { PropertyAccessor, SerializableClass, SerializationManager } from '../../serialization';

const defaultTexture2D: DRef<Texture2D> = new DRef();
const defaultTextureCube: DRef<TextureCube> = new DRef();
const defaultTexture2DArray: DRef<Texture2DArray> = new DRef();

/** @internal */
export function getDefaultTexture2D(): Texture2D {
  if (!defaultTexture2D.get()) {
    const defaultTex = getDevice().createTexture2D('rgba8unorm', 1, 1, {
      mipmapping: false
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
      mipmapping: false
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
      mipmapping: false
    });
    for (let i = 0; i < 6; i++) {
      defaultTex.update(new Uint8Array([255, 255, 255, 255]), 0, 0, 1, 1, i);
    }
    defaultTextureCube.set(defaultTex);
  }
  return defaultTextureCube.get();
}

const textureNodeProps = (function getTextureNodeProps(): PropertyAccessor<BaseTextureNode>[] {
  return [
    {
      name: 'Name',
      type: 'string',
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.paramName;
      },
      set(this: BaseTextureNode, value) {
        this.paramName = value.str[0];
      }
    },
    {
      name: 'AddressU',
      type: 'string',
      default: 'clamp',
      options: {
        enum: {
          labels: ['clamp', 'repeat', 'mirrored-repeat'],
          values: ['clamp', 'repeat', 'mirrored-repeat']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.addressU;
      },
      set(this: BaseTextureNode, value) {
        this.addressU = value.str[0] as TextureAddressMode;
      }
    },
    {
      name: 'AddressV',
      type: 'string',
      default: 'clamp',
      options: {
        enum: {
          labels: ['clamp', 'repeat', 'mirrored-repeat'],
          values: ['clamp', 'repeat', 'mirrored-repeat']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.addressV;
      },
      set(this: BaseTextureNode, value) {
        this.addressV = value.str[0] as TextureAddressMode;
      }
    },
    {
      name: 'MinFilter',
      type: 'string',
      default: 'nearest',
      options: {
        enum: {
          labels: ['nearest', 'linear'],
          values: ['nearest', 'linear']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMin;
      },
      set(this: BaseTextureNode, value) {
        this.filterMin = value.str[0] as TextureFilterMode;
      }
    },
    {
      name: 'MagFilter',
      type: 'string',
      default: 'nearest',
      options: {
        enum: {
          labels: ['nearest', 'linear'],
          values: ['nearest', 'linear']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMag;
      },
      set(this: BaseTextureNode, value) {
        this.filterMag = value.str[0] as TextureFilterMode;
      }
    },
    {
      name: 'MipFilter',
      type: 'string',
      default: 'none',
      options: {
        enum: {
          labels: ['nearest', 'linear', 'none'],
          values: ['nearest', 'linear', 'none']
        }
      },
      isNullable() {
        return false;
      },
      get(this: BaseTextureNode, value) {
        value.str[0] = this.filterMip;
      },
      set(this: BaseTextureNode, value) {
        this.filterMip = value.str[0] as TextureFilterMode;
      }
    }
  ];
})();

export abstract class BaseTextureNode<T extends BaseTexture = BaseTexture> extends BaseGraphNode {
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
  static getSerializationCls(manager: SerializationManager): SerializableClass {
    return {
      ctor: ConstantTexture2DNode,
      name: 'Texture2DNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: [
                'image/jpeg',
                'image/png',
                'image/tga',
                'image/vnd.radiance',
                'image/x-dds',
                'image/webp'
              ]
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTexture2DNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTexture2DNode, value) {
              if (value?.str[0]) {
                this.textureId = value.str[0];
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(this.textureId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                const isValidTextureType = tex?.isTexture2D();
                if (isValidTextureType) {
                  this.texture.set(tex);
                } else {
                  console.error('Invalid texture type');
                }
              } else {
                this.textureId = '';
              }
              if (!this.texture.get()) {
                this.texture.set(getDefaultTexture2D());
              }
            }
          },
          ...textureNodeProps
        ];
      }
    };
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
  static getSerializationCls(manager: SerializationManager): SerializableClass {
    return {
      ctor: ConstantTexture2DArrayNode,
      name: 'Texture2DArrayNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: ['image/x-dds']
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTexture2DArrayNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTexture2DArrayNode, value) {
              if (value?.str[0]) {
                this.textureId = value.str[0];
                let tex: Texture2DArray;
                try {
                  tex = await manager.fetchTexture<Texture2DArray>(this.textureId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                const isValidTextureType = tex?.isTexture2DArray();
                if (isValidTextureType) {
                  this.texture.set(tex);
                } else {
                  console.error('Invalid texture type');
                }
              } else {
                this.textureId = '';
              }
              if (!this.texture.get()) {
                this.texture.set(getDefaultTexture2DArray());
              }
            }
          },
          ...textureNodeProps
        ];
      }
    };
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
  static getSerializationCls(manager: SerializationManager): SerializableClass {
    return {
      ctor: ConstantTextureCubeNode,
      name: 'TextureCubeNode',
      noTitle: true,
      getProps() {
        return [
          {
            name: 'Texture',
            type: 'object',
            default: null,
            options: {
              mimeTypes: ['image/x-dds']
            },
            isNullable() {
              return true;
            },
            get(this: ConstantTextureCubeNode, value) {
              value.str[0] = this.textureId;
            },
            async set(this: ConstantTextureCubeNode, value) {
              if (value?.str[0]) {
                this.textureId = value.str[0];
                let tex: TextureCube;
                try {
                  tex = await manager.fetchTexture<TextureCube>(this.textureId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                const isValidTextureType = tex?.isTextureCube();
                if (isValidTextureType) {
                  this.texture.set(tex);
                } else {
                  console.error('Invalid texture type');
                }
              } else {
                this.textureId = '';
              }
              if (!this.texture.get()) {
                this.texture.set(getDefaultTextureCube());
              }
            }
          },
          ...textureNodeProps
        ];
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

export class TextureSampleNode extends BaseGraphNode {
  samplerType: 'Color' | 'Normal';
  constructor() {
    super();
    this.samplerType = 'Color';
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
      }
    ];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TextureSampleNode,
      name: 'TextureSampleNode',
      getProps(): PropertyAccessor<TextureSampleNode>[] {
        return [
          {
            name: 'SamplerType',
            type: 'string',
            options: {
              enum: {
                labels: ['Color', 'Normal'],
                values: ['Color', 'Normal']
              }
            },
            get(this: TextureSampleNode, value) {
              value.str[0] = this.samplerType;
            },
            set(this: TextureSampleNode, value) {
              this.samplerType = value.str[0] as any;
            }
          }
        ];
      }
    };
  }
  toString(): string {
    return 'textureSample';
  }
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
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
    return '';
  }
  protected getType(): string {
    return 'vec4';
  }
}

export class TextureSampleGrad extends BaseGraphNode {
  samplerType: 'Color' | 'Normal';
  constructor() {
    super();
    this.samplerType = 'Color';
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
      }
    ];
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TextureSampleNode,
      name: 'TextureSampleNode',
      getProps(): PropertyAccessor<TextureSampleNode>[] {
        return [
          {
            name: 'SamplerType',
            type: 'string',
            options: {
              enum: {
                labels: ['Color', 'Normal'],
                values: ['Color', 'Normal']
              }
            },
            get(this: TextureSampleNode, value) {
              value.str[0] = this.samplerType;
            },
            set(this: TextureSampleNode, value) {
              this.samplerType = value.str[0] as any;
            }
          }
        ];
      }
    };
  }
  toString(): string {
    return 'textureSample';
  }
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
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
    return '';
  }
  protected getType(): string {
    return 'vec4';
  }
}
