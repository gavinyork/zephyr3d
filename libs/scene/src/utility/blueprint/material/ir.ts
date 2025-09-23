import type {
  BaseTexture,
  PBScope,
  ProgramBuilder,
  TextureAddressMode,
  TextureFilterMode,
  TextureSampler
} from '@zephyr3d/device';
import { PBShaderExp } from '@zephyr3d/device';
import type { BaseGraphNode, BlueprintDAG, IGraphNode } from '../node';
import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../common/constants';
import type { GenericConstructor } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { BaseTextureNode, TextureSampleNode } from './texture';
import { getDevice } from '../../../app/api';
import { GenericMathNode, MakeVectorNode } from '../common/math';

export type IRUniformValue = { name: string; value: Float32Array<ArrayBuffer> | number };
export type IRUniformTexture = {
  name: string;
  defaultTexture: DRef<BaseTexture>;
  sampler: DRef<TextureSampler>;
};

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
    for (;;) {
      const name = `tmp${tmp++}`;
      if (!scope[name]) {
        return name;
      }
    }
  }
  asUniformValue(): IRUniformValue {
    return null;
  }
  asUniformTexture(): IRUniformTexture {
    return null;
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
  asUniformValue(): IRUniformValue {
    return this.name
      ? {
          name: this.name,
          value: this.value
        }
      : null;
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
  asUniformValue(): IRUniformValue {
    return this.name ? { name: this.name, value: new Float32Array(this.value) } : null;
  }
}

class IRFunc extends IRExpression {
  readonly params: (number | IRExpression)[];
  readonly func: string;
  private tmpName: string;
  constructor(params: (number | IRExpression)[], func: string) {
    super();
    this.params = params.map((param) => (param instanceof IRExpression ? param.addRef() : param));
    this.func = func;
    this.tmpName = '';
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const exp = pb[this.func](
      ...this.params.map((param) => (param instanceof IRExpression ? param.create(pb) : param))
    );
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
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
  asUniformTexture(): IRUniformTexture {
    return {
      name: this.name,
      defaultTexture: new DRef(),
      sampler: new DRef(
        getDevice().createSampler({
          addressU: this.addressU,
          addressV: this.addressV,
          minFilter: this.filterMin,
          magFilter: this.filterMag,
          mipFilter: this.filterMip
        })
      )
    };
  }
}

export interface MaterialBlueprintIRBehaviors {
  useVertexColor: boolean;
  useVertexNormal: boolean;
  useVertexTangent: boolean;
}

export class MaterialBlueprintIR {
  private _dag: BlueprintDAG;
  private _hash: string;
  private _expressions: IRExpression[];
  private _expressionMap: Map<BaseGraphNode, number>;
  private _uniformValues: IRUniformValue[];
  private _uniformTextures: IRUniformTexture[];
  private _behaviors: MaterialBlueprintIRBehaviors;
  private _outputs: Record<string, IRExpression>;
  constructor(dag: BlueprintDAG, hash: string) {
    this._dag = dag;
    this._hash = hash;
    this.compile();
  }
  get ok() {
    return !!this._outputs;
  }
  get hash() {
    return this._hash;
  }
  get behaviors() {
    return this._behaviors;
  }
  get DAG() {
    return this._dag;
  }
  set DAG(dag: BlueprintDAG) {
    this._dag = dag;
  }
  get uniformValues() {
    return this._uniformValues;
  }
  get uniformTextures() {
    return this._uniformTextures;
  }
  compile(): boolean {
    this.reset();
    this._outputs = {};
    for (const root of this._dag.roots) {
      //const connections = this._dag.graph.incoming[root];
      const rootNode = this._dag.nodeMap[root];
      for (const input of rootNode.inputs) {
        const name = input.name;
        if (input.inputNode) {
          this._outputs[name] = this.ir(input.inputNode, input.inputId, input.originType).addRef();
        } else if (typeof input.defaultValue === 'number') {
          this._outputs[name] = new IRConstantf(input.defaultValue, '').addRef();
        } else if (Array.isArray(input.defaultValue)) {
          this._outputs[name] = new IRConstantfv(input.defaultValue, '').addRef();
        } else if (input.required) {
          this._outputs = null;
          return false;
        }
      }
    }
    return true;
  }
  create(pb: ProgramBuilder): Record<string, PBShaderExp | number> {
    if (!this._outputs) {
      return null;
    }
    const outputs: Record<string, PBShaderExp | number> = {};
    for (const k in this._outputs) {
      outputs[k] = this._outputs[k].create(pb);
    }
    return outputs;
  }
  private reset() {
    this._expressions = [];
    this._expressionMap = new Map();
    this._uniformTextures = [];
    this._uniformValues = [];
    this._outputs = null;
    this._behaviors = {
      useVertexColor: false,
      useVertexNormal: false,
      useVertexTangent: false
    };
  }
  private ir(node: IGraphNode, output: number, originType?: string): IRExpression {
    let expr: IRExpression = null;
    if (node instanceof ConstantScalarNode) {
      expr = this.constantf(node, output);
    } else if (
      node instanceof ConstantVec2Node ||
      node instanceof ConstantVec3Node ||
      node instanceof ConstantVec4Node
    ) {
      expr = this.constantfv(node, output);
    } else if (node instanceof BaseTextureNode) {
      expr = this.constantTexture(node, output);
    } else if (node instanceof TextureSampleNode) {
      expr = this.textureSample(node, output);
    } else if (node instanceof MakeVectorNode) {
      expr = this.makeVector(node, output);
    } else if (node instanceof GenericMathNode) {
      expr = this.func(node, output);
    }
    if (expr && originType) {
      const outputType = node.getOutputType(output);
      if (originType !== outputType) {
        if (originType === 'float') {
          if (outputType !== 'vec2' && outputType !== 'vec3' && outputType !== 'vec4') {
            throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
          }
          return new IRSwizzle(expr, 'x');
        } else if (outputType === 'float') {
          if (originType !== 'vec2' && originType !== 'vec3' && originType !== 'vec4') {
            throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
          }
          return new IRCast(expr, originType, 0);
        } else if (outputType === 'vec2' || outputType === 'vec3' || outputType === 'vec4') {
          const nOut = Number(outputType[outputType.length - 1]);
          const nOrg = Number(originType[originType.length - 1]);
          if (nOut > nOrg) {
            return new IRSwizzle(expr, 'xyzw'.slice(0, nOrg));
          } else {
            return new IRCast(expr, originType, nOrg - nOut);
          }
        } else {
          throw new Error(`Cannot cast type \`${outputType}\` to \`${originType}`);
        }
      }
    }

    return expr;
  }
  private getOrCreateIRExpression<
    T extends GenericConstructor<IRExpression>,
    F extends ConstructorParameters<T>
  >(node: BaseGraphNode, outputId: number, ctor: T, ...args: F): IRExpression {
    let ir: IRExpression;
    if (!this._expressionMap.has(node)) {
      ir = new ctor(...args);
      this._expressions.push(ir);
      this._expressionMap.set(node, this._expressions.length - 1);
      const uniformValue = ir.asUniformValue();
      if (uniformValue) {
        this._uniformValues.push(uniformValue);
      }
      const uniformTexture = ir.asUniformTexture();
      if (uniformTexture) {
        this._uniformTextures.push(uniformTexture);
      }
    } else {
      ir = this._expressions[this._expressionMap.get(node)] as InstanceType<T>;
    }
    if (!ir.outputs[outputId]) {
      const output = node.outputs.find((v) => v.id === outputId);
      ir.outputs[outputId] = ir;
      if (typeof output.cast === 'number') {
        ir.outputs[outputId] = new IRCast(ir, node.getOutputType(outputId), output.cast);
      }
      if (output.swizzle) {
        ir.outputs[outputId] = new IRSwizzle(ir.outputs[outputId], output.swizzle);
      }
    }
    return ir.outputs[outputId];
  }
  private makeVector(node: MakeVectorNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    const funcName = node.getOutputType(output);
    return this.getOrCreateIRExpression(node, output, IRFunc, params, funcName);
  }
  private func(node: GenericMathNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    const funcName = node.func;
    return this.getOrCreateIRExpression(node, output, IRFunc, params, funcName);
  }
  private constantf(node: ConstantScalarNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRConstantf, node.x, node.paramName);
  }
  private constantfv(
    node: ConstantVec2Node | ConstantVec3Node | ConstantVec4Node,
    output: number
  ): IRExpression {
    const value =
      node instanceof ConstantVec2Node
        ? [node.x, node.y]
        : node instanceof ConstantVec3Node
        ? [node.x, node.y, node.z]
        : [node.x, node.y, node.z, node.w];
    return this.getOrCreateIRExpression(node, output, IRConstantfv, value, node.paramName);
  }
  private constantTexture(node: BaseTextureNode, output: number): IRConstantTexture {
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
  private textureSample(node: TextureSampleNode, output: number): IRExpression {
    const tex = this.ir(node.inputs[0].inputNode, node.inputs[0].inputId) as IRConstantTexture;
    const coord = this.ir(node.inputs[1].inputNode, node.inputs[1].inputId);
    const lod = this.ir(node.inputs[2].inputNode, node.inputs[2].inputId);
    return this.getOrCreateIRExpression(node, output, IRSampleTexture, tex, coord, lod);
  }
}
