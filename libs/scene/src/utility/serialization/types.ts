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
  | 'object'
  | 'object_array';
export type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
  object?: unknown[];
};

export type PropertyAccessor<T = unknown> = {
  type: PropertyType;
  name: string;
  options?: { minValue: number; maxValue: number; speed?: number };
  enum?: { labels: string[]; values: (number | string)[] };
  objectTypes?: unknown[];
  default?: PropertyValue;
  get: (this: T, value: PropertyValue) => void;
  set?: (this: T, value: PropertyValue) => void;
  isValid?: (this: T) => boolean;
};

export type SerializableClass = {
  ctor: any;
  className: string;
  parent?: SerializableClass;
  createFunc?: (ctx?: any) => any;
  getProps: (obj: any) => PropertyAccessor<any>[];
};

export type SerializationInfo = SerializableClass[];
