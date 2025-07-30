import type { PropertyAccessor, PropertyType, PropertyValue, SerializableClass } from './types';
import type { SerializationManager } from './manager';

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
  resource: '',
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

/**
 * Deserializes properties from JSON data into an object instance.
 *
 * This function handles the complex process of:
 * - Processing properties in phase order for proper initialization
 * - Converting JSON values to appropriate property types
 * - Handling nested object deserialization
 * - Managing async operations for complex properties
 *
 * @param obj - Target object to populate with deserialized data
 * @param cls - Serializable class metadata
 * @param json - JSON object containing property data
 * @param manager - Serialization manager for context and type resolution
 *
 * @public
 *
 */
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
      case 'resource':
        if (typeof v === 'string' && v) {
          tmpVal.str[0] = v;
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

/**
 * Serializes object properties to JSON format.
 *
 * This function extracts property values from an object and converts them
 * to JSON-serializable format. It handles:
 * - Type conversion from internal formats to JSON
 * - Asset reference collection for dependency tracking
 * - Default value optimization (omits properties with default values)
 * - Nested object serialization
 *
 * @param obj - Source object to serialize
 * @param cls - Serializable class metadata
 * @param json - Target JSON object to populate
 * @param manager - Serialization manager for context
 * @param assetList - Optional set to collect asset dependencies
 * @param asyncTasks - Optional array to collect serialization promises
 *
 * @public
 *
 */
export function serializeObjectProps<T extends object>(
  obj: T,
  cls: SerializableClass,
  json: object,
  manager: SerializationManager,
  assetList?: Set<string>,
  asyncTasks?: Promise<unknown>[]
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
            ? serializeObject(tmpVal.object[0], manager, {}, assetList, asyncTasks)
            : null;
        if (value) {
          json[k] = value;
        }
        break;
      }
      case 'object_array':
        json[k] = [];
        for (const p of tmpVal.object) {
          json[k].push(serializeObject(p, manager, {}, assetList, asyncTasks));
        }
        break;
      case 'resource':
        json[k] = tmpVal.object[0]['fileName'];
        asyncTasks.push(
          manager.vfs.writeFile(json[k], tmpVal.object[0]['data'], { encoding: 'binary', create: true })
        );
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

/**
 * Serializes a complete object to JSON format.
 *
 * This is the main entry point for object serialization. It handles:
 * - Class metadata resolution
 * - Initialization parameter collection
 * - Inheritance hierarchy traversal
 * - Asset dependency tracking
 * - Embedded asset collection
 *
 * @param obj - Object to serialize
 * @param manager - Serialization manager for context and metadata
 * @param json - Optional existing JSON object to populate
 * @param assetList - Optional set to collect asset dependencies
 * @param asyncTasks - Optional array to collect embedded asset promises
 * @returns Serialized JSON representation of the object
 *
 * @public
 */
export function serializeObject(
  obj: any,
  manager: SerializationManager,
  json?: any,
  assetList?: Set<string>,
  asyncTasks?: Promise<unknown>[]
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
  }
  while (info) {
    if (asyncTasks && info.getEmbeddedAssets) {
      asyncTasks?.push(...(info.getEmbeddedAssets(obj) ?? []).map((val) => Promise.resolve(val)));
    }
    if (assetList && info.getAssets) {
      for (const asset of info.getAssets(obj) ?? []) {
        if (asset) {
          assetList.add(asset);
        }
      }
    }
    serializeObjectProps(obj, info, json.Object, manager, assetList, asyncTasks);
    info = manager.getClassByConstructor(info.parent);
  }
  return json;
}

/**
 * Deserializes a complete object from JSON format.
 *
 * This is the main entry point for object deserialization. It handles:
 * - Class metadata resolution from ClassName
 * - Object construction with initialization parameters
 * - Custom creation functions vs standard constructors
 * - Inheritance hierarchy traversal for property loading
 * - Conditional property loading based on creation results
 *
 * @param ctx - Context object passed to custom creation functions
 * @param json - JSON object containing serialized data
 * @param manager - Serialization manager for context and metadata
 * @returns Promise resolving to the deserialized object
 *
 * @public
 */
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
