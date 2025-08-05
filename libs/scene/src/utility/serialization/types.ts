import type { GenericConstructor } from '@zephyr3d/base';

/**
 * Data types of serializable properties
 * @public
 */
export type PropertyType =
  | 'bool'
  | 'int'
  | 'float'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'int2'
  | 'int3'
  | 'int4'
  | 'string'
  | 'rgb'
  | 'rgba'
  | 'object'
  | 'object_array'
  | 'embedded'
  | 'command';

/**
 * Object type that holds a value of serializable property
 * @public
 */
export type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
  object?: object[];
};

/**
 * Edit types of serializable properties which is used by editor
 * @public
 */
export type PropEdit = 'aabb' | 'quaternion' | 'proptrack';

export type PropertyAccessorOptions = {
  label?: string;
  group?: string;
  edit?: PropEdit;
  minValue?: number;
  maxValue?: number;
  speed?: number;
  animatable?: boolean;
  mimeTypes?: string[];
  objectTypes?: GenericConstructor[];
  enum?: { labels: string[]; values: unknown[] };
};

/**
 * Object type which defines a serializable property
 * @public
 */
export type PropertyAccessor<T = object> = {
  type: PropertyType;
  name: string;
  phase?: number;
  readonly?: boolean;
  default?: any;
  persistent?: boolean;
  options?: PropertyAccessorOptions;
  get: (this: T, value: PropertyValue) => void;
  set?: (this: T, value: PropertyValue, index?: number) => void | Promise<void>;
  create?: (this: T, ctor: GenericConstructor, index: number) => object;
  delete?: (this: T, index: number) => object;
  add?: (this: T, value: PropertyValue, index?: number) => void | Promise<void>;
  isValid?: (this: T) => boolean;
  isNullable?: (this: T, index: number) => boolean;
  isHidden?: (this: T, index: number) => boolean;
  command?: (this: T, index: number) => boolean;
  getDefaultValue?: (this: T) => any;
};

/**
 * Object type which defines a serializable class
 * @public
 */
export type SerializableClass = {
  ctor: GenericConstructor;
  parent?: GenericConstructor;
  noTitle?: boolean;
  createFunc?: (
    ctx?: any,
    init?: any
  ) => { obj: any; loadProps?: boolean } | Promise<{ obj: any; loadProps?: boolean }>;
  getInitParams?: (obj: any) => any;
  getProps: () => PropertyAccessor<any>[];
};
