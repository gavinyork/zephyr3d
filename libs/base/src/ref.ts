import { Observable, type IEventTarget } from './event';
import type { Nullable } from './utils';

/**
 * Represents an object that can be disposed
 * @public
 **/
export interface IDisposable extends IEventTarget<{ dispose: [] }> {
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Base class for any Disposable class
 * @public
 */
export class Disposable extends Observable<{ dispose: [] }> implements IDisposable {
  private _disposed: boolean;
  constructor() {
    super();
    this._disposed = false;
  }
  get disposed() {
    return this._disposed;
  }
  dispose() {
    if (!this._disposed) {
      this.dispatchEvent('dispose');
      this.onDispose();
      this._disposed = true;
    }
  }
  protected onDispose() {}
}

/**
 * Maps disposable objects to their reference counts.
 * @internal
 */
const objectReferenceMap = new WeakMap<IDisposable, number>();

/**
 * Maps disposable objects to their weak references.
 * @internal
 */
const weakRefMap = new WeakMap<IDisposable, Set<DWeakRef<IDisposable>>>();

/**
 * Holds objects that are pending disposal.
 * @internal
 */
const disposalQueue = new Set<IDisposable>();

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

/**
 * Retains a disposable object
 * @param obj - Object to retain
 * @public
 *
 * @remarks
 * Retains an object will increase the reference counter for this object
 */
export function retainObject(obj: Nullable<IDisposable>) {
  if (obj) {
    const ref = objectReferenceMap.get(obj) ?? 0;
    objectReferenceMap.set(obj, ref + 1);
    if (ref === 0) {
      disposalQueue.delete(obj);
    }
  }
}

/**
 * Releases a disposable object
 * @param obj - Object to release
 * @public
 *
 * @remarks
 * Releases an object will decrease the reference counter for this object.
 * If reference counter become zero, the object will be disposed at next frame.
 */
export function releaseObject(obj: Nullable<IDisposable>) {
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
 */
export class DRef<T extends IDisposable> {
  /** @internal */
  private _object: Nullable<T>;
  /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */
  constructor(obj?: Nullable<T>) {
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
  set(obj: Nullable<T>) {
    if (obj !== this._object) {
      releaseObject(this._object);
      this._object = obj;
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

/**
 * A weak-reference-counting wrapper for disposable objects.
 *
 * @public
 */
export class DWeakRef<T extends IDisposable> {
  /** @internal */
  private _object: Nullable<T>;
  /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */
  constructor(obj?: Nullable<T>) {
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
  set(obj: Nullable<T>) {
    if (obj !== this._object) {
      this.release();
      this._object = obj;
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
    if (this._object) {
      const weakRefList = weakRefMap.get(this._object);
      if (weakRefList) {
        weakRefList.add(this);
      } else {
        weakRefMap.set(this._object, new Set([this]));
      }
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
