import type { SerializableClass } from '../../serialization';
import { BaseGraphNode } from '../node';

export class MakeVectorNode extends BaseGraphNode {
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
  toString(): string {
    return 'MakeVector';
  }
  static getSerializationCls(): SerializableClass {
    return {
      ctor: MakeVectorNode,
      name: 'MakeVectorNode',
      getProps() {
        return [];
      }
    };
  }
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

export abstract class GenericMathNode extends BaseGraphNode {
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
  toString() {
    return this.func;
  }
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
