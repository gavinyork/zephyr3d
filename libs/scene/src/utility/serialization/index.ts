import type { Scene } from '../../scene';
import type { EmbeddedAssetInfo } from './asset/asset';
import type { PropertyAccessor, PropertyType, PropertyValue, SerializableClass } from './types';
import type { SerializationManager } from './manager';

export * from './asset/asset';
export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';
export * from './manager';

const defaultValues: Record<PropertyType, any> = {
  bool: false,
  float: 0,
  int: 0,
  int2: [0, 0],
  int3: [0, 0, 0],
  int4: [0, 0, 0, 0],
  object: null,
  object_array: [],
  rgb: [0, 0, 0],
  rgba: [0, 0, 0, 0],
  string: '',
  vec2: [0, 0],
  vec3: [0, 0, 0],
  vec4: [0, 0, 0, 0],
  command: null
};

function getDefaultValue<T>(obj: T, prop: PropertyAccessor<T>) {
  let v = prop.getDefaultValue?.call(obj) ?? prop.default;
  if (v === undefined) {
    v = defaultValues[prop.type];
    console.warn(`No default value found for property: ${prop.name}, ${v} will be used`);
  }
  return v;
}

export async function deserializeObjectProps<T extends object>(
  obj: T,
  cls: SerializableClass,
  json: object,
  manager: SerializationManager
) {
  const props = (manager.getPropertiesByClass(cls) ?? []).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
  let currentPhase: number = undefined;
  const promises: Promise<void>[] = [];
  for (const prop of props) {
    const phase = prop.phase ?? 0;
    if (phase !== currentPhase) {
      currentPhase = phase;
      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
    if (prop.type === 'command') {
      continue;
    }
    if (!prop.set) {
      continue;
    }
    if (prop.isValid && !prop.isValid.call(obj)) {
      continue;
    }
    const persistent = prop.persistent ?? true;
    if (!persistent) {
      continue;
    }
    const k = prop.name;
    const v = json[k] ?? getDefaultValue(obj, prop);
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    switch (prop.type) {
      case 'object':
        if (typeof v === 'string' && v) {
          tmpVal.str[0] = v;
        } else {
          tmpVal.object[0] = v ? (await deserializeObject<any>(obj, v, manager)) ?? null : null;
        }
        break;
      case 'object_array':
        tmpVal.object = [];
        if (Array.isArray(v)) {
          for (const p of v) {
            if (typeof p === 'string' && p) {
              tmpVal.str[0] = p;
            } else {
              tmpVal.object.push(p ? (await deserializeObject<any>(obj, p, manager)) ?? null : null);
            }
          }
        }
        break;
      case 'float':
      case 'int':
        tmpVal.num[0] = v;
        break;
      case 'string':
        tmpVal.str[0] = v;
        break;
      case 'bool':
        tmpVal.bool[0] = v;
        break;
      case 'vec2':
      case 'int2':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        break;
      case 'vec3':
      case 'int3':
      case 'rgb':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        tmpVal.num[2] = v[2];
        break;
      case 'vec4':
      case 'int4':
      case 'rgba':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        tmpVal.num[2] = v[2];
        tmpVal.num[3] = v[3];
        break;
    }
    promises.push(Promise.resolve(prop.set.call(obj, tmpVal, -1)));
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

export function serializeObjectProps<T extends object>(
  obj: T,
  cls: SerializableClass,
  json: object,
  manager: SerializationManager,
  assetList?: Set<string>,
  embeddedAssetList?: Promise<EmbeddedAssetInfo>[]
) {
  const props = manager.getPropertiesByClass(cls) ?? [];
  for (const prop of props) {
    if (prop.isValid && !prop.isValid.call(obj)) {
      continue;
    }
    if (prop.type === 'command') {
      continue;
    }
    const persistent = prop.persistent ?? true;
    if (!persistent) {
      continue;
    }
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    prop.get.call(obj, tmpVal);
    switch (prop.type) {
      case 'object': {
        const value =
          typeof tmpVal.str[0] === 'string' && tmpVal.str[0]
            ? tmpVal.str[0]
            : tmpVal.object[0]
            ? serializeObject(tmpVal.object[0], manager, {}, assetList, embeddedAssetList)
            : null;
        if (value) {
          json[k] = value;
          if (assetList && typeof json[k] === 'string' && manager.assetRegistry.getAssetInfo(json[k])) {
            assetList.add(json[k]);
          }
        }
        break;
      }
      case 'object_array':
        json[k] = [];
        for (const p of tmpVal.object) {
          json[k].push(serializeObject(p, manager, {}, assetList, embeddedAssetList));
        }
        break;
      case 'float':
      case 'int':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.num[0]
        ) {
          json[k] = tmpVal.num[0];
        }
        break;
      case 'string':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.str[0]
        ) {
          json[k] = tmpVal.str[0];
        }
        break;
      case 'bool':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.bool[0]
        ) {
          json[k] = tmpVal.bool[0];
        }
        break;
      case 'vec2':
      case 'int2':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (v[0] === tmpVal.num[0] && v[1] === tmpVal.num[1]) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1]];
        break;
      case 'vec3':
      case 'int3':
      case 'rgb':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (v[0] === tmpVal.num[0] && v[1] === tmpVal.num[1] && v[2] === tmpVal.num[2]) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2]];
        break;
      case 'vec4':
      case 'int4':
      case 'rgba':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (
            v[0] === tmpVal.num[0] &&
            v[1] === tmpVal.num[1] &&
            v[2] === tmpVal.num[2] &&
            v[3] === tmpVal.num[3]
          ) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2], tmpVal.num[3]];
        break;
    }
  }
}

export function serializeObject(
  obj: any,
  manager: SerializationManager,
  json?: any,
  assetList?: Set<string>,
  embeddedAssetList?: Promise<EmbeddedAssetInfo>[]
) {
  const cls = manager.getClasses();
  const index = cls.findIndex((val) => val.ctor === obj.constructor);
  if (index < 0) {
    throw new Error('Serialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams = info?.getInitParams?.(obj);
  json = json ?? {};
  json.ClassName = info.ctor.name;
  json.Object = {};
  if (initParams !== undefined && initParams !== null) {
    json.Init = initParams;
    if (assetList && initParams.asset && manager.assetRegistry.getAssetInfo(initParams.asset)) {
      assetList.add(initParams.asset);
    }
  }
  while (info) {
    if (embeddedAssetList && info.getEmbeddedAssets) {
      embeddedAssetList?.push(...(info.getEmbeddedAssets(obj) ?? []).map((val) => Promise.resolve(val)));
    }
    if (assetList && info.getAssets) {
      for (const asset of info.getAssets(obj) ?? []) {
        if (asset) {
          assetList.add(asset);
        }
      }
    }
    serializeObjectProps(obj, info, json.Object, manager, assetList, embeddedAssetList);
    info = manager.getClassByConstructor(info.parent);
  }
  return json;
}

export async function deserializeObject<T extends object>(
  ctx: any,
  json: object,
  manager: SerializationManager
): Promise<T> {
  const cls = manager.getClasses();
  const className = json['ClassName'];
  const index = cls.findIndex((val) => val.ctor.name === className);
  if (index < 0) {
    throw new Error('Deserialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams: { asset?: string } = json['Init'];
  json = json['Object'];
  let p: T | Promise<T>;
  let loadProps = true;
  if (info.createFunc) {
    let result = info.createFunc(ctx, initParams);
    if (result instanceof Promise) {
      result = await result;
    }
    p = result.obj;
    loadProps = result.loadProps ?? true;
  } else {
    p = new info.ctor() as T;
  }
  //const p: T | Promise<T> = info.createFunc ? info.createFunc(ctx, initParams) : new info.ctor();
  if (!p) {
    return null;
  }
  const obj = p instanceof Promise ? await p : p;
  if (loadProps) {
    while (info) {
      await deserializeObjectProps(obj, info, json, manager);
      info = manager.getClassByConstructor(info.parent);
    }
  }
  return obj;
}

export async function deserializeSceneFromURL(
  url: string,
  manager: SerializationManager
): Promise<{ scene: Scene; meta: any }> {
  try {
    const data = await manager.assetRegistry.assetManager.fetchTextData(url);
    const json = JSON.parse(data);
    const scene = await deserializeObject<Scene>(null, json, manager);
    const meta = json['meta'] ?? null;
    return { scene, meta };
  } catch (err) {
    console.error(`Deserialize scene failed: ${err}`);
    return null;
  }
}
