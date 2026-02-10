import { ShaderType } from '../base_types';
import type { PBTextureTypeInfo, PBTypeInfo } from './types';
import { PBPrimitiveType, PBPrimitiveTypeInfo, PBTextureType, PBAddressSpace } from './types';
import type { PBGlobalScope } from './programbuilder';
import type { PBShaderExp } from './base';
import type { Nullable } from '@zephyr3d/base';

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
      throw new Error(`Invalid shader type: ${shaderType}`);
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
      throw new Error(`Invalid shader type: ${shaderType}`);
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
      throw new Error(`Invalid shader type: ${shaderType}`);
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
      throw new Error(`Invalid shader type: ${shaderType}`);
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
      throw new Error(`Invalid shader type: ${shaderType}`);
  }
}

/** @internal */
export function getTextureSampleType(type: PBTextureTypeInfo) {
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
      throw new Error(`Invalid texture type: ${type}`);
  }
}

/** @internal */
export function genSamplerName(textureName: string, comparison: boolean) {
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

interface ASTContext {
  type: ShaderType;
  mrt: boolean;
  defines: string[];
  extensions: Set<string>;
  builtins: string[];
  inputs: ShaderAST[];
  outputs: ShaderAST[];
  types: ShaderAST[];
  typeReplacement: Nullable<Map<PBShaderExp, PBTypeInfo>>;
  global: PBGlobalScope;
  vertexAttributes: number[];
  workgroupSize: Nullable<[number, number, number]>;
}

/** @internal */
export abstract class ShaderAST {
  isReference() {
    return false;
  }
  isPointer() {
    return !!this.getType()?.isPointerType();
  }
  getType(): Nullable<PBTypeInfo> {
    return null;
  }
  toWebGL(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWebGL2(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWGSL(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toString(_deviceType: string) {
    return this.constructor.name;
  }
}

/** @internal */
export abstract class ASTExpression extends ShaderAST {
  //abstract getType(): PBTypeInfo;
  abstract markWritable(): void;
  abstract isWritable(): boolean;
  abstract getAddressSpace(): Nullable<PBAddressSpace>;
  abstract isConstExp(): boolean;
}

/** @internal */
export class ASTFunctionParameter extends ASTExpression {
  /** @internal */
  paramAST: ASTPrimitive;
  /** @internal */
  writable: boolean;
  constructor(init: ASTPrimitive) {
    super();
    this.paramAST = init;
    this.writable = false;
  }
  getType() {
    return this.paramAST.getType();
  }
  markWritable() {
    if (this.paramAST instanceof ASTPrimitive) {
      console.warn(`Write to non-output parameter ${this.paramAST.value.$str}`);
    }
    this.writable = true;
  }
  isWritable() {
    return this.writable;
  }
  getAddressSpace() {
    return this.paramAST.getAddressSpace();
  }
  isConstExp() {
    return this.paramAST.isConstExp();
  }
  isReference() {
    return this.paramAST.isReference();
  }
  toWebGL(indent: string, ctx: ASTContext) {
    return this.paramAST.toWebGL(indent, ctx);
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return this.paramAST.toWebGL2(indent, ctx);
  }
  toWGSL(indent: string, ctx: ASTContext) {
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
  toWebGL(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWebGL2(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWGSL(_indent: string, _ctx: ASTContext) {
    return '';
  }
}

/** @internal */
export class ASTNakedScope extends ASTScope {
  toWebGL(indent: string, ctx: ASTContext) {
    return `${indent}{\n${super.toWebGL(indent + ' ', ctx)}${indent}}\n`;
  }
  toWebGL2(indent: string, ctx: ASTContext) {
    return `${indent}{\n${super.toWebGL2(indent + ' ', ctx)}${indent}}\n`;
  }
  toWGSL(indent: string, ctx: ASTContext) {
    return `${indent}{\n${super.toWGSL(indent + ' ', ctx)}${indent}}\n`;
  }
}

/** @internal */
export class ASTGlobalScope extends ASTScope {
  constructor() {
    super();
  }
  toWebGL(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWebGL2(_indent: string, _ctx: ASTContext) {
    return '';
  }
  toWGSL(_indent: string, _ctx: ASTContext) {
    return '';
  }
}

/** @internal */
export class ASTPrimitive extends ASTExpression {
  /** @internal */
  value: PBShaderExp;
  /** @internal */
  ref: Nullable<ASTExpression>;
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
  get name() {
    return this.value.$str;
  }
  isReference() {
    return true;
  }
  isConstExp() {
    return this.constExp;
  }
  markWritable() {
    this.writable = true;
    this.constExp = false;
    if (this.ref) {
      this.ref.markWritable();
    }
  }
  isWritable() {
    const type = this.getType();
    return (
      this.writable ||
      type.isAtomicI32() ||
      type.isAtomicU32() ||
      (type.isStructType() && type.haveAtomicMembers())
    );
  }
  getAddressSpace() {
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
  getType() {
    return this.value.$typeinfo;
  }
  toWebGL(_indent: string, _ctx: ASTContext) {
    return this.name;
  }
  toWebGL2(_indent: string, _ctx: ASTContext) {
    return this.name;
  }
  toWGSL(indent: string, ctx: ASTContext) {
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
  toString(_deviceType: string) {
    return this.name;
  }
}

/** @internal */
export abstract class ASTLValue extends ShaderAST {
  // abstract getType(): PBTypeInfo;
  abstract markWritable(): void;
  abstract isWritable(): boolean;
}
