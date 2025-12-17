import type { SerializableClass, ResourceManager } from '../../serialization';
import { BaseGraphNode } from '../node';
import type { MaterialBlueprintIR } from './ir';

/**
 * Function call node for material blueprint functions
 *
 * @remarks
 * Represents a call to a reusable material function (sub-graph) within the material node graph.
 * Functions are defined in separate blueprint files and can be instantiated multiple times.
 *
 * The node automatically:
 * - Discovers function inputs (FunctionInputNode) and creates corresponding input slots
 * - Discovers function outputs (FunctionOutputNode) and creates corresponding output slots
 * - Validates input types match the function's parameter types
 *
 * Benefits of using material functions:
 * - Code reuse across multiple materials
 * - Encapsulation of complex logic
 * - Easier maintenance (update function once, affects all uses)
 * - Better organization of large material graphs
 *
 * @example
 * ```typescript
 * // Load and instantiate a custom noise function
 * const noiseIR = await manager.loadBluePrint('functions/noise.mtlfunc');
 * const noiseCall = new FunctionCallNode(
 *   'functions/noise.mtlfunc',
 *   'noise',
 *   noiseIR
 * );
 *
 * // Connect inputs
 * noiseCall.connectInput(1, uvNode, 1); // UV coordinates
 * noiseCall.connectInput(2, scaleNode, 1); // Scale parameter
 *
 * // Use outputs
 * colorNode.connectInput(1, noiseCall, 1); // Noise result
 * ```
 *
 * @public
 */
export class FunctionCallNode extends BaseGraphNode {
  /** The file path to the function blueprint */
  private _name: string;
  /** The file path to the function blueprint */
  private _path: string;
  /** The intermediate representation (compiled graph) of the function */
  private _IR: MaterialBlueprintIR;
  /** Function input parameters with their indices, names, and types */
  private _args: { index: number; name: string; type: string }[];
  /** Function output values with their indices, names, and types */
  private _outs: { index: number; name: string; type: string }[];
  /**
   * Creates a new function call node
   *
   * @param path - The file path to the function blueprint
   * @param name - The display name of the function
   * @param IR - The compiled intermediate representation of the function
   *
   * @remarks
   * The constructor scans the function's IR to:
   * 1. Find all FunctionInputNode instances and create input slots
   * 2. Find all FunctionOutputNode instances and create output slots
   * 3. Extract parameter names and types for validation
   *
   * Input/output slots are created in the order they appear in the nodeMap,
   * using either custom names or auto-generated names like 'arg_N' or 'out_N'.
   */
  constructor(path: string, name: string, IR: MaterialBlueprintIR) {
    super();
    this._path = path;
    this._name = name;
    this._IR = IR;
    this._args = [];
    this._outs = [];
    this._inputs = [];
    this._outputs = [];
    for (const k of Object.keys(this._IR.DAG.nodeMap)) {
      const node = this._IR.DAG.nodeMap[k];
      if (node instanceof FunctionInputNode) {
        const name = node.name || `arg_${k}`;
        this._args.push({
          index: Number(k),
          name,
          type: node.type
        });
        this._inputs.push({
          id: this._inputs.length + 1,
          name,
          type: [node.type]
        });
      } else if (node instanceof FunctionOutputNode) {
        const name = node.name || `out_${k}`;
        this._outs.push({
          index: Number(k),
          name,
          type: node.type
        });
        this._outputs.push({
          id: this._outputs.length + 1,
          name,
          swizzle: name
        });
      }
    }
  }
  /**
   * Gets the file path to the function blueprint
   */
  get path() {
    return this._path;
  }
  /**
   * Gets the function name
   */
  get name() {
    return this._name;
  }
  /**
   * Gets the intermediate representation (IR) of the function
   *
   * @remarks
   * The IR contains the compiled node graph that will be inlined
   * or called during shader code generation.
   */
  get IR() {
    return this._IR;
  }
  /**
   * Gets the function's input parameter definitions
   *
   * @returns Array of parameter descriptors with index, name, and type
   */
  get args() {
    return this._args;
  }
  /**
   * Gets the function's output value definitions
   *
   * @returns Array of output descriptors with index, name, and type
   */
  get outs() {
    return this._outs;
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @param manager - The serialization manager for loading blueprints
   * @returns Serialization class descriptor
   *
   * @remarks
   * Uses a custom createFunc to asynchronously load the function blueprint
   * from the file system. The initialization parameter is the blueprint path.
   */
  static getSerializationCls(manager: ResourceManager): SerializableClass {
    return {
      ctor: FunctionCallNode,
      name: 'FunctionCallNode',
      async createFunc(_, init: string) {
        const IR = await manager.loadBluePrint(init);
        const funcName = manager.VFS.basename(init, manager.VFS.extname(init));
        return { obj: new FunctionCallNode(init, funcName, IR['func']) };
      },
      getInitParams(obj: FunctionCallNode) {
        return obj.path;
      },
      getProps() {
        return [];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns The function name
   */
  toString() {
    return this._name;
  }
  /**
   * Validates the node state and input types
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Ensures:
   * - All required inputs are connected
   * - Input types can be determined
   * - Input types match the function's parameter types
   */
  protected validate(): string {
    for (let i = 0; i < this._inputs.length; i++) {
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
    }
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID (1-based)
   * @returns The type of the output value
   *
   * @remarks
   * Returns the type declared by the corresponding FunctionOutputNode
   * in the function's blueprint.
   */
  protected getType(id: number): string {
    return this._outs[id - 1].type;
  }
}

/**
 * Function input parameter node
 *
 * @remarks
 * Represents an input parameter in a material function blueprint.
 * These nodes define the function's interface - what data must be provided
 * when the function is called from another material graph.
 *
 * Each FunctionInputNode:
 * - Has a name (parameter name)
 * - Has a type (float, vec2, vec3, vec4, mat2, mat3, or mat4)
 * - Produces one output that provides the parameter value within the function
 * - Has no inputs (it receives its value from the calling context)
 *
 * When a FunctionCallNode is created, it scans for all FunctionInputNodes
 * and creates corresponding input slots on the call node.
 *
 * @example
 * ```typescript
 * // In a function blueprint:
 * const uvInput = new FunctionInputNode();
 * uvInput.name = 'uv';
 * uvInput.type = 'vec2';
 *
 * const scaleInput = new FunctionInputNode();
 * scaleInput.name = 'scale';
 * scaleInput.type = 'float';
 *
 * // These will become inputs on any FunctionCallNode that uses this blueprint
 * ```
 *
 * @public
 */
export class FunctionInputNode extends BaseGraphNode {
  /** Static counter for auto-generating unique argument names */
  static argId = 1;
  /** The data type of this parameter */
  private _type: string;
  /**
   * Creates a new function input node
   *
   * @remarks
   * Initializes with:
   * - Default type: vec4
   * - Auto-generated name: arg_N (where N is an incrementing counter)
   * - One output slot to provide the parameter value within the function
   */
  constructor() {
    super();
    this._type = 'vec4';
    this._outputs = [{ id: 1, name: `arg_${FunctionInputNode.argId++}` }];
  }
  /**
   * Gets the parameter type
   *
   * @returns The data type (float, vec2, vec3, vec4, mat2, mat3, or mat4)
   */
  get type() {
    return this._type;
  }
  /**
   * Gets the parameter name
   *
   * @returns The parameter name used in function calls
   */
  get name() {
    return this._outputs[0].name;
  }
  set name(val: string) {
    if (val) {
      this._outputs[0].name = val;
    }
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * Serializes the parameter type and name. The type has an enumeration
   * constraint limited to valid shader types.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FunctionInputNode,
      name: 'FunctionInputNode',
      getProps() {
        return [
          {
            name: 'type',
            type: 'string',
            options: {
              enum: {
                labels: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'],
                values: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']
              }
            },
            get(this: FunctionInputNode, value) {
              value.str[0] = this._type;
            },
            set(this: FunctionInputNode, value) {
              this._type = value.str[0];
            }
          },
          {
            name: 'name',
            type: 'string',
            get(this: FunctionInputNode, value) {
              value.str[0] = this.name;
            },
            set(this: FunctionInputNode, value) {
              this.name = value.str[0];
              this.dispatchEvent('changed');
            }
          }
        ];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'FunctionInput'
   */
  toString() {
    return 'FunctionInput';
  }
  /**
   * Validates the node state
   *
   * @returns Empty string (always valid)
   *
   * @remarks
   * Function input nodes have no validation requirements as they
   * have no inputs and their type is explicitly set.
   */
  protected validate(): string {
    return '';
  }
  /**
   * Gets the output type
   *
   * @returns The parameter type
   */
  protected getType(): string {
    return this._type;
  }
}

/**
 * Function output value node
 *
 * @remarks
 * Represents an output value in a material function blueprint.
 * These nodes define what data the function returns to its caller.
 *
 * Each FunctionOutputNode:
 * - Has a name (output value name)
 * - Has one input that must be connected to compute the output value
 * - Automatically determines its type from the connected input
 * - Has no outputs (it provides its value to the calling context)
 *
 * When a FunctionCallNode is created, it scans for all FunctionOutputNodes
 * and creates corresponding output slots on the call node.
 *
 * A function can have multiple outputs to return different related values
 * (e.g., a noise function might return both noise value and derivative).
 *
 * @example
 * ```typescript
 * // In a function blueprint:
 * const resultOutput = new FunctionOutputNode();
 * resultOutput.name = 'result';
 * resultOutput.connectInput(1, computeNode, 1);
 *
 * const normalOutput = new FunctionOutputNode();
 * normalOutput.name = 'normal';
 * normalOutput.connectInput(1, normalNode, 1);
 *
 * // When called, the FunctionCallNode will have two outputs:
 * // - Output 1: result (type determined by computeNode)
 * // - Output 2: normal (type determined by normalNode)
 * ```
 *
 * @public
 */
export class FunctionOutputNode extends BaseGraphNode {
  /** Static counter for auto-generating unique output names */
  static outId = 1;
  /**
   * Creates a new function output node
   *
   * @remarks
   * Initializes with:
   * - Auto-generated name: out_N (where N is an incrementing counter)
   * - One input slot that accepts any standard shader type
   * - Type is inferred from the connected input node
   */
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: `out_${FunctionOutputNode.outId++}`,
        type: ['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4']
      }
    ];
  }
  /**
   * Gets the output value name
   *
   * @returns The output name used in function calls
   */
  get name() {
    return this._inputs[0].name;
  }
  set name(val: string) {
    if (val) {
      this._inputs[0].name = val;
    }
  }
  /**
   * Gets the output value type
   *
   * @returns The data type inferred from the connected input
   *
   * @remarks
   * This is a convenience accessor that calls getType().
   */
  get type() {
    return this.getType();
  }
  /**
   * Gets the serialization descriptor for this node type
   *
   * @returns Serialization class descriptor
   *
   * @remarks
   * Only serializes the output name. The type is inferred at runtime
   * from the connected input node.
   */
  static getSerializationCls(): SerializableClass {
    return {
      ctor: FunctionOutputNode,
      name: 'FunctionOutputNode',
      getProps() {
        return [
          {
            name: 'name',
            type: 'string',
            get(this: FunctionOutputNode, value) {
              value.str[0] = this.name;
            },
            set(this: FunctionOutputNode, value) {
              this.name = value.str[0];
              this.dispatchEvent('changed');
            }
          }
        ];
      }
    };
  }
  /**
   * Generates a string representation of this node
   *
   * @returns 'FunctionOutput'
   */
  toString() {
    return 'FunctionOutput';
  }
  /**
   * Validates the node state
   *
   * @returns Error message if invalid, empty string if valid
   *
   * @remarks
   * Ensures:
   * - The input is connected (function must return a value)
   * - The input type can be determined
   */
  protected validate(): string {
    if (!this._inputs[0].inputNode) {
      return 'Missing result';
    }
    const type = this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId);
    if (!type) {
      return 'Cannot determin result type';
    }
    return '';
  }
  /**
   * Gets the output type based on the connected input
   *
   * @returns The type from the connected input node, or empty string if not connected
   *
   * @remarks
   * The output type is dynamically determined by tracing back through
   * the connected input to find its source type. This allows functions
   * to work with multiple types without explicit type declarations.
   */
  protected getType(): string {
    return this._inputs[0].inputNode ? this._inputs[0].inputNode.getOutputType(this._inputs[0].inputId) : '';
  }
}
