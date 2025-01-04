export type PropertyType =
  | 'bool'
  | 'int'
  | 'float'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'string'
  | 'rgb'
  | 'rgba'
  | 'object';
export type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
  object?: unknown;
};

export type PropertyAccessor<T = unknown> = {
  type: PropertyType;
  name: string;
  options?: { minValue: number; maxValue: number; speed?: number };
  enum?: { labels: string[]; values: (number | string)[] };
  objectTypes?: unknown[];
  default?: PropertyValue;
  get(this: T, value: PropertyValue): void;
  set(this: T, value: PropertyValue): void;
};

export type SerializableClass<T = unknown> = {
  ctor: any;
  className: string;
  parent?: SerializableClass<T>;
  createFunc?: (ctx?: any) => T;
  getProps: (obj: T) => PropertyAccessor<T>[];
};

export type SerializationInfo<T = unknown> = SerializableClass<T>[];
