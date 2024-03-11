/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AbstractDevice, ShaderKind } from '../base_types';
import { ShaderType } from '../base_types';
import type { GPUProgram, BindGroupLayout, BindGroupLayoutEntry, VertexSemantic } from '../gpuobject';
import { MAX_BINDING_GROUPS, getVertexAttribByName } from '../gpuobject';
import type { PBReflectionTagGetter } from './reflection';
import { PBReflection } from './reflection';
import type { ShaderExpTagValue, ShaderTypeFunc } from './base';
import {
  PBShaderExp,
  setCurrentProgramBuilder,
  getCurrentProgramBuilder,
  makeConstructor,
  Proxiable
} from './base';
import * as AST from './ast';
import * as errors from './errors';
import { setBuiltinFuncs } from './builtinfunc';
import { setConstructors } from './constructors';
import type { PBPrimitiveTypeInfo, PBStructLayout, PBTextureTypeInfo, PBTypeInfo } from './types';
import {
  PBArrayTypeInfo,
  PBFunctionTypeInfo,
  PBPrimitiveType,
  PBSamplerAccessMode,
  PBStructTypeInfo,
  typeBool,
  typeF32,
  typeFrexpResult,
  typeFrexpResultVec2,
  typeFrexpResultVec3,
  typeFrexpResultVec4,
  typeI32,
  typeU32,
  typeVoid,
  typeTex2D,
  typeTexCube,
  typeTex2DArray,
  PBPointerTypeInfo,
  PBAddressSpace
} from './types';

import type { StorageTextureConstructor } from './constructors';

const COMPUTE_UNIFORM_NAME = 'ch_compute_uniform_block';
const COMPUTE_STORAGE_NAME = 'ch_compute_storage_block';
const VERTEX_UNIFORM_NAME = 'ch_vertex_uniform_block';
const FRAGMENT_UNIFORM_NAME = 'ch_fragment_uniform_block';
const SHARED_UNIFORM_NAME = 'ch_shared_uniform_block';
const VERTEX_STORAGE_NAME = 'ch_vertex_storage_block';
const FRAGMENT_STORAGE_NAME = 'ch_fragment_storage_block';
const SHARED_STORAGE_NAME = 'ch_shared_storage_block';
interface UniformInfo {
  group: number;
  binding: number;
  mask: number;
  block?: {
    name: string;
    dynamicOffset: boolean;
    exp: PBShaderExp;
  };
  texture?: {
    autoBindSampler: 'sample' | 'comparison';
    exp: PBShaderExp;
  };
  sampler?: PBShaderExp;
}

/**
 * Non-array value type of shader expression
 * @public
 */
export type ExpValueNonArrayType = number | boolean | PBShaderExp;
/**
 * Value type for shader of shader expression
 * @public
 */
export type ExpValueType = ExpValueNonArrayType | Array<ExpValueType>;

const input_prefix = 'zVSInput_';
const output_prefix_vs = 'zVSOutput_';
const output_prefix_fs = 'zFSOutput_';

/**
 * Render program build options
 * @public
 */
export interface PBRenderOptions {
  /** program label for debugging */
  label?: string;
  /**
   * Vertex shader generator.
   * @param this - Global scope object of the vertex shader
   * @param pb - The program builder instance
   */
  vertex(this: PBGlobalScope, pb: ProgramBuilder);
  /**
   * Fragment shader generator.
   * @param this - Global scope object of the fragment shader
   * @param pb - The program builder instance
   */
  fragment(this: PBGlobalScope, pb: ProgramBuilder);
}

/**
 * Compute program build options
 * @public
 */
export interface PBComputeOptions {
  /** program label for debugging */
  label?: string;
  /** workgroup size */
  workgroupSize: [number, number, number];
  /** compute shader */
  compute(this: PBGlobalScope, pb: ProgramBuilder);
}

type StructDef = {
  structs: Record<string, ShaderTypeFunc>;
  types: AST.ASTStructDefine[];
};

/**
 * The program builder interface
 * @public
 */
export interface ProgramBuilder {
  /** Get the device */
  getDevice(): AbstractDevice;
  /** Gets the global scope */
  getGlobalScope(): PBGlobalScope;
  /** Gets the current scope */
  getCurrentScope(): PBScope;
  /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */
  queryGlobal(name: string): PBShaderExp;
  /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */
  $query(name: string): PBShaderExp;
  /**
   * Generates shader codes for a render program
   * @param options - The build options
   * @returns a tuple made by vertex shader source, fragment shader source, bind group layouts and vertex attributes used, or null if build faild
   */
  buildRender(options: PBRenderOptions): readonly [string, string, BindGroupLayout[], number[]];
  /**
   * Generates shader code for a compute program
   * @param options - The build programs
   * @returns a tuple made by compute shader source and bind group layouts, or null if build failed
   */
  buildCompute(options: PBComputeOptions): readonly [string, BindGroupLayout[]];
  /**
   * Creates a shader program for render
   * @param options - The build options
   * @returns The created program or null if build failed
   */
  buildRenderProgram(options: PBRenderOptions): GPUProgram;
  /**
   * Creates a shader program for compute
   * @param options - The build options
   * @returns The created program or null if build failed
   */
  buildComputeProgram(options: PBComputeOptions): GPUProgram;
  /**
   * Creates a structure type variable
   * @param structName - Name of the structure type
   * @param instanceName - Name of the variable
   * @returns the created variable
   */
  struct(structName: string, instanceName: string): PBShaderExp;
  /**
   * Defines a structure type
   * @param members - Members of the structure
   * @param structName - Name of the type, if not given, the name will be automatically generated
   * @returns The structure type constructor
   */
  defineStruct(members: PBShaderExp[], structName?: string): ShaderTypeFunc;
  /**
   * Defines a structure type
   * @param structType - The structure type info
   * @returns The structure type constructor
   */
  defineStructByType(structType: PBStructTypeInfo): ShaderTypeFunc;
  /**
   * Creates a 'discard' statement
   */
  discard(): void;
  /**
   * Creates a function
   * @param name - Name of the function
   * @param params - Parameters of the function
   * @param body - The generator function
   */
  func(name: string, params: PBShaderExp[], body?: (this: PBFunctionScope) => void): void;
  /**
   * Create the main entry function of the shader
   * @param body - The shader generator function
   */
  main(body?: (this: PBFunctionScope) => void): void;
  /**
   * Create an 'AddressOf' expression for WGSL
   * @param ref - The reference variable
   * @returns the 'AddressOf' expression
   */
  addressOf(ref: PBShaderExp): PBShaderExp;
  /**
   * Creates a 'referenceOf' expression for WGSL
   * @param ptr - The pointer variable
   * @returns the 'referenceOf' expression
   */
  referenceOf(ptr: PBShaderExp): PBShaderExp;
  /** float type variable constructors */
  float: {
    (): PBShaderExp;
    (rhs: number): PBShaderExp;
    (rhs: boolean): PBShaderExp;
    (rhs: PBShaderExp): PBShaderExp;
    (name: string): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** int type variable constructors */
  int: {
    (): PBShaderExp;
    (rhs: number | boolean | PBShaderExp | string): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** uint type variable constructors */
  uint: {
    (): PBShaderExp;
    (rhs: number | boolean | PBShaderExp | string): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** boolean type variable constructors */
  bool: {
    (): PBShaderExp;
    (rhs: number | boolean | PBShaderExp | string): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** vec2 type variable constructors */
  vec2: {
    (): PBShaderExp;
    (rhs: number | PBShaderExp | string): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** ivec2 type variable constructors */
  ivec2: {
    (): PBShaderExp;
    (rhs: number | PBShaderExp | string): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** uvec2 type variable constructors */
  uvec2: {
    (): PBShaderExp;
    (rhs: number | PBShaderExp | string): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** bvec2 type variable constructors */
  bvec2: {
    (): PBShaderExp;
    (rhs: number | boolean | PBShaderExp | string): PBShaderExp;
    (x: number | boolean | PBShaderExp, y: number | boolean | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** vec3 type variable constructors */
  vec3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** ivec3 type variable constructors */
  ivec3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** uvec3 type variable constructors */
  uvec3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** bvec3 type variable constructors */
  bvec3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: boolean | PBShaderExp): PBShaderExp;
    (x: boolean | PBShaderExp, y: boolean | PBShaderExp, z: boolean | PBShaderExp): PBShaderExp;
    (x: boolean | PBShaderExp, yz: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: boolean | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** vec4 type variable constructors */
  vec4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (
      x: number | PBShaderExp,
      y: number | PBShaderExp,
      z: number | PBShaderExp,
      w: number | PBShaderExp
    ): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yzw: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (xyz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** ivec4 type variable constructors */
  ivec4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (
      x: number | PBShaderExp,
      y: number | PBShaderExp,
      z: number | PBShaderExp,
      w: number | PBShaderExp
    ): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yzw: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (xyz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** uvec4 type variable constructors */
  uvec4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: number | PBShaderExp): PBShaderExp;
    (
      x: number | PBShaderExp,
      y: number | PBShaderExp,
      z: number | PBShaderExp,
      w: number | PBShaderExp
    ): PBShaderExp;
    (x: number | PBShaderExp, y: number | PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (x: number | PBShaderExp, yzw: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: number | PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (xyz: PBShaderExp, w: number | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** bvec4 type variable constructors */
  bvec4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (x: boolean | PBShaderExp): PBShaderExp;
    (
      x: boolean | PBShaderExp,
      y: boolean | PBShaderExp,
      z: boolean | PBShaderExp,
      w: boolean | PBShaderExp
    ): PBShaderExp;
    (x: boolean | PBShaderExp, y: boolean | PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (x: boolean | PBShaderExp, yz: PBShaderExp, w: boolean | PBShaderExp): PBShaderExp;
    (x: boolean | PBShaderExp, yzw: PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, z: boolean | PBShaderExp, w: boolean | PBShaderExp): PBShaderExp;
    (xy: PBShaderExp, zw: PBShaderExp): PBShaderExp;
    (xyz: PBShaderExp, w: boolean | PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat2 type variable constructors */
  mat2: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat2x3 type variable constructors */
  mat2x3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat2x4 type variable constructors */
  mat2x4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m03: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp,
      m13: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat3 type variable constructors */
  mat3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp,
      m22: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat3x2 type variable constructors */
  mat3x2: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat3x4 type variable constructors */
  mat3x4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m03: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp,
      m13: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp,
      m22: number | PBShaderExp,
      m23: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat4 type variable constructors */
  mat4: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m03: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp,
      m13: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp,
      m22: number | PBShaderExp,
      m23: number | PBShaderExp,
      m30: number | PBShaderExp,
      m31: number | PBShaderExp,
      m32: number | PBShaderExp,
      m33: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp, m3: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat4x2 type variable constructors */
  mat4x2: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp,
      m30: number | PBShaderExp,
      m31: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp, m3: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** mat4x3 type variable constructors */
  mat4x3: {
    (): PBShaderExp;
    (name: string): PBShaderExp;
    (
      m00: number | PBShaderExp,
      m01: number | PBShaderExp,
      m02: number | PBShaderExp,
      m10: number | PBShaderExp,
      m11: number | PBShaderExp,
      m12: number | PBShaderExp,
      m20: number | PBShaderExp,
      m21: number | PBShaderExp,
      m22: number | PBShaderExp,
      m30: number | PBShaderExp,
      m31: number | PBShaderExp,
      m32: number | PBShaderExp
    ): PBShaderExp;
    (m0: PBShaderExp, m1: PBShaderExp, m2: PBShaderExp, m3: PBShaderExp): PBShaderExp;
    ptr: ShaderTypeFunc;
    [dim: number]: ShaderTypeFunc;
  };
  /** tex1D type variable constructors */
  tex1D(rhs?: string): PBShaderExp;
  /** tex2D type variable constructors */
  tex2D(rhs?: string): PBShaderExp;
  /** tex3D type variable constructors */
  tex3D(rhs?: string): PBShaderExp;
  /** texCube type variable constructors */
  texCube(rhs?: string): PBShaderExp;
  /** texExternal type variable constructors */
  texExternal(rhs?: string): PBShaderExp;
  /** tex2DShadow type variable constructors */
  tex2DShadow(rhs?: string): PBShaderExp;
  /** texCubeShadow type variable constructors */
  texCubeShadow(rhs?: string): PBShaderExp;
  /** tex2DArray type variable constructors */
  tex2DArray(rhs?: string): PBShaderExp;
  /** tex2DArrayShadow type variable constructors */
  tex2DArrayShadow(rhs?: string): PBShaderExp;
  /** itex1D type variable constructors */
  itex1D(rhs?: string): PBShaderExp;
  /** itex2D type variable constructors */
  itex2D(rhs?: string): PBShaderExp;
  /** itex3D type variable constructors */
  itex3D(rhs?: string): PBShaderExp;
  /** itexCube type variable constructors */
  itexCube(rhs?: string): PBShaderExp;
  /** itex2DArray type variable constructors */
  itex2DArray(rhs?: string): PBShaderExp;
  /** utex1D type variable constructors */
  utex1D(rhs?: string): PBShaderExp;
  /** utex2D type variable constructors */
  utex2D(rhs?: string): PBShaderExp;
  /** utex3D type variable constructors */
  utex3D(rhs?: string): PBShaderExp;
  /** utexCube type variable constructors */
  utexCube(rhs?: string): PBShaderExp;
  /** utex2DArray type variable constructors */
  utex2DArray(rhs?: string): PBShaderExp;
  /** texStorage1D type variable constructors */
  texStorage1D: StorageTextureConstructor;
  /** texStorage2D type variable constructors */
  texStorage2D: StorageTextureConstructor;
  /** texStorage2DArray type variable constructors */
  texStorage2DArray: StorageTextureConstructor;
  /** texStorage3D type variable constructors */
  texStorage3D: StorageTextureConstructor;
  /** sampler type variable constructors */
  sampler(rhs?: string): PBShaderExp;
  /** samplerComparison type variable constructors */
  samplerComparison(rhs?: string): PBShaderExp;
  /** Same as radians builtin function in GLSL and WGSL */
  radians(val: number | PBShaderExp): PBShaderExp;
  /** Same as degrees builtin function in GLSL and WGSL */
  degrees(val: number | PBShaderExp): PBShaderExp;
  /** Same as sin builtin function in GLSL and WGSL */
  sin(val: number | PBShaderExp): PBShaderExp;
  /** Same as cos builtin function in GLSL and WGSL */
  cos(val: number | PBShaderExp): PBShaderExp;
  /** Same as tan builtin function in GLSL and WGSL */
  tan(val: number | PBShaderExp): PBShaderExp;
  /** Same as asin builtin function in GLSL and WGSL */
  asin(val: number | PBShaderExp): PBShaderExp;
  /** Same as acos builtin function in GLSL and WGSL */
  acos(val: number | PBShaderExp): PBShaderExp;
  /** Same as atan builtin function in GLSL and WGSL */
  atan(val: number | PBShaderExp): PBShaderExp;
  /** Same as atan builtin function in GLSL and atan2 builtin function in WGSL */
  atan2(y: number | PBShaderExp, x: number | PBShaderExp): PBShaderExp;
  /** Same as sinh builtin function in GLSL and WGSL */
  sinh(val: number | PBShaderExp): PBShaderExp;
  /** Same as cosh builtin function in GLSL and WGSL */
  cosh(val: number | PBShaderExp): PBShaderExp;
  /** Same as tanh builtin function in GLSL and WGSL */
  tanh(val: number | PBShaderExp): PBShaderExp;
  /** Same as asinh builtin function in GLSL and WGSL */
  asinh(val: number | PBShaderExp): PBShaderExp;
  /** Same as acosh builtin function in GLSL and WGSL */
  acosh(val: number | PBShaderExp): PBShaderExp;
  /** Same as atanh builtin function in GLSL and WGSL */
  atanh(val: number | PBShaderExp): PBShaderExp;
  /** Same as pow builtin function in GLSL and WGSL */
  pow(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as exp builtin function in GLSL and WGSL */
  exp(val: number | PBShaderExp): PBShaderExp;
  /** Same as exp2 builtin function in GLSL and WGSL */
  exp2(val: number | PBShaderExp): PBShaderExp;
  /** Same as log builtin function in GLSL and WGSL */
  log(val: number | PBShaderExp): PBShaderExp;
  /** Same as log2 builtin function in GLSL and WGSL */
  log2(val: number | PBShaderExp): PBShaderExp;
  /** Same as sqrt builtin function in GLSL and WGSL */
  sqrt(val: number | PBShaderExp): PBShaderExp;
  /** Same as inversesqrt builtin function in GLSL and WGSL */
  inverseSqrt(val: number | PBShaderExp): PBShaderExp;
  /** Same as abs builtin function in GLSL and WGSL */
  abs(val: number | PBShaderExp): PBShaderExp;
  /** Same as sign builtin function in GLSL and WGSL */
  sign(val: number | PBShaderExp): PBShaderExp;
  /** Same as floor builtin function in GLSL and WGSL */
  floor(val: number | PBShaderExp): PBShaderExp;
  /** Same as ceil builtin function in GLSL and WGSL */
  ceil(val: number | PBShaderExp): PBShaderExp;
  /** Same as fract builtin function in GLSL and WGSL */
  fract(val: number | PBShaderExp): PBShaderExp;
  /** Same as mod builtin function in GLSL and WGSL */
  mod(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as fma builtin function in WGSL, only valid for WebGPU device */
  fma(x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
  /** Same as round builtin function in WGSL, only valid for WebGPU device */
  round(val: number | PBShaderExp): PBShaderExp;
  /** Same as trunc builtin function in WGSL, only valid for WebGPU device */
  trunc(val: number | PBShaderExp): PBShaderExp;
  /** Same as min builtin function in GLSL and WGSL */
  min(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as max builtin function in GLSL and WGSL */
  max(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as clamp builtin function in GLSL and WGSL */
  clamp(x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
  /** Same as mix builtin function in GLSL and WGSL */
  mix(x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
  /** Same as step builtin function in GLSL and WGSL */
  step(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as smoothstep builtin function in GLSL and WGSL */
  smoothStep(x: number | PBShaderExp, y: number | PBShaderExp, z: number | PBShaderExp): PBShaderExp;
  /** Same as isnan builtin function in GLSL, only valid for WebGL2 device */
  isnan(x: number | PBShaderExp): PBShaderExp;
  /** Same as isinf builtin function in GLSL, only valid for WebGL2 device */
  isinf(x: number | PBShaderExp): PBShaderExp;
  /** add two values */
  add_2(x: number | PBShaderExp, y: number | PBShaderExp);
  /** add a couple of values togeter */
  add(x: number | PBShaderExp, ...rest: (number | PBShaderExp)[]);
  /** subtract two values */
  sub(x: number | PBShaderExp, y: number | PBShaderExp);
  /** multiply two values */
  mul_2(x: number | PBShaderExp, y: number | PBShaderExp);
  /** multiply a couple of values togeter */
  mul(x: number | PBShaderExp, ...rest: (number | PBShaderExp)[]);
  /** divide the first number by the second number */
  div(x: number | PBShaderExp, y: number | PBShaderExp);
  /** Same as length builtin function in GLSL and WGSL */
  length(x: number | PBShaderExp): PBShaderExp;
  /** Same as distance builtin function in GLSL and WGSL */
  distance(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** Same as dot builtin function in GLSL and WGSL */
  dot(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** Same as cross builtin function in GLSL and WGSL */
  cross(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** Same as normalize builtin function in GLSL and WGSL. */
  normalize(x: PBShaderExp): PBShaderExp;
  /** Same as faceForward builtin function in WGSL, only valid for WebGPU device */
  faceForward(x: PBShaderExp, y: PBShaderExp, z: PBShaderExp): PBShaderExp;
  /** Same as reflect builtin function in GLSL and WGSL */
  reflect(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** Same as refract builtin function in GLSL and WGSL */
  refract(x: PBShaderExp, y: PBShaderExp, z: number | PBShaderExp): PBShaderExp;
  /** Same as frexp builtin function in WGSL, only valid for WebGPU device */
  frexp(x: number | PBShaderExp): PBShaderExp;
  /** Same as outerProduct builtin function in GLSL, only valid for WebGL2 device */
  outerProduct(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** Same as transpose builtin function in GLSL and WGSL, only valid for WebGL2 and WebGPU device */
  transpose(mat: PBShaderExp): PBShaderExp;
  /** Same as determinant builtin function in GLSL and WGSL, only valid for WebGL2 and WebGPU device */
  determinant(mat: PBShaderExp): PBShaderExp;
  /** Same as inverse builtin function in GLSL, only valid for WebGL2 device */
  inverse(mat: PBShaderExp): PBShaderExp;
  /** return true if x is less than y, otherwise false */
  lessThan(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** return true if x is less than or equals y, otherwise false, per component */
  lessThanEqual(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** return true if x is greater than y, otherwise false, per component */
  greaterThan(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** return true if x is greater than or equals y, otherwise false, per component */
  greaterThanEqual(x: number | PBShaderExp, y: number | PBShaderExp): PBShaderExp;
  /** return true if x equals y, otherwise false, per component */
  compEqual(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** return true if x is not equal to y, otherwise false, per component */
  compNotEqual(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** return true if x equals y, otherwise false */
  equal(x: PBShaderExp | number, y: PBShaderExp | number): PBShaderExp;
  /** return true if x is not equal to y, otherwise false */
  notEqual(x: PBShaderExp | number, y: PBShaderExp | number): PBShaderExp;
  /** return x && y */
  and_2(x: PBShaderExp | number | boolean, y: PBShaderExp | number | boolean): PBShaderExp;
  /** return x && y && ... */
  and(
    x: PBShaderExp | number | boolean,
    y: PBShaderExp | number | boolean,
    ...rest: (PBShaderExp | number | boolean)[]
  );
  /** return x & y, per component */
  compAnd(x: PBShaderExp | number, y: PBShaderExp | number): PBShaderExp;
  /** return x ^ y, per component */
  compXor(x: PBShaderExp | number, y: PBShaderExp | number): PBShaderExp;
  /** return x || y */
  or_2(x: PBShaderExp | boolean, y: PBShaderExp | boolean): PBShaderExp;
  /** return x || y */
  or(x: PBShaderExp | boolean, y: PBShaderExp | boolean, ...rest: (PBShaderExp | boolean)[]): PBShaderExp;
  /** return x || y, per component */
  compOr(x: PBShaderExp | number | boolean, y: PBShaderExp | number | boolean): PBShaderExp;
  /** check whether any element of a boolean vector is true */
  any(x: PBShaderExp): PBShaderExp;
  /** check whether all elements of a boolean vector are true */
  all(x: PBShaderExp): PBShaderExp;
  /** logically invert a boolean vector */
  not(x: boolean | PBShaderExp): PBShaderExp;
  /** return the negate of the given value */
  neg(x: number | PBShaderExp): PBShaderExp;
  /** shift arithmetic left, not valid for WebGL1 device */
  sal(a: number | PBShaderExp, b: number | PBShaderExp);
  /** shift arithmetic right, not valid for WebGL1 device */
  sar(a: number | PBShaderExp, b: number | PBShaderExp);
  /** Same as the arrayLength builtin function in WGSL, only valid for WebGPU device */
  arrayLength(x: PBShaderExp): PBShaderExp;
  /** Same as the select builtin function in WGSL, only valid for WebGPU device */
  select(x: number | PBShaderExp, y: number | PBShaderExp, cond: boolean | PBShaderExp): PBShaderExp;
  /** Same as floatBitsToInt builtin function in GLSL, only valid for WebGL2 device */
  floatBitsToInt(x: number | PBShaderExp): PBShaderExp;
  /** Same as floatBitsToUint builtin function in GLSL, only valid for WebGL2 device */
  floatBitsToUint(x: number | PBShaderExp): PBShaderExp;
  /** Same as intBitsToFloat builtin function in GLSL, only valid for WebGL2 device */
  intBitsToFloat(x: number | PBShaderExp): PBShaderExp;
  /** Same as uintBitsToFloat builtin function in GLSL, only valid for WebGL2 device */
  uintBitsToFloat(x: number | PBShaderExp): PBShaderExp;
  /** Same as pack4x8snorm builtin function in WGSL, only valid for WebGPU device */
  pack4x8snorm(x: PBShaderExp): PBShaderExp;
  /** Same as unpack4x8snorm builtin function in WGSL, only valid for WebGPU device */
  unpack4x8snorm(x: number | PBShaderExp): PBShaderExp;
  /** Same as pack4x8unorm builtin function in WGSL, only valid for WebGPU device */
  pack4x8unorm(x: PBShaderExp): PBShaderExp;
  /** Same as unpack4x8unorm builtin function in WGSL, only valid for WebGPU device */
  unpack4x8unorm(x: number | PBShaderExp): PBShaderExp;
  /** Same as pack2x16snom builtin function in WGSL, only valid for WebGPU device */
  pack2x16snorm(x: PBShaderExp): PBShaderExp;
  /** Same as unpack2x16snorm builtin function in WGSL, only valid for WebGPU device */
  unpack2x16snorm(x: number | PBShaderExp): PBShaderExp;
  /** Same as pack2x16unorm builtin function in WGSL, only valid for WebGPU device */
  pack2x16unorm(x: PBShaderExp): PBShaderExp;
  /** Same as unpack2x16unorm builtin function in WGSL, only valid for WebGPU device */
  unpack2x16unorm(x: number | PBShaderExp): PBShaderExp;
  /** Same as pack2x16float builtin function in WGSL, only valid for WebGPU device */
  pack2x16float(x: PBShaderExp): PBShaderExp;
  /** Same as unpack2x16float builtin function in WGSL, only valid for WebGPU device */
  unpack2x16float(x: number | PBShaderExp): PBShaderExp;
  /** Same as matrixCompMult builtin function in GLSL, only valid for WebGL/WebGL2 device */
  matrixCompMult(x: PBShaderExp, y: PBShaderExp): PBShaderExp;
  /** Same as dFdx builtin function in GLSL and dpdx builtin function in WGSL */
  dpdx(x: PBShaderExp): PBShaderExp;
  /** Same as dFdy builtin function in GLSL and dpdy builtin function in WGSL */
  dpdy(x: PBShaderExp): PBShaderExp;
  /** Same as fwidth builtin function in GLSL and WGSL */
  fwidth(x: PBShaderExp): PBShaderExp;
  /** Same as dFdx builtin function in GLSL and dpdxCoarse builtin function in WGSL */
  dpdxCoarse(x: PBShaderExp): PBShaderExp;
  /** Same as dFdx builtin function in GLSL and dpdxFine builtin function in WGSL */
  dpdxFine(x: PBShaderExp): PBShaderExp;
  /** Same as dFdy builtin function in GLSL and dpdyCoarse builtin function in WGSL */
  dpdyCoarse(x: PBShaderExp): PBShaderExp;
  /** Same as dFdy builtin function in GLSL and dpdyFine builtin function in WGSL */
  dpdyFine(x: PBShaderExp): PBShaderExp;
  /** Same as textureSize builtin function in GLSL and textureDimensions builtin function in WGSL, only valid for WebGL2 device and WebGPU device */
  textureDimensions(tex: PBShaderExp, level?: number | PBShaderExp): PBShaderExp;
  /** Same as textureGather builtin function in WGSL, only valid for WebGPU device */
  textureGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp): PBShaderExp;
  /** Same as textureGather builtin function in WGSL, only valid for WebGPU device */
  textureGather(
    component: number | PBShaderExp,
    tex: PBShaderExp,
    sampler: PBShaderExp,
    coords: PBShaderExp
  ): PBShaderExp;
  /** Same as textureGather builtin function in WGSL, only valid for WebGPU device */
  textureArrayGather(
    tex: PBShaderExp,
    sampler: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureGather builtin function in WGSL, only valid for WebGPU device */
  textureArrayGather(
    component: number | PBShaderExp,
    tex: PBShaderExp,
    sampler: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureGatherCompare builtin function in WGSL, only valid for WebGPU device */
  textureGatherCompare(
    tex: PBShaderExp,
    samplerCompare: PBShaderExp,
    coords: PBShaderExp,
    depthRef: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureGatherCompare builtin function in WGSL, only valid for WebGPU device */
  textureArrayGatherCompare(
    tex: PBShaderExp,
    samplerCompare: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    depthRef: number | PBShaderExp
  ): PBShaderExp;
  /** Same as texelFetch builtin function in GLSL and textureLoad builtin function in WGSL, only valid for WebGL2 and WebGPU device */
  textureLoad(
    tex: PBShaderExp,
    coords: number | PBShaderExp,
    levelOrSampleIndex: number | PBShaderExp
  ): PBShaderExp;
  /** Same as texelFetch builtin function in GLSL and textureLoad builtin function in WGSL, only valid for WebGL2 and WebGPU device */
  textureArrayLoad(
    tex: PBShaderExp,
    coords: number | PBShaderExp,
    arrayIndex: number | PBShaderExp,
    level: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureStore builtin function in WGSL, only valid for WebGPU device */
  textureStore(tex: PBShaderExp, coords: number | PBShaderExp, value: PBShaderExp): void;
  /** Same as textureStore builtin function in WGSL, only valid for WebGPU device */
  textureArrayStore(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    value: PBShaderExp
  ): void;
  /** Same as textureNumLayers builtin function in WGSL, only valid for WebGPU device */
  textureNumLayers(tex: PBShaderExp): PBShaderExp;
  /** Same as textureNumLevels builtin function in WGSL, only valid for WebGPU device */
  textureNumLevels(tex: PBShaderExp): PBShaderExp;
  /** Same as textureNumSamples builtin function in WGSL, only valid for WebGPU device */
  textureNumSamples(tex: PBShaderExp): PBShaderExp;
  /** Same as textureSample builtin function in WebGPU and texture/texture2D/textureCube builtin function in GLSL */
  textureSample(tex: PBShaderExp, coords: number | PBShaderExp): PBShaderExp;
  /** Same as textureSample builtin function in WebGPU and texture builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySample(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number | PBShaderExp): PBShaderExp;
  /** Same as textureSampleBias builtin function in WebGPU and texture/texture2D/textureCube builtin function in GLSL */
  textureSampleBias(tex: PBShaderExp, coords: PBShaderExp, bias: number | PBShaderExp): PBShaderExp;
  /** Same as textureSampleBias builtin function in WebGPU and texture builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySampleBias(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    bias: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureSampleCompare builtin function in WebGPU and texture builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number | PBShaderExp): PBShaderExp;
  /** Same as textureSampleCompare builtin function in WebGPU and texture builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySampleCompare(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    depthRef: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureSampleLevel builtin function in WebGPU and textureLod/texture2DLodExt/textureCubeLodExt builtin function in GLSL */
  textureSampleLevel(tex: PBShaderExp, coords: PBShaderExp): PBShaderExp;
  /** Same as textureSampleLevel builtin function in WebGPU and textureLod/texture2DLodExt/textureCubeLodExt builtin function in GLSL */
  textureSampleLevel(tex: PBShaderExp, coords: PBShaderExp, level: number | PBShaderExp): PBShaderExp;
  /** Same as textureSampleLevel builtin function in WebGPU and textureLod builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySampleLevel(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    level: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureSampleCompareLevel builtin function in WebGPU and texture/textureLod builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureSampleCompareLevel(
    tex: PBShaderExp,
    coords: PBShaderExp,
    depthRef: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureSampleCompareLevel builtin function in WebGPU and texture builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySampleCompareLevel(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    depthRef: number | PBShaderExp
  ): PBShaderExp;
  /** Same as textureSampleGrad builtin function in WebGPU and textureGrad/texture2DGradExt/textureCubeGradExt builtin function in GLSL */
  textureSampleGrad(tex: PBShaderExp, coords: PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp): PBShaderExp;
  /** Same as textureSampleGrad builtin function in WebGPU and textureGrad builtin function in GLSL, only valid for WebGL2 and WebGPU device */
  textureArraySampleGrad(
    tex: PBShaderExp,
    coords: PBShaderExp,
    arrayIndex: number | PBShaderExp,
    ddx: PBShaderExp,
    ddy: PBShaderExp
  ): PBShaderExp;
  /** Same as storageBarrier builtin function in WebGPU, only valid for WebGPU device */
  storageBarrier(): void;
  /** Same as workgroupBarrier builtin function in WebGPU, only valid for WebGPU device */
  workgroupBarrier(): void;
  /** atomicLoad, only valid for WebGPU device */
  atomicLoad(ptr: PBShaderExp);
  /** atomicStore, only valid for WebGPU device */
  atomicStore(ptr: PBShaderExp, value: number | PBShaderExp);
  /** atomicAdd, only valid for WebGPU device */
  atomicAdd(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicSub, only valid for WebGPU device */
  atomicSub(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicMax, only valid for WebGPU device */
  atomicMax(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicMin, only valid for WebGPU device */
  atomicMin(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicAnd, only valid for WebGPU device */
  atomicAnd(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicOr, only valid for WebGPU device */
  atomicOr(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
  /** atomicXor, only valid for WebGPU device */
  atomicXor(ptr: PBShaderExp, value: number | PBShaderExp): PBShaderExp;
}

/**
 * The program builder class
 * @public
 */
export class ProgramBuilder {
  /** @internal */
  _device: AbstractDevice;
  /** @internal */
  _workgroupSize: [number, number, number];
  /** @internal */
  _scopeStack: PBScope[] = [];
  /** @internal */
  _shaderType: ShaderType = ShaderType.Vertex | ShaderType.Fragment | ShaderType.Compute;
  /** @internal */
  _structInfo: Record<number, StructDef>;
  /** @internal */
  _uniforms: UniformInfo[];
  /** @internal */
  _globalScope: PBGlobalScope;
  /** @internal */
  _builtinScope: PBBuiltinScope;
  /** @internal */
  _inputScope: PBInputScope;
  /** @internal */
  _outputScope: PBOutputScope;
  /** @internal */
  _inputs: [string, AST.ASTDeclareVar][];
  /** @internal */
  _outputs: [string, AST.ASTDeclareVar][];
  /** @internal */
  _vertexAttributes: number[];
  /** @internal */
  _depthRangeCorrection: boolean;
  /** @internal */
  _emulateDepthClamp: boolean;
  /** @internal */
  _lastError: string;
  /** @internal */
  _reflection: PBReflection;
  /** @internal */
  _autoStructureTypeIndex: number;
  /** @internal */
  _nameMap: Record<string, string>[];
  /**
   * Creates a program builder for given device
   * @param device - The device
   */
  constructor(device: AbstractDevice) {
    this._device = device;
    this._workgroupSize = null;
    this._structInfo = {};
    this._uniforms = [];
    this._scopeStack = [];
    this._globalScope = null;
    this._builtinScope = null;
    this._inputScope = null;
    this._outputScope = null;
    this._inputs = [];
    this._outputs = [];
    this._vertexAttributes = [];
    this._depthRangeCorrection = device.type === 'webgpu';
    this._emulateDepthClamp = false;
    this._lastError = null;
    this._reflection = new PBReflection(this);
    this._autoStructureTypeIndex = 0;
    this._nameMap = [];
  }
  /** Get last error */
  get lastError(): string {
    return this._lastError;
  }
  /** @internal */
  get shaderType(): ShaderType {
    return this._shaderType;
  }
  /** Current shader kind */
  get shaderKind(): ShaderKind {
    return this._shaderType === ShaderType.Vertex
      ? 'vertex'
      : this._shaderType === ShaderType.Fragment
      ? 'fragment'
      : this._shaderType === ShaderType.Compute
      ? 'compute'
      : null;
  }
  /** Gets the global scope */
  getGlobalScope(): PBGlobalScope {
    return this._globalScope;
  }
  /** @internal */
  get builtinScope(): PBBuiltinScope {
    return this._builtinScope;
  }
  /** @internal */
  get inputScope(): PBInputScope {
    return this._inputScope;
  }
  /** @internal */
  get outputScope(): PBOutputScope {
    return this._outputScope;
  }
  /** @internal */
  get depthRangeCorrection(): boolean {
    return this._depthRangeCorrection;
  }
  get emulateDepthClamp(): boolean {
    return this._emulateDepthClamp;
  }
  set emulateDepthClamp(val: boolean) {
    this._emulateDepthClamp = val;
  }
  /** Get the shader code reflection interface */
  getReflection(): PBReflection {
    return this._reflection;
  }
  /** Get the device */
  getDevice(): AbstractDevice {
    return this._device;
  }
  /** @internal */
  reset(): void {
    this._workgroupSize = null;
    this._structInfo = {};
    this._uniforms = [];
    this._scopeStack = [];
    this._globalScope = null;
    this._builtinScope = null;
    this._inputScope = null;
    this._outputScope = null;
    this._inputs = [];
    this._outputs = [];
    this._vertexAttributes = [];
    this._depthRangeCorrection = this._device.type === 'webgpu';
    this._reflection = new PBReflection(this);
    this._autoStructureTypeIndex = 0;
    this._nameMap = [];
  }
  /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */
  queryGlobal(name: string): PBShaderExp {
    return this.getReflection().tag(name);
  }
  /** @internal */
  pushScope(scope: PBScope) {
    this._scopeStack.unshift(scope);
  }
  /** @internal */
  popScope(): PBScope {
    return this._scopeStack.shift();
  }
  /** Gets the current scope */
  getCurrentScope(): PBScope {
    return this._scopeStack[0];
  }
  /** Gets the current function scope */
  getCurrentFunctionScope(): PBFunctionScope {
    let funcScope: PBScope = this.getCurrentScope();
    while (funcScope && !(funcScope instanceof PBFunctionScope)) {
      funcScope = funcScope.$parent;
    }
    return funcScope as PBFunctionScope;
  }
  /**
   * Generates shader codes for a render program
   * @param options - The build options
   * @returns a tuple made by vertex shader source, fragment shader source, bind group layouts and vertex attributes used, or null if build faild
   */
  buildRender(options: PBRenderOptions): readonly [string, string, BindGroupLayout[], number[]] {
    setCurrentProgramBuilder(this);
    this._lastError = null;
    this.defineInternalStructs();
    const ret = this.buildRenderSource(options);
    setCurrentProgramBuilder(null);
    this.reset();
    return ret;
  }
  /**
   * Generates shader code for a compute program
   * @param options - The build programs
   * @returns a tuple made by compute shader source and bind group layouts, or null if build failed
   */
  buildCompute(options: PBComputeOptions): readonly [string, BindGroupLayout[]] {
    setCurrentProgramBuilder(this);
    this._lastError = null;
    this._workgroupSize = options.workgroupSize;
    this.defineInternalStructs();
    const ret = this.buildComputeSource(options);
    setCurrentProgramBuilder(null);
    this.reset();
    return ret;
  }
  /**
   * Creates a shader program for render
   * @param options - The build options
   * @returns The created program or null if build failed
   */
  buildRenderProgram(options: PBRenderOptions): GPUProgram {
    const ret = this.buildRender(options);
    return ret
      ? this._device.createGPUProgram({
          type: 'render',
          label: options.label,
          params: {
            vs: ret[0],
            fs: ret[1],
            bindGroupLayouts: ret[2],
            vertexAttributes: ret[3]
          }
        })
      : null;
  }
  /**
   * Creates a shader program for compute
   * @param options - The build options
   * @returns The created program or null if build failed
   */
  buildComputeProgram(options: PBComputeOptions): GPUProgram {
    const ret = this.buildCompute(options);
    return ret
      ? this._device.createGPUProgram({
          type: 'compute',
          params: {
            source: ret[0],
            bindGroupLayouts: ret[1]
          }
        })
      : null;
  }
  /**
   * Creates a function
   * @param name - Name of the function
   * @param params - Parameters of the function
   * @param body - The generator function
   */
  func(name: string, params: PBShaderExp[], body?: (this: PBFunctionScope) => void) {
    this.getGlobalScope().$createFunctionIfNotExists(name, params, body);
  }
  /**
   * Create the main entry function of the shader
   * @param body - The shader generator function
   */
  main(body?: (this: PBFunctionScope) => void) {
    this.getGlobalScope().$mainFunc(body);
  }
  /**
   * Create an 'AddressOf' expression for WGSL
   * @param ref - The reference variable
   * @returns the 'AddressOf' expression
   */
  addressOf(ref: PBShaderExp): PBShaderExp {
    if (this._device.type !== 'webgpu') {
      throw new errors.PBDeviceNotSupport('pointer shader type');
    }
    if (!ref.$ast.isReference()) {
      throw new errors.PBReferenceValueRequired(ref);
    }
    const exp = new PBShaderExp('', ref.$ast.getType());
    exp.$ast = new AST.ASTAddressOf(ref.$ast);
    return exp;
  }
  /**
   * Creates a 'referenceOf' expression for WGSL
   * @param ptr - The pointer variable
   * @returns the 'referenceOf' expression
   */
  referenceOf(ptr: PBShaderExp): PBShaderExp {
    if (this._device.type !== 'webgpu') {
      throw new errors.PBDeviceNotSupport('pointer shader type');
    }
    if (!ptr.$ast.getType().isPointerType()) {
      throw new errors.PBPointerValueRequired(ptr);
    }
    const ast = new AST.ASTReferenceOf(ptr.$ast);
    const exp = new PBShaderExp('', ast.getType());
    exp.$ast = ast;
    return exp;
  }
  /**
   * Creates a structure type variable
   * @param structName - Name of the structure type
   * @param instanceName - Name of the variable
   * @returns the created variable
   */
  struct(structName: string, instanceName: string): PBShaderExp {
    let ctor: ShaderTypeFunc = null;
    for (const st of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      if (st & this._shaderType) {
        const structInfo = this._structInfo[st];
        ctor = structInfo?.structs[structName];
        if (ctor) {
          break;
        }
      }
    }
    if (!ctor) {
      throw new errors.PBParamValueError('struct', 'structName', `Struct type ${structName} not exists`);
    }
    return ctor.call(this, instanceName);
  }
  /** @internal */
  isIdenticalStruct(a: PBStructTypeInfo, b: PBStructTypeInfo, checkName: boolean): boolean {
    if (checkName && a.structName && b.structName && a.structName !== b.structName) {
      return false;
    }
    if (a.structMembers.length !== b.structMembers.length) {
      return false;
    }
    for (let index = 0; index < a.structMembers.length; index++) {
      const val = a.structMembers[index];
      const other = b.structMembers[index];
      if (val.name !== other.name) {
        return false;
      }
      if (val.type.isStructType()) {
        if (!other.type.isStructType()) {
          return false;
        }
        if (!this.isIdenticalStruct(val.type, other.type, true)) {
          return false;
        }
      } else if (!val.type.isCompatibleType(other.type)) {
        return false;
      }
    }
    return true;
  }
  /** @internal */
  generateStructureName(): string {
    return `zStruct${this._autoStructureTypeIndex++}`;
  }
  /** @internal */
  getVertexAttributes(): number[] {
    return this._vertexAttributes;
  }
  /** @internal */
  defineHiddenStruct(type: PBStructTypeInfo) {
    for (const shaderType of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      let structInfo = this._structInfo[shaderType];
      if (!structInfo) {
        structInfo = { structs: {}, types: [] };
        this._structInfo[shaderType] = structInfo;
      }
      if (structInfo.structs[type.structName]) {
        throw new errors.PBParamValueError(
          'defineStruct',
          'structName',
          `cannot re-define struct '${type.structName}'`
        );
      }
      structInfo.types.push(new AST.ASTStructDefine(type, true));
    }
  }
  // /**
  //  * Defines an uniform buffer
  //  * @param name - Name of the uniform buffer
  //  * @param args - Members of the buffer structure
  //  * @returns The structure type constructor
  //  */
  // defineUniformBuffer(name: string, ...args: PBShaderExp[]): ShaderTypeFunc {
  //   return this.defineStructOrUniformBuffer(name, 'std140', ...args);
  // }
  // /**
  //  * Defines a structure type
  //  * @param structName - Name of the type
  //  * @param layout - The structure layout
  //  * @param args - Members of the structure
  //  * @returns The structure type constructor
  //  */
  // defineStruct(structName: string, ...args: PBShaderExp[]): ShaderTypeFunc {
  //   return this.defineStructOrUniformBuffer(structName, 'default', ...args);
  // }
  /**
   * Defines a structure type
   * @param members - Members of the structure
   * @param structName - Name of the type
   * @returns The structure type constructor
   */
  defineStruct(members: PBShaderExp[], structName?: string): ShaderTypeFunc {
    const layout = 'default';
    const structType = new PBStructTypeInfo(
      structName ?? '',
      layout,
      members.map((arg) => {
        if (
          !arg.$typeinfo.isPrimitiveType() &&
          !arg.$typeinfo.isArrayType() &&
          !arg.$typeinfo.isStructType() &&
          !arg.$typeinfo.isAtomicI32() &&
          !arg.$typeinfo.isAtomicU32()
        ) {
          throw new Error(`invalid struct member type: '${arg.$str}'`);
        }
        return {
          name: arg.$str,
          type: arg.$typeinfo
        };
      })
    );
    for (const shaderType of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      let structDef: AST.ASTStructDefine = null;
      let ctor: ShaderTypeFunc = null;
      const structInfo = this._structInfo[shaderType];
      if (structInfo) {
        if (
          getCurrentProgramBuilder().shaderType === shaderType &&
          structInfo.structs[structType.structName]
        ) {
          throw new errors.PBParamValueError(
            'defineStruct',
            'structName',
            `cannot re-define struct '${structType.structName}'`
          );
        }
        for (const type of structInfo.types) {
          if (!type.builtin && this.isIdenticalStruct(type.getType(), structType, false)) {
            structDef = type;
            ctor = structInfo.structs[type.getType().structName];
            break;
          }
        }
      }
      if (structDef) {
        if (structDef.type.layout !== layout) {
          throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
        }
        if (shaderType !== getCurrentProgramBuilder().shaderType) {
          if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
            this._structInfo[getCurrentProgramBuilder().shaderType] = { structs: {}, types: [] };
          }
          if (this._structInfo[getCurrentProgramBuilder().shaderType].types.indexOf(structDef) < 0) {
            this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
            this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] =
              ctor;
          }
        }
        return ctor;
      }
    }
    return this.internalDefineStruct(
      structName ?? this.generateStructureName(),
      layout,
      this._shaderType,
      false,
      ...members
    );
  }
  /**
   * Defines a structure type
   * @param structType - The structure type info
   * @returns The structure type constructor
   */
  defineStructByType(structType: PBStructTypeInfo): ShaderTypeFunc {
    const typeCopy = structType.extends(structType.structName || this.generateStructureName(), []);
    for (const shaderType of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      let structDef: AST.ASTStructDefine = null;
      let ctor: ShaderTypeFunc = null;
      const structInfo = this._structInfo[shaderType];
      if (structInfo) {
        if (getCurrentProgramBuilder().shaderType === shaderType && structInfo.structs[typeCopy.structName]) {
          throw new errors.PBParamValueError(
            'defineStruct',
            'structName',
            `cannot re-define struct '${typeCopy.structName}'`
          );
        }
        for (const type of structInfo.types) {
          if (!type.builtin && this.isIdenticalStruct(type.getType(), typeCopy, false)) {
            structDef = type;
            ctor = structInfo.structs[type.getType().structName];
            break;
          }
        }
      }
      if (structDef) {
        if (structDef.type.layout !== typeCopy.layout) {
          throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
        }
        if (shaderType !== getCurrentProgramBuilder().shaderType) {
          if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
            this._structInfo[getCurrentProgramBuilder().shaderType] = { structs: {}, types: [] };
          }
          this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
          this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] =
            ctor;
        }
        return ctor;
      }
    }
    return this.internalDefineStructByType(this._shaderType, false, typeCopy);
  }
  /** @internal */
  internalDefineStruct(
    structName: string,
    layout: PBStructLayout,
    shaderTypeMask: number,
    builtin: boolean,
    ...args: PBShaderExp[]
  ): ShaderTypeFunc {
    const structType = new PBStructTypeInfo(
      structName,
      layout,
      args.map((arg) => {
        if (
          !arg.$typeinfo.isPrimitiveType() &&
          !arg.$typeinfo.isArrayType() &&
          !arg.$typeinfo.isStructType() &&
          !arg.$typeinfo.isAtomicI32() &&
          !arg.$typeinfo.isAtomicU32()
        ) {
          throw new Error(`invalid struct member type: '${arg.$str}'`);
        }
        return {
          name: arg.$str,
          type: arg.$typeinfo
        };
      })
    );
    return this.internalDefineStructByType(shaderTypeMask, builtin, structType);
  }
  /** @internal */
  internalDefineStructByType(
    shaderTypeMask: number,
    builtin: boolean,
    structType: PBStructTypeInfo
  ): ShaderTypeFunc {
    const struct = makeConstructor(
      function structConstructor(...blockArgs: any[]) {
        let e: PBShaderExp;
        if (blockArgs.length === 1 && typeof blockArgs[0] === 'string') {
          e = new PBShaderExp(blockArgs[0], structType);
        } else {
          e = new PBShaderExp('', structType);
          e.$ast = new AST.ASTShaderExpConstructor(
            e.$typeinfo,
            blockArgs.map((arg) => (arg instanceof PBShaderExp ? arg.$ast : arg))
          );
        }
        return e;
      } as ShaderTypeFunc,
      structType
    );
    for (const shaderType of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      if (shaderTypeMask & shaderType) {
        let structInfo = this._structInfo[shaderType];
        if (!structInfo) {
          structInfo = { structs: {}, types: [] };
          this._structInfo[shaderType] = structInfo;
        }
        if (structInfo.structs[structType.structName]) {
          throw new errors.PBParamValueError(
            'defineStruct',
            'structName',
            `cannot re-define struct '${structType.structName}'`
          );
        }
        structInfo.types.push(new AST.ASTStructDefine(structType, builtin));
        structInfo.structs[structType.structName] = struct;
      }
    }
    // this.changeStructLayout(structType, layout);
    return struct;
  }
  /** @internal */
  getFunction(name: string): AST.ASTFunction[] {
    return this._globalScope ? this._globalScope.$getFunctions(name) : null;
  }
  /** @internal */
  get structInfo(): StructDef {
    return this._structInfo[this._shaderType];
  }
  /** @internal */
  getBlockName(instanceName: string): string {
    return `ch_block_name_${instanceName}`;
  }
  /** @internal */
  defineBuiltinStruct(
    shaderType: ShaderType,
    inOrOut: 'in' | 'out'
  ): [ShaderTypeFunc, PBShaderExp, string, PBShaderExp] {
    const structName =
      inOrOut === 'in'
        ? AST.getBuiltinInputStructName(shaderType)
        : AST.getBuiltinOutputStructName(shaderType);
    const instanceName =
      inOrOut === 'in'
        ? AST.getBuiltinInputStructInstanceName(shaderType)
        : AST.getBuiltinOutputStructInstanceName(shaderType);
    const stage =
      shaderType === ShaderType.Vertex
        ? 'vertex'
        : shaderType === ShaderType.Fragment
        ? 'fragment'
        : 'compute';
    const builtinVars = AST.builtinVariables['webgpu'];
    const args: { name: string; type: PBPrimitiveTypeInfo | PBArrayTypeInfo | PBStructTypeInfo }[] = [];
    const prefix: string[] = [];
    for (const k in builtinVars) {
      if (builtinVars[k].stage === stage && builtinVars[k].inOrOut === inOrOut) {
        args.push({ name: builtinVars[k].name, type: builtinVars[k].type });
        prefix.push(`@builtin(${builtinVars[k].semantic}) `);
      }
    }
    const inoutList = inOrOut === 'in' ? this._inputs : this._outputs;
    for (const k of inoutList) {
      // for debug only
      if (!(k[1] instanceof AST.ASTDeclareVar)) {
        throw new errors.PBInternalError(
          'defineBuiltinStruct() failed: input/output is not declare var ast node'
        );
      }
      const type = k[1].value.getType();
      if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
        throw new Error(`invalid in/out variable type: '${k[1].value.name}'`);
      }
      args.push({ name: k[1].value.name, type: type });
      prefix.push(
        `@location(${k[1].value.value.$location}) ${
          type.isPrimitiveType() && type.isInteger() ? '@interpolate(flat) ' : ''
        }`
      );
    }
    if (args.length > 0) {
      const st = this.findStructType(structName, shaderType);
      if (st) {
        st.getType().reset(structName, 'default', args);
        st.prefix = prefix;
        return null;
      } else {
        const structType = this.internalDefineStructByType(
          this._shaderType,
          false,
          new PBStructTypeInfo(structName, 'default', args)
        );
        this.findStructType(structName, shaderType).prefix = prefix;
        const structInstance = this.struct(structName, instanceName);
        const structInstanceIN =
          inOrOut === 'in' ? this.struct(structName, AST.getBuiltinParamName(shaderType)) : structInstance;
        return [structType, structInstance, structName, structInstanceIN];
      }
    } else {
      return null;
    }
  }
  /** @internal */
  private defineInternalStructs() {
    this.defineHiddenStruct(typeFrexpResult);
    this.defineHiddenStruct(typeFrexpResultVec2);
    this.defineHiddenStruct(typeFrexpResultVec3);
    this.defineHiddenStruct(typeFrexpResultVec4);
  }
  /** @internal */
  private array(...args: ExpValueNonArrayType[]) {
    if (args.length === 0) {
      throw new errors.PBParamLengthError('array');
    }
    args = args.map((arg) => this.normalizeExpValue(arg));
    let typeok = true;
    let type: PBTypeInfo = null;
    let isBool = true;
    let isFloat = true;
    let isInt = true;
    let isUint = true;
    let isComposite = false;
    for (const arg of args) {
      if (arg instanceof PBShaderExp) {
        const argType = arg.$ast.getType();
        if (!argType.isConstructible()) {
          typeok = false;
          break;
        }
        if (!type) {
          type = argType;
        } else if (!argType.isCompatibleType(type)) {
          typeok = false;
        }
      }
    }
    if (typeok) {
      if (type && type.isPrimitiveType() && type.isScalarType()) {
        isBool = type.primitiveType === PBPrimitiveType.BOOL;
        isFloat = type.primitiveType === PBPrimitiveType.F32;
        isUint = type.primitiveType === PBPrimitiveType.U32;
        isInt = type.primitiveType === PBPrimitiveType.I32;
      } else if (type) {
        isBool = false;
        isFloat = false;
        isUint = false;
        isInt = false;
        isComposite = true;
      }
      for (const arg of args) {
        if (!(arg instanceof PBShaderExp) && isComposite) {
          typeok = false;
          break;
        }
        if (typeof arg === 'number') {
          isBool = false;
          if ((arg | 0) === arg) {
            if (arg < 0) {
              isUint = false;
              isInt = isInt && arg >= 0x80000000 >> 0;
            } else {
              isUint = isUint && arg <= 0xffffffff;
              isInt = isInt && arg <= 0x7fffffff;
            }
          }
        } else if (typeof arg === 'boolean') {
          isFloat = false;
          isInt = false;
          isUint = false;
        }
      }
    }
    if (typeok && !isComposite) {
      if (isBool) {
        type = typeBool;
      } else if (isInt) {
        type = typeI32;
      } else if (isUint) {
        type = typeU32;
      } else if (isFloat) {
        type = typeF32;
      }
      typeok = !!type;
    }
    if (!typeok) {
      throw new errors.PBParamTypeError('array');
    }
    if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
      throw new errors.PBParamTypeError('array');
    }
    const arrayType = new PBArrayTypeInfo(type, args.length);
    const exp = new PBShaderExp('', arrayType);
    exp.$ast = new AST.ASTShaderExpConstructor(
      arrayType,
      args.map((arg) => {
        if (arg instanceof PBShaderExp) {
          return arg.$ast;
        }
        if (!type.isPrimitiveType() || !type.isScalarType()) {
          throw new errors.PBTypeCastError(arg, typeof arg, type);
        }
        return new AST.ASTScalar(arg, type);
      })
    );
    return exp;
  }
  /**
   * Creates a 'discard' statement
   */
  discard(): void {
    this.getCurrentScope().$ast.statements.push(new AST.ASTDiscard());
  }
  /** @internal */
  tagShaderExp(getter: PBReflectionTagGetter, tagValue: ShaderExpTagValue) {
    if (typeof tagValue === 'string') {
      this._reflection.tag(tagValue, getter);
    } else if (Array.isArray(tagValue)) {
      tagValue.forEach((tag) => this.tagShaderExp(getter, tag));
    } else {
      for (const k of Object.keys(tagValue)) {
        this.tagShaderExp((scope: PBGlobalScope) => {
          const value = getter(scope);
          return value[k];
        }, tagValue[k]);
      }
    }
  }
  /** @internal */
  in(location: number, name: string, variable: PBShaderExp): void {
    if (this._inputs[location]) {
      // input already exists, create an alias
      if (!this._inputScope[name]) {
        Object.defineProperty(this._inputScope, name, {
          get: function (this: PBInputScope) {
            return variable;
          },
          set: function () {
            throw new Error(`cannot assign to readonly variable: ${name}`);
          }
        });
      }
      //throw new Error(`input location ${location} already declared`);
    } else {
      variable.$location = location;
      variable.$declareType = AST.DeclareType.DECLARE_TYPE_IN;
      this._inputs[location] = [name, new AST.ASTDeclareVar(new AST.ASTPrimitive(variable))];
      Object.defineProperty(this._inputScope, name, {
        get: function (this: PBInputScope) {
          return variable;
        },
        set: function () {
          throw new Error(`cannot assign to readonly variable: ${name}`);
        }
      });
      variable.$tags.forEach((val) => this.tagShaderExp(() => variable, val));
    }
  }
  /** @internal */
  out(location: number, name: string, variable: PBShaderExp): void {
    if (this._outputs[location]) {
      throw new Error(`output location ${location} has already been used`);
    }
    variable.$location = location;
    variable.$declareType = AST.DeclareType.DECLARE_TYPE_OUT;
    this._outputs[location] = [name, new AST.ASTDeclareVar(new AST.ASTPrimitive(variable))];
    Object.defineProperty(this._outputScope, name, {
      get: function (this: PBOutputScope) {
        return variable;
      },
      set: function (this: PBOutputScope, v) {
        getCurrentProgramBuilder()
          .getCurrentScope()
          .$ast.statements.push(
            new AST.ASTAssignment(
              new AST.ASTLValueScalar(variable.$ast),
              v instanceof PBShaderExp ? v.$ast : v
            )
          );
      }
    });
  }
  /** @internal */
  getDefaultSampler(t: PBShaderExp, comparison: boolean): PBShaderExp {
    const u = this._uniforms.findIndex((val) => val.texture?.exp === t);
    if (u < 0) {
      return;
      //throw new Error('invalid texture uniform object');
    }
    const samplerType = comparison ? 'comparison' : 'sample';
    if (
      this._uniforms[u].texture.autoBindSampler &&
      this._uniforms[u].texture.autoBindSampler !== samplerType
    ) {
      throw new Error('multiple sampler not supported');
    }
    this._uniforms[u].texture.autoBindSampler = samplerType;
    if (this._device.type === 'webgpu') {
      const samplerName = AST.genSamplerName(t.$str, comparison);
      if (!this.getGlobalScope()[samplerName]) {
        throw new Error(`failed to find sampler name ${samplerName}`);
      }
      return this.getGlobalScope()[samplerName];
    } else {
      return null;
    }
  }
  /** @internal */
  normalizeExpValue(value: ExpValueType): ExpValueNonArrayType {
    if (Array.isArray(value)) {
      const converted = value.map((val) => (Array.isArray(val) ? this.normalizeExpValue(val) : val));
      return this.array(...converted);
    } else {
      return value;
    }
  }
  /** @internal */
  guessExpValueType(value: ExpValueType): PBTypeInfo {
    const val = this.normalizeExpValue(value);
    if (typeof val === 'boolean') {
      return typeBool;
    } else if (typeof val === 'number') {
      if (!Number.isInteger(val)) {
        return typeF32;
      } else if (val >= 0x80000000 >> 1 && val <= 0x7fffffff) {
        return typeI32;
      } else if (val >= 0 && val <= 0xffffffff) {
        return typeU32;
      } else {
        throw new errors.PBValueOutOfRange(val);
      }
    } else if (val instanceof PBShaderExp) {
      return val.$ast?.getType() || val.$typeinfo;
    }
  }
  /** @internal */
  findStructType(name: string, shaderType: number): AST.ASTStructDefine {
    for (const st of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      if (st & shaderType) {
        const structInfo = this._structInfo[st];
        if (structInfo) {
          for (const t of structInfo.types) {
            if (t.type.structName === name) {
              return t;
            }
          }
        }
      }
    }
    return null;
  }
  /** @internal */
  findStructConstructor(name: string, shaderType: number): ShaderTypeFunc {
    for (const st of [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Compute]) {
      if (st & shaderType) {
        const structInfo = this._structInfo[st];
        if (structInfo && structInfo.structs?.[name]) {
          return structInfo.structs[name];
        }
      }
    }
    return null;
  }
  /** @internal */
  private buildComputeSource(options: PBComputeOptions) {
    try {
      this._lastError = null;
      this._shaderType = ShaderType.Compute;
      this._scopeStack = [];
      this._globalScope = new PBGlobalScope();
      this._builtinScope = new PBBuiltinScope();
      this._inputs = [];
      this._outputs = [];
      this._inputScope = new PBInputScope();
      this._outputScope = new PBOutputScope();
      this._reflection.clear();
      this.generate(options.compute);
      // this.removeUnusedSamplerBindings(this._globalScope);
      this.mergeUniformsCompute(this._globalScope);
      this.updateUniformBindings([this._globalScope], [ShaderType.Compute]);
      return [
        this.generateComputeSource(this._globalScope, this._builtinScope),
        this.createBindGroupLayouts(options.label)
      ] as const;
    } catch (err) {
      if (err instanceof errors.PBError) {
        this._lastError = err.getMessage(this._device.type);
        console.error(this._lastError);
        return null;
      } else if (err instanceof Error) {
        this._lastError = err.toString();
        console.error(this._lastError);
        return null;
      } else {
        this._lastError = Object.prototype.toString.call(err);
        console.log(`Error: ${this._lastError}`);
        return null;
      }
    }
  }
  /** @internal */
  private buildRenderSource(options: PBRenderOptions) {
    try {
      this._lastError = null;

      this._shaderType = ShaderType.Vertex;
      this._scopeStack = [];
      this._globalScope = new PBGlobalScope();
      this._builtinScope = new PBBuiltinScope();
      this._inputs = [];
      this._outputs = [];
      this._inputScope = new PBInputScope();
      this._outputScope = new PBOutputScope();
      this._reflection.clear();
      this.generate(options.vertex);
      const vertexScope = this._globalScope;
      const vertexBuiltinScope = this._builtinScope;
      const vertexInputs = this._inputs;
      const vertexOutputs = this._outputs;
      if (this._device.type === 'webgpu') {
        // this.removeUnusedSamplerBindings(vertexScope);
      }

      this._shaderType = ShaderType.Fragment;
      this._scopeStack = [];
      this._globalScope = new PBGlobalScope();
      this._builtinScope = new PBBuiltinScope();
      this._inputs = [];
      this._outputs = [];
      this._inputScope = new PBInputScope();
      this._outputScope = new PBOutputScope();
      this._reflection.clear();
      vertexOutputs.forEach((val, index) => {
        this.in(
          index,
          val[0],
          new PBShaderExp(val[1].value.name, val[1].value.getType()).tag(...val[1].value.value.$tags)
        );
      });
      this.generate(options.fragment);
      const fragScope = this._globalScope;
      const fragBuiltinScope = this._builtinScope;
      const fragInputs = this._inputs;
      const fragOutputs = this._outputs;
      if (this._device.type === 'webgpu') {
        // this.removeUnusedSamplerBindings(fragScope);
      }

      this.mergeUniforms(vertexScope, fragScope);
      this.updateUniformBindings([vertexScope, fragScope], [ShaderType.Vertex, ShaderType.Fragment]);

      return [
        this.generateRenderSource(
          ShaderType.Vertex,
          vertexScope,
          vertexBuiltinScope,
          vertexInputs.map((val) => val[1]),
          vertexOutputs.map((val) => val[1])
        ),
        this.generateRenderSource(
          ShaderType.Fragment,
          fragScope,
          fragBuiltinScope,
          fragInputs.map((val) => val[1]),
          fragOutputs.map((val) => val[1])
        ),
        this.createBindGroupLayouts(options.label),
        this._vertexAttributes
      ] as const;
    } catch (err) {
      if (err instanceof errors.PBError) {
        this._lastError = err.getMessage(this._device.type);
        console.error(this._lastError);
        return null;
      } else if (err instanceof Error) {
        this._lastError = err.toString();
        console.error(this._lastError);
        return null;
      } else {
        this._lastError = Object.prototype.toString.call(err);
        console.log(`Error: ${this._lastError}`);
        return null;
      }
    }
  }
  /** @internal */
  private generate(body?: (this: PBGlobalScope, pb: ProgramBuilder) => void): void {
    this.pushScope(this._globalScope);
    if (this._emulateDepthClamp && this._shaderType === ShaderType.Vertex) {
      this._globalScope.$outputs.clamppedDepth = this.float().tag('CLAMPPED_DEPTH');
    }
    body && body.call(this._globalScope, this);
    this.popScope();

    // Global delcarations should be at the first
    this._globalScope.$ast.statements = [
      ...this._globalScope.$ast.statements.filter(
        (val) => val instanceof AST.ASTDeclareVar || val instanceof AST.ASTAssignment
      ),
      ...this._globalScope.$ast.statements.filter(
        (val) => !(val instanceof AST.ASTDeclareVar) && !(val instanceof AST.ASTAssignment)
      )
    ];
  }
  /** @internal */
  private generateRenderSource(
    shaderType: ShaderType,
    scope: PBGlobalScope,
    builtinScope: PBBuiltinScope,
    inputs: AST.ShaderAST[],
    outputs: AST.ShaderAST[]
  ) {
    const context = {
      type: shaderType,
      mrt: shaderType === ShaderType.Fragment && outputs.length > 1,
      defines: [],
      extensions: new Set<string>(),
      builtins: [...builtinScope.$_usedBuiltins],
      types: this._structInfo[shaderType]?.types || [],
      typeReplacement: new Map(),
      inputs: inputs,
      outputs: outputs,
      global: scope,
      vertexAttributes: this._vertexAttributes,
      workgroupSize: null
    };
    switch (this._device.type) {
      case 'webgl':
        for (const u of this._uniforms) {
          if (u.texture) {
            const type = u.texture.exp.$ast.getType();
            if (type.isTextureType() && type.isDepthTexture()) {
              if (u.texture.autoBindSampler === 'comparison') {
                throw new errors.PBDeviceNotSupport('depth texture comparison');
              }
              if (u.texture.autoBindSampler === 'sample') {
                if (type.is2DTexture()) {
                  context.typeReplacement.set(u.texture.exp, typeTex2D);
                } else if (type.isCubeTexture()) {
                  context.typeReplacement.set(u.texture.exp, typeTexCube);
                }
              }
            }
          }
        }
        return scope.$ast.toWebGL('', context);
      case 'webgl2':
        for (const u of this._uniforms) {
          if (u.texture) {
            const type = u.texture.exp.$ast.getType();
            if (type.isTextureType() && type.isDepthTexture() && u.texture.autoBindSampler === 'sample') {
              if (type.is2DTexture()) {
                context.typeReplacement.set(
                  u.texture.exp,
                  type.isArrayTexture() ? typeTex2DArray : typeTex2D
                );
              } else if (type.isCubeTexture()) {
                context.typeReplacement.set(u.texture.exp, typeTexCube);
              }
            }
          }
        }
        return scope.$ast.toWebGL2('', context);
      case 'webgpu':
        return scope.$ast.toWGSL('', context);
      default:
        return null;
    }
  }
  /** @internal */
  private generateComputeSource(scope: PBGlobalScope, builtinScope: PBBuiltinScope) {
    const context = {
      type: ShaderType.Compute,
      mrt: false,
      defines: [],
      extensions: new Set<string>(),
      builtins: [...builtinScope.$_usedBuiltins],
      types: this._structInfo[ShaderType.Compute]?.types || [],
      typeReplacement: null,
      inputs: [],
      outputs: [],
      global: scope,
      vertexAttributes: [],
      workgroupSize: this._workgroupSize
    };
    return scope.$ast.toWGSL('', context);
  }
  /** @internal */
  private mergeUniformsCompute(globalScope: PBGlobalScope) {
    const uniformList: { member: PBShaderExp; uniform: number }[][] = [];
    for (let i = 0; i < this._uniforms.length; i++) {
      const u = this._uniforms[i];
      if (
        u.block &&
        (u.block.exp.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM ||
          u.block.exp.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE)
      ) {
        if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
          continue;
        }
        if (!uniformList[u.group]) {
          uniformList[u.group] = [];
        }
        const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
        exp.$declareType = u.block.exp.$declareType;
        exp.$isBuffer = u.block.exp.$isBuffer;
        uniformList[u.group].push({ member: exp, uniform: i });
      }
    }
    for (const k in uniformList) {
      if (uniformList[k].length > 0) {
        const types = ['std140', 'std430'] as PBStructLayout[];
        const nameList = [COMPUTE_UNIFORM_NAME, COMPUTE_STORAGE_NAME];
        const ulist: { member: PBShaderExp; uniform: number }[][] = [
          uniformList[k].filter((val) => val.member.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM),
          uniformList[k].filter((val) => val.member.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE)
        ];
        for (let i = 0; i < 2; i++) {
          if (ulist[i].length === 0) {
            continue;
          }
          const nonBufferList = ulist[i].filter((val) => !val.member.$isBuffer);
          const bufferList = ulist[i].filter((val) => val.member.$isBuffer);
          const allLists = [nonBufferList, ...bufferList.map((val) => [val])];
          for (let p = 0; p < allLists.length; p++) {
            if (allLists[p].length === 0) {
              continue;
            }
            const uname = `${nameList[i]}_${k}_${p}`;
            const structName = this.generateStructureName();
            const t = getCurrentProgramBuilder().internalDefineStruct(
              structName,
              types[i],
              ShaderType.Compute,
              false,
              ...allLists[p].map((val) => val.member)
            );
            const exp = t();
            if (i === 0) {
              exp.uniformBuffer(Number(k));
            } else {
              exp.storageBuffer(Number(k));
            }
            globalScope[uname] = exp;
            const index = this._uniforms.findIndex((val) => val.block?.name === uname);
            this._uniforms[index].mask = ShaderType.Compute;
            let nameMap = this._nameMap[Number(k)];
            if (!nameMap) {
              nameMap = {};
              this._nameMap[Number(k)] = nameMap;
            }
            let writable = false;
            for (let n = allLists[p].length - 1; n >= 0; n--) {
              const u = allLists[p][n];
              const exp = this._uniforms[u.uniform].block.exp;
              nameMap[exp.$str] = uname;
              exp.$str = `${uname}.${exp.$str}`;
              writable ||= exp.$ast.isWritable();
            }
            if (writable) {
              globalScope[uname].$ast.markWritable();
            }
          }
        }
      }
    }
    this._uniforms = this._uniforms.filter((val) => {
      return !val.block || (val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer);
      //return !val.block || val.block.exp.$isBuffer;
      /*
      if (!val.block || (val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_UNIFORM && val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_STORAGE)) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */
    });
  }
  /** @internal */
  private mergeUniforms(globalScopeVertex: PBGlobalScope, globalScopeFragmet: PBGlobalScope) {
    const vertexUniformList: { member: PBShaderExp; uniform: number }[][] = [];
    const fragUniformList: { member: PBShaderExp; uniform: number }[][] = [];
    const sharedUniformList: { member: PBShaderExp; uniform: number }[][] = [];
    //const vertexUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
    //const fragUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
    //const sharedUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
    for (let i = 0; i < this._uniforms.length; i++) {
      const u = this._uniforms[i];
      if (
        u.block &&
        (u.block.exp.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM ||
          u.block.exp.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE)
      ) {
        if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
          continue;
        }
        const v = !!(u.mask & ShaderType.Vertex);
        const f = !!(u.mask & ShaderType.Fragment);
        if (v && f) {
          if (!sharedUniformList[u.group]) {
            sharedUniformList[u.group] = []; //{ members: [], uniforms: [] };
          }
          const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
          exp.$declareType = u.block.exp.$declareType;
          exp.$isBuffer = u.block.exp.$isBuffer;
          sharedUniformList[u.group].push({ member: exp, uniform: i });
          //sharedUniformList[u.group].uniforms.push(i);
        } else if (v) {
          if (!vertexUniformList[u.group]) {
            vertexUniformList[u.group] = []; //{ members: [], uniforms: [] };
          }
          const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
          exp.$declareType = u.block.exp.$declareType;
          exp.$isBuffer = u.block.exp.$isBuffer;
          vertexUniformList[u.group].push({ member: exp, uniform: i });
          //vertexUniformList[u.group].uniforms.push(i);
        } else if (f) {
          if (!fragUniformList[u.group]) {
            fragUniformList[u.group] = []; //{ members: [], uniforms: [] };
          }
          const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
          exp.$declareType = u.block.exp.$declareType;
          exp.$isBuffer = u.block.exp.$isBuffer;
          fragUniformList[u.group].push({ member: exp, uniform: i }); //members.push(exp);
          //fragUniformList[u.group].uniforms.push(i);
        }
      }
    }
    const uniformLists = [vertexUniformList, fragUniformList, sharedUniformList];
    const nameListUniform = [VERTEX_UNIFORM_NAME, FRAGMENT_UNIFORM_NAME, SHARED_UNIFORM_NAME];
    const nameListStorage = [VERTEX_STORAGE_NAME, FRAGMENT_STORAGE_NAME, SHARED_STORAGE_NAME];
    const maskList = [ShaderType.Vertex, ShaderType.Fragment, ShaderType.Vertex | ShaderType.Fragment];
    for (let i = 0; i < 3; i++) {
      for (const k in uniformLists[i]) {
        if (uniformLists[i][k]?.length > 0) {
          const ulist: { member: PBShaderExp; uniform: number }[][] = [
            uniformLists[i][k].filter(
              (val) => val.member.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM
            ),
            uniformLists[i][k].filter(
              (val) => val.member.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE
            )
          ];
          const nameList: string[][] = [nameListUniform, nameListStorage];
          const layoutList: PBStructLayout[] = ['std140', 'std430'];
          for (let j = 0; j < 2; j++) {
            if (ulist[j].length === 0) {
              continue;
            }
            const nonBufferList = ulist[j].filter((val) => !val.member.$isBuffer);
            const bufferList = ulist[j].filter((val) => val.member.$isBuffer);
            const allLists = [nonBufferList, ...bufferList.map((val) => [val])];
            for (let p = 0; p < allLists.length; p++) {
              if (allLists[p].length === 0) {
                continue;
              }
              const uname = `${nameList[j][i]}_${k}_${p}`;
              const structName = this.generateStructureName();
              const t = getCurrentProgramBuilder().internalDefineStruct(
                structName,
                layoutList[j],
                maskList[i],
                false,
                ...allLists[p].map((val) => val.member)
              );
              if (maskList[i] & ShaderType.Vertex) {
                const exp = t();
                if (j === 0) {
                  exp.uniformBuffer(Number(k));
                } else {
                  exp.storageBuffer(Number(k));
                }
                globalScopeVertex[uname] = exp;
              }
              if (maskList[i] & ShaderType.Fragment) {
                const exp = t();
                if (j === 0) {
                  exp.uniformBuffer(Number(k));
                } else {
                  exp.storageBuffer(Number(k));
                }
                globalScopeFragmet[uname] = exp;
              }
              const index = this._uniforms.findIndex((val) => val.block?.name === uname);
              this._uniforms[index].mask = maskList[i];
              let nameMap = this._nameMap[Number(k)];
              if (!nameMap) {
                nameMap = {};
                this._nameMap[Number(k)] = nameMap;
              }
              let writable = false;
              for (let n = allLists[p].length - 1; n >= 0; n--) {
                const u = allLists[p][n];
                const exp = this._uniforms[u.uniform].block.exp;
                nameMap[exp.$str] = uname;
                exp.$str = `${uname}.${exp.$str}`;
                writable ||= exp.$ast.isWritable();
              }
              if (writable) {
                if (maskList[i] & ShaderType.Vertex) {
                  globalScopeVertex[uname].$ast.markWritable();
                } else {
                  globalScopeFragmet[uname].$ast.markWritable();
                }
              }
            }
          }
        }
      }
    }
    this._uniforms = this._uniforms.filter((val) => {
      return !val.block || (val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer);
      /*
      if (!val.block) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */
    });
  }
  /** @internal */
  private updateUniformBindings(scopes: PBGlobalScope[], shaderTypes: ShaderType[]) {
    this._uniforms = this._uniforms.filter((val) => !!val.mask);
    const bindings: number[] = Array.from<number>({ length: MAX_BINDING_GROUPS }).fill(0);
    for (const u of this._uniforms) {
      u.binding = bindings[u.group]++;
    }
    for (let i = 0; i < scopes.length; i++) {
      const scope = scopes[i];
      const type = shaderTypes[i];
      for (const u of this._uniforms) {
        if (u.mask & type) {
          const uniforms = (scope.$ast as AST.ASTGlobalScope).uniforms;
          const name = u.block ? u.block.name : u.texture ? u.texture.exp.$str : u.sampler.$str;
          const index = uniforms.findIndex((val) => val.value.name === name);
          if (index < 0) {
            throw new Error(`updateUniformBindings() failed: unable to find uniform ${name}`);
          }
          (uniforms[index] as AST.ASTDeclareVar).binding = u.binding;
        }
      }
    }
  }
  /** @internal */
  private createBindGroupLayouts(label: string): BindGroupLayout[] {
    const layouts: BindGroupLayout[] = [];
    for (const uniformInfo of this._uniforms) {
      let layout = layouts[uniformInfo.group];
      if (!layout) {
        layout = {
          label: `${label || 'unknown'}[${uniformInfo.group}]`,
          entries: []
        };
        if (this._nameMap[uniformInfo.group]) {
          layout.nameMap = this._nameMap[uniformInfo.group];
        }
        layouts[uniformInfo.group] = layout;
      }
      const entry: BindGroupLayoutEntry = {
        binding: uniformInfo.binding,
        visibility: uniformInfo.mask,
        type: null,
        name: ''
      };
      if (uniformInfo.block) {
        entry.type = (uniformInfo.block.exp.$typeinfo as PBStructTypeInfo).clone(
          this.getBlockName(uniformInfo.block.name)
        );
        const isStorage = uniformInfo.block.exp.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE;
        entry.buffer = {
          type: isStorage
            ? (uniformInfo.block.exp.$ast as AST.ASTPrimitive).isWritable()
              ? 'storage'
              : 'read-only-storage'
            : 'uniform',
          hasDynamicOffset: uniformInfo.block.dynamicOffset,
          uniformLayout: entry.type.toBufferLayout(0, (entry.type as PBStructTypeInfo).layout)
        };
        entry.name = uniformInfo.block.name;
      } else if (uniformInfo.texture) {
        entry.type = uniformInfo.texture.exp.$typeinfo;
        if (!entry.type.isTextureType()) {
          throw new Error('internal error');
        }
        if (entry.type.isStorageTexture()) {
          entry.storageTexture = {
            access: 'write-only',
            viewDimension: entry.type.is1DTexture() ? '1d' : '2d',
            format: entry.type.storageTexelFormat
          };
        } else if (entry.type.isExternalTexture()) {
          entry.externalTexture = {
            autoBindSampler: uniformInfo.texture.autoBindSampler
              ? AST.genSamplerName(uniformInfo.texture.exp.$str, false)
              : null
          };
        } else {
          const sampleType =
            this._device.type === 'webgpu'
              ? uniformInfo.texture.exp.$sampleType
              : uniformInfo.texture.autoBindSampler && entry.type.isDepthTexture()
              ? 'float'
              : uniformInfo.texture.exp.$sampleType;
          let viewDimension: typeof entry.texture.viewDimension;
          if (entry.type.isArrayTexture()) {
            viewDimension = entry.type.isCubeTexture() ? 'cube-array' : '2d-array';
          } else if (entry.type.is3DTexture()) {
            viewDimension = '3d';
          } else if (entry.type.isCubeTexture()) {
            viewDimension = 'cube';
          } else if (entry.type.is1DTexture()) {
            viewDimension = '1d';
          } else {
            viewDimension = '2d';
          }
          entry.texture = {
            sampleType: sampleType,
            viewDimension: viewDimension,
            multisampled: false,
            autoBindSampler: null,
            autoBindSamplerComparison: null
          };
          if (this._device.type === 'webgpu' || uniformInfo.texture.autoBindSampler === 'sample') {
            entry.texture.autoBindSampler = AST.genSamplerName(uniformInfo.texture.exp.$str, false);
          }
          if (
            (this._device.type === 'webgpu' && entry.type.isDepthTexture()) ||
            uniformInfo.texture.autoBindSampler === 'comparison'
          ) {
            entry.texture.autoBindSamplerComparison = AST.genSamplerName(uniformInfo.texture.exp.$str, true);
          }
        }
        entry.name = uniformInfo.texture.exp.$str;
      } else if (uniformInfo.sampler) {
        entry.type = uniformInfo.sampler.$typeinfo;
        if (!entry.type.isSamplerType()) {
          throw new Error('internal error');
        }
        entry.sampler = {
          type:
            entry.type.accessMode === PBSamplerAccessMode.SAMPLE
              ? uniformInfo.sampler.$sampleType === 'float'
                ? 'filtering'
                : 'non-filtering'
              : 'comparison'
        };
        entry.name = uniformInfo.sampler.$str;
      } else {
        throw new errors.PBInternalError('invalid uniform entry type');
      }
      layout.entries.push(entry);
    }
    for (let i = 0; i < layouts.length; i++) {
      if (!layouts[i]) {
        layouts[i] = {
          label: `${label || 'unknown'}[${i}]`,
          entries: []
        };
      }
    }
    return layouts;
  }
  /** @internal */
  _getFunctionOverload(
    funcName: string,
    args: ExpValueNonArrayType[]
  ): [AST.ASTFunction, AST.ASTExpression[]] {
    const thisArgs = args.filter((val) => {
      if (val instanceof PBShaderExp) {
        const type = val.$ast.getType();
        if (
          type.isStructType() &&
          this._structInfo[this._shaderType]?.types.findIndex((t) => t.type.structName === type.structName) <
            0
        ) {
          return false;
        }
      }
      return true;
    });
    const fn = this.getGlobalScope().$getFunctions(funcName);
    return fn ? this._matchFunctionOverloading(fn, thisArgs) : null;
  }
  /** @internal */
  _matchFunctionOverloading(
    overloadings: AST.ASTFunction[],
    args: ExpValueNonArrayType[]
  ): [AST.ASTFunction, AST.ASTExpression[]] {
    for (const overload of overloadings) {
      if (args.length !== overload.funcType.argTypes.length) {
        continue;
      }
      const result: AST.ASTExpression[] = [];
      let matches = true;
      for (let i = 0; i < args.length; i++) {
        const argInfo = overload.funcType.argTypes[i];
        const argType =
          argInfo.byRef && argInfo.type instanceof PBPointerTypeInfo
            ? argInfo.type.pointerType
            : argInfo.type;
        const arg = args[i];
        if (typeof arg === 'boolean') {
          if (!argType.isPrimitiveType() || argType.primitiveType !== PBPrimitiveType.BOOL) {
            matches = false;
            break;
          }
          result.push(new AST.ASTScalar(arg, typeBool));
        } else if (typeof arg === 'number') {
          if (
            !argType.isPrimitiveType() ||
            !argType.isScalarType() ||
            argType.scalarType === PBPrimitiveType.BOOL
          ) {
            matches = false;
            break;
          }
          if (argType.scalarType === PBPrimitiveType.I32) {
            if (!Number.isInteger(arg) || arg < 0x80000000 >> 0 || arg > 0x7fffffff) {
              matches = false;
              break;
            }
            result.push(new AST.ASTScalar(arg, typeI32));
          } else if (argType.scalarType === PBPrimitiveType.U32) {
            if (!Number.isInteger(arg) || arg < 0 || arg > 0xffffffff) {
              matches = false;
              break;
            }
            result.push(new AST.ASTScalar(arg, typeU32));
          } else {
            result.push(new AST.ASTScalar(arg, argType));
          }
        } else {
          if (!argType.isCompatibleType(arg.$ast.getType())) {
            matches = false;
            break;
          }
          result.push(arg.$ast);
        }
      }
      if (matches) {
        return [overload, result];
      }
    }
    return null;
  }
  /** @internal */
  $callFunction(funcName: string, args: AST.ASTExpression[], func: AST.ASTFunction): PBShaderExp {
    if (this.getCurrentScope() === this.getGlobalScope()) {
      throw new errors.PBNonScopedFunctionCall(funcName);
    }
    const exp = new PBShaderExp('', func.returnType);
    exp.$ast = new AST.ASTCallFunction(funcName, args, func, getCurrentProgramBuilder().getDevice().type);
    this.getCurrentScope().$ast.statements.push(exp.$ast);
    return exp;
  }
  /** @internal */
  $callFunctionNoCheck(funcName: string, args: AST.ASTExpression[], retType: PBTypeInfo): PBShaderExp {
    if (this.getCurrentScope() === this.getGlobalScope()) {
      throw new errors.PBNonScopedFunctionCall(funcName);
    }
    const exp = new PBShaderExp('', retType);
    exp.$ast = new AST.ASTCallFunction(
      funcName,
      args,
      null,
      getCurrentProgramBuilder().getDevice().type,
      retType
    );
    this.getCurrentScope().$ast.statements.push(exp.$ast);
    return exp;
  }
}

/**
 * Base class for scope of the shader program
 * @public
 */
export class PBScope extends Proxiable<PBScope> {
  /** @internal */
  protected $_variables: Record<string, PBShaderExp>;
  /** @internal */
  protected $_parentScope: PBScope;
  /** @internal */
  protected $_AST: AST.ASTScope;
  /** @internal */
  protected $_localScope: PBLocalScope;
  [props: string]: any;
  /** @internal */
  constructor(astScope: AST.ASTScope, parent?: PBScope) {
    super();
    this.$_parentScope = parent || null;
    this.$_variables = {};
    this.$_AST = astScope;
    this.$_localScope = null;
  }
  /** Get the program builder */
  get $builder(): ProgramBuilder {
    return getCurrentProgramBuilder();
  }
  /** Returns the scope of the builtin variables */
  get $builtins(): PBBuiltinScope {
    return getCurrentProgramBuilder().builtinScope;
  }
  /** Returns the scope of the input variables */
  get $inputs(): PBInputScope {
    return getCurrentProgramBuilder().inputScope;
  }
  /** Returns the scope of the output variables */
  get $outputs(): PBOutputScope {
    return getCurrentProgramBuilder().outputScope;
  }
  /** @internal */
  get $parent(): PBScope {
    return this.$_parentScope;
  }
  /** @internal */
  get $ast(): AST.ASTScope {
    return this.$_AST;
  }
  /** @internal */
  set $ast(ast: AST.ASTScope) {
    this.$_AST = ast;
  }
  /**
   * Get the input vertex attribute by specified semantic
   *
   * @remarks
   * Can only be called only in vertex shader
   *
   * @param semantic - The vertex semantic
   * @returns The input vertex attribute or null if not exists
   */
  $getVertexAttrib(semantic: VertexSemantic): PBShaderExp {
    return this.$inputs.$getVertexAttrib(semantic); // getCurrentProgramBuilder().getReflection().attribute(semantic);
  }
  /** Get the current local scope */
  get $l(): PBLocalScope {
    return this.$_getLocalScope();
  }
  /** Get the global scope */
  get $g(): PBGlobalScope {
    return this.$_getGlobalScope();
  }
  /** @internal */
  $local(variable: PBShaderExp, init?: ExpValueType): void {
    const initNonArray = getCurrentProgramBuilder().normalizeExpValue(init);
    variable.$global = this instanceof PBGlobalScope;
    this.$_declare(variable, initNonArray);
  }
  /** @internal */
  $touch(exp: PBShaderExp): void {
    this.$ast.statements.push(new AST.ASTTouch(exp.$ast));
  }
  /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */
  $query(name: string): PBShaderExp {
    return this.$builder.getReflection().tag(name);
  }
  /** @internal */
  $_declareInternal(variable: PBShaderExp, init?: ExpValueNonArrayType): AST.ShaderAST {
    const key = variable.$str;
    if (this.$_variables[key]) {
      throw new Error(`cannot re-declare variable '${key}'`);
    }
    if (!(variable.$ast instanceof AST.ASTPrimitive)) {
      throw new Error(
        `invalid variable declaration: '${variable.$ast.toString(
          getCurrentProgramBuilder().getDevice().type
        )}'`
      );
    }
    const varType = variable.$typeinfo;
    if (varType.isPointerType()) {
      if (!init) {
        throw new Error(`cannot declare pointer type variable without initialization: '${variable.$str}'`);
      }
      if (!(init instanceof PBShaderExp)) {
        throw new Error(`invalid initialization for pointer type declaration: '${variable.$str}`);
      }
      const initType = init.$ast.getType();
      if (!initType.isPointerType() || !varType.pointerType.isCompatibleType(initType.pointerType)) {
        throw new Error(`incompatible pointer type assignment: '${variable.$str}'`);
      }
      variable.$typeinfo = initType;
    }
    this.$_registerVar(variable, key);
    if (init === undefined || init === null) {
      return new AST.ASTDeclareVar(variable.$ast as AST.ASTPrimitive);
    } else {
      if (
        init instanceof PBShaderExp &&
        init.$ast instanceof AST.ASTShaderExpConstructor &&
        init.$ast.args.length === 0
      ) {
        if (!init.$ast.getType().isCompatibleType(variable.$ast.getType())) {
          throw new errors.PBTypeCastError(init, init.$ast.getType(), variable.$ast.getType());
        }
        return new AST.ASTDeclareVar(variable.$ast as AST.ASTPrimitive);
      } else {
        return new AST.ASTAssignment(
          new AST.ASTLValueDeclare(variable.$ast as AST.ASTPrimitive),
          init instanceof PBShaderExp ? init.$ast : init
        );
      }
    }
  }
  /** @internal */
  $_findOrSetUniform(variable: PBShaderExp): PBShaderExp {
    const name = variable.$str;
    const uniformInfo: UniformInfo = {
      group: variable.$group,
      binding: 0,
      mask: 0
    };
    if (variable.$typeinfo.isTextureType()) {
      uniformInfo.texture = {
        autoBindSampler: null,
        exp: variable
      };
    } else if (variable.$typeinfo.isSamplerType()) {
      uniformInfo.sampler = variable;
    } else {
      uniformInfo.block = {
        name: name,
        dynamicOffset: false,
        exp: variable
      };
      // throw new Error(`unsupported uniform type: ${name}`);
    }
    let found = false;
    for (const u of getCurrentProgramBuilder()._uniforms) {
      if (u.group !== uniformInfo.group) {
        continue;
      }
      if (
        uniformInfo.block &&
        u.block &&
        u.block.name === uniformInfo.block.name &&
        u.block.exp.$typeinfo.isCompatibleType(uniformInfo.block.exp.$typeinfo)
      ) {
        u.mask |= getCurrentProgramBuilder().shaderType;
        variable = u.block.exp;
        // u.block.exp = variable;
        found = true;
        break;
      }
      if (
        uniformInfo.texture &&
        u.texture &&
        uniformInfo.texture.exp.$str === u.texture.exp.$str &&
        uniformInfo.texture.exp.$typeinfo.isCompatibleType(u.texture.exp.$typeinfo)
      ) {
        u.mask |= getCurrentProgramBuilder().shaderType;
        variable = u.texture.exp;
        // u.texture.exp = variable;
        found = true;
        break;
      }
      if (
        uniformInfo.sampler &&
        u.sampler &&
        uniformInfo.sampler.$str === u.sampler.$str &&
        uniformInfo.sampler.$typeinfo.isCompatibleType(u.sampler.$typeinfo)
      ) {
        u.mask |= getCurrentProgramBuilder().shaderType;
        variable = u.sampler;
        // u.sampler = variable;
        found = true;
        break;
      }
    }
    if (!found) {
      uniformInfo.mask = getCurrentProgramBuilder().shaderType;
      getCurrentProgramBuilder()._uniforms.push(uniformInfo);
    }
    if (
      uniformInfo.texture &&
      !(uniformInfo.texture.exp.$typeinfo as PBTextureTypeInfo).isStorageTexture() &&
      getCurrentProgramBuilder().getDevice().type === 'webgpu'
    ) {
      // webgpu requires explicit sampler bindings
      const isDepth = variable.$typeinfo.isTextureType() && variable.$typeinfo.isDepthTexture();
      const samplerName = AST.genSamplerName(variable.$str, false);
      const samplerExp = getCurrentProgramBuilder()
        .sampler(samplerName)
        .uniform(uniformInfo.group)
        .sampleType(variable.$sampleType);
      samplerExp.$sampleType = variable.$sampleType;
      this.$local(samplerExp);
      if (isDepth) {
        const samplerNameComp = AST.genSamplerName(variable.$str, true);
        const samplerExpComp = getCurrentProgramBuilder()
          .samplerComparison(samplerNameComp)
          .uniform(uniformInfo.group)
          .sampleType(variable.$sampleType);
        this.$local(samplerExpComp);
      }
    }
    return variable;
  }
  /** @internal */
  $_declare(variable: PBShaderExp, init?: ExpValueNonArrayType): void {
    if (this.$_variables[variable.$str]) {
      throw new errors.PBASTError(variable.$ast, 'cannot re-declare variable');
    }
    if (
      variable.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM ||
      variable.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE
    ) {
      const name = (variable.$ast as AST.ASTPrimitive).name;
      if (!(this instanceof PBGlobalScope)) {
        throw new Error(`uniform or storage variables can only be declared within global scope: ${name}`);
      }
      if (
        variable.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM &&
        !variable.$typeinfo.isTextureType() &&
        !variable.$typeinfo.isSamplerType() &&
        (!variable.$typeinfo.isConstructible() || !variable.$typeinfo.isHostSharable())
      ) {
        throw new errors.PBASTError(
          variable.$ast,
          `type '${variable.$typeinfo.toTypeName(
            getCurrentProgramBuilder().getDevice().type
          )}' cannot be declared in uniform address space`
        );
      }
      if (variable.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE) {
        if (getCurrentProgramBuilder().getDevice().type !== 'webgpu') {
          throw new errors.PBDeviceNotSupport('storage buffer binding');
        } else if (!variable.$typeinfo.isHostSharable()) {
          throw new errors.PBASTError(
            variable.$ast,
            `type '${variable.$typeinfo.toTypeName(
              getCurrentProgramBuilder().getDevice().type
            )}' cannot be declared in storage address space`
          );
        }
      }
      const originalType: PBPrimitiveTypeInfo | PBArrayTypeInfo = null;
      /*
      if (
        variable.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE &&
        (variable.$typeinfo.isPrimitiveType() || variable.$typeinfo.isArrayType() || variable.$typeinfo.isAtomicI32() || variable.$typeinfo.isAtomicU32())
      ) {
        originalType = variable.$typeinfo as PBPrimitiveTypeInfo | PBArrayTypeInfo;
        const wrappedStruct = getCurrentProgramBuilder().defineStruct(null, new PBShaderExp('value', originalType));
        variable.$typeinfo = wrappedStruct().$typeinfo;
      }
      */
      variable = this.$_findOrSetUniform(variable);
      const ast = this.$_declareInternal(variable) as AST.ASTDeclareVar;
      if (originalType) {
        variable.$ast = new AST.ASTHash(variable.$ast, 'value', originalType);
      }
      ast.group = variable.$group;
      ast.binding = 0;
      ast.blockName = getCurrentProgramBuilder().getBlockName(name);
      const type = variable.$typeinfo;
      if (
        (type.isStructType() && variable.$isBuffer) ||
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      ) {
        (this.$ast as AST.ASTGlobalScope).uniforms.push(ast);
      }
      variable.$tags.forEach((val) => {
        getCurrentProgramBuilder().tagShaderExp(() => variable, val);
      });
    } else {
      const ast = this.$_declareInternal(variable, init);
      this.$ast.statements.push(ast);
    }
  }
  /** @internal */
  $_registerVar(variable: PBShaderExp, name?: string) {
    const key = name || variable.$str;
    const options: any = {
      configurable: true,
      get: function (this: PBScope) {
        return variable;
      },
      set: function (this: PBScope, val: number | PBShaderExp) {
        getCurrentProgramBuilder()
          .getCurrentScope()
          .$ast.statements.push(
            new AST.ASTAssignment(
              new AST.ASTLValueScalar(variable.$ast),
              val instanceof PBShaderExp ? val.$ast : val
            )
          );
      }
    };
    Object.defineProperty(this, key, options);
    this.$_variables[key] = variable;
  }
  /** @internal */
  $localGet(prop: string): any {
    if (typeof prop === 'string' && (prop[0] === '$' || prop in this)) {
      return this[prop];
    }
    return undefined;
  }
  /** @internal */
  $localSet(prop: string, value: any): boolean {
    if (prop[0] === '$' || prop in this) {
      this[prop] = value;
      return true;
    }
    return false;
  }
  /** @internal */
  protected $get(prop: string): any {
    const ret = this.$localGet(prop);
    return ret === undefined && this.$_parentScope ? this.$_parentScope.$thisProxy.$get(prop) : ret;
  }
  /** @internal */
  protected $set(prop: string, value: any): boolean {
    if (prop[0] === '$') {
      this[prop] = value;
      return true;
    } else {
      let scope: PBScope = this;
      while (scope && !(prop in scope)) {
        scope = scope.$_parentScope;
      }
      if (scope) {
        scope[prop] = value;
        return true;
      } else {
        if (this.$l) {
          this.$l[prop] = value;
          return true;
        }
      }
    }
    return false;
  }
  /** @internal */
  protected $_getLocalScope(): PBLocalScope {
    if (!this.$_localScope) {
      this.$_localScope = new PBLocalScope(this);
    }
    return this.$_localScope;
  }
  /** @internal */
  protected $_getGlobalScope(): PBGlobalScope {
    return this.$builder.getGlobalScope();
  }
}

/**
 * The local scope of a shader
 * @public
 */
export class PBLocalScope extends PBScope {
  /** @internal */
  $_scope: PBScope;
  [props: string]: any;
  constructor(scope: PBScope) {
    super(null, null);
    this.$_scope = scope;
  }
  /** @internal */
  protected $get(prop: string): any {
    return prop[0] === '$' ? this[prop] : this.$_scope.$localGet(prop);
  }
  /** @internal */
  protected $set(prop: string, value: any): boolean {
    if (prop[0] === '$') {
      this[prop] = value;
      return true;
    }
    if (
      !(this.$_scope instanceof PBGlobalScope) &&
      value instanceof PBShaderExp &&
      (value.isConstructor() ||
        (value.$typeinfo.isTextureType() && value.$ast instanceof AST.ASTPrimitive && !value.$ast.name)) &&
      value.$declareType === AST.DeclareType.DECLARE_TYPE_UNIFORM
    ) {
      // We are setting uniform a uniform, should invoke in the global scope
      this.$g[prop] = value;
      return true;
    }
    const val = this.$_scope.$localGet(prop);
    if (val === undefined) {
      const type = getCurrentProgramBuilder().guessExpValueType(value);
      if (type.isCompatibleType(typeVoid)) {
        throw new Error(`Cannot assign void type to '${prop}'`);
      }
      const exp = new PBShaderExp(prop, type);
      if (value instanceof PBShaderExp && !this.$_scope.$parent) {
        exp.$declareType = value.$declareType;
        exp.$isBuffer = value.$isBuffer;
        exp.$group = value.$group;
        exp.$attrib = value.$attrib;
        exp.$sampleType = value.$sampleType;
        exp.$precision = value.$precision;
        exp.tag(...value.$tags);
      }
      this.$_scope.$local(exp, value);
      return true;
    } else {
      return this.$_scope.$localSet(prop, value);
    }
  }
  /** @internal */
  $_getLocalScope(): PBLocalScope {
    return this;
  }
}

/**
 * The builtin scope of a shader
 * @public
 */
export interface PBBuiltinScope {
  position: PBShaderExp;
  pointSize: PBShaderExp | number;
  fragDepth: PBShaderExp;
  readonly fragCoord: PBShaderExp;
  readonly frontFacing: PBShaderExp;
  readonly vertexIndex: PBShaderExp;
  readonly instanceIndex: PBShaderExp;
  readonly localInvocationId: PBShaderExp;
  readonly globalInvocationId: PBShaderExp;
  readonly workGroupId: PBShaderExp;
  readonly numWorkGroups: PBShaderExp;
  readonly sampleMaskIn: PBShaderExp;
  sampleMaskOut: PBShaderExp;
  readonly sampleIndex: PBShaderExp;
}

/**
 * The builtin scope of a shader
 * @public
 */
export class PBBuiltinScope extends PBScope {
  /** @internal */
  $_usedBuiltins: Set<string>;
  /** @internal */
  $_builtinVars: Record<string, PBShaderExp>;
  constructor() {
    super(null);
    this.$_usedBuiltins = new Set();
    const isWebGPU = getCurrentProgramBuilder().getDevice().type === 'webgpu';
    if (!isWebGPU) {
      this.$_builtinVars = {};
      const v = AST.builtinVariables[getCurrentProgramBuilder().getDevice().type];
      for (const k in v) {
        const info = v[k];
        this.$_builtinVars[k] = new PBShaderExp(info.name, info.type);
      }
    }
    const v = AST.builtinVariables[getCurrentProgramBuilder().getDevice().type];
    const that = this;
    for (const k of Object.keys(v)) {
      Object.defineProperty(this, k, {
        get: function () {
          return that.$getBuiltinVar(k);
        },
        set: function (v) {
          if (typeof v !== 'number' && !(v instanceof PBShaderExp)) {
            throw new Error(`Invalid output value assignment`);
          }
          const exp = that.$getBuiltinVar(k);
          getCurrentProgramBuilder()
            .getCurrentScope()
            .$ast.statements.push(
              new AST.ASTAssignment(new AST.ASTLValueScalar(exp.$ast), v instanceof PBShaderExp ? v.$ast : v)
            );
        }
      });
    }
  }
  /** @internal */
  protected $_getLocalScope(): PBLocalScope {
    return null;
  }
  /** @internal */
  private $getBuiltinVar(name: string) {
    const pb = getCurrentProgramBuilder();
    this.$_usedBuiltins.add(name);
    const isWebGPU = pb.getDevice().type === 'webgpu';
    if (isWebGPU) {
      const v = AST.builtinVariables[pb.getDevice().type];
      const info = v[name];
      const inout = info.inOrOut;
      if (inout === 'in') {
        return pb.getCurrentFunctionScope()[AST.getBuiltinParamName(pb.shaderType)][info.name];
      }
      const structName =
        inout === 'in'
          ? AST.getBuiltinInputStructInstanceName(pb.shaderType)
          : AST.getBuiltinOutputStructInstanceName(pb.shaderType);
      const scope = pb.getCurrentScope();
      if (!scope[structName] || !scope[structName][info.name]) {
        throw new Error(`invalid use of builtin variable ${name}`);
      }
      return scope[structName][info.name];
    } else {
      if (pb.getDevice().type === 'webgl2' && (name === 'vertexIndex' || name === 'instanceIndex')) {
        return pb.uint(this.$_builtinVars[name]);
      } else {
        return this.$_builtinVars[name];
      }
    }
  }
}

/**
 * The input scope of a shader
 * @public
 */
export class PBInputScope extends PBScope {
  /** @internal */
  private $_names: Record<string, string>;
  private $_aliases: Record<string, string>;
  /** @internal */
  constructor() {
    super(null);
    this.$_names = {};
    this.$_aliases = {};
  }
  /** @internal */
  $getVertexAttrib(attrib: VertexSemantic): PBShaderExp {
    const name = this.$_names[attrib];
    return name ? this[name] : null;
  }
  /** @internal */
  protected $_getLocalScope(): PBLocalScope {
    return null;
  }
  /** @internal */
  protected $get(prop: string) {
    if (prop[0] === '$') {
      return this[prop];
    }
    if (this.$_aliases[prop]) {
      prop = this.$_aliases[prop];
    }
    const pb = this.$builder;
    if (pb.getDevice().type === 'webgpu') {
      const param = pb.getCurrentFunctionScope()[AST.getBuiltinParamName(pb.shaderType)];
      const prefix = pb.shaderKind === 'vertex' ? input_prefix : output_prefix_vs;
      const name = `${prefix}${prop}`;
      if ((param.$typeinfo as PBStructTypeInfo).structMembers.findIndex((val) => val.name === name) < 0) {
        return undefined;
      }
      return param[`${prefix}${prop}`];
    }
    return super.$get(prop);
  }
  /** @internal */
  protected $set(prop: string, value: any): boolean {
    if (prop[0] === '$') {
      this[prop] = value;
    } else {
      if (!(value instanceof PBShaderExp)) {
        throw new Error(`invalid vertex input value`);
      }
      const st = getCurrentProgramBuilder().shaderType;
      if (st !== ShaderType.Vertex) {
        throw new Error(`shader input variables can only be declared in vertex shader: "${prop}"`);
      }
      const attrib = getVertexAttribByName(value.$attrib);
      if (attrib === undefined) {
        throw new Error(`can not declare shader input variable: invalid vertex attribute: "${prop}"`);
      }
      if (getCurrentProgramBuilder()._vertexAttributes.indexOf(attrib) >= 0) {
        const lastName = this.$_names[value.$attrib];
        if (prop !== lastName) {
          const p = this[lastName] as PBShaderExp;
          if (p.$typeinfo.typeId !== value.$typeinfo.typeId) {
            throw new Error(
              `can not declare shader input variable: attribute already declared with different type: "${prop}"`
            );
          }
          this.$_aliases[prop] = lastName;
        }
        return true;
      }
      if (!(value instanceof PBShaderExp) || !(value.$ast instanceof AST.ASTShaderExpConstructor)) {
        throw new Error(`invalid shader input variable declaration: "${prop}"`);
      }
      const type = value.$ast.getType();
      if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
        throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
      }
      this.$_names[value.$attrib] = prop;
      const location = getCurrentProgramBuilder()._inputs.length;
      const exp = new PBShaderExp(`${input_prefix}${prop}`, type).tag(...value.$tags);
      getCurrentProgramBuilder().in(location, prop, exp);
      getCurrentProgramBuilder()._vertexAttributes.push(attrib);
      //getCurrentProgramBuilder().getReflection().setAttrib(value.$attrib, exp);
      // modify input struct for webgpu
      if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
        if (getCurrentProgramBuilder().findStructType(AST.getBuiltinInputStructName(st), st)) {
          getCurrentProgramBuilder().defineBuiltinStruct(st, 'in');
        }
      }
    }
    return true;
  }
}

/**
 * The output scope of a shader
 * @public
 */
export class PBOutputScope extends PBScope {
  constructor() {
    super(null);
  }
  /** @internal */
  protected $_getLocalScope(): PBLocalScope {
    return null;
  }
  /** @internal */
  protected $set(prop: string, value: any): boolean {
    if (prop[0] === '$' /* || prop in this*/) {
      this[prop] = value;
    } else {
      const pb = getCurrentProgramBuilder();
      if (!(prop in this)) {
        if (
          pb.getCurrentScope() === pb.getGlobalScope() &&
          (!(value instanceof PBShaderExp) || !(value.$ast instanceof AST.ASTShaderExpConstructor))
        ) {
          throw new Error(`invalid shader output variable declaration: ${prop}`);
        }
        const type = value.$ast.getType();
        if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
          throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
        }
        const location = pb._outputs.length;
        pb.out(
          location,
          prop,
          new PBShaderExp(
            `${pb.shaderKind === 'vertex' ? output_prefix_vs : output_prefix_fs}${prop}`,
            type
          ).tag(...value.$tags)
        );
        // modify output struct for webgpu
        if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
          const st = getCurrentProgramBuilder().shaderType;
          if (getCurrentProgramBuilder().findStructType(AST.getBuiltinInputStructName(st), st)) {
            getCurrentProgramBuilder().defineBuiltinStruct(st, 'out');
          }
        }
      }
      if (getCurrentProgramBuilder().getCurrentScope() !== getCurrentProgramBuilder().getGlobalScope()) {
        const ast = value.$ast;
        if (!(ast instanceof AST.ASTShaderExpConstructor) || ast.args.length > 0) {
          this[prop] = value;
        }
      }
    }
    return true;
  }
}

/**
 * The global scope of a shader
 * @public
 */
export class PBGlobalScope extends PBScope {
  /** @internal */
  $_inputStructInfo: [ShaderTypeFunc, PBShaderExp, string, PBShaderExp];
  /** @internal */
  constructor() {
    super(new AST.ASTGlobalScope());
    this.$_inputStructInfo = null;
  }
  /** @internal */
  get $inputStructInfo(): [ShaderTypeFunc, PBShaderExp, string, PBShaderExp] {
    if (!this.$_inputStructInfo) {
      this.$_inputStructInfo = this.$builder.defineBuiltinStruct(this.$builder.shaderType, 'in');
    }
    return this.$_inputStructInfo;
  }
  /** @internal */
  get $inputStruct(): ShaderTypeFunc {
    return this.$inputStructInfo[0];
  }
  /** @internal */
  $mainFunc(body?: (this: PBFunctionScope) => void) {
    const pb = getCurrentProgramBuilder();
    if (pb.getDevice().type === 'webgpu') {
      const inputStruct = this.$inputStructInfo;
      //this.$local(inputStruct[1]);
      const isCompute = pb.shaderType === ShaderType.Compute;
      const outputStruct = isCompute ? null : pb.defineBuiltinStruct(pb.shaderType, 'out');
      if (outputStruct) {
        this.$local(outputStruct[1]);
      }
      // this.$internalCreateFunction('chMainStub', [], false, body);
      this.$internalCreateFunction(
        'main',
        inputStruct ? [inputStruct[3]] : [],
        true,
        function (this: PBFunctionScope) {
          /*
          if (inputStruct) {
            this[inputStruct[1].$str] = this[inputStruct[3].$str];
          }
          */
          if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
            this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
          }
          body?.call(this);
          //this.chMainStub();
          if (pb.shaderType === ShaderType.Vertex) {
            if (pb.depthRangeCorrection) {
              this.$builtins.position.z = pb.mul(
                pb.add(this.$builtins.position.z, this.$builtins.position.w),
                0.5
              );
            }
            if (pb.emulateDepthClamp) {
              //z = gl_Position.z / gl_Position.w;
              //z = (gl_DepthRange.diff * z + gl_DepthRange.near + gl_DepthRange.far) * 0.5;
              this.$outputs.clamppedDepth = pb.div(this.$builtins.position.z, this.$builtins.position.w);
              this.$builtins.position.z = 0;
            }
          }

          if (!isCompute) {
            this.$return(outputStruct[1]);
          }
        }
      );
    } else {
      this.$internalCreateFunction('main', [], true, function () {
        if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
          this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
        }
        body?.call(this);
        if (pb.shaderType === ShaderType.Vertex && pb.emulateDepthClamp) {
          this.$outputs.clamppedDepth = pb.div(
            pb.add(pb.div(this.$builtins.position.z, this.$builtins.position.w), 1),
            2
          );
          this.$builtins.position.z = 0;
        }
      });
    }
  }
  /** @internal */
  $createFunctionIfNotExists(name: string, params: PBShaderExp[], body?: (this: PBFunctionScope) => void) {
    if (true || !this.$builder.getFunction(name)) {
      this.$internalCreateFunction(name, params, false, body);
    }
  }
  /** @internal */
  $getFunctions(name: string): AST.ASTFunction[] {
    return (this.$ast as AST.ASTGlobalScope).findFunctions(name);
  }
  /** @internal */
  $getCurrentFunctionScope(): PBScope {
    let scope = getCurrentProgramBuilder().getCurrentScope();
    while (scope && !(scope instanceof PBFunctionScope)) {
      scope = scope.$parent;
    }
    return scope;
  }
  /** @internal */
  private $internalCreateFunction(
    this: PBGlobalScope,
    name: string,
    params: PBShaderExp[],
    isMain: boolean,
    body?: (this: PBFunctionScope) => void
  ) {
    const pb = getCurrentProgramBuilder();
    if (pb.getDevice().type === 'webgpu' && !isMain) {
      params.push(this.$inputStruct(AST.getBuiltinParamName(pb.shaderType)));
    }
    params.forEach((param) => {
      if (!(param.$ast instanceof AST.ASTPrimitive)) {
        throw new Error(`${name}(): invalid function definition`);
      }
      let ast: AST.ASTPrimitive | AST.ASTReferenceOf = param.$ast;
      if (param.$inout) {
        if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
          param.$typeinfo = new PBPointerTypeInfo(param.$typeinfo, PBAddressSpace.UNKNOWN);
        }
        ast = new AST.ASTReferenceOf(param.$ast);
      }
      param.$ast = new AST.ASTFunctionParameter(ast);
    });
    const overloads = this.$getFunctions(name);
    const currentFunctionScope = this.$getCurrentFunctionScope();
    const astFunc = new AST.ASTFunction(
      name,
      params.map((val) => val.$ast as AST.ASTFunctionParameter),
      isMain,
      null,
      false
    );
    if (currentFunctionScope) {
      const curIndex = this.$ast.statements.indexOf(currentFunctionScope.$ast);
      if (curIndex < 0) {
        throw new Error('Internal error');
      }
      this.$ast.statements.splice(curIndex, 0, astFunc);
    } else {
      this.$ast.statements.push(astFunc);
    }
    new PBFunctionScope(this, params, astFunc, body);

    if (!astFunc.returnType) {
      astFunc.returnType = typeVoid;
    }
    astFunc.funcType = new PBFunctionTypeInfo(
      astFunc.name,
      astFunc.returnType,
      params.map((param) => {
        const ast = param.$ast as AST.ASTFunctionParameter;
        return ast.paramAST instanceof AST.ASTReferenceOf
          ? {
              type: ast.paramAST.value.getType(),
              byRef: ast.paramAST instanceof AST.ASTReferenceOf
            }
          : {
              type: ast.paramAST.getType(),
              byRef: false
            };
      })
    );
    for (const overload of overloads) {
      if (overload.funcType.argHash === astFunc.funcType.argHash) {
        if (overload.returnType.isCompatibleType(astFunc.returnType)) {
          // Function signature already exists
          // console.warn(`Function '${name}' already exists`);
          this.$ast.statements.splice(this.$ast.statements.indexOf(astFunc), 1);
          return;
        } else {
          throw new Error(`Invalid function overloading: ${name}`);
        }
      }
    }
    if (overloads.length === 0) {
      Object.defineProperty(this, name, {
        get: function () {
          const func = this.$getFunctions(name);
          if (func.length === 0) {
            throw new Error(`function ${name} not found`);
          }
          return (...args: ExpValueType[]) => {
            let inputArg: PBShaderExp = null;
            if (pb.getDevice().type === 'webgpu') {
              let funcScope = pb.getCurrentScope();
              while (funcScope && !(funcScope instanceof PBFunctionScope)) {
                funcScope = funcScope.$parent;
              }
              const funcArgs = (funcScope.$ast as AST.ASTFunction).args;
              const arg = funcArgs[funcArgs.length - 1].paramAST;
              const name = (arg as AST.ASTPrimitive).name;
              inputArg = funcScope[name];
            }
            const argsNonArray = (inputArg ? [...args, inputArg] : args).map((val) =>
              pb.normalizeExpValue(val)
            );
            const funcType = pb._getFunctionOverload(name, argsNonArray);
            if (!funcType) {
              throw new Error(`ERROR: no matching overloads for function ${name}`);
            }
            return getCurrentProgramBuilder().$callFunction(name, funcType[1], funcType[0]);
          };
        }
      });
    }
  }
}

/**
 * Scope that is inside a function
 * @public
 */
export class PBInsideFunctionScope extends PBScope {
  /** @internal */
  constructor(parent: PBGlobalScope | PBInsideFunctionScope) {
    super(new AST.ASTScope(), parent);
  }
  /**
   * Creates a 'return' statement
   * @param retval - The return value
   */
  $return(retval?: ExpValueType) {
    const functionScope = this.findOwnerFunction();
    const astFunc = functionScope.$ast as AST.ASTFunction;
    let returnType: PBTypeInfo = null;
    const retValNonArray = getCurrentProgramBuilder().normalizeExpValue(retval);
    if (retValNonArray !== undefined && retValNonArray !== null) {
      if (typeof retValNonArray === 'number') {
        if (astFunc.returnType) {
          if (
            astFunc.returnType.isPrimitiveType() &&
            astFunc.returnType.isScalarType() &&
            !astFunc.returnType.isCompatibleType(typeBool)
          ) {
            returnType = astFunc.returnType;
          }
        }
        if (!returnType) {
          if (Number.isInteger(retValNonArray)) {
            if (retValNonArray < 0) {
              if (retValNonArray < 0x80000000 >> 0) {
                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
              }
              returnType = typeI32;
            } else {
              if (retValNonArray > 0xffffffff) {
                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
              }
              returnType = retValNonArray <= 0x7fffffff ? typeI32 : typeU32;
            }
          } else {
            returnType = typeF32;
          }
        }
      } else if (typeof retValNonArray === 'boolean') {
        returnType = typeBool;
      } else {
        returnType = retValNonArray.$ast.getType();
      }
    } else {
      returnType = typeVoid;
    }
    if (returnType.isPointerType()) {
      throw new Error('function can not return pointer type');
    }
    if (!astFunc.returnType) {
      astFunc.returnType = returnType;
    } else if (!astFunc.returnType.isCompatibleType(returnType)) {
      throw new Error(
        `function ${astFunc.name}: return type must be ${
          astFunc.returnType?.toTypeName(getCurrentProgramBuilder().getDevice().type) || 'void'
        }`
      );
    }
    let returnValue: AST.ASTExpression = null;
    if (retValNonArray !== undefined && retValNonArray !== null) {
      if (retValNonArray instanceof PBShaderExp) {
        returnValue = retValNonArray.$ast;
      } else {
        if (!returnType.isPrimitiveType() || !returnType.isScalarType()) {
          throw new errors.PBTypeCastError(retValNonArray, typeof retValNonArray, returnType);
        }
        returnValue = new AST.ASTScalar(retValNonArray, returnType);
      }
    }
    this.$ast.statements.push(new AST.ASTReturn(returnValue));
  }
  /**
   * Creates a new scope
   * @param body - Generator function for the scope
   * @returns The created scope
   */
  $scope(body: (this: PBInsideFunctionScope) => void): PBInsideFunctionScope {
    const astScope = new AST.ASTNakedScope();
    this.$ast.statements.push(astScope);
    return new PBNakedScope(this, astScope, body);
  }
  /**
   * Creates an 'if' statement
   * @param condition - Condition expression for the if statement
   * @param body - Generator function for the scope inside the if statement
   * @returns The scope inside the if statement
   */
  $if(condition: ExpValueNonArrayType, body: (this: PBIfScope) => void): PBIfScope {
    const astIf = new AST.ASTIf(
      'if',
      condition instanceof PBShaderExp
        ? condition.$ast
        : new AST.ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool)
    );
    this.$ast.statements.push(astIf);
    return new PBIfScope(this, astIf, body);
  }
  /**
   * Creates a select statement: condition ? first : second
   * @param condition - Condition expression
   * @param first - The first value
   * @param second - The second value
   * @returns The first value if condition evaluates to true, otherwise returns the second value
   */
  $choice(
    condition: ExpValueNonArrayType,
    first: ExpValueNonArrayType,
    second: ExpValueNonArrayType
  ): PBShaderExp {
    const ast = new AST.ASTSelect(
      condition instanceof PBShaderExp ? condition.$ast : condition,
      first instanceof PBShaderExp ? first.$ast : first,
      second instanceof PBShaderExp ? second.$ast : second
    );
    const exp = new PBShaderExp('', ast.getType());
    exp.$ast = ast;
    return exp;
  }
  /** Creates a 'break' statement */
  $break() {
    this.$ast.statements.push(new AST.ASTBreak());
  }
  /** Creates a 'continue' statement */
  $continue() {
    this.$ast.statements.push(new AST.ASTContinue());
  }
  /**
   * Creates a 'for' statement
   * @param counter - The repeat counter variable declaration
   * @param init - initial value of the repeat counter variable
   * @param end - end value of the counter exclusive
   * @param body - Generator function for the scope that inside the for statement
   */
  $for(
    counter: PBShaderExp,
    init: number | PBShaderExp,
    end: number | PBShaderExp,
    body: (this: PBForScope) => void
  ) {
    const initializerType = counter.$ast.getType();
    if (!initializerType.isPrimitiveType() || !initializerType.isScalarType()) {
      throw new errors.PBASTError(counter.$ast, 'invalid for range initializer type');
    }
    const initval = init instanceof PBShaderExp ? init.$ast : new AST.ASTScalar(init, initializerType);
    const astFor = new AST.ASTRange(
      counter.$ast as AST.ASTPrimitive,
      initval,
      end instanceof PBShaderExp ? end.$ast : new AST.ASTScalar(end, initializerType),
      true
    );
    this.$ast.statements.push(astFor);
    new PBForScope(this, counter, end, astFor, body);
  }
  /**
   * Creates a 'do..while' statement
   * @param body - Generator function for the scope that inside the do..while statment
   * @returns The scope that inside the do..while statement
   */
  $do(body: (this: PBDoWhileScope) => void): PBDoWhileScope {
    if (this.$builder.getDevice().type === 'webgl') {
      throw new Error(`No do-while() loop support for WebGL1.0 device`);
    }
    const astDoWhile = new AST.ASTDoWhile(null);
    this.$ast.statements.push(astDoWhile);
    return new PBDoWhileScope(this, astDoWhile, body);
  }
  /**
   * Creates a 'while' statement
   * @param condition - Condition expression for the while statement
   * @param body - Generator function for the scope that inside the while statement
   */
  $while(condition: ExpValueNonArrayType, body: (this: PBWhileScope) => void) {
    const astWhile = new AST.ASTWhile(
      condition instanceof PBShaderExp
        ? condition.$ast
        : new AST.ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool)
    );
    this.$ast.statements.push(astWhile);
    new PBWhileScope(this, astWhile, body);
  }
  /** @internal */
  private findOwnerFunction(): PBFunctionScope {
    for (let scope: PBScope = this; scope; scope = scope.$parent) {
      if (scope instanceof PBFunctionScope) {
        return scope;
      }
    }
    return null;
  }
}

/**
 * Scope that insides a function
 * @public
 */
export class PBFunctionScope extends PBInsideFunctionScope {
  /** @internal */
  $typeinfo: PBFunctionTypeInfo;
  /** @internal */
  constructor(
    parent: PBGlobalScope,
    params: PBShaderExp[],
    ast: AST.ASTScope,
    body?: (this: PBFunctionScope) => void
  ) {
    super(parent);
    this.$ast = ast;
    for (const param of params) {
      if (this.$_variables[param.$str]) {
        throw new Error('Duplicate function parameter name is not allowed');
      }
      this.$_registerVar(param);
    }
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
  $isMain(): boolean {
    return (this.$ast as AST.ASTFunction).isMainFunc;
  }
}

/**
 * Scope that insides a while statement
 * @public
 */
export class PBWhileScope extends PBInsideFunctionScope {
  /** @internal */
  constructor(parent: PBInsideFunctionScope, ast: AST.ASTScope, body: (this: PBWhileScope) => void) {
    super(parent);
    this.$ast = ast;
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
}

/**
 * Scope that insides a do..while statement
 * @public
 */
export class PBDoWhileScope extends PBInsideFunctionScope {
  /** @internal */
  constructor(parent: PBInsideFunctionScope, ast: AST.ASTScope, body: (this: PBDoWhileScope) => void) {
    super(parent);
    this.$ast = ast;
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
  $while(condition: ExpValueNonArrayType) {
    (this.$ast as AST.ASTDoWhile).condition =
      condition instanceof PBShaderExp
        ? condition.$ast
        : new AST.ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool);
  }
}

/**
 * Scope that insides a for statement
 * @public
 */
export class PBForScope extends PBInsideFunctionScope {
  /** @internal */
  constructor(
    parent: PBGlobalScope | PBInsideFunctionScope,
    counter: PBShaderExp,
    count: number | PBShaderExp,
    ast: AST.ASTScope,
    body: (this: PBForScope) => void
  ) {
    super(parent);
    this.$ast = ast;
    this.$_registerVar(counter);
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
}

/**
 * A naked scope
 * @public
 */
export class PBNakedScope extends PBInsideFunctionScope {
  /** @internal */
  constructor(parent: PBInsideFunctionScope, ast: AST.ASTScope, body: (this: PBNakedScope) => void) {
    super(parent);
    this.$ast = ast;
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
}

/**
 * Scope that insides an if statement
 * @public
 */
export class PBIfScope extends PBInsideFunctionScope {
  /** @internal */
  constructor(parent: PBInsideFunctionScope, ast: AST.ASTScope, body: (this: PBIfScope) => void) {
    super(parent);
    this.$ast = ast;
    getCurrentProgramBuilder().pushScope(this);
    body && body.call(this);
    getCurrentProgramBuilder().popScope();
  }
  /**
   * Creates an 'else if' branch
   * @param condition - Condition expression for the else if branch
   * @param body - Generator function for the scope that insides the else if statement
   * @returns The scope that insides the else if statement
   */
  $elseif(condition: ExpValueNonArrayType, body: (this: PBIfScope) => void): PBIfScope {
    const astElseIf = new AST.ASTIf(
      'else if',
      condition instanceof PBShaderExp
        ? condition.$ast
        : new AST.ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool)
    );
    (this.$ast as AST.ASTIf).nextElse = astElseIf;
    return new PBIfScope(this.$_parentScope as PBInsideFunctionScope, astElseIf, body);
  }
  /**
   * Creates an 'else' branch
   * @param body - Generator function for the scope that insides the else statement
   */
  $else(body: (this: PBIfScope) => void): void {
    const astElse = new AST.ASTIf('else', null);
    (this.$ast as AST.ASTIf).nextElse = astElse;
    new PBIfScope(this.$_parentScope as PBInsideFunctionScope, astElse, body);
  }
}

setBuiltinFuncs(ProgramBuilder);
setConstructors(ProgramBuilder);
