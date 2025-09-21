import { BaseGraphNode } from '../node';

export class MakeVectorNode extends BaseGraphNode {
  constructor() {
    super();
    this._inputs = [
      {
        id: 1,
        name: 'a',
        type: ['float', 'vec2', 'vec3']
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
  toString(): string {
    return 'MakeVector';
  }
  protected validate(): string {
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

export class GenericMathNode extends BaseGraphNode {
  readonly func: string;
  readonly outType: string;
  readonly explicitInTypes: Record<number, string[]>;
  readonly additionalInTypes: Record<number, string[]>;
  constructor(
    func: string,
    numArgs: number,
    outType?: string,
    inTypes?: string[],
    explicitInTypes?: Record<number, string[]>,
    additionalInTypes?: Record<number, string[]>
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
      ]
    }));
    this._outputs = [
      {
        id: 1,
        name: ''
      }
    ];
  }
  toString() {
    return this.func;
  }
  validate() {
    let type: string = '';
    for (let i = 0; i < this._inputs.length; i++) {
      const name = 'abcdefghijklmn'[i];
      if (!this._inputs[i].inputNode) {
        return `Missing argument \`${name}\``;
      }
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
        if (type && t !== type) {
          return '';
        } else {
          type = t;
        }
      }
    }
    return type;
  }
}

export class Degrees2RadiansNode extends GenericMathNode {
  constructor() {
    super('degrees2radians', 1);
  }
}

export class Radians2DegreesNode extends GenericMathNode {
  constructor() {
    super('radians2degrees', 1);
  }
}

export class SinNode extends GenericMathNode {
  constructor() {
    super('sin', 1);
  }
}

export class CosNode extends GenericMathNode {
  constructor() {
    super('cos', 1);
  }
}

export class TanNode extends GenericMathNode {
  constructor() {
    super('tan', 1);
  }
}

export class ArcSinNode extends GenericMathNode {
  constructor() {
    super('asin', 1);
  }
}

export class ArcCosNode extends GenericMathNode {
  constructor() {
    super('acos', 1);
  }
}

export class ArcTanNode extends GenericMathNode {
  constructor() {
    super('atan', 1);
  }
}

export class ArcTan2Node extends GenericMathNode {
  constructor() {
    super('atan2', 2);
  }
}

export class SinHNode extends GenericMathNode {
  constructor() {
    super('sinh', 1);
  }
}

export class CosHNode extends GenericMathNode {
  constructor() {
    super('cosh', 1);
  }
}

export class TanHNode extends GenericMathNode {
  constructor() {
    super('tanh', 1);
  }
}

export class ArcsineHNode extends GenericMathNode {
  constructor() {
    super('asinh', 1);
  }
}

export class ArccosineHNode extends GenericMathNode {
  constructor() {
    super('acosh', 1);
  }
}

export class ArctangentHNode extends GenericMathNode {
  constructor() {
    super('atanh', 1);
  }
}

export class ExpNode extends GenericMathNode {
  constructor() {
    super('exp', 1);
  }
}

export class Exp2Node extends GenericMathNode {
  constructor() {
    super('exp2', 1);
  }
}

export class LogNode extends GenericMathNode {
  constructor() {
    super('log', 1);
  }
}

export class Log2Node extends GenericMathNode {
  constructor() {
    super('log2', 1);
  }
}

export class SqrtNode extends GenericMathNode {
  constructor() {
    super('sqrt', 1);
  }
}

export class InvSqrtNode extends GenericMathNode {
  constructor() {
    super('inverseSqrt', 1);
  }
}

export class AbsNode extends GenericMathNode {
  constructor() {
    super('abs', 1);
  }
}

export class SignNode extends GenericMathNode {
  constructor() {
    super('sign', 1);
  }
}

export class FloorNode extends GenericMathNode {
  constructor() {
    super('floor', 1);
  }
}

export class CeilNode extends GenericMathNode {
  constructor() {
    super('ceil', 1);
  }
}

export class FractNode extends GenericMathNode {
  constructor() {
    super('fract', 1);
  }
}

export class DDXNode extends GenericMathNode {
  constructor() {
    super('dpdx', 1);
  }
}

export class DDYNode extends GenericMathNode {
  constructor() {
    super('dpdy', 1);
  }
}

export class FWidthNode extends GenericMathNode {
  constructor() {
    super('fwidth', 1);
  }
}

export class CompAddNode extends GenericMathNode {
  constructor() {
    super('add', 2);
  }
}
export class CompSubNode extends GenericMathNode {
  constructor() {
    super('sub', 2);
  }
}
export class CompMulNode extends GenericMathNode {
  constructor() {
    super('mul', 2);
  }
}
export class CompDivNode extends GenericMathNode {
  constructor() {
    super('div', 2);
  }
}

export class ModNode extends GenericMathNode {
  constructor() {
    super('mod', 2);
  }
}

export class MinNode extends GenericMathNode {
  constructor() {
    super('min', 2);
  }
}

export class MaxNode extends GenericMathNode {
  constructor() {
    super('max', 2);
  }
}

export class PowNode extends GenericMathNode {
  constructor() {
    super('pow', 2);
  }
}
export class StepNode extends GenericMathNode {
  constructor() {
    super('step', 2);
  }
}

export class FmaNode extends GenericMathNode {
  constructor() {
    super('fma', 3);
  }
}

export class ClampNode extends GenericMathNode {
  constructor() {
    super('clamp', 3);
  }
}

export class MixNode extends GenericMathNode {
  constructor() {
    super('mix', 3, null, null, { '2': ['float'] });
  }
}

export class NormalizeNode extends GenericMathNode {
  constructor() {
    super('normalize', 1, null, ['vec2', 'vec3', 'vec4']);
  }
}

export class FaceForwardNode extends GenericMathNode {
  constructor() {
    super('faceForward', 3, null, ['vec2', 'vec3']);
  }
}

export class ReflectNode extends GenericMathNode {
  constructor() {
    super('reflect', 2, null, ['vec2', 'vec3']);
  }
}

export class RefractNode extends GenericMathNode {
  constructor() {
    super('refract', 3, null, ['vec2', 'vec3'], { '2': ['float'] });
  }
}

export class LengthNode extends GenericMathNode {
  constructor() {
    super('length', 1, 'float');
  }
}

export class DistanceNode extends GenericMathNode {
  constructor() {
    super('distance', 2, 'float');
  }
}

export class DotProductNode extends GenericMathNode {
  constructor() {
    super('dot', 2, 'float', ['vec2', 'vec3', 'vec4']);
  }
}

export class CrossProductNode extends GenericMathNode {
  constructor() {
    super('cross', 2, null, ['vec3']);
  }
}
