import { BaseGraphNode } from '../node';

export class DotProductNode extends BaseGraphNode {
  private _type: string;
  constructor(type: string) {
    super();
    this._type = type;
    this._inputs = [
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
    this._outputs = [
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
  protected getProps(): Record<string, unknown> {
    return {
      type: this._type
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['type'] === 'string') {
      this._type = props['type'];
    }
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

export class CrossProductNode extends BaseGraphNode {
  private _type: string;
  constructor(type: string) {
    super();
    this._type = type;
    this._inputs = [
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
    this._outputs = [
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
  protected getProps(): Record<string, unknown> {
    return {
      type: this._type
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['type'] === 'string') {
      this._type = props['type'];
    }
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

export class CompOpNode extends BaseGraphNode {
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
  toString() {
    return this._op;
  }
  protected getProps(): Record<string, unknown> {
    return {
      op: this._op
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['op'] === 'string') {
      this._op = props['op'];
    }
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

export class GenericMathNode1 extends BaseGraphNode {
  private _nodeName: string;
  constructor(nodeName: string) {
    super();
    this._nodeName = nodeName;
    this._inputs = [
      {
        id: 1,
        name: '',
        type: ['float', 'vec2', 'vec3', 'vec4']
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
  toString() {
    return this._nodeName;
  }
  protected getProps(): Record<string, unknown> {
    return {
      name: this._nodeName
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['name'] === 'string') {
      this._nodeName = props['name'];
    }
  }
}

export class GenericMathNode2 extends BaseGraphNode {
  private _nodeName: string;
  constructor(nodeName: string) {
    super();
    this._nodeName = nodeName;
    this._inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3', 'vec4']
      },
      {
        id: 2,
        name: 'b',
        type: ['float', 'vec2', 'vec3', 'vec4']
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
  toString() {
    return this._nodeName;
  }
  protected getProps(): Record<string, unknown> {
    return {
      name: this._nodeName
    };
  }
  protected setProps(props: Record<string, unknown>): void {
    if (props && typeof props['name'] === 'string') {
      this._nodeName = props['name'];
    }
  }
}

export class Degrees2RadiansNode extends GenericMathNode1 {
  constructor() {
    super('degrees2radians');
  }
}

export class Radians2DegreesNode extends GenericMathNode1 {
  constructor() {
    super('radians2degrees');
  }
}

export class SinNode extends GenericMathNode1 {
  constructor() {
    super('sin');
  }
}

export class CosNode extends GenericMathNode1 {
  constructor() {
    super('cos');
  }
}

export class TanNode extends GenericMathNode1 {
  constructor() {
    super('tan');
  }
}

export class ArcSinNode extends GenericMathNode1 {
  constructor() {
    super('asin');
  }
}

export class ArcCosNode extends GenericMathNode1 {
  constructor() {
    super('acos');
  }
}

export class ArcTanNode extends GenericMathNode1 {
  constructor() {
    super('atan');
  }
}

export class SinHNode extends GenericMathNode1 {
  constructor() {
    super('sinh');
  }
}

export class CosHNode extends GenericMathNode1 {
  constructor() {
    super('cosh');
  }
}

export class TanHNode extends GenericMathNode1 {
  constructor() {
    super('tanh');
  }
}

export class ArcsineHNode extends GenericMathNode1 {
  constructor() {
    super('asinh');
  }
}

export class ArccosineHNode extends GenericMathNode1 {
  constructor() {
    super('acosh');
  }
}

export class ArctangentHNode extends GenericMathNode1 {
  constructor() {
    super('atanh');
  }
}

export class ExpNode extends GenericMathNode1 {
  constructor() {
    super('exp');
  }
}

export class Exp2Node extends GenericMathNode1 {
  constructor() {
    super('exp2');
  }
}

export class LogNode extends GenericMathNode1 {
  constructor() {
    super('log');
  }
}

export class Log2Node extends GenericMathNode1 {
  constructor() {
    super('log2');
  }
}

export class SqrtNode extends GenericMathNode1 {
  constructor() {
    super('sqrt');
  }
}

export class InvSqrtNode extends GenericMathNode1 {
  constructor() {
    super('invSqrt');
  }
}

export class AbsNode extends GenericMathNode1 {
  constructor() {
    super('abs');
  }
}

export class SignNode extends GenericMathNode1 {
  constructor() {
    super('sign');
  }
}

export class FloorNode extends GenericMathNode1 {
  constructor() {
    super('floor');
  }
}

export class CeilNode extends GenericMathNode1 {
  constructor() {
    super('ceil');
  }
}

export class FractNode extends GenericMathNode1 {
  constructor() {
    super('fract');
  }
}

export class DDXNode extends GenericMathNode1 {
  constructor() {
    super('ddx');
  }
}

export class DDYNode extends GenericMathNode1 {
  constructor() {
    super('ddy');
  }
}

export class FWidthNode extends GenericMathNode1 {
  constructor() {
    super('fwidth');
  }
}

export class ModNode extends GenericMathNode2 {
  constructor() {
    super('mod');
  }
}

export class MinNode extends GenericMathNode2 {
  constructor() {
    super('min');
  }
}

export class MaxNode extends GenericMathNode2 {
  constructor() {
    super('max');
  }
}

export class StepNode extends GenericMathNode2 {
  constructor() {
    super('step');
  }
}
