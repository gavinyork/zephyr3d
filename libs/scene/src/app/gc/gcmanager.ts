import type { Disposable, Ref } from './disposable';

/**
 * Manages disposal of objects
 * @public
 */
export class GCManager {
  private static _disposalQueue: Set<Disposable> = new Set();
  private static _referenceMap: WeakMap<Disposable, Disposable> = new WeakMap();
  /**
   * Get or create a unique reference for an object
   * @param obj - Original disposable object
   * @returns Unique reference proxy
   */
  static getReference<T extends Disposable>(obj: T): Ref<T> {
    if (!obj) {
      return null;
    }
    let ref = typeof obj['ref'] === 'function' ? (obj as Ref<T>) : (this._referenceMap.get(obj) as Ref<T>);
    if (!ref) {
      ref = this.createReference(obj);
      this._referenceMap.set(obj, ref);
    }
    return ref;
  }
  /**
   * Test whether an object is reference-counted
   * @param obj - Object to be test
   * @returns true If the object is reference-counted, otherwise false
   */
  static isReference<T extends Disposable>(obj: T): obj is Ref<T> {
    return obj && typeof obj['ref'] === 'function';
  }
  /**
   * Create reference proxy with reference counting
   * @param obj - Original object to be reference counted
   * @returns Proxy with reference counting capabilities
   */
  private static createReference<T extends Disposable>(obj: T): Ref<T> {
    let refcount = 0;
    const ref = new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (prop === 'ref') {
          return () => {
            if (refcount === 0) {
              GCManager._disposalQueue.delete(target);
            }
            refcount++;
            return target;
          };
        } else if (prop === 'unref') {
          return () => {
            if (refcount > 0) {
              refcount--;
              if (refcount === 0) {
                GCManager.dispose(target);
              }
            }
            return target;
          };
        } else if (prop === 'refobj') {
          return () => target;
        }
        return undefined;
      }
    }) as Ref<T>;
    // Add new reference to disposal queue
    GCManager.dispose(obj);

    return ref;
  }
  /**
   * Add an object to disposal queue
   * @param obj - Object to be disposed
   */
  static dispose(obj: Disposable) {
    if (obj) {
      this._disposalQueue.add(obj);
    }
  }
  /**
   * Process and clear disposal queue
   */
  static process() {
    for (const obj of this._disposalQueue) {
      obj.dispose();
    }
    this._disposalQueue.clear();
  }
}
