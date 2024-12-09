import type express from 'express';

export type ParamType<T> = T extends { params: { [name: string]: { default: unknown } } }
  ? { [name in keyof T['params']]: T['params'][name]['default'] }
  : unknown;
export type RetType<T> = T extends { retval: unknown } ? T['retval'] : unknown;
type FuncType<T> = (
  req: express.Request,
  res: express.Response & { cookie: Function },
  next: express.NextFunction,
  params: ParamType<T>
) => Promise<RetType<T>>;
export type ApiFunctions<T> = { [k in keyof T]: FuncType<T[k]> };

export type ApiParams<T, K extends keyof T> = Omit<ParamType<T[K]>, '$version'>;
export type ApiReturn<T, K extends keyof T> = RetType<T[K]>;
