import { ConstantTexture2DNode, ConstantTextureCubeNode } from '../../../blueprint/material/texture';
import type { SerializableClass } from '../../types';

export function getMaterialConstantTexture2DClass(): SerializableClass {
  return {
    ctor: ConstantTexture2DNode,
    name: 'MaterialConstantTexture2D',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantTexture2DNode, value) {
            value.bool[0] = this.isUniform;
          }
        },
        {
          name: 'ParamName',
          type: 'string',
          isNullable() {
            return false;
          },
          get(this: ConstantTexture2DNode, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantTexture2DNode, value) {
            this.paramName = value.str[0];
          }
        }
      ];
    }
  };
}

export function getMaterialConstantTextureCubeClass(): SerializableClass {
  return {
    ctor: ConstantTextureCubeNode,
    name: 'MaterialConstantTextureCube',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantTextureCubeNode, value) {
            value.bool[0] = this.isUniform;
          }
        },
        {
          name: 'ParamName',
          type: 'string',
          isNullable() {
            return false;
          },
          get(this: ConstantTextureCubeNode, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantTextureCubeNode, value) {
            this.paramName = value.str[0];
          }
        }
      ];
    }
  };
}
