import type { ParamSchema } from './types';
import type { NodeScript } from './nodescript';

// Decorators for property metadata collection
type ClassWithParams = typeof NodeScript & { params?: Record<string, ParamSchema> };

function ensureParams(ctor: ClassWithParams) {
  if (!Object.prototype.hasOwnProperty.call(ctor, 'params')) {
    // inherit without mutating parent
    (ctor as any).params = Object.assign({}, (ctor as any).params);
  }
  return (ctor as any).params as Record<string, ParamSchema>;
}

export const param = {
  number(opts: Omit<Extract<ParamSchema, { type: 'number' }>, 'type'> = {}) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'number', ...opts };
    };
  },
  boolean(opts: Omit<Extract<ParamSchema, { type: 'boolean' }>, 'type'> = {}) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'boolean', ...opts };
    };
  },
  string(opts: Omit<Extract<ParamSchema, { type: 'string' }>, 'type'> = {}) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'string', ...opts };
    };
  },
  color(opts: Omit<Extract<ParamSchema, { type: 'color' }>, 'type'> = {}) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'color', ...opts };
    };
  },
  enum(opts: Extract<ParamSchema, { type: 'enum' }>) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'enum', ...opts };
    };
  },
  vector3(opts: Omit<Extract<ParamSchema, { type: 'vector3' }>, 'type'> = {}) {
    return (target: any, key: string) => {
      const ctor = target.constructor as ClassWithParams;
      const params = ensureParams(ctor);
      params[key] = { type: 'vector3', ...opts };
    };
  }
};
