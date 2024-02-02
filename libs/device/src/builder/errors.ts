import type { ExpValueType } from './programbuilder';
import type { PBTypeInfo } from './types';
import type { ShaderAST } from './ast';

/** @internal */
export function expValueToString(deviceType: string, value: ExpValueType): string {
  if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
    return `${value}`;
  } else {
    return value.$ast?.toString(deviceType);
  }
}

/** @internal */
export function expValueTypeToString(deviceType: string, type: PBTypeInfo): string {
  return type?.toTypeName(deviceType);
}

/** @internal */
export abstract class PBError extends Error {
  abstract getMessage(deviceType: string): string;
}

/** @internal */
export class PBValueOutOfRange extends PBError {
  value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
  getMessage(deviceType: string): string {
    return `value out of range: ${this.value}`;
  }
}

/** @internal */
export class PBTypeCastError extends PBError {
  value: ExpValueType | string;
  valueType: PBTypeInfo | string;
  expectedType: PBTypeInfo | string;
  constructor(
    value: ExpValueType | string,
    valueType: PBTypeInfo | string,
    expectedType: PBTypeInfo | string
  ) {
    super();
    this.value = value;
    this.valueType = valueType;
    this.expectedType = expectedType;
  }
  getMessage(deviceType: string): string {
    const valueStr = typeof this.value === 'string' ? this.value : expValueToString(deviceType, this.value);
    const valueTypeStr =
      typeof this.valueType === 'string' ? this.valueType : expValueTypeToString(deviceType, this.valueType);
    const expectedTypeStr =
      typeof this.expectedType === 'string'
        ? this.expectedType
        : expValueTypeToString(deviceType, this.expectedType);
    return `cannot convert '${valueStr}' of type '${valueTypeStr}' to type ${expectedTypeStr}`;
  }
}

/** @internal */
export class PBParamLengthError extends PBError {
  func: string;
  constructor(func: string) {
    super();
    this.func = func;
  }
  getMessage(deviceType: string): string {
    return `wrong argument count for function '${this.func}'`;
  }
}

/** @internal */
export class PBParamTypeError extends PBError {
  func: string;
  param: string;
  constructor(func: string, param?: string) {
    super();
    this.func = func;
    this.param = param || null;
  }
  getMessage(deviceType: string): string {
    return `parameter type error for function '${this.func}': ${this.param}`;
  }
}

/** @internal */
export class PBParamValueError extends PBError {
  func: string;
  param: string;
  reason: string;
  constructor(func: string, param?: string, reason?: string) {
    super();
    this.func = func;
    this.param = param || null;
    this.reason = reason || null;
  }
  getMessage(deviceType: string): string {
    return `invalid parameter value for function '${this.func}'${this.param ? ': ' + this.param : ''}${
      this.reason ? ': ' + this.reason : ''
    }}`;
  }
}

/** @internal */
export class PBOverloadingMatchError extends PBError {
  func: string;
  constructor(func: string) {
    super();
    this.func = func;
  }
  getMessage(deviceType: string): string {
    return `No matched overloading found for function '${this.func}'`;
  }
}

/** @internal */
export class PBReferenceValueRequired extends PBError {
  value: ExpValueType;
  constructor(value: ExpValueType) {
    super();
    this.value = value;
  }
  getMessage(deviceType: string): string {
    return `'${expValueToString(deviceType, this.value)}' is not a reference type`;
  }
}

/** @internal */
export class PBPointerValueRequired extends PBError {
  value: ExpValueType;
  constructor(value: ExpValueType) {
    super();
    this.value = value;
  }
  getMessage(deviceType: string): string {
    return `'${expValueToString(deviceType, this.value)}' is not a pointer type`;
  }
}

/** @internal */
export class PBUndeclaredIdentifier extends PBError {
  constructor(identifier: string) {
    super(`undeclared identifier: ${identifier}`);
  }
  getMessage(deviceType: string): string {
    return this.message;
  }
}

/** @internal */
export class PBDeviceNotSupport extends PBError {
  feature: string;
  constructor(feature: string) {
    super();
    this.feature = feature;
  }
  getMessage(deviceType: string): string {
    return `feature not support for ${deviceType} device: ${this.feature}`;
  }
}

/** @internal */
export class PBNonScopedFunctionCall extends PBError {
  funcName: string;
  constructor(funcName: string) {
    super();
    this.funcName = funcName;
  }
  getMessage(deviceType: string): string {
    return `function call must be made inside a function scope: ${this.funcName}()`;
  }
}

/** @internal */
export class PBASTError extends PBError {
  ast: ShaderAST;
  text: string;
  constructor(ast: ShaderAST, text: string) {
    super();
    this.ast = ast;
    this.text = text;
  }
  getMessage(deviceType: string): string {
    return `${this.text}: ${this.ast.toString(deviceType)}`;
  }
}

/** @internal */
export class PBInternalError extends PBError {
  constructor(desc: string) {
    super(desc);
  }
  getMessage(deviceType: string): string {
    return `Internal error: ${this.message}`;
  }
}
