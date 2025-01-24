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
export type Reference<T extends Disposable> = T & {
  /**
   * Increment reference count
   * @returns The original object
   */
  ref(): T;
  /**
   * Decrement reference count
   * @returns The original object
   */
  unref(): T;
};

/**
 * Create a reference-counted proxy for a disposable object
 * @param obj - Object to be reference counted
 * @returns Proxy with reference counting capabilities
 */
export function makeRef<T extends Disposable>(obj: T): Reference<T> {
  return obj ? GCManager.getReference(obj) : null;
}
