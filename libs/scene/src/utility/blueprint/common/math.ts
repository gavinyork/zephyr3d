import { Observable } from '@zephyr3d/base';
import type { GraphNodeInput, GraphNodeOutput, IGraphNode } from '../node';

export class DotProductNode extends Observable<{ changed: [] }> implements IGraphNode {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  private _type: 'vec2' | 'vec3' | 'vec4';
  constructor(type: 'vec2' | 'vec3' | 'vec4') {
    super();
    this._type = type;
    this.inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      },
      {
        id: 2,
        name: 'b',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      }
    ];
    this.outputs = [
      {
        id: 1,
        name: 'float',
        type: 'float'
      }
    ];
  }
  toString() {
    return `DotProduct${this._type[3]}`;
  }
}

export class DotProduct2Node extends DotProductNode {
  constructor() {
    super('vec2');
  }
}

export class DotProduct3Node extends DotProductNode {
  constructor() {
    super('vec3');
  }
}

export class DotProduct4Node extends DotProductNode {
  constructor() {
    super('vec4');
  }
}

export class CrossProductNode extends Observable<{ changed: [] }> implements IGraphNode {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  private _type: 'vec2' | 'vec3' | 'vec4';
  constructor(type: 'vec2' | 'vec3' | 'vec4') {
    super();
    this._type = type;
    this.inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      },
      {
        id: 2,
        name: 'b',
        type: ['float', 'vec2', 'vec3', 'vec4'],
        value: [1, 1, 1, 1]
      }
    ];
    this.outputs = [
      {
        id: 1,
        name: this._type,
        type: this._type
      }
    ];
  }
  toString() {
    return `CrossProduct${this._type[3]}`;
  }
}

export class CrossProduct2Node extends CrossProductNode {
  constructor() {
    super('vec2');
  }
}

export class CrossProduct3Node extends CrossProductNode {
  constructor() {
    super('vec3');
  }
}

export class CompOpNode extends Observable<{ changed: [] }> implements IGraphNode {
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  private _op: string;
  constructor(op: string) {
    super();
    this._op = op;
    this.inputs = [
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
    this.outputs = [
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

export class GenericMathNode1 extends Observable<{ changed: [] }> implements IGraphNode {
  private _inputName: string;
  private _nodeName: string;
  readonly inputs: GraphNodeInput[];
  readonly outputs: GraphNodeOutput[];
  constructor(nodeName: string, inputName: string) {
    super();
    this._inputName = inputName;
    this._nodeName = nodeName;
    this.inputs = [
      {
        id: 1,
        name: this._inputName,
        type: ['float', 'vec2', 'vec3', 'vec4']
      }
    ];
    this.outputs = [
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
  toString() {
    return this._nodeName;
  }
}

export class Degrees2RadiansNode extends GenericMathNode1 {
  constructor() {
    super('DegreesToRadians', 'degrees');
  }
}

export class Radians2DegreesNode extends GenericMathNode1 {
  constructor() {
    super('RadiansToDegrees', 'radians');
  }
}

export class SinNode extends GenericMathNode1 {
  constructor() {
    super('Sine', 'value');
  }
}

export class CosNode extends GenericMathNode1 {
  constructor() {
    super('Cosine', 'value');
  }
}

export class TanNode extends GenericMathNode1 {
  constructor() {
    super('Tangent', 'value');
  }
}

export class ArcSinNode extends GenericMathNode1 {
  constructor() {
    super('Arcsine', 'value');
  }
}

export class ArcCosNode extends GenericMathNode1 {
  constructor() {
    super('Arccosine', 'value');
  }
}

export class ArcTanNode extends GenericMathNode1 {
  constructor() {
    super('Arctangent', 'value');
  }
}

export class SinHNode extends GenericMathNode1 {
  constructor() {
    super('Hypsine', 'value');
  }
}

export class CosHNode extends GenericMathNode1 {
  constructor() {
    super('Hypcosine', 'value');
  }
}

export class TanHNode extends GenericMathNode1 {
  constructor() {
    super('Hyptangent', 'value');
  }
}

export class ArcsineHNode extends GenericMathNode1 {
  constructor() {
    super('Hyparcsine', 'value');
  }
}

export class ArccosineHNode extends GenericMathNode1 {
  constructor() {
    super('Hyparccosine', 'value');
  }
}
