import type {
  Texture2D,
  Texture2DArray,
  TextureAddressMode,
  TextureCube,
  TextureFilterMode
} from '@zephyr3d/device';
import {
  BaseTextureNode,
  ConstantTexture2DArrayNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  getDefaultTexture2D,
  getDefaultTexture2DArray,
  getDefaultTextureCube
} from '../../../blueprint/material/texture';
import type { SerializableClass } from '../../types';
import type { SerializationManager } from '../../manager';

export function getMaterialBaseTextureClass(): SerializableClass {
  return {
    ctor: BaseTextureNode,
    name: 'BaseTextureNode',
    noTitle: true,
    getProps() {
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
    }
  };
}

export function getMaterialTexture2DClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: ConstantTexture2DNode,
    parent: BaseTextureNode,
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
        }
      ];
    }
  };
}

export function getMaterialTextureCubeClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: ConstantTextureCubeNode,
    parent: BaseTextureNode,
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
        }
      ];
    }
  };
}

export function getMaterialTexture2DArrayClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: ConstantTexture2DArrayNode,
    parent: BaseTextureNode,
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
        }
      ];
    }
  };
}
