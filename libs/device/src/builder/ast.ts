import { ShaderType } from '../base_types';
import { semanticToAttrib } from '../gpuobject';
import type {
  TypeDetailInfo,
  PBTextureTypeInfo,
  PBTypeInfo,
  PBFunctionTypeInfo,
  PBStructTypeInfo
} from './types';
import {
  typeI32,
  typeU32,
  typeF32,
  typeBool,
  PBPrimitiveType,
  PBPrimitiveTypeInfo,
  PBTextureType,
  PBAddressSpace,
  PBPointerTypeInfo,
  typeVoid
} from './types';
import * as errors from './errors';
import type { PBGlobalScope } from './programbuilder';
import type { PBShaderExp } from './base';

const BuiltinInputStructNameVS = 'zVSInput';
const BuiltinOutputStructNameVS = 'zVSOutput';
const BuiltinInputStructNameFS = 'zFSInput';
const BuiltinOutputStructNameFS = 'zFSOutput';
const BuiltinInputStructNameCS = 'zCSInput';
const BuiltinOutputStructNameCS = 'zCSOutput';

const BuiltinParamNameVS = 'zVertexInput';
const BuiltinParamNameFS = 'zVertexOutput';
const BuiltinParamNameCS = 'zComputeInput';

const BuiltinInputStructInstanceNameVS = 'zVSInputCpy';
const BuiltinOutputStructInstanceNameVS = 'zVSOutputCpy';
const BuiltinInputStructInstanceNameFS = 'zFSInputCpy';
const BuiltinOutputStructInstanceNameFS = 'zFSOutputCpy';
const BuiltinInputStructInstanceNameCS = 'zCSInputCpy';
const BuiltinOutputStructInstanceNameCS = 'zCSOutputCpy';

/** @internal */
export enum DeclareType {
  DECLARE_TYPE_NONE = 0,
  DECLARE_TYPE_IN,
  DECLARE_TYPE_OUT,
  DECLARE_TYPE_WORKGROUP,
  DECLARE_TYPE_UNIFORM,
  DECLARE_TYPE_STORAGE
}

/** @internal */
export enum ShaderPrecisionType {
  NONE = 0,
  HIGH,
  MEDIUM,
  LOW
}

/** @internal */
export function getBuiltinParamName(shaderType: ShaderType) {
  switch (shaderType) {
    case ShaderType.Vertex:
      return BuiltinParamNameVS;
    case ShaderType.Fragment:
      return BuiltinParamNameFS;
    case ShaderType.Compute:
      return BuiltinParamNameCS;
    default:
      return null;
  }
}

/** @internal */
export function getBuiltinInputStructInstanceName(shaderType: ShaderType) {
  switch (shaderType) {
    case ShaderType.Vertex:
      return BuiltinInputStructInstanceNameVS;
    case ShaderType.Fragment:
      return BuiltinInputStructInstanceNameFS;
    case ShaderType.Compute:
      return BuiltinInputStructInstanceNameCS;
    default:
      return null;
  }
}

/** @internal */
export function getBuiltinOutputStructInstanceName(shaderType: ShaderType) {
  switch (shaderType) {
    case ShaderType.Vertex:
      return BuiltinOutputStructInstanceNameVS;
    case ShaderType.Fragment:
      return BuiltinOutputStructInstanceNameFS;
    case ShaderType.Compute:
      return BuiltinOutputStructInstanceNameCS;
    default:
      return null;
  }
}

/** @internal */
export function getBuiltinInputStructName(shaderType: ShaderType) {
  switch (shaderType) {
    case ShaderType.Vertex:
      return BuiltinInputStructNameVS;
    case ShaderType.Fragment:
      return BuiltinInputStructNameFS;
    case ShaderType.Compute:
      return BuiltinInputStructNameCS;
    default:
      return null;
  }
}

/** @internal */
export function getBuiltinOutputStructName(shaderType: ShaderType) {
  switch (shaderType) {
    case ShaderType.Vertex:
      return BuiltinOutputStructNameVS;
    case ShaderType.Fragment:
      return BuiltinOutputStructNameFS;
    case ShaderType.Compute:
      return BuiltinOutputStructNameCS;
    default:
      return null;
  }
}

/** @internal */
export function getTextureSampleType(type: PBTextureTypeInfo): PBPrimitiveTypeInfo {
  switch (type.textureType) {
    case PBTextureType.TEX_1D:
    case PBTextureType.TEX_STORAGE_1D:
    case PBTextureType.TEX_2D:
    case PBTextureType.TEX_STORAGE_2D:
    case PBTextureType.TEX_2D_ARRAY:
    case PBTextureType.TEX_STORAGE_2D_ARRAY:
    case PBTextureType.TEX_3D:
    case PBTextureType.TEX_STORAGE_3D:
    case PBTextureType.TEX_CUBE:
    case PBTextureType.TEX_EXTERNAL:
      return new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4);
    case PBTextureType.TEX_DEPTH_2D_ARRAY:
    case PBTextureType.TEX_DEPTH_2D:
    case PBTextureType.TEX_DEPTH_CUBE:
      return new PBPrimitiveTypeInfo(PBPrimitiveType.F32);
    case PBTextureType.ITEX_2D_ARRAY:
    case PBTextureType.ITEX_1D:
    case PBTextureType.ITEX_2D:
    case PBTextureType.ITEX_3D:
    case PBTextureType.ITEX_CUBE:
      return new PBPrimitiveTypeInfo(PBPrimitiveType.I32);
    case PBTextureType.UTEX_2D_ARRAY:
    case PBTextureType.UTEX_1D:
    case PBTextureType.UTEX_2D:
    case PBTextureType.UTEX_3D:
    case PBTextureType.UTEX_CUBE:
      return new PBPrimitiveTypeInfo(PBPrimitiveType.U32);
    default:
      return null;
  }
}

/** @internal */
export function genSamplerName(textureName: string, comparison: boolean): string {
  return `ch_auto_sampler_${textureName}${comparison ? '_comparison' : ''}`;
}

/** @internal */
export const builtinVariables = {
  webgl: {
    position: {
      name: 'gl_Position',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      stage: 'vertex'
    },
    pointSize: {
      name: 'gl_PointSize',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
      stage: 'vertex'
    },
    fragCoord: {
      name: 'gl_FragCoord',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      stage: 'fragment'
    },
    frontFacing: {
      name: 'gl_FrontFacing',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
      stage: 'fragment'
    },
    fragDepth: {
      name: 'gl_FragDepthEXT',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
      inOrOut: 'out',
      extension: 'GL_EXT_frag_depth',
      stage: 'fragment'
    }
  },
  webgl2: {
    vertexIndex: {
      name: 'gl_VertexID',
      semantic: 'vertex_index',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'vertex'
    },
    instanceIndex: {
      name: 'gl_InstanceID',
      semantic: 'instance_index',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'vertex'
    },
    position: {
      name: 'gl_Position',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      stage: 'vertex'
    },
    pointSize: {
      name: 'gl_PointSize',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
      stage: 'vertex'
    },
    fragCoord: {
      name: 'gl_FragCoord',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      stage: 'fragment'
    },
    frontFacing: {
      name: 'gl_FrontFacing',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
      stage: 'fragment'
    },
    fragDepth: {
      name: 'gl_FragDepth',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
      stage: 'fragment'
    }
  },
  webgpu: {
    vertexIndex: {
      name: 'zVertexId',
      semantic: 'vertex_index',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'vertex'
    },
    instanceIndex: {
      name: 'zInstanceId',
      semantic: 'instance_index',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'vertex'
    },
    position: {
      name: 'zPosition',
      semantic: 'position',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      inOrOut: 'out',
      stage: 'vertex'
    },
    fragCoord: {
      name: 'zFragCoord',
      semantic: 'position',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
      inOrOut: 'in',
      stage: 'fragment'
    },
    frontFacing: {
      name: 'zFrontFacing',
      semantic: 'front_facing',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
      inOrOut: 'in',
      stage: 'fragment'
    },
    fragDepth: {
      name: 'zFragDepth',
      semantic: 'frag_depth',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
      inOrOut: 'out',
      stage: 'fragment'
    },
    localInvocationId: {
      name: 'zLocalInvocationId',
      semantic: 'local_invocation_id',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
      inOrOut: 'in',
      stage: 'compute'
    },
    globalInvocationId: {
      name: 'zGlobalInvocationId',
      semantic: 'global_invocation_id',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
      inOrOut: 'in',
      stage: 'compute'
    },
    workGroupId: {
      name: 'zWorkGroupId',
      semantic: 'workgroup_id',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
      inOrOut: 'in',
      stage: 'compute'
    },
    numWorkGroups: {
      name: 'zNumWorkGroups',
      semantic: 'num_workgroups',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
      inOrOut: 'in',
      stage: 'compute'
    },
    sampleMaskIn: {
      name: 'zSampleMaskIn',
      semantic: 'sample_mask_in',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'fragment'
    },
    sampleMaskOut: {
      name: 'zSampleMaskOut',
      semantic: 'sample_mask_out',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'out',
      stage: 'fragment'
    },
    sampleIndex: {
      name: 'zSampleIndex',
      semantic: 'sample_index',
      type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
      inOrOut: 'in',
      stage: 'fragment'
    }
  }
} as const;

function toFixed(n: number): string {
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

function toInt(n: number): string {
  return String(n | 0);
}

function toUint(n: number): string {
  return String(n >>> 0);
}

function unbracket(e: string): string {
  e = e.trim();
  if (e[0] === '(' && e[e.length - 1] === ')') {
    let match = 0;
    for (let i = 1; i < e.length - 1; i++) {
      if (e[i] === '(') {
        match++;
      } else if (e[i] === ')') {
        match--;
        if (match < 0) {
          break;
        }
      }
    }
    if (match > 0) {
      throw new errors.PBInternalError(`Invalid expression: ${e}`);
    } else if (match === 0) {
      return e.substring(1, e.length - 1);
    }
  }
  return e;
}

interface ASTContext {
  type: ShaderType;
  mrt: boolean;
  defines: string[];
  extensions: Set<string>;
  builtins: string[];
  inputs: ShaderAST[];
  outputs: ShaderAST[];
  types: ShaderAST[];
  typeReplacement: Map<PBShaderExp, PBTypeInfo>;
  global: PBGlobalScope;
  vertexAttributes: number[];
  workgroupSize: [number, number, number];
}

/** @internal */
export class ShaderAST {
  isReference(): boolean {
    return false;
  }
  isPointer(): boolean {
    return !!this.getType()?.isPointerType();
  }
  getType(): PBTypeInfo {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return '';
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return '';
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    return '';
  }
  toString(deviceType: string): string {
    return this.constructor.name;
  }
}

/** @internal */
export abstract class ASTExpression extends ShaderAST {
  abstract getType(): PBTypeInfo;
  abstract markWritable(): void;
  abstract isWritable(): boolean;
  abstract getAddressSpace(): PBAddressSpace;
  abstract isConstExp(): boolean;
}

/** @internal */
export class ASTFunctionParameter extends ASTExpression {
  /** @internal */
  paramAST: ASTPrimitive | ASTReferenceOf;
  /** @internal */
  writable: boolean;
  constructor(init: ASTPrimitive | ASTReferenceOf) {
    super();
    this.paramAST = init;
    this.writable = false;
  }
  getType(): PBTypeInfo<TypeDetailInfo> {
    return this.paramAST.getType();
  }
  markWritable(): void {
    if (this.paramAST instanceof ASTPrimitive) {
      console.warn(`Write to non-output parameter ${this.paramAST.value.$str}`);
    }
    this.writable = true;
  }
  isWritable(): boolean {
    return this.writable;
  }
  getAddressSpace(): PBAddressSpace {
    return this.paramAST.getAddressSpace();
  }
  isConstExp(): boolean {
    return this.paramAST.isConstExp();
  }
  isReference(): boolean {
    return this.paramAST.isReference();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return this.paramAST.toWebGL(indent, ctx);
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return this.paramAST.toWebGL2(indent, ctx);
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    return this.paramAST.toWGSL(indent, ctx);
  }
}

/** @internal */
export class ASTScope extends ShaderAST {
  statements: ShaderAST[];
  constructor() {
    super();
    this.statements = [];
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return this.statements
      .filter((stmt) => !(stmt instanceof ASTCallFunction) || stmt.isStatement)
      .map((stmt) => stmt.toWebGL(indent, ctx))
      .join('');
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return this.statements
      .filter((stmt) => !(stmt instanceof ASTCallFunction) || stmt.isStatement)
      .map((stmt) => stmt.toWebGL2(indent, ctx))
      .join('');
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    return this.statements
      .filter((stmt) => !(stmt instanceof ASTCallFunction) || stmt.isStatement)
      .map((stmt) => {
        if (stmt instanceof ASTCallFunction) {
          if (!stmt.getType().isVoidType()) {
            return `${indent}_ = ${stmt.toWGSL('', ctx)}`;
          }
        }
        return stmt.toWGSL(indent, ctx);
      })
      .join('');
  }
}

/** @internal */
export class ASTNakedScope extends ASTScope {
  toWebGL(indent: string, ctx: ASTContext): string {
    return `${indent}{\n${super.toWebGL(indent + ' ', ctx)}${indent}}\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return `${indent}{\n${super.toWebGL2(indent + ' ', ctx)}${indent}}\n`;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    return `${indent}{\n${super.toWGSL(indent + ' ', ctx)}${indent}}\n`;
  }
}

/** @internal */
export class ASTGlobalScope extends ASTScope {
  /** @internal */
  uniforms: ASTDeclareVar[];
  constructor() {
    super();
    this.uniforms = [];
  }
  findFunctions(name: string): ASTFunction[] {
    const result: ASTFunction[] = [];
    for (const stmt of this.statements) {
      if (stmt instanceof ASTFunction && stmt.name === name) {
        result.push(stmt);
      }
    }
    return result;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    // TODO: precision
    const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
    const version = `${indent}#version 100\n`;
    const body =
      ctx.types.map((val) => val.toWebGL(indent, ctx)).join('') +
      this.uniforms.map((uniform) => uniform.toWebGL(indent, ctx)).join('') +
      ctx.inputs.map((input) => input.toWebGL(indent, ctx)).join('') +
      ctx.outputs.map((output) => output.toWebGL(indent, ctx)).join('') +
      super.toWebGL(indent, ctx);
    for (const k of ctx.builtins) {
      const info = builtinVariables.webgl[k];
      if (info.extension) {
        ctx.extensions.add(info.extension);
      }
    }
    const extensions = [...ctx.extensions].map((s) => `${indent}#extension ${s}: enable\n`).join('');
    const defines = ctx.defines.join('');
    return version + extensions + precisions + defines + body;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
    const version = `${indent}#version 300 es\n`;
    const body =
      ctx.types.map((val) => val.toWebGL2(indent, ctx)).join('') +
      this.uniforms.map((uniform) => uniform.toWebGL2(indent, ctx)).join('') +
      ctx.inputs.map((input) => input.toWebGL2(indent, ctx)).join('') +
      ctx.outputs.map((output) => output.toWebGL2(indent, ctx)).join('') +
      super.toWebGL2(indent, ctx);
    for (const k of ctx.builtins) {
      const info = builtinVariables.webgl2[k];
      if (info.extension) {
        ctx.extensions.add(info.extension);
      }
    }
    const extensions = [...ctx.extensions].map((s) => `${indent}#extension ${s}: enable\n`).join('');
    const defines = ctx.defines.join('');
    return version + extensions + precisions + defines + body;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    const structNames =
      ctx.type === ShaderType.Vertex
        ? [BuiltinInputStructNameVS, BuiltinOutputStructNameVS]
        : ctx.type === ShaderType.Fragment
        ? [BuiltinInputStructNameFS, BuiltinOutputStructNameFS]
        : [BuiltinInputStructNameCS];
    const usedBuiltins: string[] = [];
    for (const k of ctx.builtins) {
      usedBuiltins.push(builtinVariables.webgpu[k].name);
    }
    const allBuiltins = Object.keys(builtinVariables.webgpu).map((val) => builtinVariables.webgpu[val].name);
    for (const type of ctx.types) {
      if (type instanceof ASTStructDefine && structNames.indexOf(type.type.structName) >= 0) {
        for (let i = type.type.structMembers.length - 1; i >= 0; i--) {
          const member = type.type.structMembers[i];
          if (allBuiltins.indexOf(member.name) >= 0 && usedBuiltins.indexOf(member.name) < 0) {
            type.type.structMembers.splice(i, 1);
            type.prefix.splice(i, 1);
          }
        }
      }
    }
    ctx.types = ctx.types.filter(
      (val) => !(val instanceof ASTStructDefine) || val.type.structMembers.length > 0
    );
    return (
      ctx.types.map((val) => val.toWGSL(indent, ctx)).join('') +
      this.uniforms.map((uniform) => uniform.toWGSL(indent, ctx)).join('') +
      super.toWGSL(indent, ctx)
    );
  }
}

/** @internal */
export class ASTPrimitive extends ASTExpression {
  /** @internal */
  value: PBShaderExp;
  /** @internal */
  ref: ASTExpression;
  /** @internal */
  writable: boolean;
  /** @internal */
  constExp: boolean;
  constructor(value: PBShaderExp) {
    super();
    this.value = value;
    this.ref = null;
    this.writable = false;
    this.constExp = false;
  }
  get name(): string {
    return this.value.$str;
  }
  isReference(): boolean {
    return true;
  }
  isConstExp(): boolean {
    return this.constExp;
  }
  markWritable() {
    this.writable = true;
    this.constExp = false;
    if (this.ref) {
      this.ref.markWritable();
    }
  }
  isWritable(): boolean {
    const type = this.getType();
    return (
      this.writable || type.isAtomicI32() || type.isAtomicU32() || (type.isStructType() && type.haveAtomicMembers())
    );
  }
  getAddressSpace(): PBAddressSpace {
    switch (this.value.$declareType) {
      case DeclareType.DECLARE_TYPE_UNIFORM:
        return PBAddressSpace.UNIFORM;
      case DeclareType.DECLARE_TYPE_STORAGE:
        return PBAddressSpace.STORAGE;
      case DeclareType.DECLARE_TYPE_IN:
      case DeclareType.DECLARE_TYPE_OUT:
        return null;
      default:
        return this.value.$global ? PBAddressSpace.PRIVATE : PBAddressSpace.FUNCTION;
    }
  }
  getType(): PBTypeInfo {
    return this.value.$typeinfo;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return this.name;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return this.name;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    if (this.value.$declareType === DeclareType.DECLARE_TYPE_IN) {
      const structName = getBuiltinInputStructInstanceName(ctx.type);
      return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
    } else if (this.value.$declareType === DeclareType.DECLARE_TYPE_OUT) {
      const structName = getBuiltinOutputStructInstanceName(ctx.type);
      return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
    } else {
      return this.name;
    }
  }
  toString(deviceType: string): string {
    return this.name;
  }
}

/** @internal */
export abstract class ASTLValue extends ShaderAST {
  abstract getType(): PBTypeInfo;
  abstract markWritable(): void;
  abstract isWritable(): boolean;
}

/** @internal */
export class ASTLValueScalar extends ASTLValue {
  /** @internal */
  value: ASTExpression;
  constructor(value: ASTExpression) {
    super();
    if (value.getAddressSpace() === PBAddressSpace.UNIFORM) {
      throw new errors.PBASTError(value, 'cannot assign to uniform variable');
    }
    this.value = value;
    if (this.value instanceof ASTCallFunction) {
      this.value.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.value.getType();
  }
  markWritable(): void {
    this.value.markWritable();
  }
  isWritable(): boolean {
    return this.value.isWritable();
  }
  isReference(): boolean {
    return this.value.isReference();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return this.value.toWebGL(indent, ctx);
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return this.value.toWebGL2(indent, ctx);
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    return this.value.toWGSL(indent, ctx);
  }
  toString(deviceType: string): string {
    return this.value.toString(deviceType);
  }
}

/** @internal */
export class ASTLValueHash extends ASTLValue {
  /** @internal */
  scope: ASTLValueScalar | ASTLValueHash | ASTLValueArray;
  /** @internal */
  field: string;
  /** @internal */
  type: PBTypeInfo;
  constructor(scope: ASTLValueScalar | ASTLValueHash | ASTLValueArray, field: string, type: PBTypeInfo) {
    super();
    this.scope = scope;
    this.field = field;
    this.type = type;
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable(): void {
    this.scope.markWritable();
  }
  isWritable(): boolean {
    return this.scope.isWritable();
  }
  isReference(): boolean {
    return this.scope.isReference();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return `${this.scope.toWebGL(indent, ctx)}.${this.field}`;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return `${this.scope.toWebGL2(indent, ctx)}.${this.field}`;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
    return `${scope.toWGSL(indent, ctx)}.${this.field}`;
  }
  toString(deviceType: string): string {
    const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
    return `${scope.toString(deviceType)}.${this.field}`;
  }
}

/** @internal */
export class ASTLValueArray extends ASTLValue {
  /** @internal */
  value: ASTLValueScalar | ASTLValueHash | ASTLValueArray;
  /** @internal */
  index: ASTExpression;
  /** @internal */
  type: PBTypeInfo;
  constructor(
    value: ASTLValueScalar | ASTLValueHash | ASTLValueArray,
    index: ASTExpression,
    type: PBTypeInfo
  ) {
    super();
    this.value = value;
    this.index = index;
    this.type = type;
    if (this.index instanceof ASTCallFunction) {
      this.index.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable(): void {
    this.value.markWritable();
  }
  isWritable(): boolean {
    return this.value.isWritable();
  }
  isReference(): boolean {
    return this.value.isReference();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return `${this.value.toWebGL(indent, ctx)}[${this.index.toWebGL(indent, ctx)}]`;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return `${this.value.toWebGL2(indent, ctx)}[${this.index.toWebGL2(indent, ctx)}]`;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
    return `${value.toWGSL(indent, ctx)}[${this.index.toWGSL(indent, ctx)}]`;
  }
  toString(deviceType: string): string {
    const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
    return `${value.toString(deviceType)}[${this.index.toString(deviceType)}]`;
  }
}

/** @internal */
export class ASTLValueDeclare extends ASTLValue {
  /** @internal */
  value: ASTPrimitive;
  constructor(value: ASTPrimitive) {
    super();
    this.value = value;
    this.value.constExp = true;
  }
  getType(): PBTypeInfo {
    return this.value.getType();
  }
  markWritable(): void {}
  isWritable(): boolean {
    return false;
  }
  isReference(): boolean {
    return true;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    let prefix = '';
    const builtin = false;
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
      case DeclareType.DECLARE_TYPE_OUT:
      case DeclareType.DECLARE_TYPE_UNIFORM:
      case DeclareType.DECLARE_TYPE_STORAGE:
        throw new Error('invalid declare type');
      default:
        prefix =
          this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
        break;
    }
    if (!builtin) {
      return `${prefix}${this.getType().toTypeName('webgl', this.value.name)}`;
    }
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    let prefix = '';
    const builtin = false;
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
      case DeclareType.DECLARE_TYPE_OUT:
      case DeclareType.DECLARE_TYPE_UNIFORM:
      case DeclareType.DECLARE_TYPE_STORAGE:
        throw new Error('invalid declare type');
      default:
        prefix =
          this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
        break;
    }
    if (!builtin) {
      return `${prefix}${this.getType().toTypeName('webgl2', this.value.name)}`;
    }
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    let prefix: string;
    const builtin = false;
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
      case DeclareType.DECLARE_TYPE_OUT:
      case DeclareType.DECLARE_TYPE_UNIFORM:
      case DeclareType.DECLARE_TYPE_STORAGE:
        throw new Error('invalid declare type');
      default: {
        const addressSpace = this.value.getAddressSpace();
        const readonly =
          this.getType().isPointerType() ||
          (!this.value.isWritable() &&
            (addressSpace === PBAddressSpace.PRIVATE || addressSpace === PBAddressSpace.FUNCTION));
        const moduleScope = addressSpace === PBAddressSpace.PRIVATE;
        const storageAccessMode =
          addressSpace === PBAddressSpace.STORAGE && this.value.isWritable() ? ', read_write' : '';
        const decorator =
          addressSpace !== PBAddressSpace.FUNCTION ? `<${addressSpace}${storageAccessMode}>` : '';
        prefix = readonly ? (moduleScope ? 'const ' : 'let ') : `var${decorator} `;
        break;
      }
    }
    if (!builtin) {
      // const decl = this.value.value.$global ? this.getType().toTypeName('webgpu', this.value.name) : this.value.name;
      const type = this.getType();
      if (type.isPointerType() && (this.value.isWritable() || this.value.ref.isWritable())) {
        type.writable = true;
      }
      const decl = type.toTypeName('webgpu', this.value.name);
      return `${prefix}${decl}`;
    }
  }
  toString(deviceType: string): string {
    return this.value.toString(deviceType);
  }
}

/** @internal */
export class ASTShaderExpConstructor extends ASTExpression {
  /** @internal */
  type: PBTypeInfo;
  /** @internal */
  args: (number | boolean | ASTExpression)[];
  /** @internal */
  constExp: boolean;
  constructor(type: PBTypeInfo, args: (number | boolean | ASTExpression)[]) {
    super();
    this.type = type;
    this.args = args;
    this.constExp = true;
    for (const arg of args) {
      if (arg === null || arg === undefined) {
        throw new Error('invalid constructor argument');
      }
      if (arg instanceof ASTCallFunction) {
        arg.isStatement = false;
      }
      this.constExp &&= !(arg instanceof ASTExpression) || arg.isConstExp();
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  isConstExp(): boolean {
    return this.constExp;
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    console.assert(!this.type.isArrayType(), 'array constructor not supported in webgl1 device');
    console.assert(
      this.type.isConstructible(),
      `type '${this.type.toTypeName('webgl')}' is not constructible`
    );
    const overloads = this.type.getConstructorOverloads('webgl');
    for (const overload of overloads) {
      const convertedArgs = convertArgs(this.args, overload);
      if (convertedArgs) {
        const c = convertedArgs.args.map((arg) => unbracket(arg.toWebGL(indent, ctx))).join(',');
        return `${convertedArgs.name}(${c})`;
      }
    }
    throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgl')}`);
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    console.assert(
      this.type.isConstructible(),
      `type '${this.type.toTypeName('webgl2')}' is not constructible`,
      true
    );
    const overloads = this.type.getConstructorOverloads('webgl2');
    for (const overload of overloads) {
      const convertedArgs = convertArgs(this.args, overload);
      if (convertedArgs) {
        const c = convertedArgs.args.map((arg) => unbracket(arg.toWebGL2(indent, ctx))).join(',');
        return `${convertedArgs.name}(${c})`;
      }
    }
    throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgl2')}`);
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    /*
    console.assert(
      this.type.isConstructible(),
      `type '${this.type.toTypeName('webgpu')}' is not constructible`,
      true
    );
    */
    const overloads = this.type.getConstructorOverloads('webgpu');
    for (const overload of overloads) {
      const convertedArgs = convertArgs(this.args, overload);
      if (convertedArgs) {
        const c = convertedArgs.args.map((arg) => unbracket(arg.toWGSL(indent, ctx))).join(',');
        return `${convertedArgs.name}(${c})`;
      }
    }
    throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgpu')}`);
  }
  toString(deviceType: string): string {
    return 'constructor';
  }
}

/** @internal */
export class ASTScalar extends ASTExpression {
  /** @internal */
  value: number | boolean;
  /** @internal */
  type: PBPrimitiveTypeInfo;
  constructor(value: number | boolean, type: PBPrimitiveTypeInfo) {
    super();
    this.value = value;
    this.type = type;
    if (typeof value === 'number') {
      if (type.primitiveType === PBPrimitiveType.BOOL) {
        throw new errors.PBTypeCastError(value, typeof value, type);
      }
      if (
        type.primitiveType === PBPrimitiveType.I32 &&
        (!Number.isInteger(value) || value < 0x80000000 >> 0 || value > 0xffffffff)
      ) {
        throw new errors.PBTypeCastError(value, typeof value, type);
      }
      if (
        value < 0 &&
        type.primitiveType === PBPrimitiveType.U32 &&
        (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      ) {
        throw new errors.PBTypeCastError(value, typeof value, type);
      }
    } else if (type.primitiveType !== PBPrimitiveType.BOOL) {
      throw new errors.PBTypeCastError(value, typeof value, type);
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  isConstExp(): boolean {
    return true;
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    switch (this.type.primitiveType) {
      case PBPrimitiveType.F32:
        return toFixed(this.value as number);
      case PBPrimitiveType.I32:
        return toInt(this.value as number);
      case PBPrimitiveType.U32:
        return toUint(this.value as number);
      case PBPrimitiveType.BOOL:
        return String(!!this.value);
      default:
        throw new Error('Invalid scalar type');
    }
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    switch (this.type.primitiveType) {
      case PBPrimitiveType.F32:
        return toFixed(this.value as number);
      case PBPrimitiveType.I32:
        return toInt(this.value as number);
      case PBPrimitiveType.U32:
        return `${toUint(this.value as number)}u`;
      case PBPrimitiveType.BOOL:
        return String(!!this.value);
      default:
        throw new Error('Invalid scalar type');
    }
  }
  toWGSL(indent: string, ctx: ASTContext) {
    switch (this.type.primitiveType) {
      case PBPrimitiveType.F32:
        return toFixed(this.value as number);
      case PBPrimitiveType.I32:
        return toInt(this.value as number);
      case PBPrimitiveType.U32:
        return `${toUint(this.value as number)}u`;
      case PBPrimitiveType.BOOL:
        return String(!!this.value);
      default:
        throw new Error('Invalid scalar type');
    }
  }
  toString(deviceType: string): string {
    return `${this.value}`;
  }
}

/** @internal */
export class ASTHash extends ASTExpression {
  /** @internal */
  source: ASTExpression;
  /** @internal */
  field: string;
  /** @internal */
  type: PBTypeInfo;
  constructor(source: ASTExpression, field: string, type: PBTypeInfo) {
    super();
    this.source = source;
    this.field = field;
    this.type = type;
    if (this.source instanceof ASTCallFunction) {
      this.source.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  isReference(): boolean {
    return this.source.isReference();
  }
  isConstExp(): boolean {
    return this.source.isConstExp();
  }
  markWritable() {
    this.source.markWritable();
  }
  isWritable(): boolean {
    return this.source.isWritable();
  }
  getAddressSpace(): PBAddressSpace {
    return this.source.getAddressSpace();
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `${this.source.toWebGL(indent, ctx)}.${this.field}`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${this.source.toWebGL2(indent, ctx)}.${this.field}`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
    return `${source.toWGSL(indent, ctx)}.${this.field}`;
  }
  toString(deviceType: string): string {
    const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
    return `${source.toString(deviceType)}.${this.field}`;
  }
}

/** @internal */
export class ASTCast extends ASTExpression {
  /** @internal */
  sourceValue: ASTExpression;
  /** @internal */
  castType: PBTypeInfo;
  constructor(source: ASTExpression, type: PBTypeInfo) {
    super();
    this.sourceValue = source;
    this.castType = type;
    if (this.sourceValue instanceof ASTCallFunction) {
      this.sourceValue.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.castType;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  isConstExp(): boolean {
    return this.sourceValue.isConstExp();
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
      return `${this.castType.toTypeName('webgl')}(${unbracket(this.sourceValue.toWebGL(indent, ctx))})`;
    } else {
      return this.sourceValue.toWebGL(indent, ctx);
    }
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
      return `${this.castType.toTypeName('webgl2')}(${unbracket(this.sourceValue.toWebGL2(indent, ctx))})`;
    } else {
      return this.sourceValue.toWebGL2(indent, ctx);
    }
  }
  toWGSL(indent: string, ctx: ASTContext) {
    if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
      return `${this.castType.toTypeName('webgpu')}(${unbracket(this.sourceValue.toWGSL(indent, ctx))})`;
    } else {
      return this.sourceValue.toWGSL(indent, ctx);
    }
  }
  toString(deviceType: string): string {
    return `${this.castType.toTypeName(deviceType)}(${unbracket(this.sourceValue.toString(deviceType))})`;
  }
}

/** @internal */
export class ASTAddressOf extends ASTExpression {
  /** @internal */
  value: ASTExpression;
  /** @internal */
  type: PBTypeInfo;
  constructor(value: ASTExpression) {
    super();
    console.assert(value.isReference(), 'no pointer type for non-reference values', true);
    this.value = value;
    this.type = new PBPointerTypeInfo(value.getType(), value.getAddressSpace());
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  isConstExp(): boolean {
    return false;
  }
  markWritable() {
    const addressSpace = this.value.getAddressSpace();
    if (addressSpace === PBAddressSpace.UNIFORM) {
      throw new errors.PBASTError(this.value, 'uniforms are not writable');
    }
    this.value.markWritable();
  }
  isWritable(): boolean {
    return this.value.isWritable();
  }
  getAddressSpace(): PBAddressSpace {
    return this.value.getAddressSpace();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    throw new Error('GLSL does not support pointer type');
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    throw new Error('GLSL does not support pointer type');
  }
  toWGSL(indent: string, ctx: ASTContext) {
    const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
    return ast instanceof ASTReferenceOf ? ast.value.toWGSL(indent, ctx) : `(&${ast.toWGSL(indent, ctx)})`;
  }
  toString(deviceType: string): string {
    const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
    return ast instanceof ASTReferenceOf ? ast.value.toString(deviceType) : `(&${ast.toString(deviceType)})`;
  }
}

/** @internal */
export class ASTReferenceOf extends ASTExpression {
  /** @internal */
  value: ASTExpression | ASTLValue;
  constructor(value: ASTExpression | ASTLValue) {
    super();
    this.value = value;
    if (this.value instanceof ASTCallFunction) {
      this.value.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    const type = this.value.getType();
    return type.isPointerType() ? type.pointerType : type;
  }
  isReference(): boolean {
    return true;
  }
  markWritable() {
    this.value.markWritable();
  }
  isWritable(): boolean {
    return this.value.isWritable();
  }
  isConstExp(): boolean {
    return false;
  }
  getAddressSpace(): PBAddressSpace {
    return this.value instanceof ASTExpression ? this.value.getAddressSpace() : null;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    return this.value.toWebGL(indent, ctx);
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    return this.value.toWebGL2(indent, ctx);
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return this.value.getType().isPointerType()
      ? `(*${this.value.toWGSL(indent, ctx)})`
      : this.value.toWGSL(indent, ctx);
  }
  toString(deviceType: string): string {
    return `*${this.value.toString(deviceType)}`;
  }
}

/** @internal */
export class ASTUnaryFunc extends ASTExpression {
  /** @internal */
  value: ASTExpression;
  /** @internal */
  op: string;
  /** @internal */
  type: PBTypeInfo;
  constructor(value: ASTExpression, op: string, type: PBTypeInfo) {
    super();
    this.value = value;
    this.op = op;
    this.type = type;
    if (this.value instanceof ASTCallFunction) {
      this.value.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  isConstExp(): boolean {
    return this.value.isConstExp();
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `${this.op}${this.value.toWebGL(indent, ctx)}`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${this.op}${this.value.toWebGL2(indent, ctx)}`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
    return `${this.op}${value.toWGSL(indent, ctx)}`;
  }
  toString(deviceType: string): string {
    const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
    return `${this.op}${value.toString(deviceType)}`;
  }
}

/** @internal */
export class ASTBinaryFunc extends ASTExpression {
  /** @internal */
  left: ASTExpression;
  /** @internal */
  right: ASTExpression;
  /** @internal */
  type: PBTypeInfo;
  /** @internal */
  op: string;
  constructor(left: ASTExpression, right: ASTExpression, op: string, type: PBTypeInfo) {
    super();
    this.left = left;
    this.right = right;
    this.op = op;
    this.type = type;
    if (this.left instanceof ASTCallFunction) {
      this.left.isStatement = false;
    }
    if (this.right instanceof ASTCallFunction) {
      this.right.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  isConstExp(): boolean {
    return this.left.isConstExp() && this.right.isConstExp();
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `(${this.left.toWebGL(indent, ctx)} ${this.op} ${this.right.toWebGL(indent, ctx)})`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `(${this.left.toWebGL2(indent, ctx)} ${this.op} ${this.right.toWebGL2(indent, ctx)})`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
    const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
    return `(${left.toWGSL(indent, ctx)} ${this.op} ${right.toWGSL(indent, ctx)})`;
  }
  toString(deviceType: string): string {
    const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
    const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
    return `(${left.toString(deviceType)} ${this.op} ${right.toString(deviceType)})`;
  }
}

/** @internal */
export class ASTArrayIndex extends ASTExpression {
  /** @internal */
  source: ASTExpression;
  /** @internal */
  index: ASTExpression;
  /** @internal */
  type: PBTypeInfo;
  constructor(source: ASTExpression, index: ASTExpression, type: PBTypeInfo) {
    super();
    this.source = source;
    this.index = index;
    this.type = type;
    if (this.source instanceof ASTCallFunction) {
      this.source.isStatement = false;
    }
    if (this.index instanceof ASTCallFunction) {
      this.index.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return this.type;
  }
  isReference(): boolean {
    return this.source.isReference();
  }
  markWritable() {
    this.source.markWritable();
  }
  isWritable(): boolean {
    return this.source.isWritable();
  }
  isConstExp(): boolean {
    return this.source.isConstExp() && this.index.isConstExp();
  }
  getAddressSpace(): PBAddressSpace {
    return this.source.getAddressSpace();
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `${this.source.toWebGL(indent, ctx)}[${unbracket(this.index.toWebGL(indent, ctx))}]`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${this.source.toWebGL2(indent, ctx)}[${unbracket(this.index.toWebGL2(indent, ctx))}]`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${this.source.toWGSL(indent, ctx)}[${unbracket(this.index.toWGSL(indent, ctx))}]`;
  }
  toString(deviceType: string): string {
    return `${this.source.toString(deviceType)}[${unbracket(this.index.toString(deviceType))}]`;
  }
}

/** @internal */
export class ASTTouch extends ShaderAST {
  /** @internal */
  value: ASTExpression;
  constructor(value: ASTExpression) {
    super();
    if (value.getType().isVoidType()) {
      throw new Error('can not touch void type');
    }
    if (value instanceof ASTCallFunction) {
      value.isStatement = false;
    }
    this.value = value;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}${this.value.toWebGL('', ctx)};\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}${this.value.toWebGL2('', ctx)};\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    if (!this.value.getType().isVoidType()) {
      return `${indent}_ = ${this.value.toWGSL('', ctx)};\n`;
    } else {
      return `${indent}${this.value.toWGSL('', ctx)};\n`;
    }
  }
}

/** @internal */
export class ASTSelect extends ASTExpression {
  /** @internal */
  condition: ASTExpression;
  /** @internal */
  first: ASTExpression;
  /** @internal */
  second: ASTExpression;
  /** @internal */
  type: PBTypeInfo;
  constructor(
    condition: ASTExpression | boolean | number,
    first: ASTExpression | number | boolean,
    second: ASTExpression | number | boolean
  ) {
    super();
    this.condition = condition instanceof ASTExpression ? condition : new ASTScalar(condition, typeBool);
    let firstType: PBTypeInfo = null;
    let secondType: PBTypeInfo = null;
    if (first instanceof ASTExpression) {
      firstType = first.getType();
      this.first = first;
      if (first instanceof ASTCallFunction) {
        first.isStatement = false;
      }
    } else if (typeof first === 'number') {
      if (!Number.isInteger(first)) {
        this.first = new ASTScalar(first, typeF32);
        firstType = typeF32;
      }
    } else if (typeof first === 'boolean') {
      this.first = new ASTScalar(first, typeBool);
      firstType = typeBool;
    } else {
      throw new Error('select: invalid first value');
    }
    if (second instanceof ASTExpression) {
      secondType = second.getType();
      this.second = second;
      if (second instanceof ASTCallFunction) {
        second.isStatement = false;
      }
    } else if (typeof second === 'number') {
      if (!Number.isInteger(second)) {
        this.second = new ASTScalar(second, typeF32);
        secondType = typeF32;
      }
    } else if (typeof second === 'boolean') {
      this.second = new ASTScalar(second, typeBool);
      secondType = typeBool;
    } else {
      throw new Error('select: invalid second value');
    }
    if (!firstType && !secondType) {
      throw new Error('select: cannot determine the value types');
    }
    if (firstType && secondType) {
      if (!firstType.isCompatibleType(secondType)) {
        throw new Error('select: first value and second value must be the same type');
      } else {
        this.type = firstType;
      }
    } else if (!firstType) {
      if (secondType.typeId === typeF32.typeId) {
        this.first = new ASTScalar(first as number, typeF32);
      } else if (secondType.typeId === typeI32.typeId) {
        this.first = new ASTScalar(first as number, typeI32);
      } else if (secondType.typeId === typeU32.typeId) {
        this.first = new ASTScalar(first as number, typeU32);
      } else {
        throw new Error('select: invalid type of the first value');
      }
      this.type = secondType;
    } else {
      if (firstType.typeId === typeF32.typeId) {
        this.second = new ASTScalar(second as number, typeF32);
      } else if (firstType.typeId === typeI32.typeId) {
        this.second = new ASTScalar(second as number, typeI32);
      } else if (firstType.typeId === typeU32.typeId) {
        this.second = new ASTScalar(second as number, typeU32);
      } else {
        throw new Error('select: invalid type of the second value');
      }
      this.type = firstType;
    }
  }
  getType(): PBTypeInfo<TypeDetailInfo> {
    return this.type;
  }
  isConstExp(): boolean {
    return false;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}(${this.condition.toWebGL('', ctx)} ? ${this.first.toWebGL(
      '',
      ctx
    )} : ${this.second.toWebGL('', ctx)})`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}(${this.condition.toWebGL2('', ctx)} ? ${this.first.toWebGL2(
      '',
      ctx
    )} : ${this.second.toWebGL2('', ctx)})`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${indent}select(${this.second.toWGSL('', ctx)}, ${this.first.toWGSL(
      '',
      ctx
    )}, ${this.condition.toWGSL('', ctx)})`;
    //return `${indent}${this.condition.toWGSL('', ctx)} ? ${this.first.toWGSL('', ctx)} : ${this.second.toWGSL('', ctx)}`;
  }
}
/** @internal */
export class ASTAssignment extends ShaderAST {
  /** @internal */
  lvalue: ASTLValue;
  /** @internal */
  rvalue: ASTExpression | number | boolean;
  constructor(lvalue: ASTLValue, rvalue: ASTExpression | number | boolean) {
    super();
    if (!lvalue.isReference()) {
      throw new Error('assignment: l-value required');
    }
    this.lvalue = lvalue;
    this.rvalue = rvalue;
    if (!(this.lvalue instanceof ASTLValueDeclare)) {
      if (this.lvalue.getType().isPointerType()) {
        throw new errors.PBASTError(this.lvalue, 'cannot assign to read-only variable');
      }
      this.lvalue.markWritable();
    } else if (this.lvalue.getType().isPointerType()) {
      if (this.rvalue instanceof ASTPrimitive) {
        this.lvalue.value.ref = this.rvalue.ref;
      } else if (this.rvalue instanceof ASTAddressOf) {
        this.lvalue.value.ref = this.rvalue.value;
      } else {
        throw new errors.PBASTError(this.lvalue, 'invalid pointer assignment');
      }
    } else if (this.rvalue instanceof ASTExpression) {
      this.lvalue.value.constExp = this.rvalue.isConstExp();
    }
    if (this.rvalue instanceof ASTCallFunction) {
      this.rvalue.isStatement = false;
    }
  }
  getType(): PBTypeInfo {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    let rhs: string = null;
    const ltype = this.lvalue.getType();
    const rtype = this.checkScalarType(this.rvalue, ltype);
    if (!ltype.isCompatibleType(rtype)) {
      throw new errors.PBTypeCastError(
        this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl') : `${this.rvalue}`,
        rtype,
        ltype
      );
    }
    if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
      rhs =
        (rtype as PBPrimitiveTypeInfo).primitiveType === PBPrimitiveType.F32
          ? toFixed(this.rvalue as number)
          : String(this.rvalue);
    } else {
      rhs = unbracket(this.rvalue.toWebGL(indent, ctx));
    }
    if (this.lvalue instanceof ASTLValueDeclare) {
      this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
    }
    return `${indent}${this.lvalue.toWebGL(indent, ctx)} = ${rhs};\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    let rhs: string = null;
    const ltype = this.lvalue.getType();
    const rtype = this.checkScalarType(this.rvalue, ltype);
    if (!ltype.isCompatibleType(rtype)) {
      throw new errors.PBTypeCastError(
        this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl2') : `${this.rvalue}`,
        rtype,
        ltype
      );
    }
    if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
      rhs =
        (rtype as PBPrimitiveTypeInfo).primitiveType === PBPrimitiveType.F32
          ? toFixed(this.rvalue as number)
          : String(this.rvalue);
    } else {
      rhs = unbracket(this.rvalue.toWebGL2(indent, ctx));
    }
    if (this.lvalue instanceof ASTLValueDeclare) {
      this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
    }
    return `${indent}${this.lvalue.toWebGL2(indent, ctx)} = ${rhs};\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    const ltype = this.lvalue.getType();
    const [valueTypeLeft, lvalueIsPtr] = ltype.isPointerType() ? [ltype.pointerType, true] : [ltype, false];
    const rtype = this.checkScalarType(this.rvalue, valueTypeLeft);
    const rvalueIsPtr = rtype && rtype.isPointerType();
    const valueTypeRight = rvalueIsPtr ? (rtype as PBPointerTypeInfo).pointerType : rtype;
    if (!valueTypeLeft.isCompatibleType(valueTypeRight)) {
      throw new errors.PBTypeCastError(
        this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgpu') : `${this.rvalue}`,
        rtype,
        ltype
      );
    }
    if (this.lvalue instanceof ASTLValueScalar || this.lvalue instanceof ASTLValueDeclare) {
      const structName = valueTypeLeft.isStructType() ? valueTypeLeft.structName : null;
      if (
        structName &&
        ctx.types.findIndex((val) => val instanceof ASTStructDefine && val.type.structName === structName) < 0
      ) {
        return '';
      }
    }
    let rhs: string;
    if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
      rhs =
        (rtype as PBPrimitiveTypeInfo).primitiveType === PBPrimitiveType.F32
          ? toFixed(this.rvalue as number)
          : String(this.rvalue);
    } else {
      rhs = unbracket(this.rvalue.toWGSL(indent, ctx));
    }
    const name = this.lvalue.toWGSL(indent, ctx);
    if (lvalueIsPtr && !rvalueIsPtr) {
      if (this.lvalue instanceof ASTLValueDeclare) {
        throw new Error(`rvalue must be pointer type: ${rhs}`);
      } else {
        return `${indent}*(${name}) = ${rhs};\n`;
      }
    } else if (rvalueIsPtr && !lvalueIsPtr) {
      return `${indent}${name} = *(${rhs});\n`;
    } else {
      return `${indent}${name} = ${rhs};\n`;
    }
  }
  private checkScalarType(value: number | boolean | ASTExpression, targetType: PBTypeInfo): PBTypeInfo {
    if (value instanceof ASTExpression) {
      return value.getType();
    }
    const isBool = typeof value === 'boolean';
    const isInt =
      typeof value === 'number' && Number.isInteger(value) && value >= 0x80000000 >> 0 && value <= 0x7fffffff;
    const isUint = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
    const isFloat = typeof value === 'number';
    if (targetType.isPrimitiveType()) {
      switch (targetType.primitiveType) {
        case PBPrimitiveType.BOOL:
          return isBool ? targetType : isInt ? typeI32 : isUint ? typeU32 : typeF32;
        case PBPrimitiveType.F32:
          return isFloat ? targetType : typeBool;
        case PBPrimitiveType.I32:
          return isInt ? targetType : isBool ? typeBool : isUint ? typeU32 : typeF32;
        case PBPrimitiveType.U32:
          return isUint ? targetType : isBool ? typeBool : isInt ? typeI32 : typeF32;
        default:
          return null;
      }
    } else {
      return isBool ? typeBool : isInt ? typeI32 : isUint ? typeU32 : typeF32;
    }
  }
}

/** @internal */
export class ASTDiscard extends ShaderAST {
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}discard;\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}discard;\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${indent}discard;\n`;
  }
}

/** @internal */
export class ASTBreak extends ShaderAST {
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}break;\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}break;\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${indent}break;\n`;
  }
}

/** @internal */
export class ASTContinue extends ShaderAST {
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}continue;\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}continue;\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${indent}continue;\n`;
  }
}

/** @internal */
export class ASTReturn extends ShaderAST {
  /** @internal */
  value: ASTExpression;
  constructor(value: ASTExpression) {
    super();
    this.value = value;
    if (this.value instanceof ASTCallFunction) {
      this.value.isStatement = false;
    }
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return this.value
      ? `${indent}return ${unbracket(this.value.toWebGL(indent, ctx))};\n`
      : `${indent}return;\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return this.value
      ? `${indent}return ${unbracket(this.value.toWebGL2(indent, ctx))};\n`
      : `${indent}return;\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return this.value
      ? `${indent}return ${unbracket(this.value.toWGSL(indent, ctx))};\n`
      : `${indent}return;\n`;
  }
}

/** @internal */
export class ASTCallFunction extends ASTExpression {
  /** @internal */
  name: string;
  /** @internal */
  args: ASTExpression[];
  /** @internal */
  retType: PBTypeInfo;
  /** @internal */
  func: ASTFunction;
  /** @internal */
  isStatement: boolean;
  constructor(
    name: string,
    args: ASTExpression[],
    func: ASTFunction,
    deviceType: string,
    retType?: PBTypeInfo
  ) {
    super();
    this.name = name;
    this.args = args;
    this.retType = func?.returnType ?? retType ?? typeVoid;
    this.func = func;
    this.isStatement = true;
    if (func) {
      if (func.funcType.argTypes.length !== this.args.length) {
        throw new errors.PBInternalError(`ASTCallFunction(): number of parameters mismatch`);
      }
      for (let i = 0; i < this.args.length; i++) {
        const funcArg = func.funcType.argTypes[i];
        if (funcArg.byRef) {
          if (deviceType === 'webgpu') {
            const argAddressSpace = args[i].getAddressSpace();
            if (argAddressSpace !== PBAddressSpace.FUNCTION && argAddressSpace !== PBAddressSpace.PRIVATE) {
              throw new errors.PBParamTypeError(
                name,
                'pointer type of function parameter must be function or private'
              );
            }
            const argType = funcArg.type;
            if (!argType.isPointerType()) {
              throw new errors.PBInternalError(`ASTCallFunction(): invalid reference type`);
            }
            if (argType.addressSpace === PBAddressSpace.UNKNOWN) {
              argType.addressSpace = argAddressSpace;
            } else if (argType.addressSpace !== argAddressSpace) {
              throw new errors.PBParamTypeError(
                name,
                `invalid pointer parameter address space '${argAddressSpace}', should be '${argType.addressSpace}`
              );
            }
          }
          this.args[i].markWritable();
        }
      }
    }
    for (const arg of this.args) {
      if (arg instanceof ASTCallFunction) {
        arg.isStatement = false;
      }
    }
  }
  getType(): PBTypeInfo {
    return this.retType;
  }
  isConstExp(): boolean {
    return false;
  }
  markWritable() {}
  isWritable(): boolean {
    return false;
  }
  getAddressSpace(): PBAddressSpace {
    return null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    if (this.name === 'dFdx' || this.name === 'dFdy' || this.name === 'fwidth') {
      ctx.extensions.add('GL_OES_standard_derivatives');
    } else if (
      this.name === 'texture2DLodEXT' ||
      this.name === 'texture2DProjLodEXT' ||
      this.name === 'textureCubeLodEXT' ||
      this.name === 'texture2DGradEXT' ||
      this.name === 'texture2DProjGradEXT' ||
      this.name === 'textureCubeGradEXT'
    ) {
      ctx.extensions.add('GL_EXT_shader_texture_lod');
    }
    const args = this.args.map((arg) => unbracket(arg.toWebGL(indent, ctx)));
    return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    const args = this.args.map((arg) => unbracket(arg.toWebGL2(indent, ctx)));
    return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    let thisArgs = this.args;
    if (this.func) {
      let argsNew: ASTExpression[];
      const convertedArgs = convertArgs(thisArgs, this.func.funcType);
      if (convertedArgs) {
        argsNew = convertedArgs.args;
      }
      if (!argsNew) {
        throw new Error(`no matching overloading found for function '${this.name}'`);
      }
      thisArgs = argsNew.filter((val) => {
        const type = val.getType();
        if (
          type.isStructType() &&
          ctx.types.findIndex((t) => t instanceof ASTStructDefine && t.type.structName === type.structName) <
            0
        ) {
          return false;
        }
        return true;
      });
    }
    const args = thisArgs.map((arg) => unbracket(arg.toWGSL(indent, ctx)));
    return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
  }
  toString(deviceType: string): string {
    return `${this.name}(...)`;
  }
}

/** @internal */
export class ASTDeclareVar extends ShaderAST {
  /** @internal */
  value: ASTPrimitive;
  /** @internal */
  group: number;
  /** @internal */
  binding: number;
  /** @internal */
  blockName: string;
  constructor(exp: ASTPrimitive) {
    super();
    this.value = exp;
    this.group = 0;
    this.binding = 0;
  }
  isReference(): boolean {
    return true;
  }
  isPointer(): boolean {
    return this.value.getType().isPointerType();
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    let prefix = '';
    let builtin = false;
    let valueType = this.value.getType();
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
        if (ctx.type === ShaderType.Vertex) {
          prefix = 'attribute ';
          ctx.defines.push(
            `#define ${this.value.name} ${semanticToAttrib(
              ctx.vertexAttributes[this.value.value.$location]
            )}\n`
          );
        } else {
          prefix = 'varying ';
          // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
        }
        break;
      case DeclareType.DECLARE_TYPE_OUT:
        if (ctx.type === ShaderType.Vertex) {
          prefix = 'varying ';
          // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
        } else {
          builtin = true;
          if (ctx.mrt) {
            ctx.defines.push(`#define ${this.value.name} gl_FragData[${this.value.value.$location}]\n`);
            ctx.extensions.add('GL_EXT_draw_buffers');
          } else {
            ctx.defines.push(`#define ${this.value.name} gl_FragColor\n`);
          }
        }
        break;
      case DeclareType.DECLARE_TYPE_UNIFORM:
        prefix = 'uniform ';
        valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
        break;
      case DeclareType.DECLARE_TYPE_STORAGE:
        throw new Error(`invalid variable declare type: ${this.value.name}`);
    }
    if (!builtin) {
      return `${indent}${prefix}${valueType.toTypeName('webgl', this.value.name)};\n`;
    }
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    let prefix = '';
    const builtin = false;
    let valueType = this.value.getType();
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
        if (ctx.type === ShaderType.Fragment && valueType.isPrimitiveType() && valueType.isInteger()) {
          prefix = 'flat in ';
        } else {
          prefix = 'in ';
        }
        if (ctx.type === ShaderType.Vertex) {
          ctx.defines.push(
            `#define ${this.value.name} ${semanticToAttrib(
              ctx.vertexAttributes[this.value.value.$location]
            )}\n`
          );
        } else {
          // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
        }
        break;
      case DeclareType.DECLARE_TYPE_OUT:
        if (ctx.type === ShaderType.Vertex) {
          if (valueType.isPrimitiveType() && valueType.isInteger()) {
            prefix = 'flat out ';
          } else {
            prefix = 'out ';
          }
        } else {
          prefix = `layout(location = ${this.value.value.$location}) out `;
        }
        break;
      case DeclareType.DECLARE_TYPE_UNIFORM:
        if (valueType.isStructType()) {
          /*
          if (valueType.layout !== 'std140') {
            throw new errors.PBASTError(this, 'uniform buffer layout must be std140');
          }
          */
          return `${indent}layout(std140) uniform ${this.blockName} { ${valueType.structName} ${this.value.name}; };\n`;
        } else {
          valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
          return `${indent}uniform ${valueType.toTypeName('webgl2', this.value.name)};\n`;
        }
        break;
      case DeclareType.DECLARE_TYPE_STORAGE:
        throw new Error(`invalid variable declare type: ${this.value.name}`);
    }
    if (!builtin) {
      return `${indent}${prefix}${this.value.getType().toTypeName('webgl2', this.value.name)};\n`;
    }
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    let prefix: string;
    const builtin = false;
    const isBlock =
      this.value.getType().isPrimitiveType() ||
      this.value.getType().isStructType() ||
      this.value.getType().isArrayType();
    switch (this.value.value.$declareType) {
      case DeclareType.DECLARE_TYPE_IN:
      case DeclareType.DECLARE_TYPE_OUT:
        // prefix = `@location(${this.value.value.$location}) var<out> `;
        throw new Error(`Internal error`);
      case DeclareType.DECLARE_TYPE_UNIFORM:
        if (this.group === undefined) {
          debugger;
        }
        prefix = `@group(${this.group}) @binding(${this.binding}) var${isBlock ? '<uniform>' : ''} `;
        break;
      case DeclareType.DECLARE_TYPE_STORAGE:
        prefix = `@group(${this.group}) @binding(${this.binding}) var<storage, ${
          this.value.isWritable() || this.value.getType().haveAtomicMembers() ? 'read_write' : 'read'
        }> `;
        break;
      case DeclareType.DECLARE_TYPE_WORKGROUP:
        prefix = `var<workgroup> `;
        break;
      default:
        prefix = `${this.value.getType().isPointerType() ? 'let' : 'var'}${
          this.value.value.$global && !this.value.getType().isPointerType() ? '<private>' : ''
        } `;
    }
    if (!builtin) {
      const type = this.value.getType();
      const structName = type.isStructType() ? type.structName : null;
      if (
        structName &&
        ctx.types.findIndex((val) => val instanceof ASTStructDefine && val.type.structName === structName) < 0
      ) {
        return '';
      } else {
        return `${indent}${prefix}${type.toTypeName('webgpu', this.value.name)};\n`;
      }
    }
  }
  toString(deviceType: string): string {
    return this.value.toString(deviceType);
  }
}

/** @internal */
export class ASTFunction extends ASTScope {
  /** @internal */
  name: string;
  /** @internal */
  args: ASTFunctionParameter[];
  /** @internal */
  isBuiltin: boolean;
  /** @internal */
  isMainFunc: boolean;
  /** @internal */
  funcType: PBFunctionTypeInfo;
  /** @internal */
  builtins: string[];
  /** @internal */
  returnType: PBTypeInfo;
  constructor(
    name: string,
    args: ASTFunctionParameter[],
    isMainFunc: boolean,
    type: PBFunctionTypeInfo,
    isBuiltin = false
  ) {
    super();
    this.name = name;
    this.args = args;
    this.funcType = type;
    this.builtins = [];
    this.isBuiltin = isBuiltin;
    this.isMainFunc = isMainFunc;
    this.returnType = type ? type.returnType : null;
  }
  toWebGL(indent: string, ctx: ASTContext) {
    if (!this.isBuiltin) {
      let str = '';
      const p: string[] = [];
      for (const param of this.args) {
        let exp: PBShaderExp;
        let name: string;
        let qualifier: string;
        if (param.paramAST instanceof ASTPrimitive) {
          exp = param.paramAST.value;
          name = param.paramAST.name;
          qualifier = '';
        } else {
          exp = (param.paramAST.value as ASTPrimitive).value;
          name = (param.paramAST.value as ASTPrimitive).name;
          qualifier = `${exp.$inout} `;
        }
        p.push(`${qualifier}${param.getType().toTypeName('webgl', name)}`);
      }
      str += `${indent}${this.returnType.toTypeName('webgl')} ${this.name}(${p.join(',')}) {\n`;
      str += super.toWebGL(indent + '  ', ctx);
      str += `${indent}}\n`;
      return str;
    } else {
      return '';
    }
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    if (!this.isBuiltin) {
      let str = '';
      const p: string[] = [];
      for (const param of this.args) {
        let exp: PBShaderExp;
        let name: string;
        let qualifier: string;
        if (param.paramAST instanceof ASTPrimitive) {
          exp = param.paramAST.value;
          name = param.paramAST.name;
          qualifier = '';
        } else {
          exp = (param.paramAST.value as ASTPrimitive).value;
          name = (param.paramAST.value as ASTPrimitive).name;
          qualifier = `${exp.$inout} `;
        }
        p.push(`${qualifier}${param.getType().toTypeName('webgl2', name)}`);
      }
      str += `${indent}${this.returnType.toTypeName('webgl2')} ${this.name}(${p.join(',')}) {\n`;
      str += super.toWebGL2(indent + '  ', ctx);
      str += `${indent}}\n`;
      return str;
    } else {
      return '';
    }
  }
  toWGSL(indent: string, ctx: ASTContext) {
    if (!this.isBuiltin) {
      let str = '';
      const p: string[] = [...this.builtins];
      for (const param of this.args) {
        const name =
          param.paramAST instanceof ASTPrimitive
            ? param.paramAST.name
            : (param.paramAST.value as ASTPrimitive).name;
        const paramType =
          param.paramAST instanceof ASTPrimitive
            ? param.paramAST.getType()
            : (param.paramAST.value as ASTPrimitive).getType();
        const dataType = paramType.isPointerType() ? paramType.pointerType : paramType;
        if (
          dataType.isStructType() &&
          ctx.types.findIndex(
            (t) => t instanceof ASTStructDefine && t.type.structName === dataType.structName
          ) < 0
        ) {
          continue;
        }
        p.push(`${paramType.toTypeName('webgpu', name)}`);
      }
      let t = '';
      if (this.isMainFunc) {
        switch (ctx.type) {
          case ShaderType.Vertex:
            t = '@vertex ';
            break;
          case ShaderType.Fragment:
            t = '@fragment ';
            break;
          case ShaderType.Compute:
            t = `@compute @workgroup_size(${ctx.workgroupSize[0]}, ${ctx.workgroupSize[1]}, ${ctx.workgroupSize[2]}) `;
            break;
        }
      }
      const retName = this.returnType.isVoidType() ? null : this.returnType.toTypeName('webgpu');
      const retStr = retName ? ` -> ${retName}` : '';
      str += `${indent}${t}fn ${this.name}(${p.join(',')})${retStr} {\n`;
      str += super.toWGSL(indent + '  ', ctx);
      str += `${indent}}\n`;
      return str;
    } else {
      return '';
    }
  }
}

/** @internal */
export class ASTIf extends ASTScope {
  /** @internal */
  keyword: string;
  /** @internal */
  condition: ASTExpression;
  /** @internal */
  nextElse: ASTIf;
  constructor(keyword: string, condition: ASTExpression) {
    super();
    this.keyword = keyword;
    this.condition = condition;
    this.nextElse = null;
    if (this.condition instanceof ASTCallFunction) {
      this.condition.isStatement = false;
    }
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    let str = `${indent}${this.keyword} ${
      this.condition ? '(' + unbracket(this.condition.toWebGL(indent, ctx)) + ')' : ''
    } {\n`;
    str += super.toWebGL(indent + '  ', ctx);
    str += `${indent}}\n`;
    if (this.nextElse) {
      str += this.nextElse.toWebGL(indent, ctx);
    }
    return str;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    let str = `${indent}${this.keyword} ${
      this.condition ? '(' + unbracket(this.condition.toWebGL2(indent, ctx)) + ')' : ''
    } {\n`;
    str += super.toWebGL2(indent + '  ', ctx);
    str += `${indent}}\n`;
    if (this.nextElse) {
      str += this.nextElse.toWebGL2(indent, ctx);
    }
    return str;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    let str = `${indent}${this.keyword} ${
      this.condition ? '(' + unbracket(this.condition.toWGSL(indent, ctx)) + ')' : ''
    } {\n`;
    str += super.toWGSL(indent + '  ', ctx);
    str += `${indent}}\n`;
    if (this.nextElse) {
      str += this.nextElse.toWGSL(indent, ctx);
    }
    return str;
  }
}

/** @internal */
export class ASTRange extends ASTScope {
  /** @internal */
  init: ASTPrimitive;
  /** @internal */
  start: ASTExpression;
  /** @internal */
  end: ASTExpression;
  /** @internal */
  open: boolean;
  constructor(init: ASTPrimitive, start: ASTExpression, end: ASTExpression, open: boolean) {
    super();
    this.init = init;
    this.start = start;
    this.end = end;
    this.open = open;
    this.statements = [];
    if (this.start instanceof ASTCallFunction) {
      this.start.isStatement = false;
    }
    if (this.end instanceof ASTCallFunction) {
      this.end.isStatement = false;
    }
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    const init = this.init.getType().toTypeName('webgl', this.init.name);
    const start = unbracket(this.start.toWebGL(indent, ctx));
    const end = unbracket(this.end.toWebGL(indent, ctx));
    const comp = this.open ? '<' : '<=';
    let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}++) {\n`;
    str += super.toWebGL(indent + '  ', ctx);
    str += `${indent}}\n`;
    return str;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    const init = this.init.getType().toTypeName('webgl2', this.init.name);
    const start = unbracket(this.start.toWebGL2(indent, ctx));
    const end = unbracket(this.end.toWebGL2(indent, ctx));
    const comp = this.open ? '<' : '<=';
    let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}++) {\n`;
    str += super.toWebGL2(indent + '  ', ctx);
    str += `${indent}}\n`;
    return str;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    const init = `var ${this.init.getType().toTypeName('webgpu', this.init.name)}`;
    const start = unbracket(this.start.toWGSL(indent, ctx));
    const end = unbracket(this.end.toWGSL(indent, ctx));
    const incr = new ASTScalar(1, this.init.getType() as PBPrimitiveTypeInfo).toWGSL(indent, ctx);
    const comp = this.open ? '<' : '<=';
    let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name} = ${this.init.name} + ${incr}) {\n`;
    str += super.toWGSL(indent + '  ', ctx);
    str += `${indent}}\n`;
    return str;
  }
}

/** @internal */
export class ASTDoWhile extends ASTScope {
  /** @internal */
  condition: ASTExpression;
  constructor(condition: ASTExpression) {
    super();
    this.condition = condition;
    if (this.condition instanceof ASTCallFunction) {
      this.condition.isStatement = false;
    }
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    throw new Error(`No do-while() loop support for WebGL1.0 device`);
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    let str = `${indent}do {\n`;
    str += super.toWebGL2(indent + ' ', ctx);
    str += `${indent}} while(${unbracket(this.condition.toWebGL2(indent, ctx))});\n`;
    return str;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    let str = `${indent}loop {\n`;
    str += super.toWGSL(indent + ' ', ctx);
    str += `${indent}  if (!(${unbracket(this.condition.toWGSL(indent, ctx))})) { break; }\n`;
    str += `${indent}}\n`;
    return str;
  }
}

/** @internal */
export class ASTWhile extends ASTScope {
  /** @internal */
  condition: ASTExpression;
  constructor(condition: ASTExpression) {
    super();
    this.condition = condition;
    if (this.condition instanceof ASTCallFunction) {
      this.condition.isStatement = false;
    }
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    let str = `${indent}for(int z_tmp_counter = 0; z_tmp_counter == 0; z_tmp_counter += 0) {\n`;
    const indent2 = indent + '  ';
    str += `${indent2}if(!(${unbracket(this.condition.toWebGL(indent, ctx))})){ break; }\n`;
    str += super.toWebGL(indent2, ctx);
    str += `${indent}}\n`;
    return str;
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    let str = `${indent}while(${unbracket(this.condition.toWebGL2(indent, ctx))}) {\n`;
    str += super.toWebGL2(indent + '  ', ctx);
    str += `${indent}}\n`;
    return str;
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    let str = `${indent}for(;${unbracket(this.condition.toWGSL(indent, ctx))};) {\n`;
    str += super.toWGSL(indent + '  ', ctx);
    str += `${indent}}\n`;
    return str;
    /*
    let str = `${indent}loop {\n`;
    const newIndent = indent + '  ';
    str += `${newIndent}if (!(${unbracket(this.condition.toWGSL(indent, ctx))})) { break; }\n`;
    str += super.toWGSL(newIndent, ctx);
    str += `${indent}}\n`;
    return str;
    */
  }
}

/** @internal */
export class ASTStructDefine extends ShaderAST {
  /** @internal */
  type: PBStructTypeInfo;
  /** @internal */
  prefix: string[];
  /** @internal */
  builtin: boolean;
  constructor(type: PBStructTypeInfo, builtin: boolean) {
    super();
    this.prefix = null;
    this.builtin = builtin;
    this.type = type;
  }
  getType(): PBStructTypeInfo {
    return this.type;
  }
  toWebGL(indent: string, ctx: ASTContext): string {
    if (!this.builtin) {
      let str = `${indent}struct ${this.type.structName} {\n`;
      for (const arg of this.type.structMembers) {
        str += `${indent}  ${arg.type.toTypeName('webgl', arg.name)};\n`;
      }
      str += `${indent}};\n`;
      return str;
    } else {
      return '';
    }
  }
  toWebGL2(indent: string, ctx: ASTContext): string {
    if (!this.builtin) {
      let str = `${indent}struct ${this.type.structName} {\n`;
      for (const arg of this.type.structMembers) {
        str += `${indent}  ${arg.type.toTypeName('webgl2', arg.name)};\n`;
      }
      str += `${indent}};\n`;
      return str;
    } else {
      return '';
    }
  }
  toWGSL(indent: string, ctx: ASTContext): string {
    if (!this.builtin) {
      let str = `${indent}struct ${this.type.structName} {\n`;
      str += this.type.structMembers
        .map((arg, i) => {
          const prefix = this.prefix ? this.prefix[i] : '';
          const sizePrefix =
            arg.type.getLayoutSize(this.type.layout) !== arg.type.getLayoutSize('default')
              ? `@size(${arg.type.getLayoutSize(this.type.layout)}) `
              : '';
          const alignPrefix =
            i > 0 && arg.type.getLayoutAlignment(this.type.layout) !== arg.type.getLayoutAlignment('default')
              ? `@align(${arg.type.getLayoutAlignment(this.type.layout)}) `
              : '';
          return `${indent}  ${prefix}${alignPrefix}${sizePrefix}${arg.type.toTypeName('webgpu', arg.name)}`;
        })
        .join(',\n');
      str += `\n${indent}};\n`;
      return str;
    } else {
      return '';
    }
  }
}

function convertArgs(
  args: (number | boolean | ASTExpression)[],
  overload: PBFunctionTypeInfo
): { name: string; args: ASTExpression[] } {
  if (args.length !== overload.argTypes.length) {
    return null;
  }
  const result: ASTExpression[] = [];
  for (let i = 0; i < args.length; i++) {
    const isRef = !!overload.argTypes[i].byRef;
    const argType = isRef
      ? (overload.argTypes[i].type as PBPointerTypeInfo).pointerType
      : overload.argTypes[i].type;
    const arg = args[i];
    if (typeof arg === 'number') {
      if (
        !isRef &&
        argType.isPrimitiveType() &&
        argType.isScalarType() &&
        argType.primitiveType !== PBPrimitiveType.BOOL
      ) {
        result.push(new ASTScalar(arg, argType));
      } else {
        return null;
      }
    } else if (typeof arg === 'boolean') {
      if (!isRef && argType.isPrimitiveType() && argType.primitiveType === PBPrimitiveType.BOOL) {
        result.push(new ASTScalar(arg, argType));
      } else {
        return null;
      }
    } else if (argType.isCompatibleType(arg.getType())) {
      if (isRef) {
        arg.markWritable();
        result.push(new ASTAddressOf(arg));
      } else {
        result.push(arg);
      }
    } else {
      return null;
    }
  }
  return { name: overload.name, args: result };
}
