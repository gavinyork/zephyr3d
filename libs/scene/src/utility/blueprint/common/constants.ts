import type { SerializableClass } from '../../serialization';
import { getParamName } from '../common';
import { BaseGraphNode } from '../node';

/**
 * Constant scalar (float) value node
 *
 * @remarks
 * Represents a single floating-point constant in the material graph.
 * Can be either a literal constant or exposed as a uniform parameter.
 *
 * When set as uniform:
 * - Generates a shader uniform variable
 * - Can be modified at runtime without recompiling the shader
 * - Useful for material parameters like roughness, metallic, etc.
 *
 * When set as literal:
 * - Value is baked into the shader code
 * - More efficient but requires shader recompilation to change
 *
 * @example
 * ```typescript
 * const roughness = new ConstantScalarNode();
 * roughness.x = 0.5;
 * roughness.isUniform = true;
 * roughness.paramName = 'u_roughness';
 * ```
 *
 * @public
 */
export class ConstantScalarNode extends BaseGraphNode {
  /** The scalar float value */
  private _value: number;
  /** Whether this constant should be exposed as a uniform parameter */
  private _isUniform: boolean;
  /** The uniform parameter name (only used when isUniform is true) */
  private _paramName: string;
  /**
   * Creates a new constant scalar node
   *
   * @remarks
   * Initializes with a value of 0 and a single unnamed output slot.
   */
  constructor() {
    super();
    this._value = 0;
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [{ id: 1, name: '' }];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The parameter name if uniform, otherwise the rounded numeric value
   *
   * @remarks
   * Values are rounded to 3 decimal places for display purposes.
   */
  toString() {
    return this._isUniform ? this._paramName : `${Math.round(this._value * 1000) / 1000}`;
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor with property definitions
   *
   * @remarks
   * Used by the serialization system to save/load node graphs.
   * Defines how to serialize the isUniform flag, parameter name, and value.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantScalarNode,
      name: 'ConstantScalarNode',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantScalarNode, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantScalarNode, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantScalarNode, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantScalarNode, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
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
  /**
   * Gets whether this constant is exposed as a uniform parameter
   */
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  /**
   * Gets the uniform parameter name
   */
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this.paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the scalar value
   */
  get x() {
    return this._value;
  }
  set x(val: number) {
    if (val !== this._value) {
      this._value = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Constant nodes have no validation requirements.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for this node
   *
   * @returns 'float' for scalar output
   */
  protected getType(): string {
    return 'float';
  }
}

/**
 * Constant 2D vector (vec2) value node
 *
 * @remarks
 * Represents a 2-component vector constant (e.g., UV coordinates, 2D positions).
 * Provides multiple output slots:
 * - Output 1: The full vec2 value
 * - Output 2: The x component (swizzle)
 * - Output 3: The y component (swizzle)
 *
 * Can be exposed as a uniform parameter for runtime modification.
 *
 * @example
 * ```typescript
 * const offset = new ConstantVec2Node();
 * offset.x = 0.5;
 * offset.y = 0.5;
 * offset.isUniform = true;
 * offset.paramName = 'u_uvOffset';
 * ```
 *
 * @public
 */
export class ConstantVec2Node extends BaseGraphNode {
  /** The 2D vector value [x, y] */
  private _value: number[];
  /** Whether this constant should be exposed as a uniform parameter */
  private _isUniform: boolean;
  /** The uniform parameter name (only used when isUniform is true) */
  private _paramName: string;
  /**
   * Creates a new constant vec2 node
   *
   * @remarks
   * Initializes with [0, 0] and creates output slots for the full vector
   * and individual components.
   */
  constructor() {
    super();
    this._value = [0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The parameter name if uniform, otherwise comma-separated values
   *
   * @remarks
   * Values are rounded to 3 decimal places for display purposes.
   */
  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000}`;
  }
  /**
   * Gets whether this constant is exposed as a uniform parameter
   */
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  /**
   * Gets the uniform parameter name
   */
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the x component of the vector
   */
  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the y component of the vector
   */
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor with property definitions
   *
   * @remarks
   * Used by the serialization system to save/load node graphs.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec2Node,
      name: 'ConstantVec2Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec2Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec2Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec2Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec2Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec2Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec2Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
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
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Constant nodes have no validation requirements.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for component outputs (id \> 1), 'vec2' for the full vector
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec2';
  }
}

/**
 * Constant 3D vector (vec3) value node
 *
 * @remarks
 * Represents a 3-component vector constant (e.g., RGB colors, 3D positions, normals).
 * Provides multiple output slots:
 * - Output 1: The full vec3 value
 * - Output 2: The x component (swizzle)
 * - Output 3: The y component (swizzle)
 * - Output 4: The z component (swizzle)
 *
 * Includes special 'rgb' serialization property for color picker integration.
 * Can be exposed as a uniform parameter for runtime modification.
 *
 * @example
 * ```typescript
 * const color = new ConstantVec3Node();
 * color.x = 1.0; // Red
 * color.y = 0.0; // Green
 * color.z = 0.0; // Blue
 * color.isUniform = true;
 * color.paramName = 'u_baseColor';
 * ```
 *
 * @public
 */
export class ConstantVec3Node extends BaseGraphNode {
  /** The 3D vector value [x, y, z] */
  private _value: number[];
  /** Whether this constant should be exposed as a uniform parameter */
  private _isUniform: boolean;
  /** The uniform parameter name (only used when isUniform is true) */
  private _paramName: string;
  /**
   * Creates a new constant vec3 node
   *
   * @remarks
   * Initializes with [0, 0, 0] and creates output slots for the full vector
   * and individual components.
   */
  constructor() {
    super();
    this._value = [0, 0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The parameter name if uniform, otherwise comma-separated values
   *
   * @remarks
   * Values are rounded to 3 decimal places for display purposes.
   */
  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
          Math.round(this._value[2] * 1000) / 1000
        }`;
  }
  /**
   * Gets whether this constant is exposed as a uniform parameter
   */
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  /**
   * Gets the uniform parameter name
   */
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the x component of the vector
   */
  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the y component of the vector
   */
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the z component of the vector
   */
  get z() {
    return this._value[2];
  }
  set z(val: number) {
    if (val !== this._value[2]) {
      this._value[2] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor with property definitions
   *
   * @remarks
   * Used by the serialization system to save/load node graphs.
   * Includes an 'rgb' property for color picker integration.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec3Node,
      name: 'ConstantVec3Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec3Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec3Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec3Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec3Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec3Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.y;
            },
            set(this: ConstantVec3Node, value) {
              this.y = value.num[0];
            }
          },
          {
            name: 'z',
            type: 'float',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.z;
            },
            set(this: ConstantVec3Node, value) {
              this.z = value.num[0];
            }
          },
          {
            name: 'rgb',
            type: 'rgb',
            get(this: ConstantVec3Node, value) {
              value.num[0] = this.x;
              value.num[1] = this.y;
              value.num[2] = this.z;
            },
            set(this: ConstantVec3Node, value) {
              this.x = value.num[0];
              this.y = value.num[1];
              this.z = value.num[2];
            }
          }
        ];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Constant nodes have no validation requirements.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for component outputs (id \> 1), 'vec3' for the full vector
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec3';
  }
}

/**
 * Constant 4D vector (vec4) value node
 *
 * @remarks
 * Represents a 4-component vector constant (e.g., RGBA colors with alpha, 4D positions).
 * Provides multiple output slots:
 * - Output 1: The full vec4 value
 * - Output 2: The x component (swizzle)
 * - Output 3: The y component (swizzle)
 * - Output 4: The z component (swizzle)
 * - Output 5: The w component (swizzle)
 *
 * Includes special 'rgba' serialization property for color picker integration with alpha.
 * Can be exposed as a uniform parameter for runtime modification.
 *
 * @example
 * ```typescript
 * const color = new ConstantVec4Node();
 * color.x = 1.0; // Red
 * color.y = 0.5; // Green
 * color.z = 0.0; // Blue
 * color.w = 0.8; // Alpha
 * color.isUniform = true;
 * color.paramName = 'u_tintColor';
 * ```
 *
 * @public
 */
export class ConstantVec4Node extends BaseGraphNode {
  /** The 4D vector value [x, y, z, w] */
  private _value: number[];
  /** The uniform parameter name (only used when isUniform is true) */
  private _paramName: string;
  /** Whether this constant should be exposed as a uniform parameter */
  private _isUniform: boolean;
  /**
   * Creates a new constant vec4 node
   *
   * @remarks
   * Initializes with [0, 0, 0, 0] and creates output slots for the full vector
   * and individual components.
   */
  constructor() {
    super();
    this._value = [0, 0, 0, 0];
    this._isUniform = false;
    this._paramName = '';
    this._outputs = [
      { id: 1, name: '' },
      { id: 2, name: 'x', swizzle: 'x' },
      { id: 3, name: 'y', swizzle: 'y' },
      { id: 4, name: 'z', swizzle: 'z' },
      { id: 5, name: 'w', swizzle: 'w' }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The parameter name if uniform, otherwise comma-separated values
   *
   * @remarks
   * Values are rounded to 3 decimal places for display purposes.
   */
  toString() {
    return this._isUniform
      ? this._paramName
      : `${Math.round(this._value[0] * 1000) / 1000},${Math.round(this._value[1] * 1000) / 1000},${
          Math.round(this._value[2] * 1000) / 1000
        },${Math.round(this._value[3] * 1000) / 1000}`;
  }
  /**
   * Gets whether this constant is exposed as a uniform parameter
   */
  get isUniform() {
    return this._isUniform;
  }
  set isUniform(val: boolean) {
    if (this._isUniform !== !!val) {
      this._isUniform = !!val;
      if (!this._paramName) {
        this._paramName = getParamName();
      }
    }
  }
  /**
   * Gets the uniform parameter name
   */
  get paramName() {
    return this._paramName;
  }
  set paramName(val: string) {
    if (val !== this._paramName) {
      this._paramName = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the x component of the vector
   */
  get x() {
    return this._value[0];
  }
  set x(val: number) {
    if (val !== this._value[0]) {
      this._value[0] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the y component of the vector
   */
  get y() {
    return this._value[1];
  }
  set y(val: number) {
    if (val !== this._value[1]) {
      this._value[1] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the z component of the vector
   */
  get z() {
    return this._value[2];
  }
  set z(val: number) {
    if (val !== this._value[2]) {
      this._value[2] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the w component of the vector
   */
  get w() {
    return this._value[3];
  }
  set w(val: number) {
    if (val !== this._value[3]) {
      this._value[3] = val;
      this.dispatchEvent('changed');
    }
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor with property definitions
   *
   * @remarks
   * Used by the serialization system to save/load node graphs.
   * Includes an 'rgba' property for color picker integration with alpha channel.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ConstantVec4Node,
      name: 'ConstantVec4Node',
      getProps() {
        return [
          {
            name: 'isUniform',
            type: 'bool',
            get(this: ConstantVec4Node, value) {
              value.bool[0] = this.isUniform;
            },
            set(this: ConstantVec4Node, value) {
              this.isUniform = value.bool[0];
            }
          },
          {
            name: 'paramName',
            type: 'string',
            get(this: ConstantVec4Node, value) {
              value.str[0] = this.paramName;
            },
            set(this: ConstantVec4Node, value) {
              this.paramName = value.str[0];
            }
          },
          {
            name: 'x',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.x;
            },
            set(this: ConstantVec4Node, value) {
              this.x = value.num[0];
            }
          },
          {
            name: 'y',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.y;
            },
            set(this: ConstantVec4Node, value) {
              this.y = value.num[0];
            }
          },
          {
            name: 'z',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.z;
            },
            set(this: ConstantVec4Node, value) {
              this.z = value.num[0];
            }
          },
          {
            name: 'w',
            type: 'float',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.w;
            },
            set(this: ConstantVec4Node, value) {
              this.w = value.num[0];
            }
          },
          {
            name: 'rgba',
            type: 'rgba',
            get(this: ConstantVec4Node, value) {
              value.num[0] = this.x;
              value.num[1] = this.y;
              value.num[2] = this.z;
              value.num[3] = this.w;
            },
            set(this: ConstantVec4Node, value) {
              this.x = value.num[0];
              this.y = value.num[1];
              this.z = value.num[2];
              this.w = value.num[3];
            }
          }
        ];
      }
    };
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Constant nodes have no validation requirements.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns 'float' for component outputs (id \> 1), 'vec4' for the full vector
   */
  protected getType(id: number): string {
    return id > 1 ? 'float' : 'vec4';
  }
}
