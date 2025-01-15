import type { PropertyValue, SerializableClass } from './types';

export async function deserializeObjectProps<T>(
  obj: T,
  cls: SerializableClass,
  json: object,
  serializationInfo: Map<any, SerializableClass>
) {
  const props = cls.getProps(obj) ?? [];
  for (const prop of props) {
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    const v = json[k];
    switch (prop.type) {
      case 'object':
        if (typeof v === 'string' && v) {
          tmpVal.str[0] = v;
        } else {
          tmpVal.object[0] = v ? (await deserializeObject<any>(obj, v, serializationInfo)) ?? null : null;
        }
        break;
      case 'object_array':
        tmpVal.object = [];
        if (Array.isArray(v)) {
          for (const p of v) {
            if (typeof p === 'string' && p) {
              tmpVal.str[0] = p;
            } else {
              tmpVal.object.push(
                p ? (await deserializeObject<any>(obj, p, serializationInfo)) ?? null : null
              );
            }
          }
        }
        break;
      case 'float':
      case 'int': {
        tmpVal.num[0] = v ?? prop.default?.num[0] ?? 0;
        break;
      }
      case 'string': {
        tmpVal.str[0] = v ?? prop.default?.str[0] ?? '';
        break;
      }
      case 'bool': {
        tmpVal.bool[0] = v ?? prop.default?.bool[0] ?? false;
        break;
      }
      case 'vec2': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        break;
      }
      case 'vec3':
      case 'rgb': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        tmpVal.num[2] = v ? v[2] : prop.default?.num[2] ?? 0;
        break;
      }
      case 'vec4':
      case 'rgba': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        tmpVal.num[2] = v ? v[2] : prop.default?.num[2] ?? 0;
        tmpVal.num[3] = v ? v[3] : prop.default?.num[3] ?? 0;
        break;
      }
    }
    prop.set.call(obj, tmpVal);
  }
}

export function serializeObjectProps<T>(
  obj: T,
  cls: SerializableClass,
  json: object,
  serializationInfo: Map<any, SerializableClass>
) {
  const props = cls.getProps(obj) ?? [];
  for (const prop of props) {
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    prop.get.call(obj, tmpVal);
    switch (prop.type) {
      case 'object':
        json[k] =
          typeof tmpVal.str[0] === 'string' && tmpVal.str[0]
            ? tmpVal.str[0]
            : tmpVal.object[0]
            ? serializeObject(tmpVal.object[0], serializationInfo)
            : null;
        break;
      case 'object_array':
        json[k] = [];
        for (const p of tmpVal.object) {
          json[k].push(serializeObject(p, serializationInfo));
        }
        break;
      case 'float':
      case 'int': {
        if (!prop.default || prop.default.num[0] !== tmpVal.num[0]) {
          json[k] = tmpVal.num[0];
        }
        break;
      }
      case 'string': {
        if (!prop.default || prop.default.str[0] !== tmpVal.str[0]) {
          json[k] = tmpVal.str[0];
        }
        break;
      }
      case 'bool': {
        if (!prop.default || prop.default.bool[0] !== tmpVal.bool[0]) {
          json[k] = tmpVal.bool[0];
        }
        break;
      }
      case 'vec2': {
        if (!prop.default || prop.default.num[0] !== tmpVal.num[0] || prop.default.num[1] !== tmpVal.num[1]) {
          json[k] = [tmpVal.num[0], tmpVal.num[1]];
        }
        break;
      }
      case 'vec3':
      case 'rgb': {
        if (
          !prop.default ||
          prop.default.num[0] !== tmpVal.num[0] ||
          prop.default.num[1] !== tmpVal.num[1] ||
          prop.default.num[2] !== tmpVal.num[2]
        ) {
          json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2]];
        }
        break;
      }
      case 'vec4':
      case 'rgba': {
        if (
          !prop.default ||
          prop.default.num[0] !== tmpVal.num[0] ||
          prop.default.num[1] !== tmpVal.num[1] ||
          prop.default.num[2] !== tmpVal.num[2] ||
          prop.default.num[3] !== tmpVal.num[3]
        ) {
          json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2], tmpVal.num[3]];
        }
        break;
      }
    }
  }
}

export function serializeObject(obj: any, serializationInfo: Map<any, SerializableClass>, json?: any) {
  const cls = [...serializationInfo.values()];
  const index = cls.findIndex((val) => val.ctor === obj.constructor);
  if (index < 0) {
    throw new Error('Serialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams = info?.getInitParams?.(obj);
  json = json ?? {};
  json.ClassName = info.className;
  json.Object = {};
  if (initParams) {
    json.Init = initParams;
  }
  obj = info.getObject?.(obj) ?? obj;
  while (info) {
    serializeObjectProps(obj, info, json.Object, serializationInfo);
    info = info.parent;
  }
  return json;
}

export async function deserializeObject<T>(
  ctx: any,
  json: object,
  serializationInfo: Map<any, SerializableClass>
): Promise<T> {
  const cls = [...serializationInfo.values()];
  const className = json['ClassName'];
  const index = cls.findIndex((val) => val.className === className);
  if (index < 0) {
    throw new Error('Deserialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams: any[] = json['Init'] ?? [];
  if (!Array.isArray(initParams)) {
    throw new Error('Deserialize object failed: Invalid initialization parameters');
  }
  json = json['Object'];
  const p: T | Promise<T> = info.createFunc ? info.createFunc(ctx, ...initParams) : new info.ctor();
  if (!p) {
    return null;
  }
  const obj = p instanceof Promise ? await p : p;
  while (info) {
    await deserializeObjectProps(obj, info, json, serializationInfo);
    info = info.parent;
  }
  return obj;
}
