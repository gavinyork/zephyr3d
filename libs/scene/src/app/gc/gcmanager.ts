import type { Disposable, Reference } from './disposable';

/**
 * Manages disposal of objects
 * @public
 */
export class GCManager {
  /**
   * Queue of objects pending disposal
   * @internal
   **/
  private static _disposalQueue: Set<Disposable> = new Set();
  private static _referenceMap: WeakMap<Disposable, Disposable> = new WeakMap();
  /**
   * Get or create a unique reference for an object
   * @param obj - Original disposable object
   * @returns Unique reference proxy
   */
  static getReference<T extends Disposable>(obj: T): Reference<T> {
    let ref = this._referenceMap.get(obj) as Reference<T>;
    if (!ref) {
      ref = this.createReference(obj);
      this._referenceMap.set(obj, ref);
    }
    return ref;
  }
  /**
   * Create reference proxy with reference counting
   * @param obj - Original object to be reference counted
   * @returns Proxy with reference counting capabilities
   */
  private static createReference<T extends Disposable>(obj: T): Reference<T> {
    let refcount = 0;
    return new Proxy(obj, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        if (prop === 'ref') {
          return () => {
            refcount++;
            return target;
          };
        } else if (prop === 'unref') {
          return function () {
            if (refcount > 0) {
              refcount--;
              if (refcount === 0) {
                GCManager.dispose(target);
              }
            }
            return target;
          };
        }
        return undefined;
      }
    }) as Reference<T>;
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
