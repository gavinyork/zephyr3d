import type {
  BaseTexture,
  PBInsideFunctionScope,
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
import { GenericMathNode, MakeVectorNode, TransformNode } from '../common/math';
import {
  InvProjMatrixNode,
  InvViewProjMatrixNode,
  ProjectionMatrixNode,
  ViewMatrixNode,
  ViewProjMatrixNode
} from './inputs';
import {
  CameraNearFarNode,
  CameraPositionNode,
  ElapsedTimeNode,
  SkyEnvTextureNode,
  VertexBinormalNode,
  VertexColorNode,
  VertexNormalNode,
  VertexPositionNode,
  VertexTangentNode,
  VertexUVNode
} from './inputs';
import { ShaderHelper } from '../../../material/shader/helper';
import { FunctionCallNode, FunctionInputNode, FunctionOutputNode } from './func';

export type IRUniformValue = { name: string; value: Float32Array<ArrayBuffer> | number; node: IGraphNode };
export type IRUniformTexture = {
  name: string;
  texture: DRef<BaseTexture>;
  sampler: DRef<TextureSampler>;
  node: IGraphNode;
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
  asUniformValue(_node: IGraphNode): IRUniformValue {
    return null;
  }
  asUniformTexture(_node: IGraphNode): IRUniformTexture {
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
  asUniformValue(node: IGraphNode): IRUniformValue {
    return this.name
      ? {
          name: this.name,
          value: this.value,
          node
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
  asUniformValue(node: IGraphNode): IRUniformValue {
    return this.name ? { name: this.name, value: new Float32Array(this.value), node } : null;
  }
}

class IRInput extends IRExpression {
  readonly func: string | ((scope: PBInsideFunctionScope) => PBShaderExp);
  constructor(func: string | ((scope: PBInsideFunctionScope) => PBShaderExp)) {
    super();
    this.func = func;
  }
  create(pb: ProgramBuilder): PBShaderExp {
    return typeof this.func === 'string' ? pb.getCurrentScope()[this.func] : this.func(pb.getCurrentScope());
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

class IRFunctionOutput extends IRExpression {
  private tmpName: string;
  private input: IRExpression | number;
  constructor(input: IRExpression | number) {
    super();
    this.input = input;
    this.tmpName = '';
  }
  create(pb: ProgramBuilder): PBShaderExp | number {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const exp = this.input instanceof IRExpression ? this.input.create(pb) : this.input;
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
  }
}

class IRCallFunc extends IRExpression {
  node: FunctionCallNode;
  args: IRExpression[];
  tmpName: string;
  constructor(node: FunctionCallNode, args: IRExpression[]) {
    super();
    this.node = node;
    this.args = args;
    this.tmpName = '';
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
    const that = this;
    const ir = this.node.IR;
    const params = this.node.args.map((v) => pb[v.type](v.name));
    pb.func(this.node.name, params, function () {
      const outputs = ir.create(pb);
      const rettype = pb.defineStruct(
        that.node.outputs.map((output, index) => {
          return pb[that.node.outs[index].type](output.swizzle);
        })
      );
      this.$return(
        rettype(
          ...outputs.map((output) => {
            return output.exp;
          })
        )
      );
    });
    const args = this.args.map((arg) => arg.create(pb));
    const exp = pb.getGlobalScope()[this.node.name](...args);
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
  samplerType: 'Color' | 'Normal';
  tmpName: string;
  constructor(tex: IRConstantTexture, coord: IRExpression, samplerType: 'Color' | 'Normal') {
    super();
    this.tex = tex.addRef();
    this.coord = coord.addRef();
    this.samplerType = samplerType;
    this.tmpName = '';
  }
  create(pb: ProgramBuilder): PBShaderExp {
    if (this.tmpName) {
      return pb.getCurrentScope()[this.tmpName];
    }
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
    let exp = pb.textureSample(tex, coordExp);
    if (this.samplerType === 'Normal') {
      exp = pb.sub(pb.mul(exp, pb.vec4(2, 2, 2, 1)), pb.vec4(1, 1, 1, 0));
    }
    if (this._ref === 1) {
      return exp;
    } else {
      this.tmpName = this.getTmpName(pb.getCurrentScope());
      pb.getCurrentScope()[this.tmpName] = exp;
      return pb.getCurrentScope()[this.tmpName];
    }
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
  asUniformTexture(node: BaseTextureNode): IRUniformTexture {
    return {
      name: this.name,
      texture: new DRef(node.texture.get()),
      sampler: new DRef(
        getDevice().createSampler({
          addressU: this.addressU,
          addressV: this.addressV,
          minFilter: this.filterMin,
          magFilter: this.filterMag,
          mipFilter: this.filterMip
        })
      ),
      node
    };
  }
}

export interface MaterialBlueprintIRBehaviors {
  useVertexColor: boolean;
  useVertexUV: boolean;
  useVertexTangent: boolean;
  useCameraPosition: boolean;
}

export class MaterialBlueprintIR {
  private _dag: BlueprintDAG;
  private _hash: string;
  private _expressions: IRExpression[];
  private _expressionMap: Map<BaseGraphNode, number>;
  private _uniformValues: IRUniformValue[];
  private _uniformTextures: IRUniformTexture[];
  private _behaviors: MaterialBlueprintIRBehaviors;
  private _outputs: { name: string; expr: IRExpression }[];
  constructor(dag: BlueprintDAG, hash: string) {
    this._dag = dag ?? {
      nodeMap: {},
      roots: [],
      graph: {
        outgoing: {},
        incoming: {}
      },
      order: []
    };
    this._hash = hash;
    this.compile();
  }
  get ok() {
    return this._outputs?.length > 0;
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
    this._outputs = [];
    for (const root of this._dag.roots) {
      const rootNode = this._dag.nodeMap[root];
      for (const input of rootNode.inputs) {
        const name = input.name;
        if (input.inputNode) {
          this._outputs.push({
            name,
            expr: this.ir(input.inputNode, input.inputId, input.originType).addRef()
          });
        } else if (typeof input.defaultValue === 'number') {
          this._outputs.push({
            name,
            expr: new IRConstantf(input.defaultValue, '').addRef()
          });
        } else if (Array.isArray(input.defaultValue)) {
          this._outputs.push({
            name,
            expr: new IRConstantfv(input.defaultValue, '').addRef()
          });
        } else if (input.required) {
          this._outputs = null;
          return false;
        }
      }
    }
    return true;
  }
  create(pb: ProgramBuilder): { name: string; exp: PBShaderExp | number }[] {
    if (!this._outputs) {
      return null;
    }
    const outputs: { name: string; exp: PBShaderExp | number }[] = [];
    for (const output of this._outputs) {
      outputs.push({ name: output.name, exp: output.expr.create(pb) });
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
      useVertexUV: false,
      useVertexTangent: false,
      useCameraPosition: false
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
    } else if (node instanceof TransformNode) {
      expr = this.transform(node, output);
    } else if (node instanceof VertexColorNode) {
      expr = this.vertexColor(node, output);
    } else if (node instanceof VertexUVNode) {
      expr = this.vertexUV(node, output);
    } else if (node instanceof VertexPositionNode) {
      expr = this.vertexPosition(node, output);
    } else if (node instanceof VertexNormalNode) {
      expr = this.vertexNormal(node, output);
    } else if (node instanceof VertexTangentNode) {
      expr = this.vertexTangent(node, output);
    } else if (node instanceof VertexBinormalNode) {
      expr = this.vertexBinormal(node, output);
    } else if (node instanceof ViewMatrixNode) {
      expr = this.viewMatrix(node, output);
    } else if (node instanceof ProjectionMatrixNode) {
      expr = this.projectionMatrix(node, output);
    } else if (node instanceof ViewProjMatrixNode) {
      expr = this.viewProjectionMatrix(node, output);
    } else if (node instanceof InvProjMatrixNode) {
      expr = this.invProjectionMatrix(node, output);
    } else if (node instanceof InvViewProjMatrixNode) {
      expr = this.invViewProjectionMatrix(node, output);
    } else if (node instanceof CameraPositionNode) {
      expr = this.cameraPosition(node, output);
    } else if (node instanceof CameraNearFarNode) {
      expr = this.cameraNearFar(node, output);
    } else if (node instanceof SkyEnvTextureNode) {
      expr = this.skyEnvTexture(node, output);
    } else if (node instanceof ElapsedTimeNode) {
      expr = this.elapsedTime(node, output);
    } else if (node instanceof FunctionCallNode) {
      expr = this.functionCall(node, output);
    } else if (node instanceof FunctionInputNode) {
      expr = this.functionInput(node, output);
    } else if (node instanceof FunctionOutputNode) {
      expr = this.functionOutput(node, output);
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
      const uniformValue = ir.asUniformValue(node);
      if (uniformValue) {
        this._uniformValues.push(uniformValue);
      }
      const uniformTexture = ir.asUniformTexture(node);
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
  private transform(node: TransformNode, output: number): IRExpression {
    const params: IRExpression[] = [];
    for (const input of node.inputs) {
      if (input.inputNode) {
        params.push(this.ir(input.inputNode, input.inputId, input.originType));
      }
    }
    return this.getOrCreateIRExpression(node, output, IRFunc, params, 'mul');
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
  private functionOutput(node: FunctionOutputNode, output: number): IRExpression {
    const input = this.ir(node.inputs[0].inputNode, node.inputs[0].inputId, node.inputs[0].originType);
    return this.getOrCreateIRExpression(node, output, IRFunctionOutput, input);
  }
  private vertexColor(node: VertexColorNode, output: number): IRExpression {
    this._behaviors.useVertexColor = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexColor');
  }
  private vertexUV(node: VertexUVNode, output: number): IRExpression {
    this._behaviors.useVertexUV = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexUV');
  }
  private vertexNormal(node: VertexNormalNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexNormal');
  }
  private vertexTangent(node: VertexTangentNode, output: number): IRExpression {
    this._behaviors.useVertexTangent = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexTangent');
  }
  private vertexBinormal(node: VertexBinormalNode, output: number): IRExpression {
    this._behaviors.useVertexTangent = true;
    return this.getOrCreateIRExpression(node, output, IRInput, 'zVertexBinormal');
  }
  private vertexPosition(node: VertexPositionNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, 'zWorldPos');
  }
  private viewMatrix(node: ViewMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getViewMatrix(scope)
    );
  }
  private projectionMatrix(node: ProjectionMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getProjectionMatrix(scope)
    );
  }
  private viewProjectionMatrix(node: ViewProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getViewProjectionMatrix(scope)
    );
  }
  private invProjectionMatrix(node: InvProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getInvProjectionMatrix(scope)
    );
  }
  private invViewProjectionMatrix(node: InvViewProjMatrixNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getInvViewProjectionMatrix(scope)
    );
  }
  private cameraPosition(node: CameraPositionNode, output: number): IRExpression {
    this._behaviors.useCameraPosition = true;
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getCameraPosition(scope)
    );
  }
  private cameraNearFar(node: CameraNearFarNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(
      node,
      output,
      IRInput,
      (scope: PBInsideFunctionScope) => ShaderHelper.getCameraParams(scope).xy
    );
  }
  private skyEnvTexture(node: SkyEnvTextureNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getBakedSkyTexture(scope)
    );
  }
  private elapsedTime(node: ElapsedTimeNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(node, output, IRInput, (scope: PBInsideFunctionScope) =>
      ShaderHelper.getElapsedTime(scope)
    );
  }
  private functionInput(node: FunctionInputNode, output: number): IRExpression {
    return this.getOrCreateIRExpression(
      node,
      output,
      IRInput,
      (scope: PBInsideFunctionScope) => scope[node.name]
    );
  }
  private functionCall(node: FunctionCallNode, output: number): IRExpression {
    const args = node.inputs.map((input) => {
      return this.ir(input.inputNode, input.inputId, input.originType);
    });
    return this.getOrCreateIRExpression(node, output, IRCallFunc, node, args);
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
    return this.getOrCreateIRExpression(node, output, IRSampleTexture, tex, coord, node.samplerType);
  }
}
