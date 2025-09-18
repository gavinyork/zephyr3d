import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../../../blueprint/material/constants';
import { SerializableClass } from '../../types';

export function getMaterialConstantScalarClass(): SerializableClass {
  return {
    ctor: ConstantScalarNode,
    name: 'MaterialConstantScalar',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantScalarNode, value) {
            value.bool[0] = this.isUniform;
          },
          set(this: ConstantScalarNode, value) {
            this.isUniform = value.bool[0];
          }
        },
        {
          name: 'X',
          type: 'float',
          default: 0,
          get(this: ConstantScalarNode, value) {
            value.num[0] = this.x;
          },
          set(this: ConstantScalarNode, value) {
            this.x = value.num[0];
          }
        }
      ];
    }
  };
}

export function getMaterialConstantVec2Class(): SerializableClass {
  return {
    ctor: ConstantVec2Node,
    name: 'MaterialConstantVec2',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantVec2Node, value) {
            value.bool[0] = this.isUniform;
          },
          set(this: ConstantScalarNode, value) {
            this.isUniform = value.bool[0];
          }
        },
        {
          name: 'X',
          type: 'float',
          default: 0,
          get(this: ConstantVec2Node, value) {
            value.num[0] = this.x;
          },
          set(this: ConstantVec2Node, value) {
            this.x = value.num[0];
          }
        },
        {
          name: 'Y',
          type: 'float',
          default: 0,
          get(this: ConstantVec2Node, value) {
            value.num[0] = this.y;
          },
          set(this: ConstantVec2Node, value) {
            this.y = value.num[0];
          }
        }
      ];
    }
  };
}

export function getMaterialConstantVec3Class(): SerializableClass {
  return {
    ctor: ConstantVec3Node,
    name: 'MaterialConstantVec3',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantVec3Node, value) {
            value.bool[0] = this.isUniform;
          },
          set(this: ConstantVec3Node, value) {
            this.isUniform = value.bool[0];
          }
        },
        {
          name: 'X',
          type: 'float',
          default: 0,
          get(this: ConstantVec3Node, value) {
            value.num[0] = this.x;
          },
          set(this: ConstantVec3Node, value) {
            this.x = value.num[0];
          }
        },
        {
          name: 'Y',
          type: 'float',
          default: 0,
          get(this: ConstantVec3Node, value) {
            value.num[0] = this.y;
          },
          set(this: ConstantVec3Node, value) {
            this.y = value.num[0];
          }
        },
        {
          name: 'Z',
          type: 'float',
          default: 0,
          get(this: ConstantVec3Node, value) {
            value.num[0] = this.z;
          },
          set(this: ConstantVec3Node, value) {
            this.z = value.num[0];
          }
        }
      ];
    }
  };
}

export function getMaterialConstantVec4Class(): SerializableClass {
  return {
    ctor: ConstantVec4Node,
    name: 'MaterialConstantVec4',
    noTitle: true,
    getProps() {
      return [
        {
          name: 'IsUniform',
          type: 'bool',
          default: false,
          get(this: ConstantVec4Node, value) {
            value.bool[0] = this.isUniform;
          },
          set(this: ConstantVec4Node, value) {
            this.isUniform = value.bool[0];
          }
        },
        {
          name: 'X',
          type: 'float',
          default: 0,
          get(this: ConstantVec4Node, value) {
            value.num[0] = this.x;
          },
          set(this: ConstantVec4Node, value) {
            this.x = value.num[0];
          }
        },
        {
          name: 'Y',
          type: 'float',
          default: 0,
          get(this: ConstantVec4Node, value) {
            value.num[0] = this.y;
          },
          set(this: ConstantVec4Node, value) {
            this.y = value.num[0];
          }
        },
        {
          name: 'Z',
          type: 'float',
          default: 0,
          get(this: ConstantVec4Node, value) {
            value.num[0] = this.z;
          },
          set(this: ConstantVec4Node, value) {
            this.z = value.num[0];
          }
        },
        {
          name: 'W',
          type: 'float',
          default: 0,
          get(this: ConstantVec4Node, value) {
            value.num[0] = this.w;
          },
          set(this: ConstantVec4Node, value) {
            this.w = value.num[0];
          }
        }
      ];
    }
  };
}
