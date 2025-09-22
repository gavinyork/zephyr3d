import type { TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';
import { BaseTextureNode } from '../../../blueprint/material/texture';
import type { SerializableClass } from '../../types';

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
