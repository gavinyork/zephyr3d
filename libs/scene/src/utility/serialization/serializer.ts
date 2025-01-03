import type { PropertyValue, SerializableClass, SerializationInfo } from './types';

export function deserializeObjectProps<T>(obj: T, cls: SerializableClass<T>, json: object) {
  const tmpVal: PropertyValue = {
    num: [0, 0, 0, 0],
    str: [''],
    bool: [false]
  };
  const props = cls.getProps(obj) ?? [];
  for (const prop of props) {
    const k = prop.name;
    const v = json[k];
    if (!v && !prop.default) {
      console.error(`Warn: serialized value not found for '${k}'`);
      continue;
    }
    switch (prop.type) {
      case 'float':
      case 'int': {
        tmpVal.num[0] = v ?? prop.default.num[0];
        break;
      }
      case 'string': {
        tmpVal.num[0] = v ?? prop.default.str[0];
        break;
      }
      case 'bool': {
        tmpVal.num[0] = v ?? prop.default.bool[0];
        break;
      }
      case 'vec2': {
        tmpVal.num[0] = v ? v[0] : prop.default.num[0];
        tmpVal.num[1] = v ? v[1] : prop.default.num[1];
        break;
      }
      case 'vec3':
      case 'rgb': {
        tmpVal.num[0] = v ? v[0] : prop.default.num[0];
        tmpVal.num[1] = v ? v[1] : prop.default.num[1];
        tmpVal.num[2] = v ? v[2] : prop.default.num[2];
        break;
      }
      case 'vec4':
      case 'rgba': {
        tmpVal.num[0] = v ? v[0] : prop.default.num[0];
        tmpVal.num[1] = v ? v[1] : prop.default.num[1];
        tmpVal.num[2] = v ? v[2] : prop.default.num[2];
        tmpVal.num[3] = v ? v[3] : prop.default.num[3];
        break;
      }
    }
    prop.set.call(obj, tmpVal);
  }
}

export function serializeObjectProps<T>(obj: T, cls: SerializableClass<T>, json: object) {
  const tmpVal: PropertyValue = {
    num: [0, 0, 0, 0],
    str: [''],
    bool: [false]
  };
  const props = cls.getProps(obj) ?? [];
  for (const prop of props) {
    const k = prop.name;
    prop.get.call(obj, tmpVal);
    switch (prop.type) {
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

export function serializeObject<T>(obj: T, serailizationInfo: SerializationInfo<T>, json?: object) {
  const index = serailizationInfo.findIndex((val) => val.ctor === obj.constructor);
  if (index < 0) {
    throw new Error('Serialize object failed: Cannot found serialization meta data');
  }
  let info = serailizationInfo[index];
  json = json ?? {
    ClassName: info.className
  };
  while (info) {
    serializeObjectProps(obj, info, json);
    info = info.parent;
  }
  return json;
}

export function deserializeObject<T>(ctx: unknown, json: object, serailizationInfo: SerializationInfo<T>): T {
  const className = json['ClassName'];
  const index = serailizationInfo.findIndex((val) => val.className === className);
  if (index < 0) {
    throw new Error('Deserialize object failed: Cannot found serialization meta data');
  }
  let info = serailizationInfo[index];
  const obj = info.createFunc ? info.createFunc(ctx) : new info.ctor();
  while (info) {
    deserializeObjectProps(obj, info, json);
    info = info.parent;
  }
  return obj;
}
