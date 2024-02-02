import { Primitive } from '../render/primitive';

/**
 * Base class for creation options of any kind of shapes
 * @public
 */
export interface ShapeCreationOptions {
  /** true if we need to calculate normals for the shape */
  needNormal?: boolean;
  /** true if we need to calculate tangents for the shape */
  needTangent?: boolean;
  /** true if we need to calculate texture coordinates for the shape */
  needUV?: boolean;
}

/**
 * Abstract base class for any kind of shapes
 * @public
 */
export abstract class Shape<T extends ShapeCreationOptions = ShapeCreationOptions> extends Primitive {
  /** @internal */
  protected _options: T;
  /**
   * Creates an instance of shape
   * @param options - The creation options
   */
  constructor(options?: T) {
    super();
    this._options = this.createDefaultOptions();
    this.create(options);
  }
  /** @internal */
  create(options?: T): boolean {
    if (options) {
      this._options = this.createDefaultOptions();
      Object.assign(this._options, options);
    }
    return this._create();
  }
  /** @internal */
  protected createDefaultOptions(): T {
    return {
      needNormal: true,
      needTangent: false,
      needUV: true
    } as T;
  }
  /** @internal */
  protected abstract _create(): boolean;
}

