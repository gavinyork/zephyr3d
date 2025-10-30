import type {
  BaseTexture,
  PBInsideFunctionScope,
  PBScope,
  ProgramBuilder,
  TextureAddressMode,
  TextureFilterMode,
  TextureSampler
} from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';
import type { BaseGraphNode, BlueprintDAG, IGraphNode } from '../node';
import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../common/constants';
import type { GenericConstructor } from '@zephyr3d/base';
import { ASSERT, DRef } from '@zephyr3d/base';
import { BaseTextureNode, TextureSampleNode } from './texture';
import { getDevice } from '../../../app/api';
import {
  GenericMathNode,
  PerlinNoise2DNode,
  MakeVectorNode,
  SimplexNoise2DNode,
  TransformNode,
  Hash1Node,
  Hash2Node,
  Hash3Node
} from '../common/math';
import {
  InvProjMatrixNode,
  InvViewProjMatrixNode,
  ProjectionMatrixNode,
  ViewMatrixNode,
  ViewProjMatrixNode
} from './inputs';
import {
  CameraNearFarNode,
  CameraPositionNode,
  ElapsedTimeNode,
  SkyEnvTextureNode,
  VertexBinormalNode,
  VertexColorNode,
  VertexNormalNode,
  VertexPositionNode,
  VertexTangentNode,
  VertexUVNode
} from './inputs';
import { ShaderHelper } from '../../../material/shader/helper';
import { FunctionCallNode, FunctionInputNode, FunctionOutputNode } from './func';
import {
  hash11,
  hash12,
  hash13,
  hash21,
  hash22,
  hash23,
  hash31,
  hash32,
  hash33,
  valueNoise
} from '../../../shaders/noise';

/**
 * Represents a uniform scalar or vector value in the intermediate representation
 *
 * @remarks
 * Used to track uniform values that need to be passed to the shader at runtime.
 * The value can be either a single number or a Float32Array for vector types.
 *
 * @public
 */
export type IRUniformValue = { name: string; value: Float32Array<ArrayBuffer> | number; node: IGraphNode };

/**
 * Represents a uniform texture and its sampler in the intermediate representation
 *
 * @remarks
 * Used to track texture uniforms that need to be bound to the shader at runtime.
 * Includes both the texture reference and sampler configuration.
 *
 * @public
 */
export type IRUniformTexture = {
  name: string;
  texture: DRef<BaseTexture>;
  sampler: DRef<TextureSampler>;
  node: IGraphNode;
};

/**
 * Abstract base class for intermediate representation expressions
 *
 * @remarks
 * Represents a node in the IR tree that can be compiled to shader code.
 * Uses reference counting to determine if intermediate variables are needed.
 * Each expression can be referenced multiple times in the final shader code.
 *
 * The IR expression tree is built during compilation and then translated
 * to actual shader code via the `create()` method.
 *
 * @public
 */
abstract class IRExpression {
  /** Reference count for this expression (number of times it's used) */
  protected _ref: number;
  /** Cached output expressions for each output slot */
  protected _outputs: IRExpression[];
  /**
   * Creates a new IR expression
   *
   * @remarks
   * Initializes reference count to 0 and empty outputs array.
   */
  constructor() {
    this._ref = 0;
    this._outputs = [];
  }
  /**
   * Generates shader code for this expression
   *
   * @param pb - The program builder used to generate shader code
   * @returns The generated shader expression or numeric value
   *
   * @remarks
   * This is the core method that translates the IR to actual shader code.
   * Must be implemented by all concrete expression types.
   */
  abstract create(pb: ProgramBuilder): number | PBShaderExp;
  /** Gets the array of output expressions */
  get outputs() {
    return this._outputs;
  }
  /**
   * Increments the reference count
   *
   * @returns This expression for method chaining
   *
   * @remarks
   * Called when this expression is referenced by another expression.
   * Reference count is used to determine if a temporary variable is needed.
   */
  addRef(): this {
    this._ref++;
    return this;
  }
  /**
   * Generates a unique temporary variable name
   *
   * @param scope - The shader scope to check for name conflicts
   * @returns A unique temporary variable name (e.g., 'tmp0', 'tmp1')
   *
   * @remarks
   * Ensures the generated name doesn't conflict with existing variables in the scope.
   */
  getTmpName(scope: PBScope) {
    let tmp = 0;
    for (;;) {
      const name = `tmp${tmp++}`;
      if (!scope[name]) {
        return name;
      }
    }
  }
  /**
   * Converts this expression to a uniform value if applicable
   *
   * @param _node - The graph node associated with this expression
   * @returns The uniform value descriptor, or null if not a uniform
   *
   * @remarks
   * Only constant expressions can be converted to uniforms.
   * Returns null by default; overridden by constant expression types.
   */
  asUniformValue(_node: IGraphNode): IRUniformValue {
    return null;
  }
  /**
   * Converts this expression to a uniform texture if applicable
   *
   * @param _node - The graph node associated with this expression
   * @returns The uniform texture descriptor, or null if not a texture uniform
   *
   * @remarks
   * Only texture constant expressions can be converted to texture uniforms.
   * Returns null by default; overridden by texture constant expression types.
   */
  asUniformTexture(_node: IGraphNode): IRUniformTexture {
    return null;
  }
  /**
   * Reset state for creation
   */
  reset() {}
}

/**
 * IR expression for a constant scalar (float) value
 *
 * @remarks
 * Represents either a literal constant or a uniform parameter.
 * If a parameter name is provided, generates a uniform; otherwise, uses a literal.
 *
 * @example
 * ```typescript
 * // Literal constant
 * const literal = new IRConstantf(1.5, '');
 *
 * // Uniform parameter
 * const uniform = new IRConstantf(1.0, 'u_roughness');
 * ```
 *
 * @public
 */
class IRConstantf extends IRExpression {
  /** The constant float value */
  readonly value: number;
  /** The uniform parameter name, or empty string for literals */
  readonly name: string;
  /**
   * Creates a constant float expression
   *
   * @param value - The float value
   * @param paramName - The uniform parameter name, or empty string for literals
   */
  constructor(value: number, paramName: string) {
    super();
    this.value = value;
    this.name = paramName;
  }
  /**
   * Generates shader code for this constant
   *
   * @param pb - The program builder
   * @returns A uniform reference or literal number
   *
   * @remarks
   * If a parameter name exists, creates a uniform in the global scope.
   * Otherwise, returns the literal value.
   */
  create(pb: ProgramBuilder): number {
    if (this.name) {
      if (!pb.getGlobalScope()[this.name]) {
        pb.getGlobalScope()[this.name] = pb.float().uniform(2);
      }
      return pb.getGlobalScope()[this.name];
    }
    return this.value;
  }
  /**
   * Converts to a uniform value descriptor
   *
   * @param node - The graph node
   * @returns Uniform value descriptor if this is a uniform parameter, null otherwise
   */
  asUniformValue(node: IGraphNode): IRUniformValue {
    return this.name
      ? {
          name: this.name,
          value: this.value,
          node
        }
      : null;
  }
}

/**
 * IR expression for a constant vector value
 *
 * @remarks
 * Represents vec2, vec3, or vec4 constants.
 * Can be either literals or uniform parameters.
 *
 * @example
 * ```typescript
 * // Literal vec3
 * const color = new IRConstantfv([1.0, 0.0, 0.0], '');
 *
 * // Uniform vec2
 * const param = new IRConstantfv([0.5, 0.5], 'u_offset');
 * ```
 *
 * @public
 */
class IRConstantfv extends IRExpression {
  /** The constant vector value as an array of floats */
  readonly value: number[];
  /** The uniform parameter name, or empty string for literals */
  readonly name: string;
  /**
   * Creates a constant vector expression
   *
   * @param value - The vector value as an array (length 2-4)
   * @param paramName - The uniform parameter name, or empty string for literals
   */
  constructor(value: number[], paramName: string) {
    super();
    this.value = value;
    this.name = paramName;
  }
  /**
   * Generates shader code for this constant vector
   *
   * @param pb - The program builder
   * @returns A uniform reference or vector constructor expression
   *
   * @remarks
   * If a parameter name exists, creates a uniform in the global scope.
   * The vector size is determined by the array length (vec2/vec3/vec4).
   */
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.name) {
      if (!pb.getGlobalScope()[this.name]) {
        pb.getGlobalScope()[this.name] = pb[`vec${this.value.length}`]().uniform(2);
      }
      return pb.getGlobalScope()[this.name];
    }
    return Array.isArray(this.value) ? pb[`vec${this.value.length}`](...this.value) : this.value;
  }
  /**
   * Converts to a uniform value descriptor
   *
   * @param node - The graph node
   * @returns Uniform value descriptor if this is a uniform parameter, null otherwise
   */
  asUniformValue(node: IGraphNode): IRUniformValue {
    return this.name ? { name: this.name, value: new Float32Array(this.value), node } : null;
  }
}

/**
 * IR expression for shader input variables
 *
 * @remarks
 * Represents variables that are passed into the shader from the vertex stage
 * or defined in the current scope. Examples include vertex attributes,
 * varyings, and built-in variables.
 *
 * @example
 * ```typescript
 * // Reference to vertex color
 * const vertexColor = new IRInput('zVertexColor');
 *
 * // Reference via function
 * const worldPos = new IRInput((scope) => scope.zWorldPos);
 * ```
 *
 * @public
 */
class IRInput extends IRExpression {
  /** The variable name or a function that retrieves the variable from scope */
  readonly func: string | ((scope: PBInsideFunctionScope) => PBShaderExp);
  /**
   * Creates an input variable expression
   *
   * @param func - Variable name string or function to retrieve the variable
   */
  constructor(func: string | ((scope: PBInsideFunctionScope) => PBShaderExp)) {
    super();
    this.func = func;
  }
  /**
   * Generates shader code for this input variable
   *
   * @param pb - The program builder
   * @returns The shader expression referencing the input variable
   */
  create(pb: ProgramBuilder): PBShaderExp {
    return typeof this.func === 'string' ? pb.getCurrentScope()[this.func] : this.func(pb.getCurrentScope());
  }
}

/**
 * IR expression for function calls and operations
 *
 * @remarks
 * Represents built-in shader functions (add, mul, sin, etc.) or vector constructors.
 * Uses reference counting to determine if result should be stored in a temporary variable.
 *
 * @example
 * ```typescript
 * // Addition: a + b
 * const add = new IRFunc([exprA, exprB], 'add');
 *
 * // Vector constructor: vec3(x, y, z)
 * const vec = new IRFunc([x, y, z], 'vec3');
 * ```
 *
 * @public
 */
class IRFunc extends IRExpression {
  /** Array of parameters (can be expressions or literal numbers) */
  readonly params: (number | IRExpression)[];
  /** The function name (e.g., 'add', 'mul', 'sin', 'vec3') */
  readonly func: string | ((pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => PBShaderExp);
  /** Cached temporary variable name if expression is referenced multiple times */
  private tmpName: string;
  /**
   * Creates a function call expression
   *
   * @param params - Array of parameters for the function
   * @param func - The function name or function implementation
   *
   * @remarks
   * Increments reference count for all expression parameters.
   */
  constructor(
    params: (number | IRExpression)[],
    func: string | ((pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => PBShaderExp)
  ) {
    super();
    this.params = params.map((param) => (param instanceof IRExpression ? param.addRef() : param));
    this.func = func;
    this.tmpName = '';
  }
  /** Reset for next creation */
  reset() {
    this.tmpName = '';
  }
  /**
   * Generates shader code for this function call
   *
   * @param pb - The program builder
   * @returns The shader expression for the function result
   *
   * @remarks
   * If referenced multiple times (_ref > 1), stores result in a temporary variable.
   * Otherwise, generates the function call inline.
   */
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      const exp = pb.getCurrentScope()[this.tmpName];
      ASSERT(exp, 'expression not exists');
      return exp;
    }
    const params = this.params.map((param) => (param instanceof IRExpression ? param.create(pb) : param));
    const exp = typeof this.func === 'string' ? pb[this.func](...params) : this.func(pb, ...params);
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
  }
}

/**
 * IR expression for function output values
 *
 * @remarks
 * Represents the output of a material function (subgraph).
 * Handles caching of output values when referenced multiple times.
 *
 * @example
 * ```typescript
 * // Function returns a processed color value
 * const output = new IRFunctionOutput(colorExpression);
 * ```
 *
 * @public
 */
class IRFunctionOutput extends IRExpression {
  /** Cached temporary variable name for the output */
  private tmpName: string;
  /** The input expression to output */
  private readonly input: IRExpression | number;
  /**
   * Creates a function output expression
   *
   * @param input - The expression or value to output
   */
  constructor(input: IRExpression | number) {
    super();
    this.input = input;
    this.tmpName = '';
  }
  /** Reset for next creation */
  reset() {
    this.tmpName = '';
  }
  /**
   * Generates shader code for this function output
   *
   * @param pb - The program builder
   * @returns The shader expression or value
   *
   * @remarks
   * If referenced multiple times, stores result in a temporary variable.
   */
  create(pb: ProgramBuilder): PBShaderExp | number {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const exp = this.input instanceof IRExpression ? this.input.create(pb) : this.input;
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
  }
}

/**
 * IR expression for calling user-defined material functions
 *
 * @remarks
 * Represents a call to a material function (subgraph) with parameters.
 * Generates both the function definition and the call site.
 * Uses a struct return type to return multiple outputs from the function.
 *
 * @example
 * ```typescript
 * // Call to a custom "calculateLighting" function
 * const call = new IRCallFunc(functionNode, [normalExpr, lightDirExpr]);
 * ```
 *
 * @public
 */
class IRCallFunc extends IRExpression {
  /** The function call node from the graph */
  readonly node: FunctionCallNode;
  /** Array of argument expressions */
  readonly args: IRExpression[];
  /** Cached temporary variable name if result is referenced multiple times */
  tmpName: string;
  /**
   * Creates a function call expression
   *
   * @param node - The function call node
   * @param args - Array of argument expressions
   */
  constructor(node: FunctionCallNode, args: IRExpression[]) {
    super();
    this.node = node;
    this.args = args;
    this.tmpName = '';
  }
  /** Reset for next creation */
  reset() {
    this.tmpName = '';
  }
  /**
   * Generates shader code for the function definition and call
   *
   * @param pb - The program builder
   * @returns The shader expression for the function result
   *
   * @remarks
   * First generates the function definition (if not already defined),
   * then generates the function call with the provided arguments.
   * The function returns a struct containing all output values.
   */
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const that = this;
    const ir = this.node.IR;
    const params = this.node.args.map((v) => pb[v.type](v.name));
    pb.func(this.node.name, params, function () {
      const outputs = ir.create(pb);
      const rettype = pb.defineStruct(
        that.node.outputs.map((output, index) => {
          return pb[that.node.outs[index].type](output.swizzle);
        })
      );
      this.$return(
        rettype(
          ...outputs.map((output) => {
            return output.exp;
          })
        )
      );
    });
    const args = this.args.map((arg) => arg.create(pb));
    const exp = pb.getGlobalScope()[this.node.name](...args);
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
  }
}

/**
 * IR expression for vector component swizzling
 *
 * @remarks
 * Extracts specific components from a vector using swizzle notation.
 * For scalar sources, constructs a vector with replicated values.
 *
 * @example
 * ```typescript
 * // Extract xyz from vec4
 * const xyz = new IRSwizzle(vec4Expr, 'xyz');
 *
 * // Extract single component
 * const x = new IRSwizzle(vec3Expr, 'x');
 *
 * // Swizzle and reorder
 * const bgr = new IRSwizzle(rgbExpr, 'bgr');
 * ```
 *
 * @public
 */
class IRSwizzle extends IRExpression {
  /** The source expression to swizzle */
  readonly src: IRExpression;
  /** The swizzle pattern (e.g., 'xyz', 'rgb', 'x', 'yzw') */
  readonly hash: string;
  /**
   * Creates a swizzle expression
   *
   * @param src - The source vector expression
   * @param hash - The swizzle pattern using xyzw or rgba notation
   */
  constructor(src: IRExpression, hash: string) {
    super();
    this.src = src.addRef();
    this.hash = hash;
  }
  /**
   * Generates shader code for the swizzle operation
   *
   * @param pb - The program builder
   * @returns The swizzled shader expression
   *
   * @remarks
   * If source is a scalar number, creates a vector with that value repeated.
   * Otherwise, applies the swizzle notation to the source expression.
   */
  create(pb: ProgramBuilder): number | PBShaderExp {
    const src = this.src.create(pb);
    return typeof src === 'number' ? pb[`vec${this.hash.length}`](src) : src[this.hash];
  }
}

/**
 * IR expression for type casting with padding
 *
 * @remarks
 * Converts a value to a different vector type by padding with zeros.
 * Used when a smaller vector needs to be converted to a larger one.
 *
 * @example
 * ```typescript
 * // Cast float to vec3: vec3(value, 0, 0)
 * const vec3 = new IRCast(floatExpr, 'vec3', 2);
 *
 * // Cast vec2 to vec4: vec4(value.xy, 0, 0)
 * const vec4 = new IRCast(vec2Expr, 'vec4', 2);
 * ```
 *
 * @public
 */
class IRCast extends IRExpression {
  /** The source expression to cast */
  readonly src: IRExpression;
  /** The target type name (e.g., 'vec2', 'vec3', 'vec4') */
  readonly type: string;
  /** Number of zero components to append */
  readonly cast: number;
  /**
   * Creates a type cast expression
   *
   * @param src - The source expression
   * @param type - The target type name
   * @param cast - Number of zero components to append
   */
  constructor(src: IRExpression, type: string, cast: number) {
    super();
    this.src = src.addRef();
    this.cast = cast;
    this.type = type;
  }
  /**
   * Generates shader code for the type cast
   *
   * @param pb - The program builder
   * @returns The casted shader expression
   *
   * @remarks
   * Creates a vector constructor with the source value followed by zeros.
   * Example: vec4(src, 0, 0) for casting vec2 to vec4.
   */
  create(pb: ProgramBuilder): PBShaderExp {
    return pb[this.type](this.src.create(pb), ...Array.from({ length: this.cast }).fill(0));
  }
}

/**
 * IR expression for texture sampling
 *
 * @remarks
 * Represents a texture lookup operation with optional normal map decoding.
 * Handles both color and normal map sampling with appropriate transformations.
 * Uses reference counting to cache the sampled result if used multiple times.
 *
 * @example
 * ```typescript
 * // Sample color texture
 * const color = new IRSampleTexture(texExpr, uvExpr, 'Color');
 *
 * // Sample normal map (automatically decodes from [0,1] to [-1,1])
 * const normal = new IRSampleTexture(texExpr, uvExpr, 'Normal');
 * ```
 *
 * @public
 */
class IRSampleTexture extends IRExpression {
  /** The texture constant expression */
  readonly tex: IRConstantTexture;
  /** The texture coordinate expression */
  readonly coord: IRExpression;
  /** The sampler type determining how to interpret the sampled value */
  readonly samplerType: 'Color' | 'Normal';
  /** Cached temporary variable name if result is referenced multiple times */
  tmpName: string;
  /**
   * Creates a texture sample expression
   *
   * @param tex - The texture to sample from
   * @param coord - The texture coordinates
   * @param samplerType - How to interpret the sampled value ('Color' or 'Normal')
   */
  constructor(tex: IRConstantTexture, coord: IRExpression, samplerType: 'Color' | 'Normal') {
    super();
    this.tex = tex.addRef();
    this.coord = coord.addRef();
    this.samplerType = samplerType;
    this.tmpName = '';
  }
  /** Reset for next creation */
  reset() {
    this.tmpName = '';
  }
  /**
   * Generates shader code for the texture sample operation
   *
   * @param pb - The program builder
   * @returns The sampled color value
   *
   * @remarks
   * For normal maps, applies the transformation: normal * 2 - 1 to convert
   * from [0,1] texture space to [-1,1] tangent space.
   * Caches result in a temporary variable if referenced multiple times.
   *
   * @throws Error if texture coordinate is not a valid expression or array
   */
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const tex = this.tex.create(pb);
    const coord = this.coord.create(pb);
    let coordExp: PBShaderExp;
    if (coord instanceof PBShaderExp) {
      coordExp = coord;
    } else if (Array.isArray(coord)) {
      coordExp = pb[`vec${coord.length}`](...coord);
    } else {
      throw new Error('Invalid texture coordinate');
    }
    let exp = pb.textureSample(tex, coordExp);
    if (this.samplerType === 'Normal') {
      exp = pb.sub(pb.mul(exp, pb.vec4(2, 2, 2, 1)), pb.vec4(1, 1, 1, 0));
    }
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
  }
}

/**
 * IR expression for texture uniform constants
 *
 * @remarks
 * Represents a texture parameter that will be bound as a uniform.
 * Includes sampler configuration for texture filtering and addressing modes.
 *
 * @example
 * ```typescript
 * const tex = new IRConstantTexture(
 *   'u_baseColorMap',
 *   'tex2d',
 *   'repeat',
 *   'repeat',
 *   'linear',
 *   'linear',
 *   'linear'
 * );
 * ```
 *
 * @public
 */
class IRConstantTexture extends IRExpression {
  /** The uniform texture variable name */
  readonly name: string;
  /** The texture type (e.g., 'tex2d', 'texCube') */
  readonly type: string;
  /** Horizontal texture addressing mode */
  readonly addressU: TextureAddressMode;
  /** Vertical texture addressing mode */
  readonly addressV: TextureAddressMode;
  /** Minification filter mode */
  readonly filterMin: TextureFilterMode;
  /** Magnification filter mode */
  readonly filterMag: TextureFilterMode;
  /** Mipmap filter mode */
  readonly filterMip: TextureFilterMode;
  /**
   * Creates a texture constant expression
   *
   * @param name - The uniform variable name
   * @param type - The texture type
   * @param addressU - Horizontal addressing mode
   * @param addressV - Vertical addressing mode
   * @param minFilter - Minification filter
   * @param magFilter - Magnification filter
   * @param mipFilter - Mipmap filter
   */
  constructor(
    name: string,
    type: string,
    addressU: TextureAddressMode,
    addressV: TextureAddressMode,
    minFilter: TextureFilterMode,
    magFilter: TextureFilterMode,
    mipFilter: TextureFilterMode
  ) {
    super();
    this.name = name;
    this.type = type;
    this.addressU = addressU;
    this.addressV = addressV;
    this.filterMin = minFilter;
    this.filterMag = magFilter;
    this.filterMip = mipFilter;
  }
  /**
   * Generates shader code for the texture uniform
   *
   * @param pb - The program builder
   * @returns The texture uniform reference
   *
   * @remarks
   * Creates the uniform declaration in the global scope if not already present.
   */
  create(pb: ProgramBuilder): PBShaderExp {
    if (!pb.getGlobalScope()[this.name]) {
      pb.getGlobalScope()[this.name] = pb[this.type]().uniform(2);
    }
    return pb.getGlobalScope()[this.name];
  }
  /**
   * Converts to a uniform texture descriptor
   *
   * @param node - The texture node
   * @returns Uniform texture descriptor with texture and sampler references
   */
  asUniformTexture(node: BaseTextureNode): IRUniformTexture {
    return {
      name: this.name,
      texture: new DRef(node.texture.get()),
      sampler: new DRef(
        getDevice().createSampler({
          addressU: this.addressU,
          addressV: this.addressV,
          minFilter: this.filterMin,
          magFilter: this.filterMag,
          mipFilter: this.filterMip
        })
      ),
      node
    };
  }
}

/**
 * Material blueprint behavior flags
 *
 * @remarks
 * Tracks which vertex attributes and shader features are used by the material.
 * Used to determine which vertex data needs to be provided and which
 * shader permutations need to be compiled.
 *
 * @public
 */
export interface MaterialBlueprintIRBehaviors {
  /** Whether the material uses vertex colors */
  useVertexColor: boolean;
  /** Whether the material uses texture coordinates */
  useVertexUV: boolean;
  /** Whether the material uses tangent space (tangent/binormal) */
  useVertexTangent: boolean;
  /** Whether the material uses camera position (for view-dependent effects) */
  useCameraPosition: boolean;
}

/**
 * Material Blueprint Intermediate Representation
 *
 * @remarks
 * The IR is a compiled representation of the material node graph that can be
 * efficiently translated to shader code. It performs:
 * - Type checking and validation
 * - Expression optimization (common subexpression elimination via reference counting)
 * - Uniform extraction (constants become shader uniforms)
 * - Dependency analysis (determines required vertex attributes)
 *
 * The compilation process:
 * 1. Traverse the DAG in topological order
 * 2. Build an IR expression tree
 * 3. Track uniforms and behaviors
 * 4. Generate optimized shader code from the IR
 *
 * @example
 * ```typescript
 * const ir = new MaterialBlueprintIR(dag, materialHash);
 * if (ir.ok) {
 *   // Generate shader code
 *   const outputs = ir.create(programBuilder);
 *
 *   // Apply uniforms at runtime
 *   for (const uniform of ir.uniformValues) {
 *     material.setUniform(uniform.name, uniform.value);
 *   }
 * }
 * ```
 *
 * @public
 */
export class MaterialBlueprintIR {
  /** The directed acyclic graph of material nodes */
  private _dag: BlueprintDAG;
  /** Unique hash identifying this material configuration */
  private _hash: string;
  /** Array of all IR expressions in the graph */
  private _expressions: IRExpression[];
  /** Map from graph node to IR expression index */
  private _expressionMap: Map<BaseGraphNode, number>;
  /** Array of uniform scalar/vector values to be set at runtime */
  private _uniformValues: IRUniformValue[];
  /** Array of uniform textures to be bound at runtime */
  private _uniformTextures: IRUniformTexture[];
  /** Flags indicating which shader features are used */
  private _behaviors: MaterialBlueprintIRBehaviors;
  /** Array of named output expressions (e.g., baseColor, normal, metallic) */
  private _outputs: { name: string; expr: IRExpression }[];
  /**
   * Creates and compiles a material blueprint IR
   *
   * @param dag - The material node graph DAG
   * @param hash - Unique identifier for this material
   *
   * @remarks
   * Automatically compiles the DAG during construction.
   * Check the `ok` property to verify successful compilation.
   */
  constructor(dag: BlueprintDAG, hash: string) {
    this._dag = dag ?? {
      nodeMap: {},
      roots: [],
      graph: {
        outgoing: {},
        incoming: {}
      },
      order: []
    };
    this._hash = hash;
    this.compile();
  }
  /**
   * Whether the IR compiled successfully
   *
   * @returns True if compilation produced valid outputs
   */
  get ok() {
    return this._outputs?.length > 0;
  }
  /** Gets the unique hash for this material */
  get hash() {
    return this._hash;
  }
  /** Gets the behavior flags indicating shader requirements */
  get behaviors() {
    return this._behaviors;
  }
  /** Gets the material node DAG */
  get DAG() {
    return this._dag;
  }
  set DAG(dag: BlueprintDAG) {
    this._dag = dag;
  }
  /** Gets the array of uniform values to set at runtime */
  get uniformValues() {
    return this._uniformValues;
  }
  /** Gets the array of uniform textures to bind at runtime */
  get uniformTextures() {
    return this._uniformTextures;
  }
  /**
   * Compiles the material node graph to IR
   *
   * @returns True if compilation succeeded, false otherwise
   *
   * @remarks
   * Processes all root nodes (typically a single material output node)
   * and builds IR expressions for all connected inputs.
   * Collects all required uniforms and sets behavior flags.
   *
   * Compilation fails if any required input is missing.
   */
  compile(): boolean {
    this.reset();
    this._outputs = [];
    for (const root of this._dag.roots) {
      const rootNode = this._dag.nodeMap[root];
      for (const input of rootNode.inputs) {
        const name = input.name;
        if (input.inputNode) {
          this._outputs.push({
            name,
            expr: this.ir(input.inputNode, input.inputId, input.originType).addRef()
          });
        } else if (typeof input.defaultValue === 'number') {
          this._outputs.push({
            name,
            expr: new IRConstantf(input.defaultValue, '').addRef()
          });
        } else if (Array.isArray(input.defaultValue)) {
          this._outputs.push({
            name,
            expr: new IRConstantfv(input.defaultValue, '').addRef()
          });
        } else if (input.required) {
          this._outputs = null;
          return false;
        }
      }
    }
    return true;
  }
  /**
   * Generates shader code from the IR
   *
   * @param pb - The program builder to generate code with
   * @returns Array of named shader expressions, or null if IR is invalid
   *
   * @remarks
   * Translates all IR expressions to actual shader code.
   * Should be called within a shader function scope.
   *
   * @example
   * ```typescript
   * pb.fragmentShader(function() {
   *   const outputs = ir.create(this);
   *   this.baseColor = outputs.find(o => o.name === 'baseColor').exp;
   *   this.normal = outputs.find(o => o.name === 'normal').exp;
   * });
   * ```
   */
  create(pb: ProgramBuilder): { name: string; exp: PBShaderExp | number }[] {
    if (!this._outputs) {
      return null;
    }
    for (const expr of this._expressions) {
      expr.reset();
    }
    const outputs: { name: string; exp: PBShaderExp | number }[] = [];
    for (const output of this._outputs) {
      outputs.push({ name: output.name, exp: output.expr.create(pb) });
    }
    return outputs;
  }
  /**
   * Resets the IR state for recompilation
   *
   * @remarks
   * Clears all compiled data including expressions, uniforms, and behaviors.
   * Called at the start of compilation.
   */
  private reset() {
    this._expressions = [];
    this._expressionMap = new Map();
    this._uniformTextures = [];
    this._uniformValues = [];
    this._outputs = null;
    this._behaviors = {
      useVertexColor: false,
      useVertexUV: false,
      useVertexTangent: false,
      useCameraPosition: false
    };
  }
  /**
   * Converts a graph node to an IR expression
   *
   * @param node - The graph node to convert
   * @param output - The output slot ID
   * @param originType - Optional type override for type casting
   * @returns The corresponding IR expression
   *
   * @remarks
   * Main dispatch method that routes to specific converters based on node type.
   * Handles automatic type casting when originType differs from node output type.
   *
   * @throws Error if type casting is invalid
   */
  private ir(node: IGraphNode, output: number, originType?: string): IRExpression {
    let expr: IRExpression = null;
    if (node instanceof ConstantScalarNode) {
      expr = this.constantf(node, output);
    } else if (
      node instanceof ConstantVec2Node ||
      node instanceof ConstantVec3Node ||
      node instanceof ConstantVec4Node
    ) {
      expr = this.constantfv(node, output);
    } else if (node instanceof BaseTextureNode) {
      expr = this.constantTexture(node, output);
    } else if (node instanceof TextureSampleNode) {
      expr = this.textureSample(node, output);
    } else if (node instanceof MakeVectorNode) {
      expr = this.makeVector(node, output);
    } else if (node instanceof Hash1Node) {
      expr = this.hash1(node, output);
    } else if (node instanceof Hash2Node) {
      expr = this.hash2(node, output);
    } else if (node instanceof Hash3Node) {
      expr = this.hash3(node, output);
    } else if (node instanceof SimplexNoise2DNode) {
      expr = this.simplexNoise2d(node, output);
    } else if (node instanceof PerlinNoise2DNode) {
      expr = this.perlinNoise2d(node, output);
    } else if (node instanceof GenericMathNode) {
      expr = this.func(node, output);
    } else if (node instanceof TransformNode) {
      expr = this.transform(node, output);
    } else if (node instanceof VertexColorNode) {
      expr = this.vertexColor(node, output);
    } else if (node instanceof VertexUVNode) {
      expr = this.vertexUV(node, output);
    } else if (node instanceof VertexPositionNode) {
      expr = this.vertexPosition(node, output);
    } else if (node instanceof VertexNormalNode) {
      expr = this.vertexNormal(node, output);
    } else if (node instanceof VertexTangentNode) {
      expr = this.vertexTangent(node, output);
    } else if (node instanceof VertexBinormalNode) {
      expr = this.vertexBinormal(node, output);
    } else if (node instanceof ViewMatrixNode) {
      expr = this.viewMatrix(node, output);
    } else if (node instanceof ProjectionMatrixNode) {
      expr = this.projectionMatrix(node, output);
    } else if (node instanceof ViewProjMatrixNode) {
      expr = this.viewProjectionMatrix(node, output);
    } else if (node instanceof InvProjMatrixNode) {
      expr = this.invProjectionMatrix(node, output);
    } else if (node instanceof InvViewProjMatrixNode) {
      expr = this.invViewProjectionMatrix(node, output);
    } else if (node instanceof CameraPositionNode) {
      expr = this.cameraPosition(node, output);
    } else if (node instanceof CameraNearFarNode) {
      expr = this.cameraNearFar(node, output);
    } else if (node instanceof SkyEnvTextureNode) {
      expr = this.skyEnvTexture(node, output);
    } else if (node instanceof ElapsedTimeNode) {
      expr = this.elapsedTime(node, output);
    } else if (node instanceof FunctionCallNode) {
      expr = this.functionCall(node, output);
    } else if (node instanceof FunctionInputNode) {
      expr = this.functionInput(node, output);
    } else if (node instanceof FunctionOutputNode) {
      expr = this.functionOutput(node, output);
    }
    if (expr && originType) {
      const outputType = node.getOutputType(output);
      if (originType !== outputType) {
        if (originType === 'float') {
          if (outputType !== 'vec2' && outputType !== 'vec3' && outputType !== 'vec4') {
            throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
          }
          return new IRSwizzle(expr, 'x');
        } else if (outputType === 'float') {
          if (originType !== 'vec2' && originType !== 'vec3' && originType !== 'vec4') {
            throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
          }
          return new IRCast(expr, originType, 0);
        } else if (outputType === 'vec2' || outputType === 'vec3' || outputType === 'vec4') {
          const nOut = Number(outputType[outputType.length - 1]);
          const nOrg = Number(originType[originType.length - 1]);
          if (nOut > nOrg) {
            return new IRSwizzle(expr, 'xyzw'.slice(0, nOrg));
          } else {
            return new IRCast(expr, originType, nOrg - nOut);
          }
        } else {
          throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
        }
      }
    }

    return expr;
  }
  /**
   * Gets or creates an IR expression for a graph node
   *
   * @param node - The graph node
   * @param outputId - The output slot ID
   * @param ctor - The IR expression constructor
   * @param args - Constructor arguments
   * @returns The cached or newly created IR expression
   *
   * @remarks
   * Implements common subexpression elimination by caching expressions per node.
   * Handles output slot swizzling and type casting.
   * Collects uniform values and textures.
   */
  private getOrCreateIRExpression<
    T extends GenericConstructor<IRExpression>,
    F extends ConstructorParameters<T>
  >(node: BaseGraphNode, outputId: number, ctor: T, ...args: F): IRExpression {
    let ir: IRExpression;
    if (!this._expressionMap.has(node)) {
      ir = new ctor(...args);
      this._expressions.push(ir);
      this._expressionMap.set(node, this._expressions.length - 1);
      const uniformValue = ir.asUniformValue(node);
      if (uniformValue) {
        this._uniformValues.push(uniformValue);
      }
      const uniformTexture = ir.asUniformTexture(node);
      if (uniformTexture) {
        this._uniformTextures.push(uniformTexture);
      }
    } else {
      ir = this._expressions[this._expressionMap.get(node)] as InstanceType<T>;
    }
    if (!ir.outputs[outputId]) {
      const output = node.outputs.find((v) => v.id === outputId);
      ir.outputs[outputId] = ir;
      if (typeof output.cast === 'number') {
        ir.outputs[outputId] = new IRCast(ir, node.getOutputType(outputId), output.cast);
      }
      if (output.swizzle) {
        ir.outputs[outputId] = new IRSwizzle(ir.outputs[outputId], output.swizzle);
      }
    }
    return ir.outputs[outputId];
  }
  /** Converts a MakeVector node to IR */
  private makeVector(node: MakeVectorNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    const funcName = node.getOutputType(output);
    return this.getOrCreateIRExpression(node, output, IRFunc, params, funcName);
  }
  /** Converts a Transform node to IR */
  private transform(node: TransformNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    return this.getOrCreateIRExpression(node, output, IRFunc, params, 'mul');
  }
  /** Converts a generic math function node to IR */
  private func(node: GenericMathNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    const funcName = node.func;
    return this.getOrCreateIRExpression(node, output, IRFunc, params, funcName);
  }
  /** Converts a function output node to IR */
  private functionOutput(node: FunctionOutputNode, output: number): IRExpression {
    const input = this.ir(node.inputs[0].inputNode, node.inputs[0].inputId, node.inputs[0].originType);
    return this.getOrCreateIRExpression(node, output, IRFunctionOutput, input);
  }
  /** Converts a vertex color input node to IR */
  private vertexColor(node: VertexColorNode, output: number): IRExpression {
    this._behaviors.useVertexColor = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexColor');
  }
  /** Converts a vertex UV input node to IR */
  private vertexUV(node: VertexUVNode, output: number): IRExpression {
    this._behaviors.useVertexUV = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexUV');
  }
  /** Converts a vertex normal input node to IR */
  private vertexNormal(node: VertexNormalNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexNormal');
  }
  /** Converts a vertex tangent input node to IR */
  private vertexTangent(node: VertexTangentNode, output: number): IRExpression {
    this._behaviors.useVertexTangent = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexTangent');
  }
  /** Converts a vertex binormal input node to IR */
  private vertexBinormal(node: VertexBinormalNode, output: number): IRExpression {
    this._behaviors.useVertexTangent = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexBinormal');
  }
  /** Converts a vertex position input node to IR */
  private vertexPosition(node: VertexPositionNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, 'zWorldPos');
  }
  /** Converts a view matrix input node to IR */
  private viewMatrix(node: ViewMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getViewMatrix(scope)
    );
  }
  /** Converts a projection matrix input node to IR */
  private projectionMatrix(node: ProjectionMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getProjectionMatrix(scope)
    );
  }
  /** Converts a view-projection matrix input node to IR */
  private viewProjectionMatrix(node: ViewProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getViewProjectionMatrix(scope)
    );
  }
  /** Converts an inverse projection matrix input node to IR */
  private invProjectionMatrix(node: InvProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getInvProjectionMatrix(scope)
    );
  }
  /** Converts an inverse view-projection matrix input node to IR */
  private invViewProjectionMatrix(node: InvViewProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getInvViewProjectionMatrix(scope)
    );
  }
  /** Converts a camera position input node to IR */
  private cameraPosition(node: CameraPositionNode, output: number): IRExpression {
    this._behaviors.useCameraPosition = true;
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getCameraPosition(scope)
    );
  }
  /** Converts a camera near/far input node to IR */
  private cameraNearFar(node: CameraNearFarNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(
      node,
      output,
      IRInput,
      (scope: PBInsideFunctionScope) => ShaderHelper.getCameraParams(scope).xy
    );
  }
  /** Converts a sky environment texture input node to IR */
  private skyEnvTexture(node: SkyEnvTextureNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getBakedSkyTexture(scope)
    );
  }
  /** Converts an elapsed time input node to IR */
  private elapsedTime(node: ElapsedTimeNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getElapsedTime(scope)
    );
  }
  /** Converts a function input node to IR */
  private functionInput(node: FunctionInputNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(
      node,
      output,
      IRInput,
      (scope: PBInsideFunctionScope) => scope[node.name]
    );
  }
  /** Converts a hash1 node to IR */
  private hash1(node: Hash1Node, output: number): IRExpression {
    const params: IRExpression[] = [];
    const input = node.inputs[0];
    ASSERT(!!input.inputNode);
    const type = input.inputNode.getOutputType(input.inputId);
    ASSERT(type === 'float' || type === 'vec2' || type === 'vec3');
    params.push(this.ir(input.inputNode, input.inputId, input.originType));
    return this.getOrCreateIRExpression(
      node,
      output,
      IRFunc,
      params,
      (pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => {
        const scope = pb.getCurrentScope() as PBInsideFunctionScope;
        const seed = params[0];
        return type === 'float'
          ? hash11(scope, seed)
          : type === 'vec2'
            ? hash21(scope, seed as PBShaderExp)
            : hash31(scope, seed as PBShaderExp);
      }
    );
  }
  /** Converts a hash2 node to IR */
  private hash2(node: Hash1Node, output: number): IRExpression {
    const params: IRExpression[] = [];
    const input = node.inputs[0];
    ASSERT(!!input.inputNode);
    const type = input.inputNode.getOutputType(input.inputId);
    ASSERT(type === 'float' || type === 'vec2' || type === 'vec3');
    params.push(this.ir(input.inputNode, input.inputId, input.originType));
    return this.getOrCreateIRExpression(
      node,
      output,
      IRFunc,
      params,
      (pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => {
        const scope = pb.getCurrentScope() as PBInsideFunctionScope;
        const seed = params[0];
        return type === 'float'
          ? hash12(scope, seed)
          : type === 'vec2'
            ? hash22(scope, seed as PBShaderExp)
            : hash32(scope, seed as PBShaderExp);
      }
    );
  }
  /** Converts a hash3 node to IR */
  private hash3(node: Hash1Node, output: number): IRExpression {
    const params: IRExpression[] = [];
    const input = node.inputs[0];
    ASSERT(!!input.inputNode);
    const type = input.inputNode.getOutputType(input.inputId);
    ASSERT(type === 'float' || type === 'vec2' || type === 'vec3');
    params.push(this.ir(input.inputNode, input.inputId, input.originType));
    return this.getOrCreateIRExpression(
      node,
      output,
      IRFunc,
      params,
      (pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => {
        const scope = pb.getCurrentScope() as PBInsideFunctionScope;
        const seed = params[0];
        return type === 'float'
          ? hash13(scope, seed)
          : type === 'vec2'
            ? hash23(scope, seed as PBShaderExp)
            : hash33(scope, seed as PBShaderExp);
      }
    );
  }
  /** Converts a simple noise node to IR */
  private simplexNoise2d(node: SimplexNoise2DNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    return this.getOrCreateIRExpression(
      node,
      output,
      IRFunc,
      params,
      (pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => {
        pb.func(node.toString(), [pb.vec2('uv'), pb.float('scale')], function () {
          this.$l.t = pb.float(0);
          let freq = 1;
          let amp = 0.5 * 0.5 * 0.5;
          this.t = pb.add(this.t, pb.mul(valueNoise(this, pb.mul(this.uv, this.scale, 1 / freq)), amp));
          freq *= 2;
          amp *= 2;
          this.t = pb.add(this.t, pb.mul(valueNoise(this, pb.mul(this.uv, this.scale, 1 / freq)), amp));
          freq *= 2;
          amp *= 2;
          this.t = pb.add(this.t, pb.mul(valueNoise(this, pb.mul(this.uv, this.scale, 1 / freq)), amp));
          this.$return(this.t);
        });
        return pb.getGlobalScope()[node.toString()](params[0], params[1]);
      }
    );
  }
  /** Converts a perlin noise node to IR */
  private perlinNoise2d(node: SimplexNoise2DNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    return this.getOrCreateIRExpression(
      node,
      output,
      IRFunc,
      params,
      (pb: ProgramBuilder, ...params: (number | PBShaderExp)[]) => {
        pb.func('Z_perlinNoise2dDir', [pb.vec2('uv')], function () {
          this.$l.p = pb.mod(this.uv, pb.vec2(289));
          this.$l.x = pb.add(pb.mod(pb.mul(pb.add(pb.mul(this.p.x, 34), 1), this.p.x), 289), this.p.y);
          this.x = pb.mod(pb.mul(pb.add(pb.mul(this.x, 34), 1), this.x), 289);
          this.x = pb.sub(pb.mul(pb.fract(pb.div(this.x, 41)), 2), 1);
          this.$return(
            pb.normalize(pb.vec2(pb.sub(this.x, pb.floor(pb.add(this.x, 0.5))), pb.sub(pb.abs(this.x), 0.5)))
          );
        });
        pb.func('Z_perlinNoise2dImpl', [pb.vec2('uv')], function () {
          this.$l.i = pb.floor(this.uv);
          this.$l.f = pb.fract(this.uv);
          this.$l.r00 = pb.dot(this.Z_perlinNoise2dDir(this.i), this.f);
          this.$l.r01 = pb.dot(
            this.Z_perlinNoise2dDir(pb.add(this.i, pb.vec2(0, 1))),
            pb.sub(this.f, pb.vec2(0, 1))
          );
          this.$l.r10 = pb.dot(
            this.Z_perlinNoise2dDir(pb.add(this.i, pb.vec2(1, 0))),
            pb.sub(this.f, pb.vec2(1, 0))
          );
          this.$l.r11 = pb.dot(
            this.Z_perlinNoise2dDir(pb.add(this.i, pb.vec2(1, 1))),
            pb.sub(this.f, pb.vec2(1, 1))
          );
          this.f = pb.mul(
            this.f,
            this.f,
            this.f,
            pb.add(pb.mul(this.f, pb.sub(pb.mul(this.f, 6), pb.vec2(15))), 10)
          );
          this.$return(
            pb.mix(pb.mix(this.r00, this.r01, this.f.y), pb.mix(this.r10, this.r11, this.f.y), this.f.x)
          );
        });
        pb.func(node.toString(), [pb.vec2('uv'), pb.float('scale')], function () {
          this.$return(pb.add(this.Z_perlinNoise2dImpl(pb.mul(this.uv, this.scale)), 0.5));
        });
        return pb.getGlobalScope()[node.toString()](params[0], params[1]);
      }
    );
  }
  /** Converts a function call node to IR */
  private functionCall(node: FunctionCallNode, output: number): IRExpression {
    const args = node.inputs.map((input) => {
      return this.ir(input.inputNode, input.inputId, input.originType);
    });
    return this.getOrCreateIRExpression(node, output, IRCallFunc, node, args);
  }
  /** Converts a scalar constant node to IR */
  private constantf(node: ConstantScalarNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRConstantf, node.x, node.paramName);
  }
  /** Converts a vector constant node to IR */
  private constantfv(
    node: ConstantVec2Node | ConstantVec3Node | ConstantVec4Node,
    output: number
  ): IRExpression {
    const value =
      node instanceof ConstantVec2Node
        ? [node.x, node.y]
        : node instanceof ConstantVec3Node
          ? [node.x, node.y, node.z]
          : [node.x, node.y, node.z, node.w];
    return this.getOrCreateIRExpression(node, output, IRConstantfv, value, node.paramName);
  }
  /** Converts a texture constant node to IR */
  private constantTexture(node: BaseTextureNode, output: number): IRConstantTexture {
    return this.getOrCreateIRExpression(
      node,
      output,
      IRConstantTexture,
      node.paramName,
      node.getOutputType(1),
      node.addressU,
      node.addressV,
      node.filterMin,
      node.filterMag,
      node.filterMip
    ) as IRConstantTexture;
  }
  /** Converts a texture sample node to IR */
  private textureSample(node: TextureSampleNode, output: number): IRExpression {
    const tex = this.ir(node.inputs[0].inputNode, node.inputs[0].inputId) as IRConstantTexture;
    const coord = this.ir(node.inputs[1].inputNode, node.inputs[1].inputId);
    return this.getOrCreateIRExpression(node, output, IRSampleTexture, tex, coord, node.samplerType);
  }
}
