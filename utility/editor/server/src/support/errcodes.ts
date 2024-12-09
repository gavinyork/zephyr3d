export enum ErrorCode {
  kSuccess = 0,
  kUnknownError,
  kInvalidOperation,
  kAuthError,
  kDatabaseError,
  kParamError,
  kValueError,
  kServerError,
  kNotFound,
  kNotImplemented,
  kInvalidContent,
  kAlreadyExists,
  kAccessDenied,
  kUnauthorized
}

export class RobotError extends Error {
  public readonly code: number;
  public readonly status: number;
  public constructor(message: string, code: number, status = 200) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export class DatabaseError extends RobotError {
  public originError: string;
  public errname: string;
  public errno: number;
  public constructor(message: string, errno: number, name: string, status?: number) {
    super(`数据库错误${message ? `:\n${message}` : ''}`, ErrorCode.kDatabaseError, Number(status) || 500);
    this.originError =
      message[message.length - 1] === '\n' ? message.substring(0, message.length - 1) : message;
    this.errno = errno;
    this.errname = name;
  }
}

export class ParamError extends RobotError {
  public constructor(paramName?: string, status?: number) {
    super(`参数错误${paramName ? `:${paramName}` : ''}`, ErrorCode.kParamError, Number(status) || 200);
  }
}

export class ServerError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '服务器错误', ErrorCode.kServerError, Number(status) || 200);
  }
}

export class AccessDeniedError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '拒绝访问', ErrorCode.kAccessDenied, Number(status) || 200);
  }
}

export class AuthError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '身份认证失败', ErrorCode.kAuthError, Number(status) || 200);
  }
}

export class NotFoundError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '未找到资源', ErrorCode.kNotFound, Number(status) || 200);
  }
}

export class AlreadyExistsError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '资源已存在', ErrorCode.kAlreadyExists, Number(status) || 200);
  }
}
export class InvalidOperationError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '无效请求', ErrorCode.kInvalidOperation, Number(status) || 200);
  }
}

export class NotImplementedError extends RobotError {
  public constructor(message?: string, status?: number) {
    super(message || '资源未找到，请检查访问路径是否正确', ErrorCode.kNotImplemented, Number(status) || 404);
  }
}

export function success(total: number, data: unknown) {
  return { code: ErrorCode.kSuccess, message: '请求成功', totalNum: total, data };
}

export function failed(code: ErrorCode, data: unknown, message?: string) {
  return { code, message: message ?? '请求失败', totalNum: 0, data };
}

export function accessDenied(message?: string, status?: number): never {
  throw new AccessDeniedError(message, status);
}
export function invalidOperation(message?: string, status?: number): never {
  throw new InvalidOperationError(message, status);
}

export function alreadyExists(message?: string, status?: number): never {
  throw new AlreadyExistsError(message, status);
}

export function notFound(message?: string, status?: number): never {
  throw new NotFoundError(message, status);
}

export function paramError(message?: string, status?: number): never {
  throw new ParamError(message, status);
}

export function serverError(message?: string, status?: number): never {
  const err = new ServerError(message, status);
  console.error(`${err.message}\n${err.stack}`);
  throw err;
}

export function notImplemented(message?: string, status?: number): never {
  throw new NotImplementedError(message, status);
}
