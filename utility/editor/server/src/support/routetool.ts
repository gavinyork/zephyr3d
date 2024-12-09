import fs from 'fs';
import express from 'express';
import type fileUpload from 'express-fileupload';
import * as validator from './validator';
import type { ApiDefine } from '../apiconf/apidef';
import { ErrorCode, RobotError, ParamError } from './errcodes';

export interface IHttpParamDefine {
  name?: string;
  type?:
    | 'param'
    | 'number'
    | 'numberArray'
    | 'int'
    | 'intArray'
    | 'string'
    | 'stringArray'
    | 'object'
    | 'objectArray'
    | 'file'
    | 'fileArray'
    | 'any';
  default?: any;
  nullable?: boolean;
  required?: boolean;
  enumNames?: string[];
  enum?: any[];
  enumMap?: any[];
  minValue?: number;
  maxValue?: number;
  minArrayLength?: number;
  maxArrayLength?: number;
  minStringLength?: number;
  maxStringLength?: number;
  validator?: validator.BaseParamValidator;
  fields?: { [name: string]: IHttpParamDefine };
}

export class RouteTool {
  public static loadRouters(app: express.Express, json: string | object) {
    const apiConfig: ApiDefine =
      typeof json === 'string' ? JSON.parse(fs.readFileSync(json).toString('utf8')) : json;
    for (const config of apiConfig) {
      const p = config.def.path;
      const routePath: string[] = Array.isArray(p) ? p : [p];
      const interfaces = config.def.interfaces;
      for (const interfaceName in interfaces) {
        const f = config.handlers[interfaceName];
        const i = interfaces[interfaceName];
        const params = i.params || {};
        const methods = Array.isArray(i.method) ? i.method : [i.method ?? 'get'];
        for (const method of methods) {
          for (const name in params) {
            const def = params[name];
            this._processDefinition(def);
          }
          const interfacePath = Array.isArray(i.path) ? i.path : [i.path];
          const routeFunc = async (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
          ) => {
            try {
              const container = method === 'get' ? req.query || {} : req.body || {};
              const paramContainer = req.params || {};
              const paramResults: Record<string, any> = {};
              if (params) {
                const errName = this._httpCheckParams(
                  req,
                  { ...container, ...paramContainer },
                  params,
                  paramResults
                );
                if (errName) {
                  throw new ParamError(errName);
                }
              }
              /*
              if (!await RBAC.checkUserPermission(req.session, acContext, paramResults, 0)) {
                throw new AccessDeniedError(`权限不足拒绝访问: ${interfaceName}`);
              }
              */

              await Promise.resolve(f(req, res, next, paramResults));
            } catch (err) {
              if (err instanceof RobotError) {
                return res.status(err.status).json({
                  code: err.code,
                  message: err.message,
                  data: null
                });
              }
              if (err instanceof Error) {
                return res.status(200).json({
                  code: ErrorCode.kServerError,
                  message: `${err.message}\n${err.stack}`,
                  data: null
                });
              }
              return res.status(200).json({
                code: ErrorCode.kUnknownError,
                message: '未知服务器错误，请联系管理员',
                data: null
              });
            }
          };
          routePath.forEach((route) => {
            const router = express.Router();
            app.use(route, router);
            interfacePath.forEach((pa) => {
              router.route(pa.replace(/\\/g, '/'))[method](routeFunc);
            });
          });
        }
      }
    }
  }
  private static _processDefinition(def: IHttpParamDefine) {
    if (!def.validator) {
      switch (def.type) {
        case 'int': {
          def.validator = new validator.IntValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            rangeMin: def.minValue,
            rangeMax: def.maxValue
          });
          break;
        }
        case 'number': {
          def.validator = new validator.NumberValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            rangeMin: def.minValue,
            rangeMax: def.maxValue
          });
          break;
        }
        case 'string': {
          def.validator = new validator.StringValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            lengthMin: def.minStringLength,
            lengthMax: def.maxStringLength
          });
          break;
        }
        case 'object': {
          def.validator = new validator.ObjectValidator({
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default
          });
          break;
        }
        case 'intArray': {
          def.validator = new validator.IntArrayValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            arrayLengthMin: def.minArrayLength,
            arrayLengthMax: def.maxArrayLength,
            rangeMin: def.minValue,
            rangeMax: def.maxValue
          });
          break;
        }
        case 'numberArray': {
          def.validator = new validator.NumberArrayValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            arrayLengthMin: def.minArrayLength,
            arrayLengthMax: def.maxArrayLength,
            rangeMin: def.minValue,
            rangeMax: def.maxValue
          });
          break;
        }
        case 'stringArray': {
          def.validator = new validator.StringArrayValidator({
            list: def.enum,
            listMap: def.enumMap,
            listType: 0,
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            arrayLengthMin: def.minArrayLength,
            arrayLengthMax: def.maxArrayLength,
            lengthMin: def.minStringLength,
            lengthMax: def.maxStringLength
          });
          break;
        }
        case 'objectArray': {
          def.validator = new validator.ObjectArrayValidator({
            nullable: def.nullable,
            required: def.required,
            defaultValue: def.default,
            arrayLengthMin: def.minArrayLength,
            arrayLengthMax: def.maxArrayLength
          });
          break;
        }
      }
      if (def.fields) {
        for (const k in def.fields) {
          this._processDefinition(def.fields[k]);
        }
      }
    }
  }
  private static _httpCheckParams(
    req: express.Request,
    container: any,
    params: { [name: string]: IHttpParamDefine },
    results: Record<string, any>
  ): string {
    for (const name in params) {
      const param = name in container ? container[name] : null;
      const def = params[name];
      if (def.type === 'param') {
        if (def.default.toLowerCase() !== req.params[name.substring(1)]?.toLowerCase()) {
          return `${req.url} API版本已变更为${def.default},请查看API文档`;
        }
      } else if (def.type === 'file' || def.type === 'fileArray') {
        const files = req.files || {};
        if (name in files) {
          let f = files[name];
          const isArray = Array.isArray(f);
          if (def.type === 'file' && isArray) {
            f = (f as fileUpload.UploadedFile[])[0];
          } else if (def.type === 'fileArray' && !isArray) {
            f = [f as fileUpload.UploadedFile];
          }
          results && (results[name] = f);
        } else if (def.nullable) {
          results && (results[name] = null);
        } else if (def.required) {
          return def.name || name;
        }
      } else {
        const val = typeof param === 'string' ? param.trim() || null : param;
        const { value, succeeded: isSucceeded } = def.validator
          ? def.validator.validate(val)
          : { value: val, succeeded: true };
        if (isSucceeded) {
          results && (results[name] = value);
          if (def.fields) {
            const arr = Array.isArray(value) ? value : [value];
            for (const el of arr) {
              if (el) {
                const err = this._httpCheckParams(req, el, def.fields, el);
                if (err) {
                  return err;
                }
              }
            }
          }
        } else {
          return def.name || name;
        }
      }
    }
    return null;
  }
}
