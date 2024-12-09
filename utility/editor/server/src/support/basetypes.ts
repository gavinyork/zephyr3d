export type Nullable<T> = T | null;

export type Primitive = undefined | null | boolean | number | string | Function;

export type Immutable<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
  ? ReadonlyArray<U>
  : DeepImmutable<T>;

export type DeepImmutable<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
  ? DeepImmutableArray<U>
  : DeepImmutableObject<T>;

export type DeepImmutableObject<T> = {
  readonly [K in keyof T]: DeepImmutable<T[K]>;
};

export interface DeepImmutableArray<T> extends ReadonlyArray<DeepImmutable<T>> {}
