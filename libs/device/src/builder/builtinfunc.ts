import * as typeinfo from './types';
import type { ASTExpression } from './ast';
import { ASTUnaryFunc, ASTBinaryFunc, ASTFunction, ASTAddressOf, ASTScalar } from './ast';
import { PBShaderExp } from './base';
import {
  PBDeviceNotSupport,
  PBOverloadingMatchError,
  PBParamLengthError,
  PBParamTypeError,
  PBParamValueError
} from './errors';
import type { ExpValueType, ProgramBuilder } from './programbuilder';

const genTypeList = [
  [typeinfo.typeF32, typeinfo.typeF32Vec2, typeinfo.typeF32Vec3, typeinfo.typeF32Vec4],
  [typeinfo.typeI32, typeinfo.typeI32Vec2, typeinfo.typeI32Vec3, typeinfo.typeI32Vec4],
  [typeinfo.typeU32, typeinfo.typeU32Vec2, typeinfo.typeU32Vec3, typeinfo.typeU32Vec4],
  [typeinfo.typeBool, typeinfo.typeBVec2, typeinfo.typeBVec3, typeinfo.typeBVec4]
];

const genMatrixTypeList = [
  typeinfo.typeMat2,
  typeinfo.typeMat2x3,
  typeinfo.typeMat2x4,
  typeinfo.typeMat3x2,
  typeinfo.typeMat3,
  typeinfo.typeMat3x4,
  typeinfo.typeMat4x2,
  typeinfo.typeMat4x3,
  typeinfo.typeMat4
];

function matchFunctionOverloadings(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
  const bit =
    pb.getDevice().type === 'webgl'
      ? MASK_WEBGL1
      : pb.getDevice().type === 'webgl2'
      ? MASK_WEBGL2
      : MASK_WEBGPU;
  const overloadings = builtinFunctionsAll?.[name].overloads
    .filter((val) => !!(val[1] & bit))
    .map((val) => val[0]);
  if (!overloadings || overloadings.length === 0) {
    throw new PBDeviceNotSupport(`builtin shader function '${name}'`);
  }
  const argsNonArray = args.map((val) => pb.normalizeExpValue(val));
  const matchResult = pb._matchFunctionOverloading(overloadings, argsNonArray);
  if (!matchResult) {
    throw new PBOverloadingMatchError(name);
  }
  return matchResult;
}
function callBuiltinChecked(pb: ProgramBuilder, matchResult: [ASTFunction, ASTExpression[]]) {
  return pb.$callFunction(matchResult[0].name, matchResult[1], matchResult[0]);
}
function callBuiltin(pb: ProgramBuilder, name: string, ...args: ExpValueType[]): PBShaderExp {
  return callBuiltinChecked(pb, matchFunctionOverloadings(pb, name, ...args));
}

function genMatrixType(
  name: string,
  shaderTypeMask: number,
  r: typeinfo.PBTypeInfo,
  args: typeinfo.PBPrimitiveTypeInfo[]
): [ASTFunction, number][] {
  const result: [ASTFunction, number][] = [];
  for (let i = 0; i < genMatrixTypeList.length; i++) {
    const returnType = r || genMatrixTypeList[i];
    const argTypes = args.map((arg) => {
      return { type: arg || genMatrixTypeList[i] };
    });
    result.push([
      new ASTFunction(name, null, false, new typeinfo.PBFunctionTypeInfo(name, returnType, argTypes), true),
      shaderTypeMask
    ]);
  }
  return result;
}

function genType(
  name: string,
  shaderTypeMask: number,
  r: typeinfo.PBTypeInfo | number,
  args: (typeinfo.PBTypeInfo | number)[],
  vecOnly?: boolean
): [ASTFunction, number][] {
  if (args.findIndex((val) => typeof val === 'number') < 0) {
    return [
      [
        new ASTFunction(
          name,
          null,
          false,
          new typeinfo.PBFunctionTypeInfo(
            name,
            r as typeinfo.PBPrimitiveTypeInfo,
            args.map((arg) => ({ type: arg as typeinfo.PBTypeInfo }))
          ),
          true
        ),
        shaderTypeMask
      ]
    ];
  } else {
    const result: [ASTFunction, number][] = [];
    let i = vecOnly ? 1 : 0;
    for (; i < 4; i++) {
      const returnType = typeof r === 'number' ? genTypeList[r][i] : r;
      const argTypes = args.map((arg) => {
        if (typeof arg === 'number') {
          return { type: genTypeList[arg][i] };
        } else {
          return { type: arg };
        }
      });
      result.push([
        new ASTFunction(name, null, false, new typeinfo.PBFunctionTypeInfo(name, returnType, argTypes), true),
        shaderTypeMask
      ]);
    }
    return result;
  }
}

function unaryFunc(a: ASTExpression, op: string, type: typeinfo.PBTypeInfo): PBShaderExp {
  const exp = new PBShaderExp('', type);
  exp.$ast = new ASTUnaryFunc(a, op, type);
  return exp;
}

function binaryFunc(a: ASTExpression, b: ASTExpression, op: string, type: typeinfo.PBTypeInfo): PBShaderExp {
  const exp = new PBShaderExp('', type);
  exp.$ast = new ASTBinaryFunc(a, b, op, type);
  return exp;
}

const MASK_WEBGL1 = 1 << 0;
const MASK_WEBGL2 = 1 << 1;
const MASK_WEBGPU = 1 << 2;
const MASK_WEBGL = MASK_WEBGL1 | MASK_WEBGL2;
const MASK_ALL = MASK_WEBGL | MASK_WEBGPU;

const builtinFunctionsAll = {
  add_2: {
    overloads: [
      ...genType('', MASK_ALL, 0, [0, 0]),
      ...genType('', MASK_ALL, 1, [1, 1]),
      ...genType('', MASK_ALL, 2, [2, 2]),
      ...genType('', MASK_ALL, 3, [3, 3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec2, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec4, typeinfo.typeF32]),

      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32, typeinfo.typeI32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32Vec2, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32, typeinfo.typeI32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32Vec3, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32, typeinfo.typeI32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32Vec4, typeinfo.typeI32]),

      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32, typeinfo.typeU32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32Vec2, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32, typeinfo.typeU32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32Vec3, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32, typeinfo.typeU32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32Vec4, typeinfo.typeU32]),

      ...genMatrixType('', MASK_ALL, null, [null, null])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
        return args[0] + args[1];
      }
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '+', matchResult[0].returnType);
    }
  },
  add: {
    overloads: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length < 2) {
        throw new PBParamLengthError('add');
      }
      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = pb.add_2(result as number | PBShaderExp, args[i] as number | PBShaderExp);
      }
      return result as PBShaderExp;
    }
  },
  sub: {
    overloads: [
      ...genType('', MASK_ALL, 0, [0, 0]),
      ...genType('', MASK_ALL, 1, [1, 1]),
      ...genType('', MASK_ALL, 2, [2, 2]),
      ...genType('', MASK_ALL, 3, [3, 3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec2, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec4, typeinfo.typeF32]),

      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32, typeinfo.typeI32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32Vec2, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32, typeinfo.typeI32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32Vec3, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32, typeinfo.typeI32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32Vec4, typeinfo.typeI32]),

      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32, typeinfo.typeU32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32Vec2, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32, typeinfo.typeU32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32Vec3, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32, typeinfo.typeU32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32Vec4, typeinfo.typeU32]),

      ...genMatrixType('', MASK_ALL, null, [null, null])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '-', matchResult[0].returnType);
    }
  },
  div: {
    overloads: [
      ...genType('', MASK_ALL, 0, [0, 0]),
      ...genType('', MASK_ALL, 1, [1, 1]),
      ...genType('', MASK_ALL, 2, [2, 2]),
      ...genType('', MASK_ALL, 3, [3, 3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec2, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec4, typeinfo.typeF32]),

      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32, typeinfo.typeI32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32Vec2, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32, typeinfo.typeI32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32Vec3, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32, typeinfo.typeI32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32Vec4, typeinfo.typeI32]),

      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32, typeinfo.typeU32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32Vec2, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32, typeinfo.typeU32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32Vec3, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32, typeinfo.typeU32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32Vec4, typeinfo.typeU32])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '/', matchResult[0].returnType);
    }
  },
  mul_2: {
    overloads: [
      ...genType('', MASK_ALL, 0, [0, 0]),
      ...genType('', MASK_ALL, 1, [1, 1]),
      ...genType('', MASK_ALL, 2, [2, 2]),
      ...genType('', MASK_ALL, 3, [3, 3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec2, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeF32]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec4, typeinfo.typeF32]),

      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32, typeinfo.typeI32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec2, [typeinfo.typeI32Vec2, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32, typeinfo.typeI32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec3, [typeinfo.typeI32Vec3, typeinfo.typeI32]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32, typeinfo.typeI32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeI32Vec4, [typeinfo.typeI32Vec4, typeinfo.typeI32]),

      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32, typeinfo.typeU32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec2, [typeinfo.typeU32Vec2, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32, typeinfo.typeU32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec3, [typeinfo.typeU32Vec3, typeinfo.typeU32]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32, typeinfo.typeU32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeU32Vec4, [typeinfo.typeU32Vec4, typeinfo.typeU32]),

      ...genMatrixType('', MASK_ALL, null, [typeinfo.typeF32, null]),
      ...genMatrixType('', MASK_ALL, null, [null, typeinfo.typeF32]),

      ...genType('', MASK_ALL, typeinfo.typeMat2, [typeinfo.typeMat2, typeinfo.typeMat2]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x2, [typeinfo.typeMat2, typeinfo.typeMat3x2]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x2, [typeinfo.typeMat2, typeinfo.typeMat4x2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeMat2, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec2, typeinfo.typeMat2]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x3, [typeinfo.typeMat2x3, typeinfo.typeMat2]),
      ...genType('', MASK_ALL, typeinfo.typeMat3, [typeinfo.typeMat2x3, typeinfo.typeMat3x2]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x3, [typeinfo.typeMat2x3, typeinfo.typeMat4x2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeMat2x3, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec3, typeinfo.typeMat2x3]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x4, [typeinfo.typeMat2x4, typeinfo.typeMat2]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x4, [typeinfo.typeMat2x4, typeinfo.typeMat3x2]),
      ...genType('', MASK_ALL, typeinfo.typeMat4, [typeinfo.typeMat2x4, typeinfo.typeMat4x2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeMat2x4, typeinfo.typeF32Vec2]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeF32Vec4, typeinfo.typeMat2x4]),

      ...genType('', MASK_ALL, typeinfo.typeMat2, [typeinfo.typeMat3x2, typeinfo.typeMat2x3]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x2, [typeinfo.typeMat3x2, typeinfo.typeMat3]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x2, [typeinfo.typeMat3x2, typeinfo.typeMat4x3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeMat3x2, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec2, typeinfo.typeMat3x2]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x3, [typeinfo.typeMat3, typeinfo.typeMat2x3]),
      ...genType('', MASK_ALL, typeinfo.typeMat3, [typeinfo.typeMat3, typeinfo.typeMat3]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x3, [typeinfo.typeMat3, typeinfo.typeMat4x3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeMat3, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeMat3]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x4, [typeinfo.typeMat3x4, typeinfo.typeMat2x3]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x4, [typeinfo.typeMat3x4, typeinfo.typeMat3]),
      ...genType('', MASK_ALL, typeinfo.typeMat4, [typeinfo.typeMat3x4, typeinfo.typeMat4x3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeMat3x4, typeinfo.typeF32Vec3]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec4, typeinfo.typeMat3x4]),

      ...genType('', MASK_ALL, typeinfo.typeMat2, [typeinfo.typeMat4x2, typeinfo.typeMat2x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x2, [typeinfo.typeMat4x2, typeinfo.typeMat3x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x2, [typeinfo.typeMat4x2, typeinfo.typeMat4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec2, [typeinfo.typeMat4x2, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec2, typeinfo.typeMat4x2]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x3, [typeinfo.typeMat4x3, typeinfo.typeMat2x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat3, [typeinfo.typeMat4x3, typeinfo.typeMat3x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat4x3, [typeinfo.typeMat4x3, typeinfo.typeMat4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeMat4x3, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec3, typeinfo.typeMat4x3]),

      ...genType('', MASK_ALL, typeinfo.typeMat2x4, [typeinfo.typeMat4, typeinfo.typeMat2x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat3x4, [typeinfo.typeMat4, typeinfo.typeMat3x4]),
      ...genType('', MASK_ALL, typeinfo.typeMat4, [typeinfo.typeMat4, typeinfo.typeMat4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeMat4, typeinfo.typeF32Vec4]),
      ...genType('', MASK_ALL, typeinfo.typeF32Vec4, [typeinfo.typeF32Vec4, typeinfo.typeMat4])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '*', matchResult[0].returnType);
    }
  },
  mul: {
    overloads: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length < 2) {
        throw new PBParamLengthError('mul');
      }
      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = pb.mul_2(result as number | PBShaderExp, args[i] as number | PBShaderExp);
      }
      return result as PBShaderExp;
    }
  },
  mod: {
    overloads: [
      ...genType('mod', MASK_ALL, 0, [0, 0]),
      ...genType('mod', MASK_ALL, 1, [1, 1]),
      ...genType('mod', MASK_ALL, 2, [2, 2]),
      ...genType('mod', MASK_ALL, 3, [3, 3])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      const isIntegerType =
        argType.isPrimitiveType() &&
        (argType.scalarType === typeinfo.PBPrimitiveType.I32 ||
          argType.scalarType === typeinfo.PBPrimitiveType.U32);
      if (pb.getDevice().type === 'webgl' && isIntegerType) {
        throw new PBDeviceNotSupport('integer modulus');
      }
      if (pb.getDevice().type === 'webgpu' || isIntegerType) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '%', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  radians: { overloads: genType('radians', MASK_ALL, 0, [0]) },
  degrees: { overloads: genType('degrees', MASK_ALL, 0, [0]) },
  sin: { overloads: genType('sin', MASK_ALL, 0, [0]) },
  cos: { overloads: genType('cos', MASK_ALL, 0, [0]) },
  tan: { overloads: genType('tan', MASK_ALL, 0, [0]) },
  asin: { overloads: genType('asin', MASK_ALL, 0, [0]) },
  acos: { overloads: genType('acos', MASK_ALL, 0, [0]) },
  atan: { overloads: genType('atan', MASK_ALL, 0, [0]) },
  atan2: {
    overloads: [...genType('atan', MASK_WEBGL, 0, [0, 0]), ...genType('atan2', MASK_WEBGPU, 0, [0, 0])]
  },
  sinh: { overloads: genType('sinh', MASK_WEBGL2 | MASK_WEBGPU, 0, [0]) },
  cosh: { overloads: genType('cosh', MASK_WEBGL2 | MASK_WEBGPU, 0, [0]) },
  tanh: { overloads: genType('tanh', MASK_WEBGL2 | MASK_WEBGPU, 0, [0]) },
  asinh: { overloads: genType('asinh', MASK_WEBGL2, 0, [0]) },
  acosh: { overloads: genType('acosh', MASK_WEBGL2, 0, [0]) },
  atanh: { overloads: genType('atanh', MASK_WEBGL2, 0, [0]) },
  pow: { overloads: genType('pow', MASK_ALL, 0, [0, 0]) },
  exp: { overloads: genType('exp', MASK_ALL, 0, [0]) },
  exp2: { overloads: genType('exp2', MASK_ALL, 0, [0]) },
  log: { overloads: genType('log', MASK_ALL, 0, [0]) },
  log2: { overloads: genType('log2', MASK_ALL, 0, [0]) },
  sqrt: { overloads: genType('sqrt', MASK_ALL, 0, [0]) },
  inverseSqrt: {
    overloads: [...genType('inversesqrt', MASK_WEBGL, 0, [0]), ...genType('inverseSqrt', MASK_WEBGPU, 0, [0])]
  },
  abs: {
    overloads: [
      ...genType('abs', MASK_ALL, 0, [0]),
      ...genType('abs', MASK_WEBGL2 | MASK_WEBGPU, 1, [1]),
      ...genType('abs', MASK_WEBGPU, 2, [2])
    ]
  },
  sign: {
    overloads: [...genType('sign', MASK_ALL, 0, [0]), ...genType('sign', MASK_WEBGL2, 1, [1])]
  },
  floor: { overloads: genType('floor', MASK_ALL, 0, [0]) },
  ceil: { overloads: genType('ceil', MASK_ALL, 0, [0]) },
  fract: { overloads: genType('fract', MASK_ALL, 0, [0]) },
  fma: {
    overloads: genType('fma', MASK_ALL, 0, [0, 0, 0]),
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      if (pb.getDevice().type === 'webgpu') {
        return callBuiltinChecked(pb, matchResult);
      } else {
        return pb.add(pb.mul(args[0] as any, args[1] as any), args[2] as any);
      }
    }
  },
  round: { overloads: genType('round', MASK_WEBGPU, 0, [0]) },
  trunc: { overloads: genType('trunc', MASK_WEBGPU, 0, [0]) },
  // TODO: modf
  min: {
    overloads: [
      ...genType('min', MASK_ALL, 0, [0, 0]),
      ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1]),
      ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ]
  },
  max: {
    overloads: [
      ...genType('max', MASK_ALL, 0, [0, 0]),
      ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1]),
      ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ]
  },
  clamp: {
    overloads: [
      ...genType('clamp', MASK_ALL, 0, [0, 0, 0]),
      ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1, 1]),
      ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2, 2])
    ]
  },
  mix: {
    overloads: [
      ...genType('mix', MASK_ALL, 0, [0, 0, 0]),
      ...genType('mix', MASK_ALL, 0, [0, 0, typeinfo.typeF32])
    ]
  },
  step: { overloads: genType('step', MASK_ALL, 0, [0, 0]) },
  smoothStep: { overloads: genType('smoothstep', MASK_ALL, 0, [0, 0, 0]) },
  isnan: { overloads: genType('isnan', MASK_WEBGL2, 3, [0]) },
  isinf: { overloads: genType('isinf', MASK_WEBGL2, 3, [0]) },
  length: { overloads: genType('length', MASK_ALL, typeinfo.typeF32, [0]) },
  distance: { overloads: genType('distance', MASK_ALL, typeinfo.typeF32, [0, 0]) },
  dot: {
    overloads: [
      ...genType('dot', MASK_ALL, typeinfo.typeF32, [0, 0], true),
      ...genType('dot', MASK_WEBGPU, typeinfo.typeI32, [1, 1], true),
      ...genType('dot', MASK_WEBGPU, typeinfo.typeU32, [2, 2], true)
    ]
  },
  cross: {
    overloads: genType('cross', MASK_ALL, typeinfo.typeF32Vec3, [typeinfo.typeF32Vec3, typeinfo.typeF32Vec3])
  },
  normalize: { overloads: genType('normalize', MASK_ALL, 0, [0], true) },
  faceForward: {
    overloads: [
      ...genType('faceforward', MASK_WEBGL, 0, [0, 0, 0], true),
      ...genType('faceForward', MASK_WEBGPU, 0, [0, 0, 0], true)
    ]
  },
  reflect: { overloads: genType('reflect', MASK_ALL, 0, [0, 0], true) },
  refract: { overloads: genType('refract', MASK_ALL, 0, [0, 0, typeinfo.typeF32], true) },
  frexp: {
    overloads: [
      ...genType('frexp', MASK_WEBGPU, typeinfo.typeFrexpResult, [typeinfo.typeF32]),
      ...genType('frexp', MASK_WEBGPU, typeinfo.typeFrexpResultVec2, [typeinfo.typeF32Vec2]),
      ...genType('frexp', MASK_WEBGPU, typeinfo.typeFrexpResultVec3, [typeinfo.typeF32Vec3]),
      ...genType('frexp', MASK_WEBGPU, typeinfo.typeFrexpResultVec4, [typeinfo.typeF32Vec4])
    ]
  },
  outerProduct: {
    overloads: [
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat2, [
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat3, [
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat4, [
        typeinfo.typeF32Vec4,
        typeinfo.typeF32Vec4
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat2x3, [
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec2
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat3x2, [
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec3
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat2x4, [
        typeinfo.typeF32Vec4,
        typeinfo.typeF32Vec2
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat4x2, [
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat3x4, [
        typeinfo.typeF32Vec4,
        typeinfo.typeF32Vec3
      ]),
      ...genType('outerProduct', MASK_WEBGL2, typeinfo.typeMat4x3, [
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec4
      ])
    ]
  },
  transpose: {
    overloads: [
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat2, [typeinfo.typeMat2]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat3, [typeinfo.typeMat3]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat4, [typeinfo.typeMat4]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat2x3, [typeinfo.typeMat3x2]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat3x2, [typeinfo.typeMat2x3]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat2x4, [typeinfo.typeMat4x2]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat4x2, [typeinfo.typeMat2x4]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat3x4, [typeinfo.typeMat4x3]),
      ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeMat4x3, [typeinfo.typeMat3x4])
    ]
  },
  determinant: {
    overloads: [
      ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeF32, [typeinfo.typeMat2]),
      ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeF32, [typeinfo.typeMat3]),
      ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeinfo.typeF32, [typeinfo.typeMat4])
    ]
  },
  inverse: {
    overloads: [
      ...genType('inverse', MASK_WEBGL2, typeinfo.typeMat2, [typeinfo.typeMat2]),
      ...genType('inverse', MASK_WEBGL2, typeinfo.typeMat3, [typeinfo.typeMat3]),
      ...genType('inverse', MASK_WEBGL2, typeinfo.typeMat4, [typeinfo.typeMat4])
    ]
  },
  lessThan: {
    overloads: [
      ...genType('lessThan', MASK_ALL, 3, [0, 0]),
      ...genType('lessThan', MASK_ALL, 3, [1, 1]),
      ...genType('lessThan', MASK_ALL, 3, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '<', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  lessThanEqual: {
    overloads: [
      ...genType('lessThanEqual', MASK_ALL, 3, [0, 0]),
      ...genType('lessThanEqual', MASK_ALL, 3, [1, 1]),
      ...genType('lessThanEqual', MASK_ALL, 3, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '<=', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  greaterThan: {
    overloads: [
      ...genType('greaterThan', MASK_ALL, 3, [0, 0]),
      ...genType('greaterThan', MASK_ALL, 3, [1, 1]),
      ...genType('greaterThan', MASK_ALL, 3, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '>', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  greaterThanEqual: {
    overloads: [
      ...genType('greaterThanEqual', MASK_ALL, 3, [0, 0]),
      ...genType('greaterThanEqual', MASK_ALL, 3, [1, 1]),
      ...genType('greaterThanEqual', MASK_ALL, 3, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '>=', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  compEqual: {
    overloads: [
      ...genType('equal', MASK_ALL, 3, [0, 0]),
      ...genType('equal', MASK_ALL, 3, [1, 1]),
      ...genType('equal', MASK_ALL, 3, [2, 2]),
      ...genType('equal', MASK_ALL, 3, [3, 3])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  compNotEqual: {
    overloads: [
      ...genType('notEqual', MASK_ALL, 3, [0, 0]),
      ...genType('notEqual', MASK_ALL, 3, [1, 1]),
      ...genType('notEqual', MASK_ALL, 3, [2, 2]),
      ...genType('notEqual', MASK_ALL, 3, [3, 3])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  equal: {
    overloads: [
      ...genType('equal', MASK_ALL, typeinfo.typeBool, [0, 0]),
      ...genType('equal', MASK_ALL, typeinfo.typeBool, [1, 1]),
      ...genType('equal', MASK_ALL, typeinfo.typeBool, [2, 2]),
      ...genType('equal', MASK_ALL, typeinfo.typeBool, [3, 3])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
        return pb.all(pb.compEqual(args[0] as PBShaderExp, args[1] as PBShaderExp));
      } else {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
      }
    }
  },
  notEqual: {
    overloads: [
      ...genType('notEqual', MASK_ALL, typeinfo.typeBool, [0, 0]),
      ...genType('notEqual', MASK_ALL, typeinfo.typeBool, [1, 1]),
      ...genType('notEqual', MASK_ALL, typeinfo.typeBool, [2, 2]),
      ...genType('notEqual', MASK_ALL, typeinfo.typeBool, [3, 3])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
        return pb.any(pb.compNotEqual(args[0] as PBShaderExp, args[1] as PBShaderExp));
      } else {
        return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
      }
    }
  },
  any: { overloads: genType('any', MASK_ALL, typeinfo.typeBool, [3], true) },
  all: { overloads: genType('all', MASK_ALL, typeinfo.typeBool, [3], true) },
  not: {
    overloads: genType('not', MASK_ALL, 3, [3]),
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      const argType = matchResult[1][0].getType();
      if (pb.getDevice().type === 'webgpu' || (argType.isPrimitiveType() && argType.isScalarType())) {
        return unaryFunc(matchResult[1][0], '!', matchResult[0].returnType);
      } else {
        return callBuiltinChecked(pb, matchResult);
      }
    }
  },
  neg: {
    overloads: [...genType('neg', MASK_ALL, 0, [0]), ...genType('neg', MASK_ALL, 1, [1])],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return unaryFunc(matchResult[1][0], '-', matchResult[0].returnType);
    }
  },
  or_2: {
    overloads: genType('or', MASK_ALL, typeinfo.typeBool, [3, 3]),
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '||', matchResult[0].returnType);
    }
  },
  or: {
    overloads: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length < 2) {
        throw new PBParamLengthError('or');
      }
      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = pb.or_2(result as boolean | PBShaderExp, args[i] as boolean | PBShaderExp);
      }
      return result as PBShaderExp;
    }
  },
  compOr: {
    overloads: [
      ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1]),
      ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '|', matchResult[0].returnType);
    }
  },
  and_2: {
    overloads: genType('and', MASK_ALL, typeinfo.typeBool, [3, 3]),
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '&&', matchResult[0].returnType);
    }
  },
  and: {
    overloads: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length < 2) {
        throw new PBParamLengthError('and');
      }
      let result = args[0];
      for (let i = 1; i < args.length; i++) {
        result = pb.and_2(
          result as PBShaderExp | number | boolean,
          args[i] as PBShaderExp | number | boolean
        );
      }
      return result as PBShaderExp;
    }
  },
  compAnd: {
    overloads: [
      ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1]),
      ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '&', matchResult[0].returnType);
    }
  },
  compXor: {
    overloads: [
      ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 1]),
      ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '^', matchResult[0].returnType);
    }
  },
  sal: {
    overloads: [
      ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 2]),
      ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '<<', matchResult[0].returnType);
    }
  },
  sar: {
    overloads: [
      ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 1, [1, 2]),
      ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 2, [2, 2])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const matchResult = matchFunctionOverloadings(pb, name, ...args);
      return binaryFunc(matchResult[1][0], matchResult[1][1], '>>', matchResult[0].returnType);
    }
  },
  arrayLength: {
    overloads: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 1) {
        throw new PBParamLengthError('arrayLength');
      }
      if (!(args[0] instanceof PBShaderExp)) {
        throw new PBParamValueError('arrayLength', 'array');
      }
      const type = args[0].$ast.getType();
      const arrayType = type.isPointerType() ? type.pointerType : type;
      if (!arrayType.isArrayType() || arrayType.dimension !== 0) {
        throw new PBParamTypeError('arrayLength', 'array');
      }
      const arg = type.isArrayType() ? pb.addressOf(args[0]).$ast : args[0].$ast;
      return pb.$callFunctionNoCheck(name, [arg], typeinfo.typeU32);
    }
  },
  select: {
    overloads: [
      ...genType('select', MASK_WEBGPU, 0, [0, 0, typeinfo.typeBool]),
      ...genType('select', MASK_WEBGPU, 1, [1, 1, typeinfo.typeBool]),
      ...genType('select', MASK_WEBGPU, 2, [2, 2, typeinfo.typeBool]),
      ...genType('select', MASK_WEBGPU, 3, [3, 3, typeinfo.typeBool]),
      ...genType('select', MASK_WEBGPU, 0, [0, 0, 3], true),
      ...genType('select', MASK_WEBGPU, 1, [1, 1, 3], true),
      ...genType('select', MASK_WEBGPU, 2, [2, 2, 3], true),
      ...genType('select', MASK_WEBGPU, 3, [3, 3, 3], true),
      ...genType('mix', MASK_WEBGL2, 0, [0, 0, 3]),
      ...genType('mix', MASK_WEBGL2, 1, [1, 1, 3]),
      ...genType('mix', MASK_WEBGL2, 2, [2, 2, 3])
    ]
  },
  floatBitsToInt: { overloads: genType('floatBitsToInt', MASK_WEBGL2, 1, [0]) },
  floatBitsToUint: { overloads: genType('floatBitsToUint', MASK_WEBGL2, 2, [0]) },
  intBitsToFloat: { overloads: genType('intBitsToFloat', MASK_WEBGL2, 0, [1]) },
  uintBitsToFloat: { overloads: genType('uintBitsToFloat', MASK_WEBGL2, 0, [2]) },
  pack4x8snorm: { overloads: genType('pack4x8snorm', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeF32Vec4]) },
  unpack4x8snorm: {
    overloads: genType('unpack4x8snorm', MASK_WEBGPU, typeinfo.typeF32Vec4, [typeinfo.typeU32])
  },
  pack4x8unorm: { overloads: genType('pack4x8unorm', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeF32Vec4]) },
  unpack4x8unorm: {
    overloads: genType('unpack4x8unorm', MASK_WEBGPU, typeinfo.typeF32Vec4, [typeinfo.typeU32])
  },
  pack2x16snorm: {
    overloads: [
      ...genType('pack2x16snorm', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeF32Vec2]),
      ...genType('packSnorm2x16', MASK_WEBGL2, typeinfo.typeU32, [typeinfo.typeF32Vec2])
    ]
  },
  unpack2x16snorm: {
    overloads: [
      ...genType('unpack2x16snorm', MASK_WEBGPU, typeinfo.typeF32Vec2, [typeinfo.typeU32]),
      ...genType('unpackSnorm2x16', MASK_WEBGL2, typeinfo.typeF32Vec2, [typeinfo.typeU32])
    ]
  },
  pack2x16unorm: {
    overloads: [
      ...genType('pack2x16unorm', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeF32Vec2]),
      ...genType('packUnorm2x16', MASK_WEBGL2, typeinfo.typeU32, [typeinfo.typeF32Vec2])
    ]
  },
  unpack2x16unorm: {
    overloads: [
      ...genType('unpack2x16unorm', MASK_WEBGPU, typeinfo.typeF32Vec2, [typeinfo.typeU32]),
      ...genType('unpackUnorm2x16', MASK_WEBGL2, typeinfo.typeF32Vec2, [typeinfo.typeU32])
    ]
  },
  pack2x16float: {
    overloads: [
      ...genType('pack2x16float', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeF32Vec2]),
      ...genType('packHalf2x16', MASK_WEBGL2, typeinfo.typeU32, [typeinfo.typeF32Vec2])
    ]
  },
  unpack2x16float: {
    overloads: [
      ...genType('unpack2x16float', MASK_WEBGPU, typeinfo.typeF32Vec2, [typeinfo.typeU32]),
      ...genType('unpackHalf2x16', MASK_WEBGL2, typeinfo.typeF32Vec2, [typeinfo.typeU32])
    ]
  },
  matrixCompMult: { overloads: genMatrixType('matrixCompMult', MASK_WEBGL, null, [null, null]) },
  dpdx: {
    overloads: [...genType('dFdx', MASK_WEBGL, 0, [0]), ...genType('dpdx', MASK_WEBGPU, 0, [0])]
  },
  dpdy: {
    overloads: [...genType('dFdy', MASK_WEBGL, 0, [0]), ...genType('dpdy', MASK_WEBGPU, 0, [0])]
  },
  fwidth: { overloads: genType('fwidth', MASK_ALL, 0, [0]) },
  dpdxCoarse: {
    overloads: [...genType('dpdxCoarse', MASK_WEBGPU, 0, [0]), ...genType('dFdx', MASK_WEBGL, 0, [0])]
  },
  dpdxFine: {
    overloads: [...genType('dpdxFine', MASK_WEBGPU, 0, [0]), ...genType('dFdx', MASK_WEBGL, 0, [0])]
  },
  dpdyCoarse: {
    overloads: [...genType('dpdyCoarse', MASK_WEBGPU, 0, [0]), ...genType('dFdy', MASK_WEBGL, 0, [0])]
  },
  dpdyFine: {
    overloads: [...genType('dpdyFine', MASK_WEBGPU, 0, [0]), ...genType('dFdy', MASK_WEBGL, 0, [0])]
  },
  // textureDimensions(tex: PBShaderExp, level?: number|PBShaderExp);
  textureDimensions: {
    overloads: [
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTex1D, typeinfo.typeI32]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeITex1D, typeinfo.typeI32]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeUTex1D, typeinfo.typeI32]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTex2D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeITex2D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeUTex2D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeITex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeUTex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTex3D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeITex3D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeUTex3D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexCube,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeITexCube,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeUTexCube,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexCubeArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeITexCubeArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeUTexCubeArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [typeinfo.typeTexMultisampled2D]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [typeinfo.typeITexMultisampled2D]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [typeinfo.typeUTexMultisampled2D]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeI32
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexDepthMultisampled2D
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba8unorm]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba8snorm]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba8uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba8sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba16uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba16sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba16float]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba32uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba32sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rgba32float]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rg32uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rg32sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_rg32float]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_r32uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_r32sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32, [typeinfo.typeTexStorage1D_r32float]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba8unorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba8snorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba8uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba8sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba16uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba16sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba16float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rgba32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rg32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rg32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_rg32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [typeinfo.typeTexStorage2D_r32uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [typeinfo.typeTexStorage2D_r32sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2D_r32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba8unorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba8snorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba8uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba8sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba16uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba16sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba16float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rgba32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rg32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rg32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_rg32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_r32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_r32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec2, [
        typeinfo.typeTexStorage2DArray_r32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba8unorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba8snorm
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba8uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba8sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba16uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba16sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba16float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rgba32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rg32uint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rg32sint
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_rg32float
      ]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [typeinfo.typeTexStorage3D_r32uint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [typeinfo.typeTexStorage3D_r32sint]),
      ...genType('textureDimensions', MASK_WEBGPU, typeinfo.typeU32Vec3, [
        typeinfo.typeTexStorage3D_r32float
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeTex1D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeTex2D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeITex1D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeITex2D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeUTex1D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeUTex2D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeTex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeITex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeUTex2DArray,
        typeinfo.typeI32
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeTexCube, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeITexCube, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [typeinfo.typeUTexCube, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec3, [typeinfo.typeTex3D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec3, [typeinfo.typeITex3D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec3, [typeinfo.typeUTex3D, typeinfo.typeI32]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeI32
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeI32
      ]),
      ...genType('textureSize', MASK_WEBGL2, typeinfo.typeI32Vec2, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeI32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length < 1 || args.length > 2) {
        throw new PBParamLengthError('textureDimensions');
      }
      if (!(args[0] instanceof PBShaderExp)) {
        throw new PBParamValueError('textureDimensions', 'tex');
      }
      const texType = args[0].$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureDimensions', 'tex');
      }
      if (pb.getDevice().type === 'webgpu') {
        if (texType.isMultisampledTexture() || texType.isStorageTexture()) {
          if (args[1] !== undefined) {
            throw new PBParamValueError('textureDimensions', 'level');
          }
        }
        return callBuiltin(pb, name, ...args);
      } else if (pb.getDevice().type === 'webgl2') {
        const tex = args[0];
        const level = args[1] || 0;
        return texType.is1DTexture()
          ? callBuiltin(pb, name, tex, level).x
          : callBuiltin(pb, name, tex, level);
      }
    }
  },
  // textureGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
  // textureGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
  textureGather: {
    overloads: [
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeITex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeUTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeITexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeUTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ])
    ]
  },
  // textureArrayGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
  // textureArrayGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
  textureArrayGather: {
    overloads: [
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeITex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeUTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeITexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeI32,
        typeinfo.typeUTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureGather', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ])
    ]
  },
  // textureGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp);
  textureGatherCompare: {
    overloads: [
      ...genType('textureGatherCompare', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureGatherCompare', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ])
    ]
  },
  // textureArrayGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp);
  textureArrayGatherCompare: {
    overloads: [
      ...genType('textureGatherCompare', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureGatherCompare', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32
      ])
    ]
  },
  // textureLoad(tex: PBShaderExp, coords: number|PBShaderExp, levelOrSampleIndex: number|PBShaderExp);
  textureLoad: {
    overloads: [
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex1D,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeITex1D,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex1D,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_bgra8unorm,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_r32float,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage1D_r32sint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage1D_r32uint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_rg32float,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage1D_rg32sint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage1D_rg32uint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_rgba16float,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage1D_rgba16sint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage1D_rgba16uint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_rgba32float,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage1D_rgba32sint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage1D_rgba32uint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage1D_rgba8sint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage1D_rgba8uint,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_rgba8snorm,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage1D_rgba8unorm,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeITex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_bgra8unorm,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_r32float,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage2D_r32sint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage2D_r32uint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_rg32float,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage2D_rg32sint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage2D_rg32uint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_rgba16float,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage2D_rgba16sint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage2D_rgba16uint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_rgba32float,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage2D_rgba32sint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage2D_rgba32uint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage2D_rgba8sint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage2D_rgba8uint,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_rgba8snorm,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage2D_rgba8unorm,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeITex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_bgra8unorm,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_r32float,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage3D_r32sint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage3D_r32uint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_rg32float,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage3D_rg32sint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage3D_rg32uint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_rgba16float,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage3D_rgba16sint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage3D_rgba16uint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_rgba32float,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage3D_rgba32sint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage3D_rgba32uint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeTexStorage3D_rgba8sint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeTexStorage3D_rgba8uint,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_rgba8snorm,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexStorage3D_rgba8unorm,
        typeinfo.typeI32Vec3
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexMultisampled2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeITexMultisampled2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeUTexMultisampled2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeI32Vec2
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthMultisampled2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex1D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeU32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeITex1D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeI32Vec4, [
        typeinfo.typeITex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeI32Vec4, [
        typeinfo.typeITex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeUTex1D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex2D,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex3D,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length === 0) {
        throw new PBParamLengthError('textureLoad');
      }
      if (!(args[0] instanceof PBShaderExp)) {
        throw new PBParamValueError('textureLoad', 'tex');
      }
      const texType = args[0].$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureLoad', 'tex');
      }
      if (pb.getDevice().type === 'webgl2') {
        if (args.length !== 3) {
          throw new PBParamLengthError('textureLoad');
        }
        if (texType.is1DTexture()) {
          if (typeof args[1] === 'number') {
            if (!Number.isInteger(args[1])) {
              throw new PBParamTypeError('textureLoad', 'coord');
            }
          } else if (args[1] instanceof PBShaderExp) {
            const coordType = args[1].$ast.getType();
            if (
              !coordType.isPrimitiveType() ||
              !coordType.isScalarType() ||
              coordType.scalarType !== typeinfo.PBPrimitiveType.I32
            ) {
              throw new PBParamTypeError('textureLoad', 'coord');
            }
          } else {
            throw new PBParamTypeError('textureLoad', 'coord');
          }
          args[1] = pb.ivec2(args[1], 0);
        }
      } else if (pb.getDevice().type === 'webgpu') {
        if (texType.isExternalTexture()) {
          args = args.slice(0, 2);
        }
        if (texType.isStorageTexture()) {
          texType.readable = true;
        }
      }
      return callBuiltin(pb, name, ...args);
    }
  },
  // textureArrayLoad(tex: PBShaderExp, coords: number|PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp);
  textureArrayLoad: {
    overloads: [
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeI32Vec4, [
        typeinfo.typeITex2DArray,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex2DArray,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLoad', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeI32Vec4, [
        typeinfo.typeITex2DArray,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('texelFetch', MASK_WEBGL2, typeinfo.typeU32Vec4, [
        typeinfo.typeUTex2DArray,
        typeinfo.typeI32Vec3,
        typeinfo.typeI32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (pb.getDevice().type === 'webgl2') {
        if (args.length !== 4) {
          throw new PBParamLengthError('textureArrayLoad');
        }
        const tex = args[0];
        const coords = pb.ivec3(args[1] as PBShaderExp, args[2] as PBShaderExp);
        const level = args[3];
        return callBuiltin(pb, name, tex, coords, level);
      } else {
        return callBuiltin(pb, name, ...args);
      }
    }
  },
  // textureStore(tex: PBShaderExp, coords: number|PBShaderExp, value: PBShaderExp);
  textureStore: {
    overloads: [
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba8unorm,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba8snorm,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba8uint,
        typeinfo.typeU32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba8sint,
        typeinfo.typeU32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba16uint,
        typeinfo.typeU32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba16sint,
        typeinfo.typeU32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba16float,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba32uint,
        typeinfo.typeU32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba32sint,
        typeinfo.typeU32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rgba32float,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rg32uint,
        typeinfo.typeU32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rg32sint,
        typeinfo.typeU32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_rg32float,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_r32uint,
        typeinfo.typeU32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_r32sint,
        typeinfo.typeU32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage1D_r32float,
        typeinfo.typeU32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba8unorm,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba8snorm,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba8uint,
        typeinfo.typeU32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba8sint,
        typeinfo.typeU32Vec2,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba16uint,
        typeinfo.typeU32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba16sint,
        typeinfo.typeU32Vec2,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba16float,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba32uint,
        typeinfo.typeU32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba32sint,
        typeinfo.typeU32Vec2,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rgba32float,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rg32uint,
        typeinfo.typeU32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rg32sint,
        typeinfo.typeU32Vec2,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_rg32float,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_r32uint,
        typeinfo.typeU32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_r32uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_r32sint,
        typeinfo.typeU32Vec2,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2D_r32float,
        typeinfo.typeU32Vec2,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba8unorm,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba8snorm,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba8uint,
        typeinfo.typeU32Vec3,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba8sint,
        typeinfo.typeU32Vec3,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba16uint,
        typeinfo.typeU32Vec3,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba16sint,
        typeinfo.typeU32Vec3,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba16float,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba32uint,
        typeinfo.typeU32Vec3,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba32sint,
        typeinfo.typeU32Vec3,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rgba32float,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rg32uint,
        typeinfo.typeU32Vec3,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rg32sint,
        typeinfo.typeU32Vec3,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_rg32float,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_r32uint,
        typeinfo.typeU32Vec3,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_r32sint,
        typeinfo.typeU32Vec3,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage3D_r32float,
        typeinfo.typeU32Vec3,
        typeinfo.typeF32Vec4
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (pb.getDevice().type === 'webgpu') {
        const tex = args[0];
        if (tex instanceof PBShaderExp) {
          const texType = tex.$ast.getType();
          if (texType?.isTextureType() && texType.isStorageTexture()) {
            texType.writable = true;
          }
        }
      }
      return callBuiltin(pb, name, ...args);
    }
  },
  // textureArrayStore(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, value: PBShaderExp);
  textureArrayStore: {
    overloads: [
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba8unorm,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba8snorm,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba8uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba8sint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba16uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba16sint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba16float,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba32uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba32sint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rgba32float,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rg32uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rg32sint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_rg32float,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_r32uint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeU32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_r32sint,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32Vec4
      ]),
      ...genType('textureStore', MASK_WEBGPU, typeinfo.typeVoid, [
        typeinfo.typeTexStorage2DArray_r32float,
        typeinfo.typeI32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec4
      ])
    ]
  },
  // textureNumLayers(tex: PBShaderExp);
  textureNumLayers: {
    overloads: [
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTex2DArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITex2DArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTex2DArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexCubeArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITexCubeArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTexCubeArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepth2DArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepthCubeArray]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_r32float
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexStorage2DArray_r32sint]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexStorage2DArray_r32uint]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rg32float
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rg32sint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rg32uint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba16float
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba16sint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba16uint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba32float
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba32sint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba32uint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba8sint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba8snorm
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba8uint
      ]),
      ...genType('textureNumLayers', MASK_WEBGPU, typeinfo.typeI32, [
        typeinfo.typeTexStorage2DArray_rgba8unorm
      ])
    ]
  },
  // textureNumLevels(tex: PBShaderExp);
  textureNumLevels: {
    overloads: [
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTex1D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITex1D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTex1D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTex2D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITex2D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTex2D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTex2DArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITex2DArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTex2DArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTex3D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITex3D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTex3D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexCube]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITexCube]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTexCube]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexCubeArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITexCubeArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTexCubeArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepth2D]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepth2DArray]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepthCube]),
      ...genType('textureNumLevels', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepthCubeArray])
    ]
  },
  // textureNumSamples(tex: PBShaderExp);
  textureNumSamples: {
    overloads: [
      ...genType('textureNumSamples', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexMultisampled2D]),
      ...genType('textureNumSamples', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeITexMultisampled2D]),
      ...genType('textureNumSamples', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeUTexMultisampled2D]),
      ...genType('textureNumSamples', MASK_WEBGPU, typeinfo.typeI32, [typeinfo.typeTexDepthMultisampled2D])
    ]
  },
  // textureSample(tex: texture, coords: number|PBShaderExp);
  textureSample: {
    overloads: [
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex1D,
        typeinfo.typeSampler,
        typeinfo.typeF32
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureSampleBaseClampToEdge', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [typeinfo.typeTex1D, typeinfo.typeF32Vec2]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [typeinfo.typeTex2D, typeinfo.typeF32Vec2]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeF32Vec2
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeF32Vec2
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [typeinfo.typeTex3D, typeinfo.typeF32Vec3]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [typeinfo.typeTexCube, typeinfo.typeF32Vec3]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeF32Vec3
      ]),
      ...genType('texture2D', MASK_WEBGL1, typeinfo.typeF32Vec4, [typeinfo.typeTex1D, typeinfo.typeF32Vec2]),
      ...genType('texture2D', MASK_WEBGL1, typeinfo.typeF32Vec4, [typeinfo.typeTex2D, typeinfo.typeF32Vec2]),
      ...genType('texture2D', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeF32Vec2
      ]),
      ...genType('texture2D', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureCube', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureCube', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeF32Vec3
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 2) {
        throw new PBParamLengthError('textureSample');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSample', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureSample', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        if (texType.isStorageTexture()) {
          throw new PBParamTypeError('textureSample', 'texture');
        }
        const sampler = pb.getDefaultSampler(tex, false);
        const coords = args[1];
        const ret = callBuiltin(pb, name, tex, sampler, coords);
        if (ret.$ast.getType().isCompatibleType(typeinfo.typeF32)) {
          return pb.vec4(ret);
        } else {
          return ret;
        }
      } else {
        pb.getDefaultSampler(tex, false);
        if (texType.is1DTexture()) {
          if (args[1] instanceof PBShaderExp) {
            const coordType = args[1].$ast.getType();
            if (
              !coordType.isPrimitiveType() ||
              !coordType.isScalarType() ||
              coordType.scalarType !== typeinfo.PBPrimitiveType.F32
            ) {
              throw new PBParamTypeError('textureSample', 'coord');
            }
          } else if (typeof args[1] !== 'number') {
            throw new PBParamTypeError('textureSample', 'coord');
          }
          args[1] = pb.vec2(args[1], 0);
        }
        return callBuiltin(pb, name, ...args);
      }
    }
  },
  // textureArraySample(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp)
  textureArraySample: {
    overloads: [
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureSample', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeF32Vec3
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeF32Vec3
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 3) {
        throw new PBParamLengthError('textureArraySample');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySample', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureArraySample', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        const coords = args[1];
        const arrayIndex = args[2];
        const ret = callBuiltin(pb, name, tex, sampler, coords, arrayIndex);
        if (ret.$ast.getType().isCompatibleType(typeinfo.typeF32)) {
          return pb.vec4(ret);
        } else {
          return ret;
        }
      } else {
        pb.getDefaultSampler(tex, false);
        const coords = args[1];
        const arrayIndex = args[2];
        const coordsComposit = pb.vec3(coords as number | PBShaderExp, pb.float(arrayIndex as PBShaderExp));
        return callBuiltin(pb, name, tex, coordsComposit);
      }
    }
  },
  // textureSampleBias(tex: PBShaderExp, coords: PBShaderExp, bias: number|PBShaderExp)
  textureSampleBias: {
    overloads: [
      ...genType('textureSampleBias', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleBias', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleBias', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture2D', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureCube', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 3) {
        throw new PBParamLengthError('textureSampleBias');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSampleBias', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureSampleBias', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
      } else {
        pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, ...args);
      }
    }
  },
  // textureArraySampleBias(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, bias: number|PBShaderExp)
  textureArraySampleBias: {
    overloads: [
      ...genType('textureSampleBias', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleBias', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 4) {
        throw new PBParamLengthError('textureArraySampleBias');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySampleBias', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureArraySampleBias', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
      } else if (pb.getDevice().type === 'webgl2') {
        pb.getDefaultSampler(tex, false);
        const coords = args[1];
        const arrayIndex = args[2];
        const coordsComposit = pb.vec3(coords as number | PBShaderExp, pb.float(arrayIndex as PBShaderExp));
        return callBuiltin(pb, name, tex, coordsComposit, args[3]);
      }
    }
  },
  // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
  textureSampleCompare: {
    overloads: [
      ...genType('textureSampleCompare', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleCompare', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32, [typeinfo.typeTexDepth2D, typeinfo.typeF32Vec3]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32, [typeinfo.typeTexDepthCube, typeinfo.typeF32Vec4])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 3) {
        throw new PBParamLengthError('textureSampleCompare');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSampleCompare', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType() || !texType.isDepthTexture()) {
        throw new PBParamTypeError('textureSampleCompare', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(args[0] as PBShaderExp, true);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
      } else {
        pb.getDefaultSampler(args[0] as PBShaderExp, true);
        let coordsComposite: PBShaderExp;
        if (texType.isCubeTexture() || texType.isArrayTexture()) {
          coordsComposite = pb.vec4(args[1] as any, args[2] as any);
        } else {
          coordsComposite = pb.vec3(args[1] as any, args[2] as any);
        }
        return callBuiltin(pb, name, tex, coordsComposite);
      }
    }
  },
  // textureArraySampleCompare(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
  textureArraySampleCompare: {
    overloads: [
      ...genType('textureSampleCompare', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleCompare', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeF32Vec4
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 4) {
        throw new PBParamLengthError('textureArraySampleCompare');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySampleCompare', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType() || !texType.isDepthTexture()) {
        throw new PBParamTypeError('textureArraySampleCompare', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(args[0] as PBShaderExp, true);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
      } else {
        pb.getDefaultSampler(args[0] as PBShaderExp, true);
        const coordsComposite = pb.vec4(args[1] as any, pb.float(args[2] as any), args[3] as any);
        return callBuiltin(pb, name, tex, coordsComposite);
      }
    }
  },
  // textureSampleLevel(tex: PBShaderExp, coords: PBShaderExp, level: number|PBShaderExp)
  textureSampleLevel: {
    overloads: [
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture2DLodEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('texture2DLodEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('texture2DLodEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexExternal,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureCubeLodEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureCubeLodEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSampleLevel', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureSampleLevel', 'texture');
      }
      if (pb.getDevice().type === 'webgl' && pb.shaderKind === 'vertex') {
        // WebGL1 does not support vertex texture lod
        return pb.textureSample(tex, args[1] as any);
      }
      if (pb.getDevice().type === 'webgpu') {
        if (texType.isExternalTexture()) {
          return pb.textureLoad(tex, pb.ivec2(args[1] as any), 0);
        } else {
          const sampler = pb.getDefaultSampler(tex, false);
          const level =
            texType.isDepthTexture() &&
            (typeof args[2] === 'number' ||
              (args[2] instanceof PBShaderExp && args[2].$ast.getType().isCompatibleType(typeinfo.typeF32)))
              ? pb.int(args[2])
              : args[2];
          const ret = texType.isExternalTexture()
            ? callBuiltin(pb, name, tex, sampler, args[1])
            : callBuiltin(pb, name, tex, sampler, args[1], level);
          if (ret.$ast.getType().isCompatibleType(typeinfo.typeF32)) {
            return pb.vec4(ret);
          } else {
            return ret;
          }
        }
      } else {
        pb.getDefaultSampler(tex, false);
        return texType.isExternalTexture()
          ? callBuiltin(pb, name, args[0], args[1], 0)
          : callBuiltin(pb, name, args[0], args[1], args[2]);
      }
    }
  },
  // textureArraySampleLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp)
  textureArraySampleLevel: {
    overloads: [
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureSampleLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeI32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 4) {
        throw new PBParamLengthError('textureArraySampleLevel');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySampleLevel', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureArraySampleLevel', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        const level =
          texType.isDepthTexture() &&
          (typeof args[3] === 'number' ||
            (args[3] instanceof PBShaderExp && args[3].$ast.getType().isCompatibleType(typeinfo.typeF32)))
            ? pb.int(args[3])
            : args[3];
        const ret = callBuiltin(pb, name, tex, sampler, args[1], args[2], level);
        if (ret.$ast.getType().isCompatibleType(typeinfo.typeF32)) {
          return pb.vec4(ret);
        } else {
          return ret;
        }
      } else {
        pb.getDefaultSampler(tex, false);
        const coordsComposite = pb.vec3(args[1] as any, pb.float(args[2] as any));
        return callBuiltin(pb, name, tex, coordsComposite, args[3]);
      }
    }
  },
  // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
  textureSampleCompareLevel: {
    overloads: [
      ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCube,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('textureLod', MASK_WEBGL2, typeinfo.typeF32, [
        typeinfo.typeTexDepth2D,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32, [typeinfo.typeTexDepthCube, typeinfo.typeF32Vec4])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 3) {
        throw new PBParamLengthError('textureSampleCompareLevel');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType() || !texType.isDepthTexture()) {
        throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, true);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
      } else {
        pb.getDefaultSampler(args[0] as PBShaderExp, true);
        let coordsComposite: PBShaderExp;
        if (texType.isCubeTexture() || texType.isArrayTexture()) {
          coordsComposite = pb.vec4(args[1] as any, args[2] as any);
        } else {
          coordsComposite = pb.vec3(args[1] as any, args[2] as any);
        }
        return texType.isCubeTexture()
          ? callBuiltin(pb, name, tex, coordsComposite)
          : callBuiltin(pb, name, tex, coordsComposite, 0);
      }
    }
  },
  // textureArraySampleCompareLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
  textureArraySampleCompareLevel: {
    overloads: [
      ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeinfo.typeF32, [
        typeinfo.typeTexDepthCubeArray,
        typeinfo.typeSamplerComparison,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32
      ]),
      ...genType('texture', MASK_WEBGL2, typeinfo.typeF32, [
        typeinfo.typeTexDepth2DArray,
        typeinfo.typeF32Vec4
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 4) {
        throw new PBParamLengthError('textureArraySampleCompareLevel');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType() || !texType.isDepthTexture()) {
        throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, true);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
      } else {
        pb.getDefaultSampler(args[0] as PBShaderExp, true);
        const coordsComposite = pb.vec4(args[1] as any, pb.float(args[2] as any), args[3] as any);
        return callBuiltin(pb, name, tex, coordsComposite);
      }
    }
  },
  // textureSampleGrad(tex: PBShaderExp, coords: PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
  textureSampleGrad: {
    overloads: [
      ...genType('textureSampleGrad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureSampleGrad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureSampleGrad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGrad', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureGrad', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex3D,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGrad', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('texture2DGradEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2D,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureCubeGradEXT', MASK_WEBGL1, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCube,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 4) {
        throw new PBParamLengthError('textureSampleGrad');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureSampleGrad', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType()) {
        throw new PBParamTypeError('textureSampleGrad', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
      } else {
        pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, ...args);
      }
    }
  },
  // textureArraySampleGrad(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
  textureArraySampleGrad: {
    overloads: [
      ...genType('textureSampleGrad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec2,
        typeinfo.typeI32,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ]),
      ...genType('textureSampleGrad', MASK_WEBGPU, typeinfo.typeF32Vec4, [
        typeinfo.typeTexCubeArray,
        typeinfo.typeSampler,
        typeinfo.typeF32Vec3,
        typeinfo.typeI32,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec3
      ]),
      ...genType('textureGrad', MASK_WEBGL2, typeinfo.typeF32Vec4, [
        typeinfo.typeTex2DArray,
        typeinfo.typeF32Vec3,
        typeinfo.typeF32Vec2,
        typeinfo.typeF32Vec2
      ])
    ],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 5) {
        throw new PBParamLengthError('textureArraySampleGrad');
      }
      const tex = args[0];
      if (!(tex instanceof PBShaderExp)) {
        throw new PBParamTypeError('textureArraySampleGrad', 'texture');
      }
      const texType = tex.$ast.getType();
      if (!texType.isTextureType() || !texType.isArrayTexture()) {
        throw new PBParamTypeError('textureArraySampleGrad', 'texture');
      }
      if (pb.getDevice().type === 'webgpu') {
        const sampler = pb.getDefaultSampler(tex, false);
        return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3], args[4]);
      } else {
        pb.getDefaultSampler(tex, false);
        const coordsComposite = pb.vec3(args[1] as any, pb.float(args[2] as any));
        return callBuiltin(pb, name, tex, coordsComposite, args[3], args[4]);
      }
    }
  },
  storageBarrier: { overloads: genType('storageBarrier', MASK_WEBGPU, typeinfo.typeVoid, []) },
  workgroupBarrier: { overloads: genType('workgroupBarrier', MASK_WEBGPU, typeinfo.typeVoid, []) },
  atomicLoad: {
    overloades: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 1) {
        throw new PBParamLengthError(name);
      }
      const arg = args[0];
      if (!(arg instanceof PBShaderExp)) {
        throw new PBParamTypeError(name, 'ptr');
      }
      if (arg.$ast.getType().typeId === typeinfo.typeAtomicI32.typeId) {
        return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg.$ast)], typeinfo.typeI32);
      } else if (arg.$ast.getType().typeId === typeinfo.typeAtomicU32.typeId) {
        return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg.$ast)], typeinfo.typeU32);
      } else {
        throw new PBParamValueError(name, 'ptr must be atomic type');
      }
    }
  },
  atomicStore: {
    overloades: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 2) {
        throw new PBParamLengthError(name);
      }
      const arg1 = args[0];
      const arg2 = args[1];
      if (!(arg1 instanceof PBShaderExp)) {
        throw new PBParamTypeError(name, 'ptr');
      }
      if (arg1.$ast.getType().typeId === typeinfo.typeAtomicI32.typeId) {
        if (typeof arg2 === 'number') {
          if (!Number.isInteger(arg2)) {
            throw new PBParamValueError(name, 'value');
          }
          return pb.$callFunctionNoCheck(
            name,
            [new ASTAddressOf(arg1.$ast), new ASTScalar(arg2, typeinfo.typeI32)],
            typeinfo.typeVoid
          );
        } else if (arg2 instanceof PBShaderExp) {
          if (arg2.$ast.getType().typeId !== typeinfo.typeI32.typeId) {
            throw new PBParamTypeError(name, 'value');
          }
          return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg1.$ast), arg2.$ast], typeinfo.typeVoid);
        } else {
          throw new PBParamTypeError(name, 'value');
        }
      } else if (arg1.$ast.getType().typeId === typeinfo.typeAtomicU32.typeId) {
        if (typeof arg2 === 'number') {
          if (!Number.isInteger(arg2)) {
            throw new PBParamValueError(name, 'value');
          }
          return pb.$callFunctionNoCheck(
            name,
            [new ASTAddressOf(arg1.$ast), new ASTScalar(arg2, typeinfo.typeU32)],
            typeinfo.typeVoid
          );
        } else if (arg2 instanceof PBShaderExp) {
          if (arg2.$ast.getType().typeId !== typeinfo.typeU32.typeId) {
            throw new PBParamTypeError(name, 'value');
          }
          return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg1.$ast), arg2.$ast], typeinfo.typeVoid);
        } else {
          throw new PBParamTypeError(name, 'value');
        }
      } else {
        throw new PBParamValueError(name, 'ptr must be atomic type');
      }
    }
  }
};

for (const name of [
  'atomicAdd',
  'atomicSub',
  'atomicMax',
  'atomicMin',
  'atomicAnd',
  'atomicOr',
  'atomicXor',
  'atomicExchange'
]) {
  builtinFunctionsAll[name] = {
    overloades: [],
    normalizeFunc(pb: ProgramBuilder, name: string, ...args: ExpValueType[]) {
      if (args.length !== 2) {
        throw new PBParamLengthError(name);
      }
      const arg1 = args[0];
      const arg2 = args[1];
      if (!(arg1 instanceof PBShaderExp)) {
        throw new PBParamTypeError(name, 'ptr');
      }
      if (arg1.$ast.getType().typeId === typeinfo.typeAtomicI32.typeId) {
        if (typeof arg2 === 'number') {
          if (!Number.isInteger(arg2)) {
            throw new PBParamValueError(name, 'value');
          }
          return pb.$callFunctionNoCheck(
            name,
            [new ASTAddressOf(arg1.$ast), new ASTScalar(arg2, typeinfo.typeI32)],
            typeinfo.typeI32
          );
        } else if (arg2 instanceof PBShaderExp) {
          if (arg2.$ast.getType().typeId !== typeinfo.typeI32.typeId) {
            throw new PBParamTypeError(name, 'value');
          }
          return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg1.$ast), arg2.$ast], typeinfo.typeI32);
        } else {
          throw new PBParamTypeError(name, 'value');
        }
      } else if (arg1.$ast.getType().typeId === typeinfo.typeAtomicU32.typeId) {
        if (typeof arg2 === 'number') {
          if (!Number.isInteger(arg2)) {
            throw new PBParamValueError(name, 'value');
          }
          return pb.$callFunctionNoCheck(
            name,
            [new ASTAddressOf(arg1.$ast), new ASTScalar(arg2, typeinfo.typeU32)],
            typeinfo.typeU32
          );
        } else if (arg2 instanceof PBShaderExp) {
          if (arg2.$ast.getType().typeId !== typeinfo.typeU32.typeId) {
            throw new PBParamTypeError(name, 'value');
          }
          return pb.$callFunctionNoCheck(name, [new ASTAddressOf(arg1.$ast), arg2.$ast], typeinfo.typeU32);
        } else {
          throw new PBParamTypeError(name, 'value');
        }
      } else {
        throw new PBParamValueError(name, 'ptr must be atomic type');
      }
    }
  };
}

export type PBBuiltinFunction = keyof typeof builtinFunctionsAll;
export type PBBuiltinFunctionWrapper = (
  pb: ProgramBuilder,
  name: string,
  ...args: ExpValueType[]
) => PBShaderExp;
export type PBBuiltinFunctionOverloadsInfo = {
  overloads?: [typeinfo.PBFunctionTypeInfo, number][];
  normalizeFunc?: PBBuiltinFunctionWrapper;
};

/** @internal */
export function setBuiltinFuncs(cls: typeof ProgramBuilder) {
  for (const k of Object.keys(builtinFunctionsAll)) {
    cls.prototype[k] = function (this: ProgramBuilder, ...args: ExpValueType[]): PBShaderExp {
      const normalizeFunc = builtinFunctionsAll?.[k]?.normalizeFunc || callBuiltin;
      return normalizeFunc(this, k, ...args);
    };
  }
}
