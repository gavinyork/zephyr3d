import type { ASTExpression } from './ast';
import {
  getTextureSampleType,
  ShaderPrecisionType,
  DeclareType,
  ASTPrimitive,
  ASTScalar,
  ASTArrayIndex,
  ASTLValueArray,
  ASTLValueHash,
  ASTLValueScalar,
  ASTHash,
  ASTShaderExpConstructor,
  ASTAssignment,
  ASTCast
} from './ast';
import type { PBTypeInfo } from './types';
import {
  PBPrimitiveType,
  PBPrimitiveTypeInfo,
  PBArrayTypeInfo,
  PBPointerTypeInfo,
  PBAddressSpace,
  typeI32
} from './types';
import { PBASTError } from './errors';
import type { VertexSemantic } from '../gpuobject';
import type { ProgramBuilder } from './programbuilder';

let currentProgramBuilder: ProgramBuilder = null;
const constructorCache: Map<ShaderTypeFunc, Record<string | symbol, ShaderTypeFunc>> = new Map();

/** @internal */
export function setCurrentProgramBuilder(pb: ProgramBuilder) {
  currentProgramBuilder = pb;
}

/** @internal */
export function getCurrentProgramBuilder(): ProgramBuilder {
  return currentProgramBuilder;
}

/** @public */
export interface ShaderExpTagRecord {
  [name: string]: ShaderExpTagValue;
}
/** @public */
export type ShaderExpTagValue = string[] | string | ShaderExpTagRecord;

/**
 * type of a shader variable constructor
 * @public
 */
export type ShaderTypeFunc = {
  (...args: any[]): PBShaderExp;
  ptr: ShaderTypeFunc;
  [dim: number]: ShaderTypeFunc;
};

/** @internal */
export function makeConstructor(typeFunc: ShaderTypeFunc, elementType: PBTypeInfo): ShaderTypeFunc {
  const wrappedTypeFunc = new Proxy(typeFunc, {
    get: function (target, prop) {
      if (typeof prop === 'symbol' || prop in target) {
        return target[prop];
      }
      let entries = constructorCache.get(typeFunc);
      if (!entries) {
        entries = {};
        constructorCache.set(typeFunc, entries);
      }
      let ctor = entries[prop];
      if (!ctor) {
        if (elementType.isPrimitiveType() || elementType.isStructType() || elementType.isArrayType()) {
          if (prop === 'ptr') {
            const pointerType = new PBPointerTypeInfo(elementType, PBAddressSpace.FUNCTION);
            ctor = function pointerCtor(this: ProgramBuilder, ...args: any[]) {
              if (args.length === 1 && typeof args[0] === 'string') {
                return new PBShaderExp(args[0], pointerType);
              } else {
                throw new Error(`Invalid pointer type constructor`);
              }
            } as ShaderTypeFunc;
          } else {
            const dim = Number(prop);
            if (Number.isInteger(dim) && dim >= 0) {
              const arrayType = new PBArrayTypeInfo(elementType, dim);
              const arrayTypeFunc = function arrayCtor(this: ProgramBuilder, ...args: any[]) {
                if (args.length === 1 && typeof args[0] === 'string') {
                  return new PBShaderExp(args[0], arrayType);
                } else {
                  const exp = new PBShaderExp('', arrayType);
                  exp.$ast = new ASTShaderExpConstructor(
                    exp.$typeinfo,
                    args.map((arg) => (arg instanceof PBShaderExp ? arg.$ast : arg))
                  );
                  return exp;
                }
              };
              ctor = makeConstructor(arrayTypeFunc as ShaderTypeFunc, arrayType);
            }
          }
        }
      }
      if (ctor) {
        entries[prop] = ctor;
      }
      return ctor;
    }
  });
  return wrappedTypeFunc;
}

/**
 * Base class for proxiable object
 * @public
 */
export abstract class Proxiable<T> {
  /** @internal */
  private proxy: Proxiable<T>;
  constructor() {
    this.proxy = new Proxy(this, {
      get: function (target, prop) {
        return typeof prop === 'string' ? target.$get(prop) : undefined;
      },
      set: function (target, prop, value) {
        return typeof prop === 'string' ? target.$set(prop, value) : false;
      }
    }) as Proxiable<T>;
    return this.proxy;
  }
  get $thisProxy(): T {
    return this.proxy as unknown as T;
  }
  /** @internal */
  protected abstract $get(prop: string): any;
  /** @internal */
  protected abstract $set(prop: string, value: any): boolean;
}

let uidExp = 0;

/**
 * Base class for a expression in the shader
 * @public
 */
export class PBShaderExp extends Proxiable<PBShaderExp> {
  /** @internal */
  $uid: number;
  /** @internal */
  $str: string;
  /** @internal */
  $location: number;
  /** @internal */
  $typeinfo: PBTypeInfo;
  /** @internal */
  $global: boolean;
  /** @internal */
  $sampleType: 'depth' | 'sint' | 'uint' | 'float' | 'unfilterable-float';
  /** @internal */
  $precision: ShaderPrecisionType;
  /** @internal */
  $ast: ASTExpression;
  /** @internal */
  $inout: 'out' | 'inout';
  /** @internal */
  $memberCache: Record<string, PBShaderExp>;
  /** @internal */
  $attrib: VertexSemantic;
  /** @internal */
  $tags: ShaderExpTagValue[];
  /** @internal */
  $_group: number;
  /** @internal */
  $declareType: DeclareType;
  /** @internal */
  $isBuffer: boolean;
  /** @internal */
  $dynamicOffset: boolean;
  [name: string]: any;
  /** @internal */
  constructor(str: string, typeInfo: PBTypeInfo) {
    super();
    if (!str && typeInfo.isPointerType()) {
      throw new Error('no default constructor for pointer type');
    }
    this.$uid = uidExp++;
    this.$str = str || '';
    this.$location = 0;
    this.$global = false;
    this.$typeinfo = typeInfo;
    this.$qualifier = null;
    this.$precision = ShaderPrecisionType.NONE;
    this.$ast = new ASTPrimitive(this);
    this.$inout = null;
    this.$memberCache = {};
    this.$attrib = null;
    this.$tags = [];
    this.$_group = null;
    this.$declareType = DeclareType.DECLARE_TYPE_NONE;
    this.$isBuffer = false;
    this.$dynamicOffset = false;
    if (typeInfo.isTextureType()) {
      if (typeInfo.isDepthTexture()) {
        this.$sampleType = 'depth';
      } else {
        const t = getTextureSampleType(typeInfo);
        if (t.primitiveType === PBPrimitiveType.I32) {
          this.$sampleType = 'sint';
        } else if (t.primitiveType === PBPrimitiveType.U32) {
          this.$sampleType = 'uint';
        } else {
          this.$sampleType = 'float';
        }
      }
    }
  }
  get $group() {
    return this.$_group;
  }
  set $group(val: number) {
    this.$_group = val;
    if (this.$_group === undefined) {
      debugger;
    }
  }
  /**
   * Point out that the variable should be in uniform address space
   * @param group - The bind group index
   * @returns self
   */
  uniform(group: number): PBShaderExp {
    this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
    this.$group = group;
    this.$isBuffer = false;
    return this;
  }
  /**
   * Point out that the variable should be an uniform buffer
   * @param group - The bind group index
   * @returns self
   */
  uniformBuffer(group: number, dynamicOffset = false): PBShaderExp {
    if (
      !this.$typeinfo.isPrimitiveType() &&
      !this.$typeinfo.isArrayType() &&
      !this.$typeinfo.isStructType()
    ) {
      throw new PBASTError(
        this.$ast,
        'only primitive type, array type or structure type can be set as uniform buffer'
      );
    }
    this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
    this.$group = group;
    this.$isBuffer = true;
    this.$dynamicOffset = !!dynamicOffset;
    return this;
  }
  /**
   * Point out that the variable should be in workgroup address space
   *
   * @remarks
   * WebGPU device only
   *
   * @returns self
   */
  workgroup(): PBShaderExp {
    this.$declareType = DeclareType.DECLARE_TYPE_WORKGROUP;
    return this;
  }
  /**
   * Point out that the variable should be in storage address space
   * @param group - The bind group index
   * @returns self
   */
  storage(group: number): PBShaderExp {
    if (!this.$typeinfo.isHostSharable()) {
      throw new PBASTError(this.$ast, 'type cannot be declared in storage address space');
    }
    this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
    this.$group = group;
    this.$isBuffer = false;
    return this;
  }
  /**
   * Point out that the variable should be a storage buffer
   * @param group - The bind group index
   * @returns self
   */
  storageBuffer(group: number, dynamicOffset = false): PBShaderExp {
    if (
      !this.$typeinfo.isPrimitiveType() &&
      !this.$typeinfo.isArrayType() &&
      !this.$typeinfo.isStructType()
    ) {
      throw new PBASTError(
        this.$ast,
        'only primitive type, array type or structure type can be set as storage buffer'
      );
    }
    this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
    this.$group = group;
    this.$isBuffer = true;
    this.$dynamicOffset = !!dynamicOffset;
    return this;
  }
  inout(): PBShaderExp {
    this.$inout = 'inout';
    return this;
  }
  out(): PBShaderExp {
    this.$inout = 'out';
    return this;
  }
  /**
   * Point out that the variable is a input vertex attribute
   * @param attr - The vertex semantic
   * @returns self
   */
  attrib(attr: VertexSemantic): PBShaderExp {
    this.$declareType = DeclareType.DECLARE_TYPE_IN;
    this.$attrib = attr;
    return this;
  }
  /**
   * Create tags for the variable
   * @param args - tags
   * @returns self
   */
  tag(...args: ShaderExpTagValue[]): PBShaderExp {
    args.forEach((val) => {
      if (this.$tags.indexOf(val) < 0) {
        this.$tags.push(val);
      }
    });
    return this;
  }
  /**
   * Set sample type for the variable if the variable is of type texture
   * @param type - sample type
   * @returns self
   */
  sampleType(type: 'float' | 'unfilterable-float' | 'sint' | 'uint' | 'depth'): PBShaderExp {
    if (type) {
      this.$sampleType = type;
    }
    return this;
  }
  /**
   * Get element in the array by index
   * @param index - index of the element
   * @returns the element variable
   */
  at(index: number | PBShaderExp) {
    const varType = this.$ast.getType();
    if (
      !varType.isArrayType() &&
      (!varType.isPrimitiveType() || (!varType.isVectorType() && !varType.isMatrixType()))
    ) {
      throw new Error('at() function must be used with array types');
    }
    let elementType: PBTypeInfo = null;
    let dimension: number;
    if (varType.isArrayType()) {
      elementType = varType.elementType;
      dimension = varType.dimension;
    } else if (varType.isVectorType()) {
      elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, 1));
      dimension = varType.cols;
    } else if (varType.isMatrixType()) {
      elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
      dimension = varType.rows;
    }
    const result = new PBShaderExp('', elementType);
    if (typeof index === 'number') {
      if (!Number.isInteger(index)) {
        throw new Error('at() array index must be integer type');
      }
      if (index < 0 || (dimension > 0 && index >= dimension)) {
        throw new Error('at() array index out of bounds');
      }
      result.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(index, typeI32), elementType);
    } else {
      const type = index.$ast.getType();
      if (!type.isPrimitiveType() || !type.isScalarType()) {
        throw new Error('at() array index must be scalar type');
      }
      let ast = index.$ast;
      if (type.scalarType !== PBPrimitiveType.I32 && type.scalarType !== PBPrimitiveType.U32) {
        ast = new ASTCast(ast, typeI32);
      }
      result.$ast = new ASTArrayIndex(this.$ast, ast, elementType);
    }
    return result;
  }
  /**
   * Set element in the array by index
   * @param index - index of the element
   * @param val - value to set
   */
  setAt(index: number | PBShaderExp, val: number | boolean | PBShaderExp) {
    const varType = this.$ast.getType();
    if (!varType.isArrayType()) {
      throw new Error('setAt() function must be used with array types');
    }
    if (typeof index === 'number') {
      if (!Number.isInteger(index)) {
        throw new Error('setAt() array index must be integer type');
      }
      if (index < 0 || (varType.dimension > 0 && index >= varType.dimension)) {
        throw new Error('setAt() array index out of bounds');
      }
    }
    currentProgramBuilder
      .getCurrentScope()
      .$ast.statements.push(
        new ASTAssignment(
          new ASTLValueArray(
            new ASTLValueScalar(this.$ast),
            typeof index === 'number' ? new ASTScalar(index, typeI32) : index.$ast,
            varType.elementType
          ),
          val instanceof PBShaderExp ? val.$ast : val
        )
      );
  }
  /**
   * Point out that the variable should be in high precision
   * @returns self
   */
  highp(): PBShaderExp {
    this.$precision = ShaderPrecisionType.HIGH;
    return this;
  }
  /**
   * Points out that the variable should be in medium precision
   * @returns self
   */
  mediump(): PBShaderExp {
    this.$precision = ShaderPrecisionType.MEDIUM;
    return this;
  }
  /**
   * Points out that the variable should be in low precision
   * @returns self
   */
  lowp(): PBShaderExp {
    this.$precision = ShaderPrecisionType.LOW;
    return this;
  }
  /**
   * Whether this is a constructor
   * @returns true if this is a constructor
   */
  isConstructor(): boolean {
    return this.$ast instanceof ASTShaderExpConstructor && this.$ast.args.length === 0;
  }
  /**
   * Determine if this variable is of vector type
   * @returns true if the variable is of vector type, otherwise false
   */
  isVector(): boolean {
    const varType = this.$ast.getType();
    return varType.isPrimitiveType() && varType.isVectorType();
  }
  /**
   * Get vector component count of the variable if this variable is of vector type
   * @returns the vector component count
   */
  numComponents(): number {
    const varType = this.$ast.getType();
    return varType.isPrimitiveType() ? varType.cols : 0;
  }
  /**
   * Get type name of this variable
   * @returns The type name of this variable
   */
  getTypeName(): string {
    return this.$ast.getType().toTypeName(currentProgramBuilder.getDevice().type);
  }
  /** @internal */
  protected $get(prop: string): any {
    if (typeof prop === 'string') {
      if (prop[0] === '$' || prop in this) {
        return this[prop];
      } else {
        let exp = this.$memberCache[prop];
        if (!exp) {
          const varType = this.$ast?.getType() || this.$typeinfo;
          const num = Number(prop);
          if (Number.isNaN(num)) {
            if (varType.isStructType()) {
              const elementIndex = varType.structMembers.findIndex((val) => val.name === prop);
              if (elementIndex < 0) {
                throw new Error(`unknown struct member '${prop}'`);
              }
              const element = varType.structMembers[elementIndex];
              if (element.type.isStructType()) {
                const ctor = currentProgramBuilder.structInfo.structs[element.type.structName];
                exp = ctor.call(currentProgramBuilder, `${this.$str}.${prop}`);
              } else {
                exp = new PBShaderExp(`${this.$str}.${prop}`, element.type);
              }
              exp.$ast = new ASTHash(this.$ast, prop, element.type);
            } else {
              if (!varType.isPrimitiveType() || !varType.isVectorType()) {
                throw new Error(
                  `invalid index operation: ${this.$ast.toString(
                    currentProgramBuilder.getDevice().type
                  )}[${prop}]`
                );
              }
              if (
                prop.length === 0 ||
                prop.length > 4 ||
                ([...prop].some((val) => 'xyzw'.slice(0, varType.cols).indexOf(val) < 0) &&
                  [...prop].some((val) => 'rgba'.slice(0, varType.cols).indexOf(val) < 0))
              ) {
                throw new Error(
                  `unknown swizzle target: ${this.$ast.toString(
                    currentProgramBuilder.getDevice().type
                  )}[${prop}]`
                );
              }
              const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, prop.length));
              exp = new PBShaderExp('', type);
              exp.$ast = new ASTHash(this.$ast, prop, type);
            }
          } else {
            if (varType.isArrayType()) {
              exp = this.at(num);
            } else if (varType.isPrimitiveType() && varType.isVectorType()) {
              if (num >= varType.cols) {
                throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
              }
              exp = this.$get('xyzw'[num]);
            } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
              const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
              exp = new PBShaderExp('', type);
              exp.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(num, typeI32), type);
            } else {
              throw new Error(`invalid index operation: ${this.$str}[${num}]`);
            }
          }
          this.$memberCache[prop] = exp;
        }
        return exp;
      }
    } else {
      return undefined;
    }
  }
  /** @internal */
  protected $set(prop: string, value: any): boolean {
    if (typeof prop === 'string') {
      if (prop[0] === '$' || prop in this) {
        this[prop] = value;
      } else {
        if (typeof value !== 'number' && typeof value !== 'boolean' && !(value instanceof PBShaderExp)) {
          throw new Error(`Invalid output value assignment`);
        }
        const varType = this.$ast?.getType() || this.$typeinfo;
        const num = Number(prop);
        if (Number.isNaN(num)) {
          if (varType.isStructType()) {
            const elementIndex = varType.structMembers.findIndex((val) => val.name === prop);
            if (elementIndex < 0) {
              throw new Error(`unknown struct member '${prop}`);
            }
            const element = varType.structMembers[elementIndex];
            let dstAST: ASTExpression;
            if (typeof value === 'number' || typeof value === 'boolean') {
              if (!element.type.isPrimitiveType() || !element.type.isScalarType()) {
                throw new Error(`can not set struct member '${prop}: invalid value type`);
              }
              dstAST = new ASTScalar(value, element.type);
            } else if (value instanceof PBShaderExp) {
              dstAST = value.$ast;
            }
            if (!dstAST) {
              throw new Error(`can not set struct member '${prop}: invalid value type`);
            }
            currentProgramBuilder
              .getCurrentScope()
              .$ast.statements.push(
                new ASTAssignment(
                  new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, element.type),
                  dstAST
                )
              );
          } else {
            // FIXME: WGSL does not support l-value swizzling
            if (prop.length > 1 || ('xyzw'.indexOf(prop) < 0 && 'rgba'.indexOf(prop) < 0)) {
              throw new Error(`invalid index operation: ${this.$str}[${num}]`);
            }
            if (!varType.isPrimitiveType() || !varType.isVectorType()) {
              throw new Error(`invalid index operation: ${this.$str}[${num}]`);
            }
            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.scalarType);
            currentProgramBuilder
              .getCurrentScope()
              .$ast.statements.push(
                new ASTAssignment(
                  new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, type),
                  value instanceof PBShaderExp ? value.$ast : value
                )
              );
          }
        } else {
          if (varType.isArrayType()) {
            this.setAt(num, value);
          } else if (varType.isPrimitiveType() && varType.isVectorType()) {
            if (num >= varType.cols) {
              throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
            }
            this.$set('xyzw'[num], value);
          } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
            if (!(value instanceof PBShaderExp)) {
              throw new Error(`invalid matrix column vector assignment: ${this.$str}[${num}]`);
            }
            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
            currentProgramBuilder
              .getCurrentScope()
              .$ast.statements.push(
                new ASTAssignment(
                  new ASTLValueArray(new ASTLValueScalar(this.$ast), new ASTScalar(num, typeI32), type),
                  value.$ast
                )
              );
          } else {
            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
          }
        }
      }
      return true;
    }
    return false;
  }
}
