import type { PBScope, ProgramBuilder, TextureAddressMode, TextureFilterMode } from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';
import type { BaseGraphNode, BlueprintDAG, IGraphNode } from '../node';
import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../common/constants';
import type { GenericConstructor } from '@zephyr3d/base';
import { BaseTextureNode, TextureSampleNode } from './texture';

abstract class IRExpression {
  protected _ref: number;
  protected _outputs: IRExpression[];
  constructor() {
    this._ref = 0;
    this._outputs = [];
  }
  abstract create(pb: ProgramBuilder): number | PBShaderExp;
  get outputs() {
    return this._outputs;
  }
  addRef(): this {
    this._ref++;
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

class IRConstantf extends IRExpression {
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

class IRConstantfv extends IRExpression {
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

class IRSwizzle extends IRExpression {
  readonly src: IRExpression;
  readonly hash: string;
  constructor(src: IRExpression, hash: string) {
    super();
    this.src = src.addRef();
    this.hash = hash;
  }
  create(pb: ProgramBuilder): number | PBShaderExp {
    const src = this.src.create(pb);
    return typeof src === 'number' ? pb[`vec${this.hash.length}`](src) : src[this.hash];
  }
}

class IRCast extends IRExpression {
  readonly src: IRExpression;
  readonly type: string;
  readonly cast: number;
  constructor(src: IRExpression, type: string, cast: number) {
    super();
    this.src = src.addRef();
    this.cast = cast;
    this.type = type;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    return pb[this.type](this.src.create(pb), ...Array.from({ length: this.cast }).fill(0));
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

export class MaterialBlueprintIR {
  private _expressions: IRExpression[];
  private _expressionMap: Map<BaseGraphNode, number>;
  private _outputs: Record<string, PBShaderExp | number>;
  constructor() {
    this._expressions = [];
    this._expressionMap = new Map();
    this._outputs = {};
  }
  create(pb: ProgramBuilder, dag: BlueprintDAG) {
    const irMap: Record<string, IRExpression> = {};
    for (const root of dag.roots) {
      const connections = dag.graph.incoming[root];
      const rootNode = dag.nodeMap[root];
      for (const conn of connections) {
        const name = rootNode.inputs[conn.endSlotId].name;
        irMap[name] = this.ir(dag.nodeMap[conn.targetNodeId], conn.startSlotId);
      }
    }
    for (const k in irMap) {
      this._outputs[k] = irMap[k].create(pb);
    }
  }
  processNode(node: IGraphNode) {
    if (node instanceof ConstantScalarNode) {
    }
  }
  ir(node: IGraphNode, output: number): IRExpression {
    if (node instanceof ConstantScalarNode) {
      return this.constantf(node, output);
    }
    if (
      node instanceof ConstantVec2Node ||
      node instanceof ConstantVec3Node ||
      node instanceof ConstantVec4Node
    ) {
      return this.constantfv(node, output);
    }
    if (node instanceof BaseTextureNode) {
      return this.constantTexture(node, output);
    }
    if (node instanceof TextureSampleNode) {
      return this.textureSample(node, output);
    }
    return null;
  }
  getOrCreateIRExpression<T extends GenericConstructor<IRExpression>, F extends ConstructorParameters<T>>(
    node: BaseGraphNode,
    outputId: number,
    ctor: T,
    ...args: F
  ): IRExpression {
    let ir: IRExpression;
    if (!this._expressionMap.has(node)) {
      ir = new ctor(...args);
      this._expressions.push(ir);
      this._expressionMap.set(node, this._expressions.length - 1);
    } else {
      ir = this._expressions[this._expressionMap.get(node)] as InstanceType<T>;
    }
    if (!ir.outputs[outputId]) {
      const output = node.outputs[outputId];
      let outputIR: IRExpression = null;
      if (typeof output.cast === 'number') {
        outputIR = new IRCast(ir, node.getOutputType(outputId), output.cast);
      }
      if (output.swizzle) {
        outputIR = new IRSwizzle(outputIR, output.swizzle);
      }
      ir.outputs[outputId] = outputIR ?? ir;
    }
    return ir.outputs[outputId];
  }
  constantf(node: ConstantScalarNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRConstantf, node.x, node.paramName);
  }
  constantfv(node: ConstantVec2Node | ConstantVec3Node | ConstantVec4Node, output: number): IRExpression {
    const value =
      node instanceof ConstantVec2Node
        ? [node.x, node.y]
        : node instanceof ConstantVec3Node
        ? [node.x, node.y, node.z]
        : [node.x, node.y, node.z, node.w];
    return this.getOrCreateIRExpression(node, output, IRConstantfv, value, node.paramName);
  }
  constantTexture(node: BaseTextureNode, output: number): IRConstantTexture {
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
  textureSample(node: TextureSampleNode, output: number): IRExpression {
    const tex = this.ir(node.inputs[0].inputNode, node.inputs[0].inputId) as IRConstantTexture;
    const coord = this.ir(node.inputs[1].inputNode, node.inputs[1].inputId);
    const lod = this.ir(node.inputs[2].inputNode, node.inputs[2].inputId);
    return this.getOrCreateIRExpression(node, output, IRSampleTexture, tex, coord, lod);
  }
  addOutput(src: number, name: string): void {
    this._outputs[name] = src;
  }
}
