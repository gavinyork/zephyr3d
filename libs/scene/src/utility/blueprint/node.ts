import { Observable, type IEventTarget } from '@zephyr3d/base';

export interface NodeConnection {
  targetNodeId: number;
  startSlotId: number;
  endSlotId: number;
}

// Adjacency List
export interface GraphStructure {
  // Forward Adjacency List: nodeId -> Output links
  outgoing: Record<number, NodeConnection[]>;
  // Backward Adjacency List: nodeId -> Input links
  incoming: Record<number, NodeConnection[]>;
}

export interface BlueprintDAG {
  nodeMap: Record<number, IGraphNode>;
  roots: number[];
  graph: GraphStructure;
  order: number[];
}

export type GraphNodeInput = {
  id: number;
  name: string;
  type: string[];
  inputNode?: IGraphNode;
  inputId?: number;
};
export type GraphNodeOutput = {
  id: number;
  name: string;
  swizzle?: string;
  cast?: number;
};

export interface IGraphNode extends IEventTarget<{ changed: [] }> {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  readonly error: string;
  getOutputType(id: number): string;
  toString(): string;
  check(): void;
  reset(): void;
}

export abstract class BaseGraphNode extends Observable<{ changed: [] }> implements IGraphNode {
  protected _inputs: GraphNodeInput[];
  protected _outputs: GraphNodeOutput[];
  protected _error: string;
  constructor() {
    super();
    this._inputs = [];
    this._outputs = [];
    this._error = '';
  }
  getOutputType(id: number) {
    return this.getType(id);
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  get error() {
    return this._error;
  }
  toString() {
    return '';
  }
  check() {
    this._error = this.validate();
  }
  reset() {
    this._error = '';
  }
  setInput(id: number, node: BaseGraphNode, inputId: number) {
    const input = this._inputs.find((input) => input.id === id);
    if (!input) {
      throw new Error(`Input with id ${id} not found`);
    }
    input.inputNode = node;
    input.inputId = inputId;
  }
  protected abstract getType(_id?: number): string;
  protected abstract validate(): string;
}
