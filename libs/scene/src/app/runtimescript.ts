import type { GenericConstructor, IDisposable, Nullable } from '@zephyr3d/base';

/**
 * Supported serialized field types for runtime script parameters.
 *
 * @public
 */
export type RuntimeScriptPropertyType =
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
  | 'node'
  | 'object_array';

/**
 * Runtime script property types that can be used as a single value or array element.
 *
 * @public
 */
export type RuntimeScriptValueType = Exclude<RuntimeScriptPropertyType, 'object_array'>;

/**
 * Additional editor hints for runtime script parameters.
 *
 * @public
 */
export type RuntimeScriptPropertyOptions = {
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

/**
 * Decorator configuration for a serialized runtime script parameter element.
 *
 * This shape is used for scalar values and for `object_array.element`.
 *
 * @public
 */
export type RuntimeScriptValueDeclaration = RuntimeScriptPropertyOptions & {
  type: RuntimeScriptValueType;
  default?: unknown;
};

/**
 * Decorator configuration for an array-typed runtime script parameter.
 *
 * @public
 */
export type RuntimeScriptArrayDeclaration = RuntimeScriptPropertyOptions & {
  type: 'object_array';
  element: RuntimeScriptValueDeclaration;
  default?: unknown[];
};

/**
 * Decorator configuration for a serialized runtime script parameter.
 *
 * @public
 */
export type RuntimeScriptPropertyDeclaration = RuntimeScriptValueDeclaration | RuntimeScriptArrayDeclaration;

/**
 * Resolved runtime script parameter metadata.
 *
 * @public
 */
export type RuntimeScriptPropertyInfo = RuntimeScriptPropertyDeclaration & {
  name: string;
};

/**
 * Serialized runtime script configuration payload.
 *
 * @public
 */
export type RuntimeScriptConfig = Record<string, unknown>;

const runtimeScriptPropertiesKey = Symbol('zephyr3d.runtimeScriptProperties');

function cloneRuntimeScriptValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneRuntimeScriptValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneRuntimeScriptValue(item);
    }
    return result as T;
  }
  return value;
}

function getOwnRuntimeScriptProperties(ctor: GenericConstructor) {
  return ((ctor as any)[runtimeScriptPropertiesKey] ?? []) as RuntimeScriptPropertyInfo[];
}

/**
 * Marks a runtime script field as configurable and serializable in editor/runtime tooling.
 *
 * @param options - Metadata describing how the field should be edited and serialized.
 * @returns A property decorator.
 *
 * @public
 */
export function scriptProp(options: RuntimeScriptPropertyDeclaration): PropertyDecorator {
  return (target, propertyKey) => {
    if (typeof propertyKey !== 'string') {
      throw new Error('Runtime script property name must be a string');
    }
    const ctor = target.constructor as GenericConstructor;
    const own = getOwnRuntimeScriptProperties(ctor).slice();
    const normalized: RuntimeScriptPropertyInfo =
      options.type === 'object_array'
        ? {
            ...options,
            default: (cloneRuntimeScriptValue(options.default) as unknown[]) ?? [],
            name: propertyKey
          }
        : {
            ...options,
            default: cloneRuntimeScriptValue(options.default),
            name: propertyKey
          };
    const index = own.findIndex((item) => item.name === propertyKey);
    if (index >= 0) {
      own[index] = normalized;
    } else {
      own.push(normalized);
    }
    Object.defineProperty(ctor, runtimeScriptPropertiesKey, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: own
    });
  };
}

/**
 * Gets the serialized parameter metadata declared on a runtime script class.
 *
 * Inheritance is supported: base-class metadata is returned before derived-class metadata,
 * and derived declarations override base declarations with the same property name.
 *
 * @param ctor - Runtime script constructor.
 * @returns Declared parameter metadata.
 *
 * @public
 */
export function getRuntimeScriptProperties(ctor: GenericConstructor): RuntimeScriptPropertyInfo[] {
  const chain: GenericConstructor[] = [];
  let current: any = ctor;
  while (typeof current === 'function' && current !== RuntimeScript && current !== Function.prototype) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }
  const merged = new Map<string, RuntimeScriptPropertyInfo>();
  for (const type of chain) {
    for (const prop of getOwnRuntimeScriptProperties(type)) {
      const normalized =
        prop.type === 'object_array'
          ? ({
              ...prop,
              default: (cloneRuntimeScriptValue(prop.default) as unknown[]) ?? []
            } satisfies RuntimeScriptPropertyInfo)
          : ({
              ...prop,
              default: cloneRuntimeScriptValue(prop.default)
            } satisfies RuntimeScriptPropertyInfo);
      merged.set(prop.name, normalized);
    }
  }
  return [...merged.values()];
}

/**
 * Merges user-provided script configuration with declared defaults.
 *
 * Only decorated fields are included in the result.
 *
 * @param ctor - Runtime script constructor.
 * @param config - Serialized configuration payload.
 * @returns Normalized configuration object.
 *
 * @public
 */
export function normalizeRuntimeScriptConfig(
  ctor: GenericConstructor,
  config?: Nullable<RuntimeScriptConfig>
): RuntimeScriptConfig {
  const result: RuntimeScriptConfig = {};
  for (const prop of getRuntimeScriptProperties(ctor)) {
    if (config && Object.prototype.hasOwnProperty.call(config, prop.name)) {
      result[prop.name] = cloneRuntimeScriptValue(config[prop.name]);
    } else if (prop.default !== undefined) {
      result[prop.name] = cloneRuntimeScriptValue(prop.default);
    }
  }
  return result;
}

/**
 * Applies normalized configuration values onto a runtime script instance.
 *
 * Values are assigned before lifecycle hooks such as `onCreated()` run.
 *
 * @param instance - Runtime script instance.
 * @param config - Serialized configuration payload.
 *
 * @public
 */
export function applyRuntimeScriptConfig<T extends RuntimeScript<any>>(
  instance: T,
  config?: Nullable<RuntimeScriptConfig>
) {
  const normalized = normalizeRuntimeScriptConfig(instance.constructor as GenericConstructor, config);
  for (const [key, value] of Object.entries(normalized)) {
    (instance as Record<string, unknown>)[key] = cloneRuntimeScriptValue(value);
  }
}

/**
 * Base class for runtime scripts that can be attached to a host object.
 *
 * Lifecycle overview:
 * - onCreated(): Called once per script instance right after construction,
 *   before any host is attached.
 * - onAttached(host): Called each time this instance is attached to a host.
 * - onUpdate(deltaTime, elapsedTime): Called every frame/tick while attached.
 * - onDetached(host): Called when detached from a host.
 * - onDestroy(): Called when the instance is no longer attached to any host
 *   and is about to be discarded.
 *
 * Notes:
 * - Hooks may return a Promise to perform asynchronous work (e.g., asset loading).
 * - The generic host type `T` can be `IDisposable` or `null`. If `null`, the script
 *   may operate without a concrete host.
 *
 * @typeParam T - The host type that this script attaches to. Typically implements `IDisposable`.
 * @public
 */
export class RuntimeScript<T extends IDisposable | null> {
  /**
   * Gets merged serialized property metadata for this runtime script class.
   *
   * @returns Declared parameter metadata for the current class.
   */
  static getScriptProperties(this: GenericConstructor) {
    return getRuntimeScriptProperties(this);
  }
  /**
   * Called once after construction, before the first attachment to a host.
   *
   * Use this to initialize internal state, allocate resources, or kick off
   * asynchronous loading needed by the script.
   *
   * @returns Optionally a Promise to await initialization.
   */
  onCreated(): void | Promise<void> {}
  /**
   * Called when the script is attached to a host.
   *
   * This may be called multiple times if the same instance attaches to different
   * hosts over its lifetime.
   *
   * @param _host - The host the script is being attached to.
   * @returns Optionally a Promise to await asynchronous setup.
   */
  onAttached(_host: Nullable<T>): void | Promise<void> {}
  /**
   * Called every update/tick while the script is active.
   *
   * Typical usage includes per-frame logic, animation, and input handling.
   *
   * @param _deltaTime - Time since last update in seconds.
   * @param _elapsedTime - Total elapsed time since start in seconds.
   */
  onUpdate(_deltaTime: number, _elapsedTime: number) {}
  /**
   * Called when the script is detached from a host.
   *
   * Use this to stop host-specific behaviors and release host-bound resources.
   *
   * @param _host - The host the script is being detached from.
   */
  onDetached(_host: T) {}
  /**
   * Called when the script has no remaining hosts and is about to be discarded.
   *
   * Use this to release global resources and finalize the script's lifecycle.
   * This is the terminal lifecycle hook for an instance.
   */
  onDestroy() {}
}
