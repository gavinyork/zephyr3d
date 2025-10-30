import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

/**
 * Vector constructor node
 *
 * @remarks
 * Constructs a vector (vec2, vec3, or vec4) from individual components or smaller vectors.
 * Accepts 1-4 inputs which can be scalars (float) or vectors (vec2, vec3).
 * The output vector size is determined by the total number of components from all inputs.
 *
 * Valid combinations:
 * - vec2: float + float, or vec2
 * - vec3: float + float + float, vec2 + float, float + vec2, or vec3
 * - vec4: float + float + float + float, vec2 + vec2, vec3 + float, etc.
 *
 * @example
 * ```typescript
 * // Create vec3 from three floats
 * const makeVec3 = new MakeVectorNode();
 * makeVec3.connectInput(1, xNode, 1);
 * makeVec3.connectInput(2, yNode, 1);
 * makeVec3.connectInput(3, zNode, 1);
 *
 * // Create vec4 from vec3 and float
 * const makeVec4 = new MakeVectorNode();
 * makeVec4.connectInput(1, rgbNode, 1);
 * makeVec4.connectInput(2, alphaNode, 1);
 * ```
 *
 * @public
 */
export class MakeVectorNode extends BaseGraphNode {
  /**
   * Creates a new make vector node
   *
   * @remarks
   * Initializes with 4 optional input slots (a, b, c, d).
   * At least one input must be connected. Unused trailing inputs can be left disconnected.
   */
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3'],
        required: true
      },
      {
        id: 2,
        name: 'b',
        type: ['float', 'vec2', 'vec3']
      },
      {
        id: 3,
        name: 'c',
        type: ['float', 'vec2', 'vec3']
      },
      {
        id: 4,
        name: 'd',
        type: ['float', 'vec2', 'vec3']
      }
    ];
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'MakeVector'
   */
  toString(): string {
    return 'MakeVector';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * No properties need to be serialized beyond the base node data.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: MakeVectorNode,
      name: 'MakeVectorNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state and input types
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Validation checks:
   * - At least one input must be connected
   * - All inputs up to the last connected one must be present
   * - Total component count must be between 2 and 4
   * - All input types must be valid (float, vec2, or vec3)
   */
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
    let index = this._inputs.length - 1;
    while (index >= 0 && !this._inputs[index].inputNode) {
      index--;
    }
    if (index < 0) {
      return 'Missing arguments';
    }
    let n = 0;
    const types: string[] = [];
    for (let i = 0; i <= index; i++) {
      const name = this._inputs[i].name;
      if (!this._inputs[i].inputNode) {
        return `Missing argument \`${name}\``;
      }
      const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!type) {
        return `Cannot determine type of argument \`${name}\``;
      }
      if (!this._inputs[i].type.includes(type)) {
        return `Invalid input type ${type}`;
      }
      types.push(type);
      n += type === 'float' ? 1 : type === 'vec2' ? 2 : type === 'vec3' ? 3 : 0;
    }
    if (n < 2 || n > 4) {
      return `Invalid type combination ${types.join(',')}`;
    }
    return '';
  }
  /**
   * Gets the output type based on connected inputs
   *
   * @returns 'vec2', 'vec3', 'vec4', or empty string if invalid
   *
   * @remarks
   * Counts total components from all connected inputs:
   * - float = 1 component
   * - vec2 = 2 components
   * - vec3 = 3 components
   * Returns vecN where N is the total component count (2-4).
   */
  protected getType() {
    let index = this._inputs.length - 1;
    while (index >= 0 && !this._inputs[index].inputNode) {
      index--;
    }
    if (index < 0) {
      return '';
    }
    let n = 0;
    for (let i = 0; i <= index; i++) {
      if (!this._inputs[i].inputNode) {
        return '';
      }
      const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!type) {
        return '';
      }
      n += type === 'float' ? 1 : type === 'vec2' ? 2 : type === 'vec3' ? 3 : 0;
    }
    if (n < 2 || n > 4) {
      return '';
    }
    return `vec${n}`;
  }
}

/**
 * Matrix-vector transformation node
 *
 * @remarks
 * Performs matrix-vector or matrix-matrix multiplication using the shader's mul() function.
 * Supports transformations for 2D, 3D, and 4D spaces:
 * - mat2 * vec2 or vec2 * mat2
 * - mat3 * vec3 or vec3 * mat3
 * - mat4 * vec4 or vec4 * mat4
 * - mat2 * mat2, mat3 * mat3, mat4 * mat4
 *
 * Common uses:
 * - Transform positions by model/view/projection matrices
 * - Transform normals by inverse transpose matrices
 * - Chain matrix transformations
 *
 * @example
 * ```typescript
 * // Transform position by view-projection matrix
 * const transform = new TransformNode();
 * transform.connectInput(1, positionNode, 1); // vec4 position
 * transform.connectInput(2, viewProjMatrixNode, 1); // mat4 matrix
 *
 * // Transform normal by normal matrix
 * const normalTransform = new TransformNode();
 * normalTransform.connectInput(1, normalNode, 1); // vec3 normal
 * normalTransform.connectInput(2, normalMatrixNode, 1); // mat3 matrix
 * ```
 *
 * @public
 */
export class TransformNode extends BaseGraphNode {
  /**
   * Creates a new transform node
   *
   * @remarks
   * Initializes with two required inputs: the value to transform (a) and the transformation matrix (b).
   */
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'a',
        type: ['vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'],
        required: true
      },
      {
        id: 2,
        name: 'b',
        type: ['vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']
      }
    ];
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'Transform'
   */
  toString(): string {
    return 'Transform';
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * No properties need to be serialized beyond the base node data.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TransformNode,
      name: 'TransformNode',
      getProps() {
        return [];
      }
    };
  }
  /**
   * Validates the node state and input type compatibility
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Validates that the input types are compatible for multiplication:
   * - vec2 with mat2
   * - vec3 with mat3
   * - vec4 with mat4
   * - Compatible matrix-matrix multiplications
   */
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
    const types: string[] = [];
    for (let i = 0; i < 2; i++) {
      const name = this._inputs[i].name;
      if (!this._inputs[i].inputNode) {
        return `Missing argument \`${name}\``;
      }
      const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!type) {
        return `Cannot determine type of argument \`${name}\``;
      }
      if (!this._inputs[i].type.includes(type)) {
        return `Invalid input type ${type}`;
      }
      types.push(type);
    }
    if (types[0] === 'vec2' && types[1] === 'mat2') {
      return '';
    }
    if (types[0] === 'vec3' && types[1] === 'mat3') {
      return '';
    }
    if (types[0] === 'vec4' && types[1] === 'mat4') {
      return '';
    }
    if (types[0] === 'mat2' && (types[1] === 'mat2' || types[1] === 'vec2')) {
      return '';
    }
    if (types[0] === 'mat3' && (types[1] === 'mat3' || types[1] === 'vec3')) {
      return '';
    }
    if (types[0] === 'mat4' && (types[1] === 'mat4' || types[1] === 'vec4')) {
      return '';
    }
    return 'Invalid argument types of transformation';
  }
  /**
   * Gets the output type based on input types
   *
   * @returns The result type of the transformation, or empty string if invalid
   *
   * @remarks
   * Result type rules:
   * - vec * mat = vec (same dimension)
   * - mat * vec = vec (same dimension)
   * - mat * mat = mat (same dimension)
   */
  protected getType() {
    const err = super.validate();
    if (err) {
      return '';
    }
    const types: string[] = [];
    for (let i = 0; i < 2; i++) {
      if (!this._inputs[i].inputNode) {
        return '';
      }
      const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!type) {
        return '';
      }
      if (!this._inputs[i].type.includes(type)) {
        return '';
      }
      types.push(type);
    }
    if (types[0] === 'vec2' && types[1] === 'mat2') {
      return 'vec2';
    }
    if (types[0] === 'vec3' && types[1] === 'mat3') {
      return 'vec3';
    }
    if (types[0] === 'vec4' && types[1] === 'mat4') {
      return 'vec4';
    }
    if (types[0] === 'mat2' && (types[1] === 'mat2' || types[1] === 'vec2')) {
      return types[1] === 'mat2' ? 'mat2' : 'vec2';
    }
    if (types[0] === 'mat3' && (types[1] === 'mat3' || types[1] === 'vec3')) {
      return types[1] === 'mat3' ? 'mat3' : 'vec3';
    }
    if (types[0] === 'mat4' && (types[1] === 'mat4' || types[1] === 'vec4')) {
      return types[1] === 'mat4' ? 'mat4' : 'vec4';
    }
    return '';
  }
}

/**
 * Abstract base class for generic mathematical function nodes
 *
 * @remarks
 * Provides a flexible framework for shader math functions that:
 * - Accept N arguments of specified types
 * - Perform type validation and inference
 * - Support both uniform input types and mixed types
 *
 * Type handling:
 * - By default, all inputs must be the same type (float, vec2, vec3, or vec4)
 * - `explicitInTypes` allows specific inputs to accept only certain types
 * - `additionalInTypes` allows specific inputs to accept additional mixed types
 * - `originTypes` specifies type casting requirements
 *
 * The output type is either:
 * - Explicitly specified via `outType`
 * - Inferred from the common input type
 *
 * @example
 * ```typescript
 * // Simple function with uniform types (all float or all vec3, etc.)
 * class AddNode extends GenericMathNode {
 *   constructor() {
 *     super('add', 2); // 2 arguments, output type = input type
 *   }
 * }
 *
 * // Function with explicit output type
 * class LengthNode extends GenericMathNode {
 *   constructor() {
 *     super('length', 1, 'float'); // 1 argument, always outputs float
 *   }
 * }
 *
 * // Function with mixed input types
 * class MulNode extends GenericMathNode {
 *   constructor() {
 *     // Allow scalar multiplication: vec * float or float * vec
 *     super('mul', 2, null, null, null, { '1': ['float'], '2': ['float'] });
 *   }
 * }
 * ```
 *
 * @public
 */
export abstract class GenericMathNode extends BaseGraphNode {
  /** The shader function name (e.g., 'sin', 'add', 'normalize') */
  readonly func: string;
  /** The explicit output type, if specified (otherwise inferred from inputs) */
  readonly outType: string;
  /** Maps input slot IDs to allowed types for that specific slot */
  readonly explicitInTypes: Record<number, string[]>;
  /** Maps input slot IDs to additional allowed types beyond the common type */
  readonly additionalInTypes: Record<number, string[]>;
  /**
   * Creates a new generic math node
   *
   * @param func - The shader function name
   * @param numArgs - Number of input arguments
   * @param outType - Explicit output type (null to infer from inputs)
   * @param inTypes - Default allowed input types (defaults to all vector types)
   * @param explicitInTypes - Per-slot type restrictions
   * @param additionalInTypes - Per-slot additional allowed types
   * @param originTypes - Per-slot type casting requirements
   *
   * @remarks
   * Creates input slots named 'a', 'b', 'c', etc. based on numArgs.
   * All inputs are required by default.
   */
  constructor(
    func: string,
    numArgs: number,
    outType?: string,
    inTypes?: string[],
    explicitInTypes?: Record<number, string[]>,
    additionalInTypes?: Record<number, string[]>,
    originTypes?: string[]
  ) {
    super();
    this.func = func;
    this.outType = outType ?? '';
    this.explicitInTypes = explicitInTypes ?? null;
    this.additionalInTypes = additionalInTypes ?? null;
    inTypes = inTypes ?? ['float', 'vec2', 'vec3', 'vec4'];
    this._inputs = Array.from({ length: numArgs }).map((_, index) => ({
      id: index + 1,
      name: 'abcdefghijklmn'[index],
      type: this.explicitInTypes?.[index + 1] ?? [
        ...new Set([...inTypes, ...(this.additionalInTypes?.[index + 1] ?? [])])
      ],
      required: true,
      originType: originTypes?.[index]
    }));
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The function name
   */
  toString() {
    return this.func;
  }
  /**
   * Validates the node state and input type compatibility
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Ensures all inputs:
   * - Have determinable types
   * - Have allowed types for their slot
   * - Share a common type (unless explicitly or additionally typed)
   */
  protected validate(): string {
    const err = super.validate();
    if (err) {
      return err;
    }
    let type: string = '';
    for (let i = 0; i < this._inputs.length; i++) {
      const name = 'abcdefghijklmn'[i];
      const t = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!t) {
        return `Cannot determine type of argument \`${name}\``;
      }
      if (!this._inputs[i].type.includes(t)) {
        return `Invalid input type ${t}`;
      }
      if (!this.explicitInTypes || !this.explicitInTypes[this._inputs[i].id]) {
        if (!this.additionalInTypes || !this.additionalInTypes[this._inputs[i].id]?.includes(t)) {
          if (type && t !== type) {
            return 'Invalid Arguments types';
          } else {
            type = t;
          }
        }
      }
    }
    return '';
  }
  /**
   * Gets the output type based on input types
   *
   * @returns The output type, or empty string if invalid
   *
   * @remarks
   * Returns the explicit output type if specified, otherwise infers
   * the common type from non-explicit, non-additional inputs.
   */
  protected getType(): string {
    if (this.outType) {
      return this.outType;
    }
    let type: string = '';
    for (let i = 0; i < this._inputs.length; i++) {
      if (!this._inputs[i].inputNode) {
        return '';
      }
      const t = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
      if (!t) {
        return '';
      }
      if (!this.explicitInTypes || !this.explicitInTypes[this._inputs[i].id]) {
        if (!this.additionalInTypes || !this.additionalInTypes[this._inputs[i].id]?.includes(t)) {
          if (type && t !== type) {
            return 'Invalid Arguments types';
          } else {
            type = t;
          }
        }
      }
    }
    return type;
  }
}

/**
 * Converts degrees to radians
 *
 * @remarks
 * Applies the formula: radians = degrees * (π / 180)
 * Supports scalar and vector inputs.
 *
 * @public
 */
export class Degrees2RadiansNode extends GenericMathNode {
  constructor() {
    super('degrees2radians', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Degrees2RadiansNode,
      name: 'Degrees2RadiansNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Converts radians to degrees
 *
 * @remarks
 * Applies the formula: degrees = radians * (180 / π)
 * Supports scalar and vector inputs.
 *
 * @public
 */
export class Radians2DegreesNode extends GenericMathNode {
  constructor() {
    super('radians2degrees', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Radians2DegreesNode,
      name: 'Radians2DegreesNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the sine function
 *
 * @remarks
 * Returns sin(x) for input x in radians.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class SinNode extends GenericMathNode {
  constructor() {
    super('sin', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SinNode,
      name: 'SinNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the cosine function
 *
 * @remarks
 * Returns cos(x) for input x in radians.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class CosNode extends GenericMathNode {
  constructor() {
    super('cos', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CosNode,
      name: 'CosNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the tangent function
 *
 * @remarks
 * Returns tan(x) for input x in radians.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class TanNode extends GenericMathNode {
  constructor() {
    super('tan', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TanNode,
      name: 'TanNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the arcsine (inverse sine) function
 *
 * @remarks
 * Returns asin(x) in radians for input x in the range [-1, 1].
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArcSinNode extends GenericMathNode {
  constructor() {
    super('asin', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArcSinNode,
      name: 'ArcSinNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the arccosine (inverse cosine) function
 *
 * @remarks
 * Returns acos(x) in radians for input x in the range [-1, 1].
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArcCosNode extends GenericMathNode {
  constructor() {
    super('acos', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArcCosNode,
      name: 'ArcCosNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the arctangent (inverse tangent) function
 *
 * @remarks
 * Returns atan(x) in radians for input x.
 * Result is in the range [-π/2, π/2].
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArcTanNode extends GenericMathNode {
  constructor() {
    super('atan', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArcTanNode,
      name: 'ArcTanNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the two-argument arctangent function
 *
 * @remarks
 * Returns atan2(y, x) in radians, the angle in the range [-π, π]
 * whose tangent is y/x, using the signs of both arguments to determine
 * the quadrant of the result.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArcTan2Node extends GenericMathNode {
  constructor() {
    super('atan2', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArcTan2Node,
      name: 'ArcTan2Node',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the hyperbolic sine function
 *
 * @remarks
 * Returns sinh(x) = (e^x - e^(-x)) / 2
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class SinHNode extends GenericMathNode {
  constructor() {
    super('sinh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SinHNode,
      name: 'SinHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the hyperbolic cosine function
 *
 * @remarks
 * Returns cosh(x) = (e^x + e^(-x)) / 2
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class CosHNode extends GenericMathNode {
  constructor() {
    super('cosh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CosHNode,
      name: 'CosHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the hyperbolic tangent function
 *
 * @remarks
 * Returns tanh(x) = sinh(x) / cosh(x)
 * Result is in the range [-1, 1].
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class TanHNode extends GenericMathNode {
  constructor() {
    super('tanh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: TanHNode,
      name: 'TanHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the inverse hyperbolic sine function
 *
 * @remarks
 * Returns asinh(x) = ln(x + sqrt(x^2 + 1))
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArcsineHNode extends GenericMathNode {
  constructor() {
    super('asinh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArcsineHNode,
      name: 'ArcsineHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the inverse hyperbolic cosine function
 *
 * @remarks
 * Returns acosh(x) = ln(x + sqrt(x^2 - 1)) for x \>= 1
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArccosineHNode extends GenericMathNode {
  constructor() {
    super('acosh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArccosineHNode,
      name: 'ArccosineHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the inverse hyperbolic tangent function
 *
 * @remarks
 * Returns atanh(x) = 0.5 * ln((1 + x) / (1 - x)) for |x| \< 1
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ArctangentHNode extends GenericMathNode {
  constructor() {
    super('atanh', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ArctangentHNode,
      name: 'ArctangentHNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the natural exponential function
 *
 * @remarks
 * Returns e^x (Euler's number raised to the power x).
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class ExpNode extends GenericMathNode {
  constructor() {
    super('exp', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ExpNode,
      name: 'ExpNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the base-2 exponential function
 *
 * @remarks
 * Returns 2^x (2 raised to the power x).
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class Exp2Node extends GenericMathNode {
  constructor() {
    super('exp2', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Exp2Node,
      name: 'Exp2Node',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the natural logarithm
 *
 * @remarks
 * Returns ln(x) (logarithm base e) for x \> 0.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class LogNode extends GenericMathNode {
  constructor() {
    super('log', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: LogNode,
      name: 'LogNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the base-2 logarithm
 *
 * @remarks
 * Returns log₂(x) (logarithm base 2) for x \> 0.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class Log2Node extends GenericMathNode {
  constructor() {
    super('log2', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Log2Node,
      name: 'Log2Node',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the square root
 *
 * @remarks
 * Returns √x for x \>= 0.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class SqrtNode extends GenericMathNode {
  constructor() {
    super('sqrt', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SqrtNode,
      name: 'SqrtNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the inverse square root
 *
 * @remarks
 * Returns 1/√x for x \> 0.
 * Often more efficient than computing sqrt then dividing.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class InvSqrtNode extends GenericMathNode {
  constructor() {
    super('inverseSqrt', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: InvSqrtNode,
      name: 'InvSqrtNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the absolute value
 *
 * @remarks
 * Returns |x| (magnitude without sign).
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class AbsNode extends GenericMathNode {
  constructor() {
    super('abs', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: AbsNode,
      name: 'AbsNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Extracts the sign of a value
 *
 * @remarks
 * Returns -1 if x \< 0, 0 if x = 0, +1 if x \> 0.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class SignNode extends GenericMathNode {
  constructor() {
    super('sign', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SignNode,
      name: 'SignNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Rounds down to the nearest integer
 *
 * @remarks
 * Returns the largest integer value not greater than x.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class FloorNode extends GenericMathNode {
  constructor() {
    super('floor', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FloorNode,
      name: 'FloorNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Rounds up to the nearest integer
 *
 * @remarks
 * Returns the smallest integer value not less than x.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class CeilNode extends GenericMathNode {
  constructor() {
    super('ceil', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CeilNode,
      name: 'CeilNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the fractional part
 *
 * @remarks
 * Returns x - floor(x), the decimal part of x.
 * Result is always in the range [0, 1).
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class FractNode extends GenericMathNode {
  constructor() {
    super('fract', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FractNode,
      name: 'FractNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the partial derivative with respect to screen-space X
 *
 * @remarks
 * Returns the rate of change of the input value across adjacent pixels in the X direction.
 * Only available in fragment shaders.
 * Useful for computing gradients, detecting edges, and adjusting sampling rates.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class DDXNode extends GenericMathNode {
  constructor() {
    super('dpdx', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: DDXNode,
      name: 'DDXNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the partial derivative with respect to screen-space Y
 *
 * @remarks
 * Returns the rate of change of the input value across adjacent pixels in the Y direction.
 * Only available in fragment shaders.
 * Useful for computing gradients, detecting edges, and adjusting sampling rates.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class DDYNode extends GenericMathNode {
  constructor() {
    super('dpdy', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: DDYNode,
      name: 'DDYNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Computes the sum of absolute derivatives
 *
 * @remarks
 * Returns abs(dpdx(x)) + abs(dpdy(x)), representing the total rate of change
 * across both screen axes. Useful for automatic LOD calculation and edge detection.
 * Only available in fragment shaders.
 * Supports scalar and vector inputs (component-wise for vectors).
 *
 * @public
 */
export class FWidthNode extends GenericMathNode {
  constructor() {
    super('fwidth', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FWidthNode,
      name: 'FWidthNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Component-wise addition
 *
 * @remarks
 * Returns a + b for each component.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 *
 * @public
 */
export class CompAddNode extends GenericMathNode {
  constructor() {
    super('add', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CompAddNode,
      name: 'CompAddNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Component-wise subtraction
 *
 * @remarks
 * Returns a - b for each component.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 *
 * @public
 */
export class CompSubNode extends GenericMathNode {
  constructor() {
    super('sub', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CompSubNode,
      name: 'CompSubNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Component-wise multiplication with scalar support
 *
 * @remarks
 * Returns a * b for each component.
 * Supports:
 * - vec * vec (component-wise)
 * - vec * float (scalar multiplication)
 * - float * vec (scalar multiplication)
 * - float * float
 *
 * For matrix multiplication, use TransformNode instead.
 *
 * @public
 */
export class CompMulNode extends GenericMathNode {
  constructor() {
    super('mul', 2, null, null, null, { '1': ['float'], '2': ['float'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CompMulNode,
      name: 'CompMulNode',
      getProps() {
        return [];
      }
    };
  }
  protected getType(): string {
    const type1 = this.inputs[0].inputNode
      ? this.inputs[0].inputNode.getOutputType(this.inputs[0].inputId)
      : '';
    const type2 = this.inputs[1].inputNode
      ? this.inputs[1].inputNode.getOutputType(this.inputs[1].inputId)
      : '';
    if (!type1 || !type2) {
      return '';
    }
    return type1 === 'float' ? type2 : type1;
  }
}

/**
 * Component-wise division
 *
 * @remarks
 * Returns a / b for each component.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Division by zero produces undefined results.
 *
 * @public
 */
export class CompDivNode extends GenericMathNode {
  constructor() {
    super('div', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CompDivNode,
      name: 'CompDivNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Modulo operation
 *
 * @remarks
 * Returns a - b * floor(a / b), the remainder of a divided by b.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class ModNode extends GenericMathNode {
  constructor() {
    super('mod', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ModNode,
      name: 'ModNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Returns the minimum of two values
 *
 * @remarks
 * Returns min(a, b) for each component.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class MinNode extends GenericMathNode {
  constructor() {
    super('min', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: MinNode,
      name: 'MinNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Returns the maximum of two values
 *
 * @remarks
 * Returns max(a, b) for each component.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class MaxNode extends GenericMathNode {
  constructor() {
    super('max', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: MaxNode,
      name: 'MaxNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Raises a value to a power
 *
 * @remarks
 * Returns a^b (a raised to the power b).
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class PowNode extends GenericMathNode {
  constructor() {
    super('pow', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: PowNode,
      name: 'PowNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Step function (Heaviside step)
 *
 * @remarks
 * Returns 0 if x \< edge, otherwise 1.
 * Useful for creating hard thresholds.
 * Both inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class StepNode extends GenericMathNode {
  constructor() {
    super('step', 2);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: StepNode,
      name: 'StepNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Fused multiply-add operation
 *
 * @remarks
 * Returns a * b + c in a single operation.
 * More accurate and potentially faster than separate multiply and add.
 * All three inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class FmaNode extends GenericMathNode {
  constructor() {
    super('fma', 3);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FmaNode,
      name: 'FmaNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Clamps a value to a specified range
 *
 * @remarks
 * Returns min(max(x, minVal), maxVal).
 * Constrains x to be between minVal and maxVal.
 * All three inputs must be the same type (float, vec2, vec3, or vec4).
 * Component-wise for vectors.
 *
 * @public
 */
export class ClampNode extends GenericMathNode {
  constructor() {
    super('clamp', 3);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ClampNode,
      name: 'ClampNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Clamps a value to the range [0, 1]
 *
 * @remarks
 * Returns clamp(x, 0, 1).
 * Commonly used to ensure color values are in valid range.
 * Supports float, vec2, vec3, and vec4 inputs.
 * Component-wise for vectors.
 *
 * @public
 */
export class SaturateNode extends GenericMathNode {
  constructor() {
    super('saturate', 1);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SaturateNode,
      name: 'SaturateNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Linear interpolation between two values
 *
 * @remarks
 * Returns a * (1 - t) + b * t, blending between a and b based on t.
 * When t = 0, returns a; when t = 1, returns b.
 * The first two inputs must be the same type (float, vec2, vec3, or vec4).
 * The third input (t) can be a float for uniform interpolation or a vector for component-wise interpolation.
 *
 * @public
 */
export class MixNode extends GenericMathNode {
  constructor() {
    super('mix', 3, null, null, null, { '3': ['float'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: MixNode,
      name: 'MixNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Normalizes a vector to unit length
 *
 * @remarks
 * Returns x / length(x), a vector in the same direction with length 1.
 * Only supports vector inputs (vec2, vec3, vec4).
 * Essential for working with directions, normals, and lighting calculations.
 *
 * @public
 */
export class NormalizeNode extends GenericMathNode {
  constructor() {
    super('normalize', 1, null, ['vec2', 'vec3', 'vec4']);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: NormalizeNode,
      name: 'NormalizeNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Flips a vector to face forward
 *
 * @remarks
 * Returns N if dot(Nref, I) \< 0, otherwise -N.
 * Used to orient a normal to face away from a surface (opposite to incident direction).
 * All three inputs must be the same vector type (vec2 or vec3).
 *
 * @public
 */
export class FaceForwardNode extends GenericMathNode {
  constructor() {
    super('faceForward', 3, null, ['vec2', 'vec3']);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FaceForwardNode,
      name: 'FaceForwardNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the reflection direction
 *
 * @remarks
 * Returns I - 2 * dot(N, I) * N, the reflection of incident vector I about normal N.
 * Both inputs must be the same vector type (vec2 or vec3).
 * Used for environment mapping and reflections.
 *
 * @public
 */
export class ReflectNode extends GenericMathNode {
  constructor() {
    super('reflect', 2, null, ['vec2', 'vec3']);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: ReflectNode,
      name: 'ReflectNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the refraction direction
 *
 * @remarks
 * Returns the refraction of incident vector I through surface with normal N
 * using the ratio of indices of refraction eta.
 * The first two inputs must be the same vector type (vec2 or vec3).
 * The third input (eta) is always a float scalar.
 * Used for transparent materials and refractive effects.
 *
 * @public
 */
export class RefractNode extends GenericMathNode {
  constructor() {
    super('refract', 3, null, ['vec2', 'vec3'], { '3': ['float'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: RefractNode,
      name: 'RefractNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the length of a vector
 *
 * @remarks
 * Returns sqrt(x.x + x.y + x.z + ...), the Euclidean length of the vector.
 * Supports vector inputs (vec2, vec3, vec4).
 * Always returns a float scalar.
 *
 * @public
 */
export class LengthNode extends GenericMathNode {
  constructor() {
    super('length', 1, 'float');
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: LengthNode,
      name: 'LengthNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the distance between two points
 *
 * @remarks
 * Returns length(a - b), the Euclidean distance between points a and b.
 * Both inputs must be the same vector type (vec2, vec3, or vec4).
 * Always returns a float scalar.
 *
 * @public
 */
export class DistanceNode extends GenericMathNode {
  constructor() {
    super('distance', 2, 'float');
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: DistanceNode,
      name: 'DistanceNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the dot product of two vectors
 *
 * @remarks
 * Returns a.x * b.x + a.y * b.y + ... (sum of component-wise products).
 * Both inputs must be the same vector type (vec2, vec3, or vec4).
 * Always returns a float scalar.
 *
 * Used for:
 * - Calculating angles between vectors (via cosine)
 * - Projecting one vector onto another
 * - Lighting calculations (Lambert's cosine law)
 *
 * @public
 */
export class DotProductNode extends GenericMathNode {
  constructor() {
    super('dot', 2, 'float', ['vec2', 'vec3', 'vec4']);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: DotProductNode,
      name: 'DotProductNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates the cross product of two 3D vectors
 *
 * @remarks
 * Returns a vector perpendicular to both input vectors.
 * Both inputs must be vec3.
 * Always returns vec3.
 *
 * The magnitude of the result equals the area of the parallelogram
 * formed by the two input vectors.
 *
 * Used for:
 * - Calculating surface normals from tangent vectors
 * - Finding perpendicular directions
 * - Computing oriented areas
 *
 * @public
 */
export class CrossProductNode extends GenericMathNode {
  constructor() {
    super('cross', 2, null, ['vec3']);
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: CrossProductNode,
      name: 'CrossProductNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates a simplex noise by input UV and scale value
 *
 * @remarks
 * Returns a float value
 *
 * @public
 */
export class SimplexNoise2DNode extends GenericMathNode {
  constructor() {
    super('Z_simplexNoise2D', 2, 'float', null, { '1': ['vec2'], '2': ['float'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: SimplexNoise2DNode,
      name: 'SimplexNoise2DNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates a perlin noise by input UV and scale value
 *
 * @remarks
 * Returns a float value
 *
 * @public
 */
export class PerlinNoise2DNode extends GenericMathNode {
  constructor() {
    super('Z_perlinNoise2D', 2, 'float', null, { '1': ['vec2'], '2': ['float'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: PerlinNoise2DNode,
      name: 'PerlinNoise2DNode',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates float hash by input scalar value or vector value
 *
 * @public
 */
export class Hash1Node extends GenericMathNode {
  constructor() {
    super('Z_hash1', 1, 'float', null, { '1': ['float', 'vec2', 'vec3'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Hash1Node,
      name: 'Hash1Node',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates vec2 hash by input scalar value or vector value
 *
 * @public
 */
export class Hash2Node extends GenericMathNode {
  constructor() {
    super('Z_hash2', 1, 'vec2', null, { '1': ['float', 'vec2', 'vec3'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Hash2Node,
      name: 'Hash2Node',
      getProps() {
        return [];
      }
    };
  }
}

/**
 * Calculates vec3 hash by input scalar value or vector value
 *
 * @public
 */
export class Hash3Node extends GenericMathNode {
  constructor() {
    super('Z_hash3', 1, 'vec3', null, { '1': ['float', 'vec2', 'vec3'] });
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: Hash3Node,
      name: 'Hash3Node',
      getProps() {
        return [];
      }
    };
  }
}
