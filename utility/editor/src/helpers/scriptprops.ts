import type { PropertyAccessor, PropertyAccessorOptions, SerializableClass } from '@zephyr3d/scene';
import { getEngine, Scene, SceneNode } from '@zephyr3d/scene';
import type { GenericConstructor, Nullable } from '@zephyr3d/base';

type ScriptHost = Scene | SceneNode;
type ScriptConfigValue = Nullable<Record<string, unknown> | unknown[]>;
type ScriptHostWithConfig = ScriptHost & {
  scriptConfig: ScriptConfigValue;
  scriptConfigs?: ScriptConfigValue[];
  scripts?: { script: string; config: ScriptConfigValue }[];
};
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
  hidden?: boolean;
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
type RuntimeScriptObjectFieldDeclaration = RuntimeScriptValueDeclaration & {
  name: string;
};
type RuntimeScriptObjectDeclaration = {
  type: 'object';
  fields: RuntimeScriptObjectFieldDeclaration[];
  default?: Record<string, unknown>;
};
type RuntimeScriptArrayElementDeclaration = RuntimeScriptValueDeclaration | RuntimeScriptObjectDeclaration;
type RuntimeScriptPropertyInfo =
  | (RuntimeScriptValueDeclaration & { name: string })
  | {
      name: string;
      type: 'object_array';
      element: RuntimeScriptArrayElementDeclaration;
      default?: unknown[];
      label?: string;
      group?: string;
      hidden?: boolean;
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

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createArrayElementClassName(
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  key: string
) {
  const baseName = String(info.label ?? info.name ?? 'Array Element')
    .replace(/[^0-9A-Za-z_]+/g, ' ')
    .trim();
  const readableName = baseName.length > 0 ? baseName : 'Array Element';
  return `${readableName} Item ${hashString(key)}`;
}

function isScriptHost(value: unknown): value is ScriptHost {
  return value instanceof Scene || value instanceof SceneNode;
}

function cloneScriptAttachmentList(
  value: Nullable<{ script?: string; config?: ScriptConfigValue }[]>
): { script: string; config: ScriptConfigValue }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => ({
    script: String(item?.script ?? ''),
    config: cloneValue(item?.config ?? null) as ScriptConfigValue
  }));
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

function isObjectElementDeclaration(
  value: RuntimeScriptValueDeclaration | RuntimeScriptPropertyInfo | RuntimeScriptArrayElementDeclaration
): value is RuntimeScriptObjectDeclaration {
  return value.type === 'object';
}

function isScalarElementDeclaration(
  value: RuntimeScriptArrayElementDeclaration
): value is RuntimeScriptValueDeclaration {
  return value.type !== 'object';
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

function getScriptAttachments(host: ScriptHost) {
  return cloneScriptAttachmentList((host as ScriptHostWithConfig).scripts);
}

function setScriptAttachments(
  host: ScriptHost,
  attachments: { script: string; config: ScriptConfigValue }[]
) {
  const target = host as ScriptHostWithConfig;
  target.scripts = cloneScriptAttachmentList(attachments);
  target.script = attachments[0]?.script ?? '';
  target.scriptConfig = (attachments[0]?.config ?? null) as ScriptConfigValue;
}

function getScriptConfigObject(host: ScriptHost, scriptPath?: string, attachmentIndex?: number) {
  if (scriptPath) {
    const attachments = getScriptAttachments(host);
    const attachment =
      typeof attachmentIndex === 'number' && attachmentIndex >= 0
        ? attachments[attachmentIndex]
        : attachments.find((item) => item.script === scriptPath);
    const config = attachment?.config;
    return config && !Array.isArray(config) && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : null;
  }
  const target = host as ScriptHostWithConfig;
  const config = target.scriptConfig;
  return config && !Array.isArray(config) && typeof config === 'object'
    ? (config as Record<string, unknown>)
    : null;
}

function getPropertyOptions(
  info: RuntimeScriptValueDeclaration | RuntimeScriptPropertyInfo,
  scriptGroup?: string
): PropertyAccessorOptions {
  const group = scriptGroup
    ? info.group
      ? `Script/${scriptGroup}/${info.group}`
      : `Script/${scriptGroup}`
    : info.group
      ? `Script/${info.group}`
      : 'Script';
  if (info.type === 'asset') {
    return {
      label: info.label,
      group,
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
      group,
      sceneNode: info.sceneNode ?? { kind: 'node' },
      minValue: info.minValue,
      maxValue: info.maxValue,
      speed: info.speed,
      enum: info.enum
    };
  }
  return {
    label: info.label,
    group,
    minValue: info.minValue,
    maxValue: info.maxValue,
    speed: info.speed,
    mimeTypes: info.mimeTypes,
    sceneNode: info.sceneNode,
    enum: info.enum,
    inlineObjectArray: info.type === 'object_array'
  };
}

function readDefaultValue(
  info: RuntimeScriptPropertyInfo | RuntimeScriptValueDeclaration | RuntimeScriptObjectDeclaration
) {
  if (isObjectElementDeclaration(info)) {
    const objInfo = info;
    if (objInfo.default !== undefined) {
      return cloneValue(objInfo.default);
    }
    const result: Record<string, unknown> = {};
    for (const field of objInfo.fields) {
      result[field.name] = readDefaultValue(field);
    }
    return result;
  }
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

function getConfiguredValue(
  host: ScriptHost,
  propName: string,
  scriptPath?: string,
  attachmentIndex?: number
) {
  const config = getScriptConfigObject(host, scriptPath, attachmentIndex);
  return config && Object.prototype.hasOwnProperty.call(config, propName)
    ? cloneValue(config[propName])
    : undefined;
}

function readPropertyValue(
  host: ScriptHost,
  info: RuntimeScriptPropertyInfo,
  scriptPath?: string,
  attachmentIndex?: number
) {
  const configured = getConfiguredValue(host, info.name, scriptPath, attachmentIndex);
  return configured !== undefined ? configured : readDefaultValue(info);
}

function writeConfigValue(
  host: ScriptHost,
  propName: string,
  next: unknown,
  defaultValue: unknown,
  scriptPath?: string,
  attachmentIndex?: number
) {
  const cloned = cloneValue(next);
  const isSameDefault = isSameValue(cloned, defaultValue);
  if (scriptPath) {
    const attachments = getScriptAttachments(host);
    let index =
      typeof attachmentIndex === 'number' && attachmentIndex >= 0
        ? attachmentIndex
        : attachments.findIndex((item) => item.script === scriptPath);
    if (index < 0) {
      if (isSameDefault) {
        return;
      }
      attachments.push({
        script: scriptPath,
        config: {}
      });
      index = attachments.length - 1;
    }
    let config = attachments[index].config;
    if (!config || Array.isArray(config) || typeof config !== 'object') {
      config = {};
    }
    const objectConfig = config as Record<string, unknown>;
    if (isSameDefault) {
      delete objectConfig[propName];
      attachments[index].config = Object.keys(objectConfig).length > 0 ? objectConfig : null;
    } else {
      objectConfig[propName] = cloned;
      attachments[index].config = objectConfig;
    }
    setScriptAttachments(host, attachments);
    return;
  }
  const target = host as ScriptHostWithConfig;
  const config =
    target.scriptConfig && !Array.isArray(target.scriptConfig) && typeof target.scriptConfig === 'object'
      ? ({ ...(target.scriptConfig as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (isSameDefault) {
    if (config) {
      delete config[propName];
    }
    target.scriptConfig = config && Object.keys(config).length > 0 ? config : null;
  } else {
    const objectConfig = config ?? {};
    objectConfig[propName] = cloned;
    target.scriptConfig = objectConfig;
  }
}

function writeScalarPropertyValue(
  host: ScriptHost,
  info: RuntimeScriptValueDeclaration & { name: string },
  value: unknown,
  scriptPath?: string,
  attachmentIndex?: number
) {
  writeConfigValue(host, info.name, value, readDefaultValue(info), scriptPath, attachmentIndex);
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
  scriptPath: string;
  attachmentIndex: number;
  propertyName: string;
  index: number;
  element: RuntimeScriptArrayElementDeclaration;
  constructor(
    host: ScriptHost,
    scriptPath: string,
    attachmentIndex: number,
    propertyName: string,
    index: number,
    element: RuntimeScriptArrayElementDeclaration
  ) {
    this.host = host;
    this.scriptPath = scriptPath;
    this.attachmentIndex = attachmentIndex;
    this.propertyName = propertyName;
    this.index = index;
    this.element = element;
  }
}

function getArrayValue(
  host: ScriptHost,
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  scriptPath?: string,
  attachmentIndex?: number
) {
  const value = readPropertyValue(host, info, scriptPath, attachmentIndex);
  return Array.isArray(value) ? cloneValue(value) : [];
}

function setArrayValue(
  host: ScriptHost,
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  value: unknown[],
  scriptPath?: string,
  attachmentIndex?: number
) {
  writeConfigValue(host, info.name, value, readDefaultValue(info), scriptPath, attachmentIndex);
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
    name: createArrayElementClassName(info, key),
    noTitle: true,
    getProps() {
      if (isScalarElementDeclaration(info.element)) {
        const scalarElement = info.element;
        return [
          {
            name: 'Value',
            type: getScalarPropertyType(scalarElement.type),
            options: getPropertyOptions(scalarElement),
            isHidden() {
              return !!scalarElement.hidden;
            },
            get(this: ScriptArrayElement, value) {
              const data = getArrayValue(this.host, info)[this.index];
              readScalarInto(value as any, scalarElement.type, data);
            },
            set(this: ScriptArrayElement, value) {
              const arr = getArrayValue(this.host, info);
              arr[this.index] = writeScalarFromInput(scalarElement.type, value as any);
              setArrayValue(this.host, info, arr);
            }
          }
        ] as PropertyAccessor<any>[];
      }
      const objectElement = info.element;
      return objectElement.fields.map(
        (field) =>
          ({
            name: field.name,
            type: getScalarPropertyType(field.type),
            options: getPropertyOptions(field),
            isHidden() {
              return !!field.hidden;
            },
            get(this: ScriptArrayElement, value) {
              const item = getArrayValue(this.host, info)[this.index];
              const data =
                item && typeof item === 'object' && !Array.isArray(item)
                  ? (item as Record<string, unknown>)[field.name]
                  : undefined;
              readScalarInto(value as any, field.type, data ?? readDefaultValue(field));
            },
            set(this: ScriptArrayElement, value) {
              const arr = getArrayValue(this.host, info);
              const current = arr[this.index];
              const next =
                current && typeof current === 'object' && !Array.isArray(current)
                  ? { ...(current as Record<string, unknown>) }
                  : ((readDefaultValue(objectElement) as Record<string, unknown>) ?? {});
              next[field.name] = writeScalarFromInput(field.type, value as any);
              arr[this.index] = next;
              setArrayValue(this.host, info, arr);
            }
          }) as PropertyAccessor<any>
      );
    }
  };
  getEngine().resourceManager.registerClass(serializationClass);
  arrayElementClassCache.set(key, serializationClass);
  return serializationClass;
}

function createScalarAccessor(
  info: Exclude<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  scriptPath: string,
  attachmentIndex: number,
  scriptGroup?: string
): PropertyAccessor<ScriptHost> {
  return {
    name: info.name,
    type: getScalarPropertyType(info.type),
    default: cloneValue(info.default),
    options: getPropertyOptions(info, scriptGroup),
    isHidden(this: ScriptHost) {
      return !this.script || !!info.hidden;
    },
    isPersistent(this: ScriptHost) {
      return !!this.script;
    },
    get(this: ScriptHost, value) {
      readScalarInto(value as any, info.type, readPropertyValue(this, info, scriptPath, attachmentIndex));
    },
    set(this: ScriptHost, value) {
      writeScalarPropertyValue(
        this,
        info,
        writeScalarFromInput(info.type, value as any),
        scriptPath,
        attachmentIndex
      );
    }
  };
}

function createObjectArrayAccessor(
  info: Extract<RuntimeScriptPropertyInfo, { type: 'object_array' }>,
  scriptPath: string,
  attachmentIndex: number,
  scriptGroup?: string
): PropertyAccessor<ScriptHost> {
  const elementClass = getArrayElementSerializationClass(info);
  return {
    name: info.name,
    type: 'object_array',
    default: cloneValue(info.default),
    options: {
      ...getPropertyOptions(info, scriptGroup),
      objectTypes: [elementClass.ctor],
      inlineObjectArray: true
    },
    isHidden(this: ScriptHost) {
      return !this.script || !!info.hidden;
    },
    isPersistent(this: ScriptHost) {
      return !!this.script;
    },
    isNullable() {
      return false;
    },
    get(this: ScriptHost, value) {
      const target = value as any;
      const arr = getArrayValue(this, info, scriptPath, attachmentIndex);
      target.object = arr.map(
        (_item, index) =>
          new (elementClass.ctor as unknown as {
            new (
              host: ScriptHost,
              scriptPath: string,
              attachmentIndex: number,
              propertyName: string,
              index: number,
              element: RuntimeScriptArrayElementDeclaration
            ): ScriptArrayElement;
          })(this, scriptPath, attachmentIndex, info.name, index, info.element)
      );
    },
    set(this: ScriptHost, value, index) {
      const target = value as any;
      const arr = getArrayValue(this, info, scriptPath, attachmentIndex);
      if (typeof index === 'number' && index >= 0 && target.object?.[0] instanceof ScriptArrayElement) {
        arr[index] = getArrayValue(this, info, scriptPath, attachmentIndex)[target.object[0].index];
      } else if (target.object) {
        const next: unknown[] = [];
        for (const item of target.object) {
          if (item instanceof ScriptArrayElement) {
            next.push(getArrayValue(this, info, scriptPath, attachmentIndex)[item.index]);
          }
        }
        setArrayValue(this, info, next, scriptPath, attachmentIndex);
        return;
      }
      setArrayValue(this, info, arr, scriptPath, attachmentIndex);
    },
    create(this: ScriptHost, _ctor, index) {
      const arr = getArrayValue(this, info, scriptPath, attachmentIndex);
      const insertIndex = Math.max(0, Math.min(index ?? arr.length, arr.length));
      arr.splice(insertIndex, 0, cloneValue(readDefaultValue(info.element)));
      setArrayValue(this, info, arr, scriptPath, attachmentIndex);
      return new (elementClass.ctor as unknown as {
        new (
          host: ScriptHost,
          scriptPath: string,
          attachmentIndex: number,
          propertyName: string,
          index: number,
          element: RuntimeScriptArrayElementDeclaration
        ): ScriptArrayElement;
      })(this, scriptPath, attachmentIndex, info.name, insertIndex, info.element);
    },
    add(this: ScriptHost, value, index) {
      const target = value as any;
      const arr = getArrayValue(this, info, scriptPath, attachmentIndex);
      const item = target.object?.[0] as ScriptArrayElement | undefined;
      const insertIndex = Math.max(0, Math.min(index ?? arr.length, arr.length));
      const nextValue =
        item instanceof ScriptArrayElement
          ? getArrayValue(this, info, scriptPath, attachmentIndex)[item.index]
          : cloneValue(readDefaultValue(info.element));
      arr.splice(insertIndex, 0, cloneValue(nextValue));
      setArrayValue(this, info, arr, scriptPath, attachmentIndex);
    },
    delete(this: ScriptHost, index) {
      const arr = getArrayValue(this, info, scriptPath, attachmentIndex);
      if (index >= 0 && index < arr.length) {
        arr.splice(index, 1);
        setArrayValue(this, info, arr, scriptPath, attachmentIndex);
      }
    }
  };
}

function createAccessor(
  info: RuntimeScriptPropertyInfo,
  scriptPath: string,
  attachmentIndex: number,
  scriptGroup?: string
): PropertyAccessor<ScriptHost> {
  return info.type === 'object_array'
    ? createObjectArrayAccessor(info, scriptPath, attachmentIndex, scriptGroup)
    : createScalarAccessor(info, scriptPath, attachmentIndex, scriptGroup);
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

function getScriptDisplayName(path: string) {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').pop() ?? normalized;
  return name.replace(/\.(ts|js)$/i, '') || normalized;
}

export async function getSingleScriptPropertyAccessors(
  host: unknown,
  scriptPath: string,
  attachmentIndex = -1,
  scriptGroup?: string
): Promise<PropertyAccessor<ScriptHost>[]> {
  if (!isScriptHost(host) || !scriptPath.trim()) {
    return [];
  }
  const cacheKey = `${scriptPath}::${attachmentIndex}::${scriptGroup ?? ''}`;
  if (propertyCache.has(cacheKey)) {
    return propertyCache.get(cacheKey)!;
  }
  const props = (await loadScriptPropertyInfo(scriptPath)).map((info) =>
    createAccessor(info, scriptPath, attachmentIndex, scriptGroup)
  );
  propertyCache.set(cacheKey, props);
  return props;
}

export async function getScriptPropertyAccessors(host: unknown): Promise<PropertyAccessor<ScriptHost>[]> {
  if (!isScriptHost(host)) {
    return [];
  }
  const attachments = (host as ScriptHostWithConfig).scripts ?? [];
  const scriptEntries = attachments
    .map((item, index) => ({ path: String(item?.script ?? '').trim(), index }))
    .filter((item) => !!item.path);
  const scriptPaths = scriptEntries.map((item) => item.path).filter((item) => !!item);
  if (scriptPaths.length === 0) {
    const scriptPath = host.script.trim();
    if (!scriptPath) {
      return [];
    }
    scriptPaths.push(scriptPath);
  }
  const cacheKey = scriptPaths.join('|');
  if (propertyCache.has(cacheKey)) {
    return propertyCache.get(cacheKey)!;
  }
  const multipleScripts = scriptPaths.length > 1;
  const props = (
    await Promise.all(
      (scriptEntries.length > 0 ? scriptEntries : [{ path: scriptPaths[0], index: 0 }]).map((entry) =>
        getSingleScriptPropertyAccessors(
          host,
          entry.path,
          entry.index,
          multipleScripts ? getScriptDisplayName(entry.path) : undefined
        )
      )
    )
  ).flat();
  propertyCache.set(cacheKey, props);
  return props;
}

export function clearScriptPropertyAccessorCache(path?: Nullable<string>) {
  if (path) {
    propertyCache.delete(path);
  } else {
    propertyCache.clear();
  }
}
