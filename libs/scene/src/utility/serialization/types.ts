import { GenericConstructor } from '@zephyr3d/base';

export type PropertyType = 'bool' | 'int' | 'float' | 'vec2' | 'vec3' | 'vec4' | 'string' | 'rgb' | 'rgba';
export type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
};

export type PropertyAccessor<T = unknown> = {
  type: PropertyType;
  name: string;
  options?: { minValue: number; maxValue: number; speed: number };
  enum?: { labels: string[]; values: (number | string)[] };
  default?: PropertyValue;
  get(this: T, value: PropertyValue): void;
  set(this: T, value: PropertyValue): void;
};

export type SerializableClass<T = unknown> = {
  ctor: GenericConstructor<T>;
  className: string;
  parent?: SerializableClass<T>;
  createFunc?: (ctx: any) => T;
  getProps: () => PropertyAccessor<T>[];
};

export type SerializationInfo<T = unknown> = SerializableClass<T>[];
