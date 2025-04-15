import { EmbeddedAssetInfo } from './asset/asset';

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
  phase?: number;
  hidden?: boolean;
  options?: { minValue: number; maxValue: number; speed?: number };
  enum?: { labels: string[]; values: (number | string)[] };
  instance?: boolean;
  objectTypes?: unknown[];
  default?: any;
  nullable?: boolean;
  persistent?: boolean;
  edit?: PropEdit;
  get: (this: T, value: PropertyValue) => void;
  set?: (this: T, value: PropertyValue) => void | Promise<void>;
  isValid?: (this: T) => boolean;
  command?: (this: T, index: number) => boolean;
  getDefaultValue?: (this: T) => any;
};

export type SerializableClass = {
  ctor?: any;
  className?: string;
  parent?: SerializableClass;
  createFunc?: (
    ctx?: any,
    init?: any
  ) => { obj: any; loadProps?: boolean } | Promise<{ obj: any; loadProps?: boolean }>;
  getObject?: (obj: any) => any;
  getInitParams?: (obj: any) => any;
  getProps: (obj: any) => PropertyAccessor<any>[];
  getEmbeddedAssets?: (obj: any) => (EmbeddedAssetInfo | Promise<EmbeddedAssetInfo>)[];
};

export type SerializationInfo = SerializableClass[];
