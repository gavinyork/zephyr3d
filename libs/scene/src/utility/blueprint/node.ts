import { Observable, type IEventTarget } from '@zephyr3d/base';

/** @internal */
export function getNodeTypeComponents(type: string) {
  switch (type) {
    case 'float':
    case 'bool':
      return 1;
    case 'vec2':
    case 'bvec2':
      return 2;
    case 'vec3':
    case 'bvec3':
      return 3;
    case 'vec4':
    case 'bvec4':
      return 4;
    default:
      return 0;
  }
}

/**
 * Represents a connection between two nodes
 *
 * @remarks
 * Defines the complete information for connecting from an output slot of one node
 * to an input slot of another node.
 *
 * @example
 * ```typescript
 * const connection: NodeConnection = {
 *   targetNodeId: 42,
 *   startSlotId: 0,  // Output slot of source node
 *   endSlotId: 1     // Input slot of target node
 * };
 * ```
 *
 * @public
 */
export interface NodeConnection {
  targetNodeId: number;
  startSlotId: number;
  endSlotId: number;
}

/**
 * Adjacency list representation of the graph structure
 *
 * @remarks
 * Uses forward and backward adjacency lists to efficiently store and query
 * connections between nodes:
 * - Forward adjacency list for finding all output connections from a node
 * - Backward adjacency list for finding all input connections to a node
 *
 * @public
 */
export interface GraphStructure {
  /**
   * Forward adjacency list: nodeId -\> all output connections from this node
   * @remarks Used to quickly find which nodes a given node connects to
   */
  outgoing: Record<number, NodeConnection[]>;
  /**
   * Backward adjacency list: nodeId -\> all input connections to this node
   * @remarks Used to quickly find which nodes provide data to a given node
   */
  incoming: Record<number, NodeConnection[]>;
}

/**
 * Complete representation of a Blueprint Directed Acyclic Graph (DAG)
 *
 * @remarks
 * Contains all structural information of the node graph:
 * - Node mapping table
 * - Root nodes list (nodes with no inputs)
 * - Graph structure (adjacency lists)
 * - Topological sort order (for executing nodes in dependency order)
 *
 * @example
 * ```typescript
 * const dag: BlueprintDAG = {
 *   nodeMap: { 1: node1, 2: node2, 3: node3 },
 *   roots: [1],  // node1 is a root node
 *   graph: { outgoing: {...}, incoming: {...} },
 *   order: [1, 2, 3]  // Topological sort result
 * };
 * ```
 *
 * @public
 */
export interface BlueprintDAG {
  /** Mapping from node ID to node instance */
  nodeMap: Record<number, IGraphNode>;
  /**
   * List of root node IDs
   * @remarks Root nodes are nodes with no input connections, typically constants or parameter nodes
   */
  roots: number[];
  /** The adjacency list structure of the graph */
  graph: GraphStructure;
  /**
   * Topological sort order of nodes
   * @remarks List of node IDs sorted by dependency relationships, used for correct execution order
   */
  order: number[];
}

/**
 * Input slot definition for a graph node
 *
 * @remarks
 * Describes an input connection point on a node, including its type constraints,
 * connected source node, default value, and validation requirements.
 *
 * @example
 * ```typescript
 * const input: GraphNodeInput = {
 *   id: 0,
 *   name: 'value',
 *   type: ['float', 'vec2', 'vec3'],  // Accepts multiple types
 *   required: true,
 *   defaultValue: 0.0
 * };
 * ```
 *
 * @public
 */
export type GraphNodeInput = {
  /** Unique identifier for this input slot */
  id: number;
  /** Display name of the input */
  name: string;
  /**
   * Array of accepted type names
   * @remarks Multiple types indicate the input can accept any of these types
   */
  type: string[];
  /**
   * The source node connected to this input
   * @remarks Undefined if no connection exists
   */
  inputNode?: IGraphNode;
  /**
   * The output slot ID of the connected source node
   * @remarks Only valid when inputNode is defined
   */
  inputId?: number;
  /**
   * Default value when no connection exists
   * @remarks Can be a single number or an array of numbers for vector types
   */
  defaultValue?: number[] | number;
  /**
   * Whether this input must be connected
   * @remarks If true, validation will fail if no connection exists
   * @defaultValue false
   */
  required?: boolean;
  /**
   * Original type name before any type casting
   * @remarks Used for tracking type conversions and compatibility checking
   */
  originType?: string;
};

/**
 * Output slot definition for a graph node
 *
 * @remarks
 * Describes an output connection point on a node, including optional swizzling
 * and type casting information.
 *
 * @example
 * ```typescript
 * const output: GraphNodeOutput = {
 *   id: 0,
 *   name: 'result',
 *   swizzle: 'xyz',  // Extract only xyz components from a vec4
 *   cast: 2          // Cast to type at index 2
 * };
 * ```
 *
 * @public
 */
export type GraphNodeOutput = {
  /** Unique identifier for this output slot */
  id: number;
  /** Display name of the output */
  name: string;
  /**
   * Swizzle mask for vector component extraction
   * @remarks E.g., 'xyz', 'xy', 'r', 'rgba' for accessing specific components
   * @example 'xyz' extracts first 3 components from vec4
   */
  swizzle?: string;
  /**
   * Type cast index
   * @remarks Index into a type array for automatic type conversion
   */
  cast?: number;
};

/**
 * Interface for a graph node in the material blueprint system
 *
 * @remarks
 * Defines the contract that all graph nodes must implement, including:
 * - Input and output slot management
 * - Type information retrieval
 * - Error state tracking
 * - Validation logic
 * - Change notification through events
 *
 * @example
 * ```typescript
 * class AddNode implements IGraphNode {
 *   readonly inputs = [
 *     { id: 0, name: 'a', type: ['float'] },
 *     { id: 1, name: 'b', type: ['float'] }
 *   ];
 *   readonly outputs = [
 *     { id: 0, name: 'result' }
 *   ];
 *   // ... implement other methods
 * }
 * ```
 *
 * @public
 */
export interface IGraphNode extends IEventTarget<{ changed: [] }> {
  /** Array of input slot definitions */
  readonly inputs: GraphNodeInput[];
  /** Array of output slot definitions */
  readonly outputs: GraphNodeOutput[];
  /** Whether this node has uniform value */
  isUniform: boolean;
  /** Uniform parameter name */
  paramName: string;
  /** Current error message, empty string if no error */
  error: string;
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns The type name of the output (e.g., 'float', 'vec3', 'mat4')
   *
   * @example
   * ```typescript
   * const outputType = node.getOutputType(0);  // 'vec3'
   * ```
   */
  getOutputType(id: number): string;
  /**
   * Generates a string representation of the node
   *
   * @remarks
   * Typically used for code generation or debugging purposes.
   * Should return valid shader code or a meaningful description.
   *
   * @returns String representation of the node's operation
   *
   * @example
   * ```typescript
   * node.toString();  // Returns: "float result = a + b;"
   * ```
   */
  toString(): string;
  /**
   * Validates the node's current state
   *
   * @remarks
   * Checks if all required inputs are connected and if type constraints are satisfied.
   * Sets the `error` property if validation fails.
   * Should be called after any connection changes.
   *
   * @example
   * ```typescript
   * node.check();
   * if (node.error) {
   *   console.error('Validation failed:', node.error);
   * }
   * ```
   */
  check(): void;
  /**
   * Resets the node's error state
   *
   * @remarks
   * Clears any error messages. Typically called before revalidation.
   */
  reset(): void;
}

/**
 * Abstract base class for graph nodes
 *
 * @remarks
 * Provides common functionality for all graph node types:
 * - Input/output slot storage
 * - Error state management
 * - Basic validation logic
 * - Change event emission
 *
 * Subclasses must implement:
 * - `getType()`: Define output type logic
 * - Optionally override `validate()` for custom validation
 * - Optionally override `toString()` for code generation
 *
 * @example
 * ```typescript
 * class MultiplyNode extends BaseGraphNode {
 *   constructor() {
 *     super();
 *     this._inputs = [
 *       { id: 0, name: 'a', type: ['float', 'vec2', 'vec3'], required: true },
 *       { id: 1, name: 'b', type: ['float', 'vec2', 'vec3'], required: true }
 *     ];
 *     this._outputs = [
 *       { id: 0, name: 'result' }
 *     ];
 *   }
 *
 *   protected getType(id?: number): string {
 *     // Return type based on input types
 *     return this._inputs[0].inputNode?.getOutputType(0) ?? 'float';
 *   }
 *
 *   toString(): string {
 *     return `${this.getType()} result = a * b;`;
 *   }
 * }
 * ```
 *
 * @public
 */
export abstract class BaseGraphNode extends Observable<{ changed: [] }> implements IGraphNode {
  /** Internal storage for input slot definitions */
  protected _inputs: GraphNodeInput[];
  /** Internal storage for output slot definitions */
  protected _outputs: GraphNodeOutput[];
  /** Internal storage for error message */
  protected _error: string;
  /**
   * Creates a new BaseGraphNode instance
   *
   * @remarks
   * Initializes empty input/output arrays and error state.
   * Subclasses should populate `_inputs` and `_outputs` in their constructor.
   */
  constructor() {
    super();
    this._inputs = [];
    this._outputs = [];
    this._error = '';
  }
  /**
   * Whether this node contains uniform value/texture
   */
  get isUniform() {
    return false;
  }
  /**
   * Uniform parameter name
   */
  get paramName() {
    return '';
  }
  /**
   * Gets the output type for a specific output slot
   *
   * @param id - The output slot ID
   * @returns The type name of the output
   *
   * @remarks
   * Default implementation delegates to the abstract `getType()` method.
   * Can be overridden for more complex type logic.
   */
  getOutputType(id: number) {
    return this.getType(id);
  }
  /** Gets the input slot definitions array */
  get inputs() {
    return this._inputs;
  }
  /** Gets the output slot definitions array */
  get outputs() {
    return this._outputs;
  }
  /** Gets the current error message */
  get error() {
    return this._error;
  }
  set error(str: string) {
    this._error = str;
  }
  /**
   * Generates a string representation of the node
   *
   * @returns Empty string by default
   *
   * @remarks
   * Subclasses should override this to return valid shader code
   * or a meaningful description of the node's operation.
   */
  toString() {
    return '';
  }
  /**
   * Validates the node and updates error state
   *
   * @remarks
   * Calls the `validate()` method and stores the result in `_error`.
   * Emits a 'changed' event if the error state changes.
   */
  check() {
    this._error = this.validate();
  }
  /**
   * Clears the error state
   *
   * @remarks
   * Sets `_error` to an empty string.
   */
  reset() {
    this._error = '';
  }
  /**
   * Connects an input slot to another node's output
   *
   * @param id - The input slot ID to connect
   * @param node - The source node to connect from
   * @param inputId - The output slot ID of the source node
   *
   * @throws Error if the input slot with the given ID doesn't exist
   *
   * @example
   * ```typescript
   * const addNode = new AddNode();
   * const constantNode = new ConstantNode(5.0);
   *
   * // Connect constantNode's output 0 to addNode's input 0
   * addNode.setInput(0, constantNode, 0);
   * ```
   */
  setInput(id: number, node: BaseGraphNode, inputId: number) {
    const input = this._inputs.find((input) => input.id === id);
    if (!input) {
      throw new Error(`Input with id ${id} not found`);
    }
    input.inputNode = node;
    input.inputId = inputId;
  }
  /**
   * Gets the type name for a specific output slot
   *
   * @param _id - The output slot ID (optional)
   * @returns The type name (e.g., 'float', 'vec3', 'mat4')
   *
   * @remarks
   * Must be implemented by subclasses to define type resolution logic.
   * The type may depend on connected input types.
   *
   * @example
   * ```typescript
   * protected getType(_id?: number): string {
   *   // Return type based on first input
   *   const inputType = this._inputs[0]?.inputNode?.getOutputType(this._inputs[0].inputId ?? 0);
   *   return inputType ?? 'float';
   * }
   * ```
   */
  protected abstract getType(_id?: number): string;
  /**
   * Validates the node's current state
   *
   * @returns Error message string, or empty string if valid
   *
   * @remarks
   * Default implementation checks if all required inputs are connected.
   * Subclasses can override to add custom validation logic like:
   * - Type compatibility checking
   * - Value range validation
   * - Configuration validation
   *
   * @example
   * ```typescript
   * protected validate(): string {
   *   const baseError = super.validate();
   *   if (baseError) return baseError;
   *
   *   // Custom validation
   *   const type1 = this._inputs[0].inputNode?.getOutputType(0);
   *   const type2 = this._inputs[1].inputNode?.getOutputType(0);
   *   if (type1 !== type2) {
   *     return 'Input types must match';
   *   }
   *
   *   return '';
   * }
   * ```
   */
  protected validate(): string {
    for (let i = 0; i < this._inputs.length; i++) {
      const input = this._inputs[i];
      if (input.required && !input.inputNode) {
        return `Missing required argument: input[${i}]`;
      }
      if (input.inputNode) {
        const type = this._inputs[i].inputNode.getOutputType(this._inputs[i].inputId);
        if (!type) {
          return `Cannot determine type of argument ${i}`;
        }
        if (!this._inputs[i].type.includes(type)) {
          return `Invalid input type ${type} for argument ${i}`;
        }
      }
    }
    return '';
  }
}
