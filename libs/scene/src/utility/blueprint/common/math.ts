import { Observable } from '@zephyr3d/base';
import type { GraphNodeInput, GraphNodeOutput, IGraphNode } from '../node';

export class CompOpNode extends Observable<{ changed: [] }> implements IGraphNode {
  private _inputs: GraphNodeInput[];
  private _outputs: GraphNodeOutput[];
  private _op: string;
  constructor(op: string) {
    super();
    this._op = op;
    this._inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: 0
      },
      {
        id: 2,
        name: 'b',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: 0
      }
    ];
    this._outputs = [
      {
        id: 1,
        name: 'float',
        type: 'float'
      },
      {
        id: 2,
        name: 'vec2',
        type: 'vec2'
      },
      {
        id: 3,
        name: 'vec3',
        type: 'vec3'
      },
      {
        id: 4,
        name: 'vec4',
        type: 'vec4'
      }
    ];
  }
  get inputs() {
    return this._inputs;
  }
  get outputs() {
    return this._outputs;
  }
  toString() {
    return this._op;
  }
}

export class CompAddNode extends CompOpNode {
  constructor() {
    super('Add');
  }
}

export class CompSubtractNode extends CompOpNode {
  constructor() {
    super('Subtract');
  }
}

export class CompMultiplyNode extends CompOpNode {
  constructor() {
    super('Multiply');
  }
}

export class CompDivNode extends CompOpNode {
  constructor() {
    super('Div');
  }
}
