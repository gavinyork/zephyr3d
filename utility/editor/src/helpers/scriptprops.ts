import type { PropertyAccessor, PropertyAccessorOptions, SerializableClass } from '@zephyr3d/scene';
import { getEngine, Scene, SceneNode } from '@zephyr3d/scene';
import type { GenericConstructor, Nullable } from '@zephyr3d/base';

type ScriptHost = Scene | SceneNode;
type ScriptHostWithConfig = ScriptHost & { scriptConfig: Nullable<Record<string, unknown>> };
type RuntimeScriptValueType =
  | 'bool'
  | 'int'
  | 'float'
  | 'int2'
  | 'int3'
  | 'int4'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'rgb'
  | 'rgba'
  | 'string'
  | 'asset'
  | 'node';
type RuntimeScriptValueDeclaration = {
  type: RuntimeScriptValueType;
  default?: unknown;
  label?: string;
  group?: string;
  minValue?: number;
  maxValue?: number;
  speed?: number;
  mimeTypes?: string[];
  sceneNode?: {
    kind?: 'node' | 'mesh';
  };
  enum?: {
    labels: string[];
    values: unknown[];
  };
};
type RuntimeScriptPropertyInfo =
  | (RuntimeScriptValueDeclaration & { name: string })
  | {
      name: string;
      type: 'object_array';
      element: RuntimeScriptValueDeclaration;
      default?: unknown[];
      label?: string;
      group?: string;
      minValue?: number;
      maxValue?: number;
      speed?: number;
      mimeTypes?: string[];
      sceneNode?: {
        kind?: 'node' | 'mesh';
      };
      enum?: {
        labels: string[];
        values: unknown[];
      };
    };

const propertyCache = new Map<string, PropertyAccessor<ScriptHost>[]>();
const arrayElementClassCache = new Map<string, SerializableClass>();

function isScriptHost(value: unknown): value is ScriptHost {
  return value instanceof Scene || value instanceof SceneNode;
}

function cloneValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneValue(item);
    }
    return result;
  }
  return value;
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isSameValue(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bEntries = Object.entries(b as Record<string, unknown>);
    return (
      aEntries.length === bEntries.length &&
      aEntries.every(([key, value]) => isSameValue(value, (b as Record<string, unknown>)[key]))
    );
  }
  return a === b;
}

function getScriptConfigObject(host: ScriptHost, createIfNeeded = false) {
  const target = host as ScriptHostWithConfig;
  if (!target.scriptConfig && createIfNeeded) {
    target.scriptConfig = {};
  }
  return target.scriptConfig ?? null;
}

function getPropertyOptions(
  info: RuntimeScriptValueDeclaration | RuntimeScriptPropertyInfo
): PropertyAccessorOptions {
  if (info.type === 'asset') {
    return {
      label: info.label,
      group: info.group ? `Script/${info.group}` : 'Script',
      mimeTypes: info.mimeTypes ?? [],
      minValue: info.minValue,
      maxValue: info.maxValue,
      speed: info.speed,
      enum: info.enum
    };
  }
  if (info.type === 'node') {
    return {
      label: info.label,
      group: info.group ? `Script/${info.group}` : 'Script',
      sceneNode: info.sceneNode ?? { kind: 'node' },
      minValue: info.minValue,
      maxValue: info.maxValue,
      speed: info.speed,
      enum: info.enum
    };
  }
  return {
    label: info.label,
    group: info.group ? `Script/${info.group}` : 'Script',
    minValue: info.minValue,
    maxValue: info.maxValue,
    speed: info.speed,
    mimeTypes: info.mimeTypes,
    sceneNode: info.sceneNode,
    enum: info.enum,
    inlineObjectArray: info.type === 'object_array'
  };
}

function readDefaultValue(info: RuntimeScriptPropertyInfo | RuntimeScriptValueDeclaration) {
  if (info.default !== undefined) {
    return cloneValue(info.default);
  }
  switch (info.type) {
    case 'bool':
      return false;
    case 'string':
    case 'asset':
    case 'node':
      return '';
    case 'int':
    case 'float':
      return 0;
    case 'int2':
    case 'vec2':
      return [0, 0];
    case 'int3':
    case 'vec3':
    case 'rgb':
      return [0, 0, 0];
    case 'int4':
    case 'vec4':
    case 'rgba':
      return [0, 0, 0, 0];
    case 'object_array':
      return [];
    default:
      return null;
  }
}

function getConfiguredValue(host: ScriptHost, propName: string) {
  const config = getScriptConfigObject(host);
  return config && Object.prototype.hasOwnProperty.call(config, propName)
    ? cloneValue(config[propName])
    : undefined;
}

function readPropertyValue(host: ScriptHost, info: RuntimeScriptPropertyInfo) {
  const configured = getConfiguredValue(host, info.name);
  return configured !== undefined ? configured : readDefaultValue(info);
}

function writeConfigValue(host: ScriptHost, propName: string, next: unknown, defaultValue: unknown) {
  const cloned = cloneValue(next);
  const isSameDefault = isSameValue(cloned, defaultValue);
  const config = getScriptConfigObject(host, !isSameDefault);
  if (!config) {
    return;
  }
  if (isSameDefault) {
    delete config[propName];
    if (Object.keys(config).length === 0) {
      (host as ScriptHostWithConfig).scriptConfig = null;
    }
  } else {
    config[propName] = cloned;
  }
}

function writeScalarPropertyValue(
  host: ScriptHost,
  info: RuntimeScriptValueDeclaration & { name: string },
  value: unknown
) {
  writeConfigValue(host, info.name, value, readDefaultValue(info));
}

function getScalarPropertyType(type: RuntimeScriptValueType) {
  if (type === 'asset' || type === 'node') {
    return 'string';
  }
  return type;
}

function readScalarInto(target: any, type: RuntimeScriptValueType, data: unknown) {
  switch (type) {
    case 'bool':
      target.bool[0] = !!data;
      break;
    case 'string':
    case 'asset':
    case 'node':
      target.str[0] = typeof data === 'string' ? data : '';
      break;
    case 'int':
    case 'float':
      target.num[0] = Number(data ?? 0);
      break;
    case 'int2':
    case 'vec2': {
      const arr = Array.isArray(data) ? data : [0, 0];
      target.num[0] = Number(arr[0] ?? 0);
      target.num[1] = Number(arr[1] ?? 0);
      break;
    }
    case 'int3':
    case 'vec3':
    case 'rgb': {
      const arr = Array.isArray(data) ? data : [0, 0, 0];
      target.num[0] = Number(arr[0] ?? 0);
      target.num[1] = Number(arr[1] ?? 0);
      target.num[2] = Number(arr[2] ?? 0);
      break;
    }
    case 'int4':
    case 'vec4':
    case 'rgba': {
      const arr = Array.isArray(data) ? data : [0, 0, 0, 0];
      target.num[0] = Number(arr[0] ?? 0);
      target.num[1] = Number(arr[1] ?? 0);
      target.num[2] = Number(arr[2] ?? 0);
      target.num[3] = Number(arr[3] ?? 0);
      break;
    }
  }
}

function writeScalarFromInput(type: RuntimeScriptValueType, value: any) {
  switch (type) {
    case 'bool':
      return !!value.bool[0];
    case 'string':
    case 'asset':
    case 'node':
      return value.str[0] ?? '';
    case 'int':
      return Math.round(Number(value.num[0] ?? 0));
    case 'float':
      return Number(value.num[0] ?? 0);
    case 'int2':
      return [Math.round(Number(value.num[0] ?? 0)), Math.round(Number(value.num[1] ?? 0))];
    case 'vec2':
      return [Number(value.num[0] ?? 0), Number(value.num[1] ?? 0)];
    case 'int3':
      return [
        Math.round(Number(value.num[0] ?? 0)),
        Math.round(Number(value.num[1] ?? 0)),
        Math.round(Number(value.num[2] ?? 0))
      ];
    case 'vec3':
    case 'rgb':
      return [Number(value.num[0] ?? 0), Number(value.num[1] ?? 0), Number(value.num[2] ?? 0)];
    case 'int4':
      return [
        Math.round(Number(value.num[0] ?? 0)),
        Math.round(Number(value.num[1] ?? 0)),
        Math.round(Number(value.num[2] ?? 0)),
        Math.round(Number(value.num[3] ?? 0))
      ];
    case 'vec4':
    case 'rgba':
      return [
        Number(value.num[0] ?? 0),
        Number(value.num[1] ?? 0),
        Number(value.num[2] ?? 0),
        Number(value.num[3] ?? 0)
      ];
  }
}

class ScriptArrayElement {
  host: ScriptHost;
  propertyName: string;
  index: number;
  element: RuntimeScriptValueDeclaration;
  constructor(host: ScriptHost, propertyName: string, index: number, element: RuntimeScriptValueDeclaration) {
    this.host = host;
    this.propertyName = propertyName;
    this.index = index;
    this.element = element;
  }
}

function getArrayValue(host: ScriptHost, info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>) {
  const value = readPropertyValue(host, info);
  return Array.isArray(value) ? cloneValue(value) : [];
}

function setArrayValue(
  host: ScriptHost,
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  value: unknown[]
) {
  writeConfigValue(host, info.name, value, readDefaultValue(info));
}

function getArrayElementSerializationClass(
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>
) {
  const key = `${info.name}:${JSON.stringify(info.element)}`;
  const cached = arrayElementClassCache.get(key);
  if (cached) {
    return cached;
  }
  const cls = class ScriptArrayElementWrapper extends ScriptArrayElement {};
  const serializationClass: SerializableClass = {
    ctor: cls as unknown as GenericConstructor,
    name: `ScriptArrayElement_${key}`,
    noTitle: true,
    getProps() {
      return [
        {
          name: 'Value',
          type: getScalarPropertyType(info.element.type),
          options: getPropertyOptions(info.element),
          get(this: ScriptArrayElement, value) {
            const data = getArrayValue(this.host, info)[this.index];
            readScalarInto(value as any, info.element.type, data);
          },
          set(this: ScriptArrayElement, value) {
            const arr = getArrayValue(this.host, info);
            arr[this.index] = writeScalarFromInput(info.element.type, value as any);
            setArrayValue(this.host, info, arr);
          }
        }
      ] as PropertyAccessor<any>[];
    }
  };
  getEngine().resourceManager.registerClass(serializationClass);
  arrayElementClassCache.set(key, serializationClass);
  return serializationClass;
}

function createScalarAccessor(
  info: Exclude<RuntimeScriptPropertyInfo, { type: 'object_array' }>
): PropertyAccessor<ScriptHost> {
  return {
    name: info.name,
    type: getScalarPropertyType(info.type),
    default: cloneValue(info.default),
    options: getPropertyOptions(info),
    isHidden(this: ScriptHost) {
      return !this.script;
    },
    isPersistent(this: ScriptHost) {
      return !!this.script;
    },
    get(this: ScriptHost, value) {
      readScalarInto(value as any, info.type, readPropertyValue(this, info));
    },
    set(this: ScriptHost, value) {
      writeScalarPropertyValue(this, info, writeScalarFromInput(info.type, value as any));
    }
  };
}

function createObjectArrayAccessor(
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>
): PropertyAccessor<ScriptHost> {
  const elementClass = getArrayElementSerializationClass(info);
  return {
    name: info.name,
    type: 'object_array',
    default: cloneValue(info.default),
    options: {
      ...getPropertyOptions(info),
      objectTypes: [elementClass.ctor],
      inlineObjectArray: true
    },
    isHidden(this: ScriptHost) {
      return !this.script;
    },
    isPersistent(this: ScriptHost) {
      return !!this.script;
    },
    isNullable() {
      return false;
    },
    get(this: ScriptHost, value) {
      const target = value as any;
      const arr = getArrayValue(this, info);
      target.object = arr.map(
        (_item, index) =>
          new (elementClass.ctor as unknown as {
            new (
              host: ScriptHost,
              propertyName: string,
              index: number,
              element: RuntimeScriptValueDeclaration
            ): ScriptArrayElement;
          })(this, info.name, index, info.element)
      );
    },
    set(this: ScriptHost, value, index) {
      const target = value as any;
      const arr = getArrayValue(this, info);
      if (typeof index === 'number' && index >= 0 && target.object?.[0] instanceof ScriptArrayElement) {
        arr[index] = getArrayValue(this, info)[target.object[0].index];
      } else if (target.object) {
        const next: unknown[] = [];
        for (const item of target.object) {
          if (item instanceof ScriptArrayElement) {
            next.push(getArrayValue(this, info)[item.index]);
          }
        }
        setArrayValue(this, info, next);
        return;
      }
      setArrayValue(this, info, arr);
    },
    create(this: ScriptHost, _ctor, index) {
      const arr = getArrayValue(this, info);
      const insertIndex = Math.max(0, Math.min(index ?? arr.length, arr.length));
      arr.splice(insertIndex, 0, cloneValue(readDefaultValue(info.element)));
      setArrayValue(this, info, arr);
      return new (elementClass.ctor as unknown as {
        new (
          host: ScriptHost,
          propertyName: string,
          index: number,
          element: RuntimeScriptValueDeclaration
        ): ScriptArrayElement;
      })(this, info.name, insertIndex, info.element);
    },
    add(this: ScriptHost, value, index) {
      const target = value as any;
      const arr = getArrayValue(this, info);
      const item = target.object?.[0] as ScriptArrayElement | undefined;
      const insertIndex = Math.max(0, Math.min(index ?? arr.length, arr.length));
      const nextValue =
        item instanceof ScriptArrayElement
          ? getArrayValue(this, info)[item.index]
          : cloneValue(readDefaultValue(info.element));
      arr.splice(insertIndex, 0, cloneValue(nextValue));
      setArrayValue(this, info, arr);
    },
    delete(this: ScriptHost, index) {
      const arr = getArrayValue(this, info);
      if (index >= 0 && index < arr.length) {
        arr.splice(index, 1);
        setArrayValue(this, info, arr);
      }
    }
  };
}

function createAccessor(info: RuntimeScriptPropertyInfo): PropertyAccessor<ScriptHost> {
  return info.type === 'object_array' ? createObjectArrayAccessor(info) : createScalarAccessor(info);
}

async function loadScriptPropertyInfo(path: string) {
  const scriptPath = path?.trim();
  if (!scriptPath) {
    return [];
  }
  const normalizedPath =
    scriptPath.toLowerCase().endsWith('.ts') || scriptPath.toLowerCase().endsWith('.js')
      ? scriptPath.slice(0, -3)
      : scriptPath;
  const info = await getEngine().loadRuntimeScriptClass(normalizedPath);
  if (!info) {
    return [];
  }
  const ctor = info.cls as {
    getScriptProperties?: () => RuntimeScriptPropertyInfo[];
  };
  return ctor.getScriptProperties?.() ?? [];
}

export async function getScriptPropertyAccessors(host: unknown): Promise<PropertyAccessor<ScriptHost>[]> {
  if (!isScriptHost(host) || !host.script) {
    return [];
  }
  const scriptPath = host.script.trim();
  if (!scriptPath) {
    return [];
  }
  if (propertyCache.has(scriptPath)) {
    return propertyCache.get(scriptPath)!;
  }
  const props = (await loadScriptPropertyInfo(scriptPath)).map(createAccessor);
  propertyCache.set(scriptPath, props);
  return props;
}

export function clearScriptPropertyAccessorCache(path?: Nullable<string>) {
  if (path) {
    propertyCache.delete(path);
  } else {
    propertyCache.clear();
  }
}
