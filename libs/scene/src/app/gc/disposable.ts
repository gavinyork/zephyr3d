import { GCManager } from './gcmanager';

/**
 * Represents an object that can be disposed
 * @public
 **/
export type Disposable = {
  dispose(): void;
};

/**
 * Reference management interface for disposable objects
 * @public
 */
export type Ref<T extends Disposable> = T & {
  /**
   * Increment reference count
   * @returns The original object
   */
  ref(): Ref<T>;
  /**
   * Decrement reference count
   * @returns The original object
   */
  unref(): Ref<T>;
};

/**
 * Create a reference-counted proxy for a disposable object
 * @param obj - Object to be reference counted
 * @returns Proxy with reference counting capabilities
 * @public
 */
export function makeRef<T extends Disposable>(obj: T): Ref<T> {
  return obj ? GCManager.getReference(obj) : null;
}

/**
 * Test whether an object is reference-counted
 * @param obj - Object to be test
 * @returns true If the object is reference-counted, otherwise false
 * @public
 */
export function isRef<T extends Disposable>(obj: T): obj is Ref<T> {
  return GCManager.isReference(obj);
}
