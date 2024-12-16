import Long from 'long';
import path from 'path';
import fs from 'fs';
import type express from 'express';
import { DatabaseError, ErrorCode, NotImplementedError, ServerError, serverError, success } from './errcodes';
import { Engine } from './engine';

export type DePromise<T> = T extends Promise<infer U> ? U : T;

export class SerializationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SerializationError';
  }
}

export class Utils {
  public static debug = false;
  public static camel2snake(src: string): string {
    return src.replace(/([A-Z])/g, '_$1').toLowerCase();
  }
  public static async readFile(path: string, encoding: BufferEncoding = 'utf-8') {
    return new Promise<string>((resolve, reject) => {
      fs.readFile(path, { encoding }, (err, data) => (err ? reject(err) : resolve(data)));
    });
  }
  public static async writeFile(path: string, data: string, encoding: BufferEncoding = 'utf-8') {
    return new Promise<void>((resolve, reject) => {
      fs.writeFile(path, data, { encoding }, (err) => (err ? reject(err) : resolve()));
    });
  }
  public static replaceAll(content: string, src: string, dst: string) {
    let s = content;
    while (s.indexOf(src) >= 0) {
      s = s.replace(src, dst);
    }
    return s;
  }
  public static async fileExists(path: string) {
    return new Promise<boolean>((resolve) => fs.access(path, (err) => resolve(!err)));
  }
  public static snake2camel(src: string): string {
    return src
      .split('_')
      .map((val, index) => (index === 0 ? val : `${val[0].toUpperCase()}${val.substr(1)}`))
      .join('');
  }
  public static addTailSlash(src: string, slash = '/'): string {
    return src && src[src.length - 1] !== slash ? `${src}${slash}` : src;
  }
  public static removeTailSlash(src: string, slash = '/'): string {
    return src && src[src.length - 1] === slash ? src.slice(0, src.length - 1) : src;
  }
  public static isNumber(obj: any): obj is number {
    return typeof obj === 'number';
  }
  public static isInt(obj: any): boolean {
    return this.isNumber(obj) && obj % 1 === 0;
  }
  public static isBoolean(obj: any): obj is boolean {
    return typeof obj === 'boolean';
  }
  public static isString(obj: any): obj is string {
    return Object.prototype.toString.call(obj) === '[object String]';
  }
  public static isUndefined(obj: any): obj is undefined {
    return Object.prototype.toString.call(obj) === '[object Undefined]';
  }
  public static isNull(obj: any): obj is null {
    return Object.prototype.toString.call(obj) === '[object Null]';
  }
  public static isObject(obj: any): obj is { [name: string]: any } {
    return Object.prototype.toString.call(obj) === '[object Object]';
  }
  public static isBooleanObject(obj: any): obj is boolean {
    return Object.prototype.toString.call(obj) === '[object Boolean]';
  }
  public static isNumberObject(obj: any): obj is number {
    return Object.prototype.toString.call(obj) === '[object Number]';
  }
  public static isArray(obj: any): obj is Array<any> {
    return Object.prototype.toString.call(obj) === '[object Array]';
  }
  public static isMap(obj: any): obj is Map<any, any> {
    return Object.prototype.toString.call(obj) === '[object Map]';
  }
  public static isSet(obj: any): obj is Set<any> {
    return Object.prototype.toString.call(obj) === '[object Set]';
  }
  public static isRegExp(obj: any): obj is RegExp {
    return Object.prototype.toString.call(obj) === '[object RegExp]';
  }
  public static isArrayBuffer(obj: any): obj is ArrayBuffer {
    return Object.prototype.toString.call(obj) === '[object ArrayBuffer]';
  }
  public static isDate(obj: any): obj is Date {
    return Object.prototype.toString.call(obj) === '[object Date]';
  }
  public static isFunction(obj: any): obj is Function {
    return Object.prototype.toString.call(obj) === '[object Function]';
  }
  public static isPrimitive(obj: any) {
    return (
      this.isNumber(obj) ||
      this.isString(obj) ||
      this.isBoolean(obj) ||
      this.isNull(obj) ||
      this.isUndefined(obj)
    );
  }
  public static joinURL(domain: string, ...pathlist: string[]): string {
    domain = domain.trim().toLowerCase();
    if (!domain) {
      return '';
    }
    if (domain.indexOf('http://') !== 0 && domain.indexOf('https://') !== 0) {
      domain = `http://${domain}`;
    }
    try {
      const url = new URL(domain);
      const parts = pathlist.filter((val) => !!val);
      if (parts.length > 0) {
        url.pathname = path.posix.join(...parts);
      }
      const s = url.toString();
      return s[s.length - 1] === '/' ? s.slice(0, s.length - 1) : s;
    } catch (err) {
      serverError(`joinURL(): ${err}`);
    }
  }
  public static csvToArray(data: string, fieldSep?: string, newLine?: string): string[][] {
    fieldSep = fieldSep || ',';
    newLine = newLine || '\n';
    const nSep = '\x1D';
    const qSep = '\x1E';
    const cSep = '\x1F';
    const nSepRe = new RegExp(nSep, 'g');
    const qSepRe = new RegExp(qSep, 'g');
    const cSepRe = new RegExp(cSep, 'g');
    const fieldRe = new RegExp(
      `(?<=(^|[${fieldSep}\\n]))"(|[\\s\\S]+?(?<![^"]"))"(?=($|[${fieldSep}\\n]))`,
      'g'
    );
    const grid: string[][] = [];
    data
      .replace(/\r/g, '')
      .replace(/\n+$/, '')
      .replace(fieldRe, (match, p1, p2) => p2.replace(/\n/g, nSep).replace(/""/g, qSep).replace(/,/g, cSep))
      .split(/\n/)
      .forEach((line) => {
        const row = line
          .split(fieldSep)
          .map((cell) => cell.replace(nSepRe, newLine).replace(qSepRe, '"').replace(cSepRe, ','));
        grid.push(row);
      });
    return grid;
  }
  public static deepCopy(obj: any) {
    return this.isPrimitive(obj) ? obj : JSON.parse(JSON.stringify(obj));
  }
  public static equals(obj1: any, obj2: any) {
    for (const propName in obj1) {
      if (
        Object.prototype.hasOwnProperty.call(obj1, propName) !==
        Object.prototype.hasOwnProperty.call(obj2, propName)
      ) {
        return false;
      }
      if (typeof obj1[propName] !== typeof obj2[propName]) {
        return false;
      }
    }
    for (const propName in obj2) {
      if (
        Object.prototype.hasOwnProperty.call(obj1, propName) !==
        Object.prototype.hasOwnProperty.call(obj2, propName)
      ) {
        return false;
      }
      if (typeof obj1[propName] !== typeof obj2[propName]) {
        return false;
      }
      if (!Object.prototype.hasOwnProperty.call(obj1, propName)) {
        continue;
      }
      if (
        (obj1[propName] instanceof Array && obj2[propName] instanceof Array) ||
        (obj1[propName] instanceof Object && obj2[propName] instanceof Object)
      ) {
        if (!this.equals(obj1[propName], obj2[propName])) {
          return false;
        }
      } else if (obj1[propName] !== obj2[propName]) {
        return false;
      }
    }
    return true;
  }
  public static trimLeft(str: string) {
    return str.replace(/(^\s*)/g, '');
  }
  public static trimRight(str: string) {
    return str.replace(/(\s*$)/g, '');
  }
  public static trim(str: string) {
    return str.replace(/(^\s*)|(\s*$)/g, '');
  }
  public static mergeBlank = function (str: string) {
    return str.replace(/\s+/g, ' ');
  };
  public static toUnicode(str: string): string {
    return str.replace(
      /[\u007F-\uFFFF]/g,
      (chr) => `\\u${`0000${chr.charCodeAt(0).toString(16)}`.substr(-4)}`
    );
  }
  public static fromUnicode(str: string): string {
    return str.replace(/\\u[0-9|a-f|A-F]{4}/g, (s) => String.fromCharCode(parseInt(s.slice(2), 16)));
  }
  public static getClientIP(req: express.Request): string {
    return (
      (req.headers['x-forwarded-for'] as string) || req.connection.remoteAddress || req.socket.remoteAddress
    );
  }
  public static safeParseNumber(value: any) {
    return isNaN(value) ? null : parseFloat(value);
  }
  public static safeParseInt(value: any, defaultValue?: any) {
    let result =
      value !== null && value !== undefined && /^[-+]?\d+$/.test(value.toString())
        ? parseInt(value, 10)
        : null;
    if (result === null && this.isNumber(defaultValue)) {
      result = defaultValue;
    }
    return result;
  }
  public static safeParseLong(value: any) {
    if (isNaN(value)) {
      return null;
    }
    if (this.isString(value)) {
      return Long.fromString(value);
    }
    if (this.isNumber(value)) {
      return Long.fromNumber(value);
    }
    return null;
  }
  public static isMD5(str: any) {
    return this.isString(str) && /^[0-9a-f]{32}$/.test(str);
  }
  public static longDivToFixed(value: any, n: number) {
    let lval = value;
    if (this.isNull(lval) || this.isUndefined(lval)) {
      return null;
    }
    if (this.isString(lval)) {
      lval = Long.fromString(lval);
    } else if (this.isNumber(lval)) {
      lval = Long.fromNumber(lval);
    }
    let sign = '';
    if (lval.lt(0)) {
      lval = lval.neg();
      sign = '-';
    }
    let divisor = Long.ONE;
    for (let i = 0; i < n; i++) {
      divisor = divisor.mul(10);
    }
    const iPart = lval.div(divisor).toString();
    let fPart = lval.mod(divisor).toString();
    while (fPart.length < n) {
      fPart = `0${fPart}`;
    }
    return `${sign + iPart}.${fPart}`;
  }
  public static httpResult(err: ErrorCode, data?: any, message?: string): any {
    return Object.assign(
      {
        code: err,
        message: message || ErrorCode[err]
      },
      data ? { data } : {}
    );
  }
  public static getURL(path: string, params: object) {
    function encodeValue(val: unknown) {
      if (val === undefined) {
        return '';
      }
      if (typeof val === 'number' || typeof val === 'string') {
        return encodeURIComponent(val.toString());
      }
      throw new Error('Invalid url param type');
    }
    const arr: string[] = [];
    Object.keys(params).forEach((k) => {
      if (Array.isArray(params[k])) {
        for (const p of params[k]) {
          arr.push(`${k}=${encodeValue(p)}`);
        }
      } else {
        arr.push(`${k}=${encodeValue(params[k])}`);
      }
    });
    return `${path}${arr.length > 0 ? `?${arr.join('&')}` : ''}`;
  }
  public static async delay(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  public static patch(a: any, diff: any): any {
    if (diff.type === 'R') {
      return diff.diff;
    }
    if (diff.type === 'A') {
      if (!this.isArray(a) || !this.isArray(diff.diff)) {
        throw new SerializationError('Invalid patch for array type');
      }
      return this.patchArray(a, diff.diff);
    }
    if (diff.type === 'U') {
      if (!this.isObject(a)) {
        throw new SerializationError('Invalid patch for object type');
      }
      return this.patchObject(a, diff.diff);
    }
  }
  public static diff(a: any, b: any): any {
    if (this.isObject(a) && this.isObject(b)) {
      const d = this.diffObject(a, b);
      return d ? { type: 'U', diff: d } : null;
    }
    if (this.isArray(a) && this.isArray(b)) {
      const d = this.diffArray(a, b);
      return d ? { type: 'A', diff: d } : null;
    }
    if (this.isPrimitive(a) && this.isPrimitive(b)) {
      return a === b ? null : { type: 'R', diff: b };
    }
    return { type: 'R', diff: b };
  }
  public static diffObject(obj1: any, obj2: any): any {
    const f1 = Object.getOwnPropertyNames(obj1);
    const f2 = Object.getOwnPropertyNames(obj2);
    const result: any = {};
    for (const f of f1) {
      if (f2.indexOf(f) >= 0) {
        const d = this.diff(obj1[f], obj2[f]);
        if (d) {
          result[f] = d;
        }
      } else {
        result[f] = { type: 'D' };
      }
    }
    for (const f of f2) {
      if (f1.indexOf(f) < 0) {
        result[f] = { type: 'N', diff: obj2[f] };
      }
    }
    return Object.getOwnPropertyNames(result).length > 0 ? result : null;
  }
  public static patchObject(obj: any, diff: any): any {
    if (!this.isObject(diff)) {
      throw new SerializationError(`Invalid patch: ${diff}`);
    }
    for (const f in diff) {
      if (Object.prototype.hasOwnProperty.call(diff, f)) {
        const d = diff[f];
        if (!this.isObject(d) || this.isUndefined(d.type)) {
          throw new SerializationError(`Invalid patch: ${diff}`);
        }
        switch (d.type) {
          case 'N':
            if (Object.prototype.hasOwnProperty.call(obj, f)) {
              throw new SerializationError(`Newly created field <${f}> already exists`);
            }
            obj[f] = d.diff;
            break;
          case 'R':
            if (!Object.prototype.hasOwnProperty.call(obj, f)) {
              throw new SerializationError(`Replaced field <${f}> not exists`);
            }
            obj[f] = d.diff;
            break;
          case 'U':
          case 'A':
            if (!Object.prototype.hasOwnProperty.call(obj, f)) {
              throw new SerializationError(`Updated field <${f}> not exists`);
            }
            obj[f] = this.patch(obj[f], d);
            break;
          case 'D':
            if (!Object.prototype.hasOwnProperty.call(obj, f)) {
              throw new SerializationError(`Deleted field <${f}> not exists`);
            }
            delete obj[f];
            break;
          default:
            throw new SerializationError(`Invalid diff type ${d.type} for object`);
        }
      }
    }
    return obj;
  }
  public static diffArray(arr1: any[], arr2: any[]): any {
    const len1 = arr1.length;
    const len2 = arr2.length;
    const details: any[] = [];
    for (let i = 0; i < len1; i++) {
      if (i < len2) {
        const d = this.diff(arr1[i], arr2[i]);
        if (d) {
          details.push({ index: i, diff: d });
        }
      } else {
        details.push({ index: i, diff: { type: 'D' } });
        break;
      }
    }
    for (let i = len1; i < len2; i++) {
      details.push({ index: i, diff: { type: 'N', diff: arr2[i] } });
    }
    return details.length > 0 ? details : null;
  }
  public static patchArray(arr: any[], diff: any[]): any[] {
    for (const d of diff) {
      if (d.diff.type === 'D') {
        arr.length = d.index;
        break;
      } else if (d.diff.type === 'N') {
        arr.push(d.diff.diff);
      } else {
        arr[d.index] = this.patch(arr[d.index], d.diff);
      }
    }
    return arr;
  }
}

interface ISerializationInfo {
  properties: any;
}

const factory: { [name: string]: any } = {};

export function deserialize(data: any): any {
  if (Utils.isPrimitive(data)) {
    return data;
  }
  if (Utils.isArray(data)) {
    return data.map((val: any) => deserialize(val));
  }
  if (Utils.isObject(data)) {
    if (data.type === 'map') {
      const result = new Map();
      for (const kv of data.value) {
        const key = deserialize(kv[0]);
        const val = deserialize(kv[1]);
        result.set(key, val);
      }
      return result;
    }
    if (data.type === 'set') {
      const result = new Set();
      for (const v of data.value) {
        result.add(deserialize(v));
      }
      return result;
    }
    if (data.type === 'regexp') {
      return new RegExp(data.value);
    }
    if (data.type === 'date') {
      return new Date(data.value);
    }
    if (data.type === 'object') {
      let result: any;
      if (!data.classname) {
        result = {};
        for (const f in data.value) {
          result[f] = deserialize(data.value[f]);
        }
      } else {
        result = new factory[data.classname]();
        result.constructor.__serializationInfo.deserialize(result, data);
      }
      return result;
    }
  } else {
    throw new SerializationError(`${Object.prototype.toString.call(data)} is not serializable`);
  }
}

export function serialize(obj: any): any {
  if (Utils.isPrimitive(obj)) {
    return obj;
  }
  if (Utils.isArray(obj)) {
    return obj.map((val) => serialize(val));
  }
  if (Utils.isMap(obj)) {
    const result: any = { type: 'map', value: [] };
    for (const kv of obj.entries()) {
      const key = serialize(kv[0]);
      const val = serialize(kv[1]);
      result.value.push([key, val]);
    }
    return result;
  }
  if (Utils.isSet(obj)) {
    const result: any = { type: 'set', value: [] };
    for (const v of obj.values()) {
      result.value.push(serialize(v));
    }
    return result;
  }
  if (Utils.isRegExp(obj)) {
    return { type: 'regexp', value: obj.valueOf() };
  }
  if (Utils.isDate(obj)) {
    return { type: 'date', value: obj.valueOf() };
  }
  if (Utils.isObject(obj)) {
    const data: any = { type: 'object', value: {} };
    if (
      obj.constructor === undefined ||
      obj.constructor ===
        (function () {
          return {};
        })().constructor
    ) {
      // primitive object
      for (const prop in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, prop)) {
          data.value[prop] = serialize(obj[prop]);
        }
      }
    } else {
      let info = (obj as any).constructor.__serializationInfo;
      if (info) {
        data.classname = info.name;
        while (info) {
          const proplist: any = info.properties;
          for (const prop in proplist) {
            if (proplist[prop].options.serialize) {
              data.value[prop] = proplist[prop].options.serialize(obj, obj[prop]);
            } else {
              data.value[prop] = serialize(obj[prop]);
            }
          }
          info = info.super;
        }
      }
    }
    return data;
  }
  throw new SerializationError(`${Object.prototype.toString.call(obj)} is not serializable`);
}

interface IPersistent {
  deserialize?: (container: any, data: any) => any;
  serialize?: (container: any, obj: any) => any;
}

interface ISerailizable {
  pre?: (obj: any, data: any) => void;
  post?: (obj: any, data: any) => void;
}

export function persistent(options?: IPersistent) {
  return function (target: any, propertyKey: string) {
    if (!Object.prototype.hasOwnProperty.call(target.constructor, '__serializationInfo')) {
      const superInfo = target.constructor.__serializationInfo;
      target.constructor.__serializationInfo = {
        properties: {},
        name: target.constructor.name,
        super: superInfo
      };
      factory[target.constructor.name] = target.constructor;
    }
    const info = target.constructor.__serializationInfo as ISerializationInfo;
    info.properties[propertyKey] = { options: options || {} };
  };
}

export function serializable(options?: ISerailizable) {
  return function (constructor: any) {
    if (!Object.prototype.hasOwnProperty.call(constructor, '__serializationInfo')) {
      const superInfo = constructor.__serializationInfo;
      constructor.__serializationInfo = {
        properties: {},
        name: constructor.name,
        super: superInfo
      };
      factory[constructor.name] = constructor;
    }
    const info = constructor.__serializationInfo;
    info.options = options;
    info.deserialize = function (this: any, obj: any, data: any) {
      if (this.super) {
        this.super.deserialize(obj, data);
      }
      this.options?.pre?.(obj, data);
      const proplist: any = this.properties;
      for (const prop in proplist) {
        if (proplist[prop].options.deserialize) {
          obj[prop] = proplist[prop].options.deserialize(obj, data.value[prop]);
        } else {
          obj[prop] = deserialize(data.value[prop]);
        }
      }
      this.options?.post?.(obj, data);
    }.bind(info);
  };
}

export function upperBound<T>(array: T[], value: number, toNumber: (x: T) => number): number {
  let l = 0;
  let r = array.length - 1;
  while (l < r) {
    const m = (l + r) >> 1;
    if (toNumber(array[m]) <= value) {
      l = m + 1;
    } else {
      r = m;
    }
  }
  return l;
}

export function lowerBound<T>(array: T[], value: number, toNumber: (x: T) => number): number {
  let l = 0;
  let r = array.length - 1;
  while (l < r) {
    const m = (l + r) >> 1;
    if (toNumber(array[m]) < value) {
      l = m + 1;
    } else {
      r = m;
    }
  }
  return l;
}
export async function dbTransaction<T = any>(
  engine: Engine | Engine.Session,
  func: (dbSession: Engine.Session) => Promise<T>
) {
  const dbSession = engine instanceof Engine ? await engine.beginSession() : engine;
  try {
    const ret = await func(dbSession);
    if (dbSession !== engine) {
      await dbSession.end();
    }
    return ret;
  } catch (err) {
    if (dbSession !== engine) {
      await dbSession.cancel();
    }
    const fatal =
      err instanceof DatabaseError || err instanceof ServerError || err instanceof NotImplementedError;
    if (fatal) {
      console.error(`dbTransaction() failed: ${err}\n${err.stack}`);
    } else if (err instanceof Error) {
      console.info(err.message);
    }
    throw err;
  }
}

export function successResponse<T>(res: express.Response, data: T, total = 0): T {
  res.json(success(total, data));
  return null as T;
}
