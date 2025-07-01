import type { GenericConstructor } from '@zephyr3d/base';
import type { EmbeddedAssetInfo } from './asset/asset';

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
  | 'command';

export type PropertyValue = {
  num?: number[];
  str?: string[];
  bool?: boolean[];
  object?: unknown[];
};

export type PropEdit = 'aabb' | 'quaternion';

export type PropertyAccessor<T = unknown> = {
  type: PropertyType;
  name: string;
  label?: string;
  group?: string;
  phase?: number;
  hidden?: boolean;
  options?: { minValue: number; maxValue: number; speed?: number };
  enum?: { labels: string[]; values: (number | string)[] };
  instance?: boolean;
  objectTypes?: GenericConstructor[];
  readonly?: boolean;
  default?: any;
  animatable?: boolean;
  persistent?: boolean;
  edit?: PropEdit;
  get: (this: T, value: PropertyValue) => void;
  set?: (this: T, value: PropertyValue) => void | Promise<void>;
  isValid?: (this: T) => boolean;
  isNullable?: (this: T) => boolean;
  command?: (this: T, index: number) => boolean;
  getDefaultValue?: (this: T) => any;
};

export type SerializableClass = {
  ctor: GenericConstructor;
  parent?: GenericConstructor;
  createFunc?: (
    ctx?: any,
    init?: any
  ) => { obj: any; loadProps?: boolean } | Promise<{ obj: any; loadProps?: boolean }>;
  getInitParams?: (obj: any) => any;
  getProps: () => PropertyAccessor<any>[];
  getAssets?: (obj: any) => string[];
  getEmbeddedAssets?: (obj: any) => (EmbeddedAssetInfo | Promise<EmbeddedAssetInfo>)[];
};

export type SerializationInfo = SerializableClass[];
