import type { PBScope, ProgramBuilder, TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';
import { BaseGraphNode, BlueprintDAG, IGraphNode } from '../node';
import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../common/constants';
import { GenericConstructor } from '@zephyr3d/base';
import { BaseTextureNode, TextureSampleNode } from './texture';

abstract class IRExpression {
  protected ref: number;
  constructor() {
    this.ref = 0;
  }
  abstract create(pb: ProgramBuilder): number | PBShaderExp;
  addRef(): this {
    this.ref++;
    return this;
  }
  getTmpName(scope: PBScope) {
    let tmp = 0;
    while (true) {
      const name = `tmp${tmp++}`;
      if (!scope[name]) {
        return name;
      }
    }
  }
}

class IRConstantExpressionf extends IRExpression {
  readonly value: number;
  readonly name: string;
  constructor(value: number, paramName: string) {
    super();
    this.value = value;
    this.name = paramName;
  }
  create(pb: ProgramBuilder): number {
    if (this.name) {
      if (!pb.getGlobalScope()[this.name]) {
        pb.getGlobalScope()[this.name] = pb.float().uniform(2);
      }
      return pb.getGlobalScope()[this.name];
    }
    return this.value;
  }
}

class IRConstantExpressionfv extends IRExpression {
  readonly value: number[];
  readonly name: string;
  constructor(value: number[], paramName: string) {
    super();
    this.value = value;
    this.name = paramName;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.name) {
      if (!pb.getGlobalScope()[this.name]) {
        pb.getGlobalScope()[this.name] = pb[`vec${this.value.length}`]().uniform(2);
      }
      return pb.getGlobalScope()[this.name];
    }
    return Array.isArray(this.value) ? pb[`vec${this.value.length}`](...this.value) : this.value;
  }
}

class IRSampleTexture extends IRExpression {
  tex: IRConstantTexture;
  coord: IRExpression;
  lod: IRExpression;
  constructor(tex: IRConstantTexture, coord: IRExpression, lod: IRExpression) {
    super();
    this.tex = tex.addRef();
    this.coord = coord.addRef();
    this.lod = lod?.addRef() ?? null;
  }
  create(pb: ProgramBuilder): PBShaderExp {
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
    return this.lod === null
      ? pb.textureSample(tex, coordExp)
      : pb.textureSampleLevel(tex, coordExp, this.lod.create(pb) as number | PBShaderExp);
  }
}

class IRConstantTexture extends IRExpression {
  readonly name: string;
  readonly type: string;
  readonly addressU: TextureAddressMode;
  readonly addressV: TextureAddressMode;
  readonly filterMin: TextureFilterMode;
  readonly filterMag: TextureFilterMode;
  readonly filterMip: TextureFilterMode;
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
  create(pb: ProgramBuilder): PBShaderExp {
    if (!pb.getGlobalScope()[this.name]) {
      pb.getGlobalScope()[this.name] = pb[this.type]().uniform(2);
    }
    return pb.getGlobalScope()[this.name];
  }
}

class IRHash extends IRExpression {
  readonly src: IRExpression;
  readonly hash: string;
  exp: PBShaderExp | number;
  constructor(src: IRExpression, hash: string) {
    super();
    this.src = src.addRef();
    this.hash = hash;
    this.exp = null;
  }
  create(pb: ProgramBuilder): number | PBShaderExp {
    if (this.exp === null) {
      const src = this.src.create(pb);
      if (src instanceof PBShaderExp) {
        this.exp = src[this.hash];
      } else {
        if (this.hash.length === 1) {
          this.exp = src;
        } else {
          this.exp = pb[`vec${this.hash.length}`](src);
        }
      }
    }
    return this.exp;
  }
}

export class BlueprintMaterialIR {
  private _expressions: IRExpression[];
  private _expressionMap: Map<BaseGraphNode, number>;
  private _outputs: Record<string, number>;
  constructor() {
    this._expressions = [];
    this._expressionMap = new Map();
    this._outputs = {};
  }
  create(dag: BlueprintDAG) {
    for (const root of dag.roots) {
    }
  }
  processNode(node: IGraphNode) {
    if (node instanceof ConstantScalarNode) {
    }
  }
  ir(node: IGraphNode): IRExpression {
    if (node instanceof ConstantScalarNode) {
      return this.constantf(node);
    }
    if (
      node instanceof ConstantVec2Node ||
      node instanceof ConstantVec3Node ||
      node instanceof ConstantVec4Node
    ) {
      return this.constantfv(node);
    }
    if (node instanceof BaseTextureNode) {
      return this.constantTexture(node);
    }
    if (node instanceof TextureSampleNode) {
      return this.textureSample(node);
    }
    return null;
  }
  getOrCreateIRExpression<T extends GenericConstructor<IRExpression>, F extends ConstructorParameters<T>>(
    node: BaseGraphNode,
    ctor: T,
    ...args: F
  ): InstanceType<T> {
    if (!this._expressionMap.has(node)) {
      const ir = new ctor(...args);
      this._expressions.push(ir);
      this._expressionMap.set(node, this._expressions.length - 1);
      return ir as InstanceType<T>;
    }
    return this._expressions[this._expressionMap.get(node)] as InstanceType<T>;
  }
  constantf(node: ConstantScalarNode): IRConstantExpressionf {
    return this.getOrCreateIRExpression(node, IRConstantExpressionf, node.x, node.paramName);
  }
  constantfv(node: ConstantVec2Node | ConstantVec3Node | ConstantVec4Node): IRConstantExpressionfv {
    const value =
      node instanceof ConstantVec2Node
        ? [node.x, node.y]
        : node instanceof ConstantVec3Node
        ? [node.x, node.y, node.z]
        : [node.x, node.y, node.z, node.w];
    return this.getOrCreateIRExpression(node, IRConstantExpressionfv, value, node.paramName);
  }
  constantTexture(node: BaseTextureNode): IRConstantTexture {
    return this.getOrCreateIRExpression(
      node,
      IRConstantTexture,
      node.paramName,
      node.getOutputType(1),
      node.addressU,
      node.addressV,
      node.filterMin,
      node.filterMag,
      node.filterMip
    );
  }
  textureSample(node: TextureSampleNode): IRSampleTexture {
    const tex = this.ir(node.inputs[0].inputNode) as IRConstantTexture;
    const coord = this.ir(node.inputs[1].inputNode);
    const lod = this.ir(node.inputs[2].inputNode);
    return new IRSampleTexture(tex, coord, lod);
  }
  addOutput(src: number, name: string): void {
    this._outputs[name] = src;
  }
}
