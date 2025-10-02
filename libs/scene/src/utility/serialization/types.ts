import type { GenericConstructor } from '@zephyr3d/base';

/**
 * Enumerates supported data types for serializable properties.
 *
 * This type informs serializers/editors how to interpret and encode values.
 *
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
 * Container for a serializable property's value.
 *
 * Values are carried in typed arrays (even for single values) to support
 * both scalar and array-like properties in a unified shape.
 *
 * Conventions:
 * - `num` carries numeric data for types like `int`, `float`, `vec*`, `int*`, `rgb`, `rgba`
 * - `str` carries string data for `string`
 * - `bool` carries boolean data for `bool`
 * - `object` carries references/instances for `object`, `object_array`, `embedded`
 *
 * Only the relevant field(s) for the property's {@link PropertyType} will be populated.
 *
 * @public
 */
export type PropertyValue = {
  /** Numeric lane(s) for numeric, vector, or color types. */
  num?: number[];
  /** String lane(s) for text properties. */
  str?: string[];
  /** Boolean lane(s) for boolean properties. */
  bool?: boolean[];
  /** Object lane(s) for object references or embedded objects. */
  object?: object[];
};

/**
 * Editor-oriented edit types that augment how a property is presented/edited.
 *
 * This is orthogonal to {@link PropertyType} and is purely an editor hint.
 *
 * @public
 */
export type PropEdit = 'aabb' | 'quaternion' | 'proptrack';

/**
 * Additional options controlling how a property is displayed, constrained, and edited.
 *
 * These options are consumed primarily by an editor/inspector UI, but may
 * also influence validation and tooling behavior.
 *
 * @public
 */
export type PropertyAccessorOptions = {
  /** Human-friendly label for UI. Defaults to `name` if omitted. */
  label?: string;
  /** Logical grouping/category in UI. */
  group?: string;
  /** Editor presentation hint (e.g., quaternion gizmo, animation track). */
  edit?: PropEdit;
  /** Minimum numeric value (for sliders/spinners). */
  minValue?: number;
  /** Maximum numeric value (for sliders/spinners). */
  maxValue?: number;
  /** Step/speed for numeric editing UI. */
  speed?: number;
  /** Whether the property can be animated/keyframed. */
  animatable?: boolean;
  /** Allowed MIME types for file-picker-like editors. */
  mimeTypes?: string[];
  /** Allowed constructor types when choosing/creating object references. */
  objectTypes?: GenericConstructor[];
  /**
   * Optional enumeration metadata.
   * `labels[i]` corresponds to `values[i]`.
   */
  enum?: { labels: string[]; values: unknown[] };
};

/**
 * Descriptor for a serializable property of a class/type.
 *
 * This binds together:
 * - Metadata: `type`, `name`, `default`, `readonly`, `persistent`, `options`
 * - Accessors: `get`, `set`, `add`, `delete`, `create` for manipulating the underlying object state
 * - Predicates: `isValid`, `isNullable`, `isHidden` to control UI and validation
 * - Commands: `command` for action-style properties (`type: 'command'`)
 * - Utilities: `getDefaultValue` to compute defaults dynamically
 *
 * The accessors are invoked with `this` bound to the owning object instance.
 *
 * @typeParam T - The instance type that owns the property.
 * @public
 */
export type PropertyAccessor<T = object> = {
  /** The storage/serialization data type. */
  type: PropertyType;
  /** Unique property name (stable identifier for tooling/serialization). */
  name: string;
  /**
   * Optional evaluation phase/order hint (lower runs earlier).
   * Useful for staged initialization or batched updates in editors.
   */
  phase?: number;
  /** If true, the property is read-only in UI and programmatic setters may be disallowed. */
  readonly?: boolean;
  /** Default value used if none is provided. Can be a primitive, array, or object. */
  default?: any;
  /**
   * If true, the property is persisted during save/serialize.
   * Non-persistent properties may be computed or session-only.
   */
  persistent?: boolean;
  /** Editor and validation options for this property. */
  options?: PropertyAccessorOptions;
  /**
   * Reads the current value from `this` into the provided `value` container.
   *
   * Implementations should fully populate the appropriate lane(s) (e.g., `num`, `str`, etc.)
   * according to the property's {@link PropertyType}.
   *
   * @param value - Output container to be filled by the getter.
   */
  get: (this: T, value: PropertyValue) => void;
  /**
   * Writes an incoming value to `this`.
   *
   * For array-like properties, `index` can target a specific element.
   * Implementations should read from the appropriate lane(s) of `value` according to {@link PropertyType}.
   *
   * @param value - Input container carrying the new value.
   * @param index - Optional element index for array-like properties.
   * @returns Optionally `Promise<void>` if asynchronous work is required.
   */
  set?: (this: T, value: PropertyValue, index?: number) => void | Promise<void>;
  /**
   * Creates a new embedded/contained object for object-like properties.
   *
   * Typically used for `embedded` or `object_array` to instantiate an element.
   *
   * @param ctor - Constructor to instantiate.
   * @param index - Target index where the new object will be inserted.
   * @returns The newly created object instance.
   */
  create?: (this: T, ctor: GenericConstructor, index: number) => object;
  /**
   * Deletes an element from an array-like property or clears a value.
   *
   * @param index - Target element index.
   * @returns Optionally `Promise<void>` if asynchronous work is required.
   */
  delete?: (this: T, index: number) => void | Promise<void>;
  /**
   * Adds a new element/value to an array-like property.
   *
   * If `index` is omitted, implementations may append to the end.
   *
   * @param value - The value to add (read appropriate lane(s) per {@link PropertyType}).
   * @param index - Optional insertion index.
   * @returns Optionally `Promise<void>` if asynchronous work is required.
   */
  add?: (this: T, value: PropertyValue, index?: number) => void | Promise<void>;
  /**
   * Validates the current state of `this` with respect to this property.
   *
   * Returning `false` may block serialization or UI confirmation.
   *
   * @returns `true` if valid, otherwise `false`.
   */
  isValid?: (this: T) => boolean;
  /**
   * Indicates whether a specific element or slot may be `null` or `undefined`.
   *
   * Applies to array-like or optional properties.
   *
   * @param index - Target element index.
   * @returns `true` if nullable, otherwise `false`.
   */
  isNullable?: (this: T, index: number) => boolean;
  /**
   * Controls visibility of a specific element or the property in UI.
   *
   * @param index - Target element index.
   * @param obj - Value at index
   * @returns `true` if hidden, otherwise `false`.
   */
  isHidden?: (this: T, index: number, obj?: unknown) => boolean;
  /**
   * Executes a command-style property.
   *
   * Only meaningful for `type: 'command'`. Return value may indicate success or toggle state.
   *
   * @param index - Optional command index for multi-command groups.
   * @returns Command result, commonly a boolean for toggle-like actions.
   */
  command?: (this: T, index: number) => boolean;
  /**
   * Supplies a default value dynamically at runtime.
   *
   * If provided, this takes precedence over the static `default` field.
   */
  getDefaultValue?: (this: T) => any;
};

/**
 * Descriptor for a serializable class/type.
 *
 * This defines how a class is identified, constructed, and inspected for properties.
 * Editors and serializers can use this metadata to instantiate objects, load initial
 * parameters, and enumerate property accessors.
 *
 * @public
 */
export type SerializableClass = {
  /** Concrete constructor for the serializable class. */
  ctor: GenericConstructor;
  /** Optional parent/superclass constructor to represent inheritance in tooling. */
  parent?: GenericConstructor;
  /** If true, suppresses title rendering in UI for compact displays. */
  noTitle?: boolean;
  /** Display name used by tooling and editors. */
  name: string;
  /**
   * Custom factory to create an instance and optionally control property loading.
   *
   * If `loadProps` is `false`, the caller may skip default property loading
   * (useful for lazy or staged initialization).
   *
   * @param ctx - Optional construction context (editor/runtime-specific).
   * @param init - Optional initialization payload.
   * @returns The created object and a `loadProps` hint.
   */
  createFunc?: (
    ctx?: any,
    init?: any
  ) => { obj: any; loadProps?: boolean } | Promise<{ obj: any; loadProps?: boolean }>;
  /**
   * Extracts initialization parameters from an instance suitable for re-creation.
   *
   * This is the inverse of `createFunc`'s `init` argument, enabling round-trip
   * serialization of constructor/initializer data.
   *
   * @param obj - The instance to introspect.
   * @returns An initialization payload (serializable).
   */
  getInitParams?: (obj: any) => any;
  /**
   * Enumerates property accessors for this class.
   *
   * The returned list defines the full set of serializable/editor-visible properties.
   *
   * @returns Array of property accessors.
   */
  getProps: () => PropertyAccessor<any>[];
};
