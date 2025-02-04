/**
 * Represents an object that can be disposed
 * @public
 **/
export interface Disposable {
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Maps disposable objects to their reference counts.
 * @private
 */
const objectReferenceMap = new WeakMap<Disposable, number>();

/**
 * Maps disposable objects to their weak references.
 * @private
 */
const weakRefMap = new WeakMap<Disposable, Set<WeakRef<Disposable>>>();

/**
 * Holds objects that are pending disposal.
 * @private
 */
const disposalQueue = new Set<Disposable>();

/**
 * Processes all pending disposals from the previous frame.
 * This should be called at the beginning of each frame
 * @public
 */
export function flushPendingDisposals() {
  for (const obj of disposalQueue) {
    obj.dispose();
    weakRefMap.get(obj)?.forEach((weakRef) => {
      weakRef.dispose();
    });
  }
  disposalQueue.clear();
}

export function retainObject(obj: Disposable) {
  if (obj) {
    const ref = objectReferenceMap.get(obj) ?? 0;
    objectReferenceMap.set(obj, ref + 1);
    if (ref === 0) {
      disposalQueue.delete(obj);
    }
  }
}

export function releaseObject(obj: Disposable) {
  if (obj) {
    let refcount = objectReferenceMap.get(obj) ?? 0;
    if (refcount > 0) {
      refcount--;
      if (refcount > 0) {
        objectReferenceMap.set(obj, refcount);
      } else {
        objectReferenceMap.delete(obj);
        disposalQueue.add(obj);
      }
    }
  }
}
/**
 * A reference-counting wrapper for disposable objects.
 *
 * @public
 * @template T - Type of the wrapped disposable object
 */
export class Ref<T extends Disposable> {
  /** @internal */
  private _object: T;
  /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */
  constructor(obj?: T) {
    this._object = obj ?? null;
    retainObject(this._object);
  }
  /**
   * Gets the currently referenced object.
   * @returns The referenced object, or null if none is set
   */
  get() {
    return this._object;
  }
  /**
   * Sets a new object reference, releasing the previous one if it exists.
   * @param obj - The new object to reference
   */
  set(obj: T) {
    if (obj !== this._object) {
      releaseObject(this._object);
      this._object = obj ?? null;
      retainObject(this._object);
    }
  }
  /**
   * Releases the reference and cleans up resources.
   */
  dispose() {
    releaseObject(this._object);
    this._object = null;
  }
}

export class WeakRef<T extends Disposable> {
  /** @internal */
  private _object: T;
  /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */
  constructor(obj?: T) {
    this._object = obj ?? null;
    this.retain();
  }
  /**
   * Gets the currently referenced object.
   * @returns The referenced object, or null if none is set
   */
  get() {
    if (this._object?.disposed) {
      this.dispose();
    }
    return this._object;
  }
  /**
   * Sets a new object reference, releasing the previous one if it exists.
   * @param obj - The new object to reference
   */
  set(obj: T) {
    if (obj !== this._object) {
      this.release();
      this._object = obj ?? null;
      this.retain();
    }
  }
  /**
   * Releases the reference and cleans up resources.
   */
  dispose() {
    this.release();
  }
  /** @internal */
  private retain() {
    const weakRefList = weakRefMap.get(this._object);
    if (weakRefList) {
      weakRefList.add(this);
    } else {
      weakRefMap.set(this._object, new Set([this]));
    }
  }
  /** @internal */
  private release() {
    if (this._object) {
      weakRefMap.get(this._object)?.delete(this);
      this._object = null;
    }
  }
}
