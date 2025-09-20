import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../../blueprint/common/constants';
import type { SerializableClass } from '../types';

export function getConstantScalarClass(): SerializableClass {
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
          name: 'Name',
          type: 'string',
          isValid(this: ConstantScalarNode) {
            return this.isUniform;
          },
          get(this: ConstantScalarNode, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantScalarNode, value) {
            this.paramName = value.str[0];
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

export function getConstantVec2Class(): SerializableClass {
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
          name: 'Name',
          type: 'string',
          isValid(this: ConstantVec2Node) {
            return this.isUniform;
          },
          get(this: ConstantVec2Node, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantVec2Node, value) {
            this.paramName = value.str[0];
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

export function getConstantVec3Class(): SerializableClass {
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
          name: 'Name',
          type: 'string',
          isValid(this: ConstantVec3Node) {
            return this.isUniform;
          },
          get(this: ConstantVec3Node, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantVec3Node, value) {
            this.paramName = value.str[0];
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

export function getConstantVec4Class(): SerializableClass {
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
          name: 'Name',
          type: 'string',
          isValid(this: ConstantVec4Node) {
            return this.isUniform;
          },
          get(this: ConstantVec4Node, value) {
            value.str[0] = this.paramName;
          },
          set(this: ConstantVec4Node, value) {
            this.paramName = value.str[0];
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
