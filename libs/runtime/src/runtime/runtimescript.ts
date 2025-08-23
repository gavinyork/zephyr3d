import type { IDisposable } from '@zephyr3d/base';

/**
 * Base class for runtime scripts that can be attached to a host object.
 *
 * Lifecycle overview:
 * - onCreated(): Called once per script instance right after construction,
 *   before any host is attached.
 * - onAttached(host): Called each time this instance is attached to a host.
 * - onUpdate(deltaTime, elapsedTime): Called every frame/tick while attached.
 * - onDetached(host): Called when detached from a host.
 * - onDestroy(): Called when the instance is no longer attached to any host
 *   and is about to be discarded.
 *
 * Notes:
 * - Hooks may return a Promise to perform asynchronous work (e.g., asset loading).
 * - The generic host type `T` can be `IDisposable` or `null`. If `null`, the script
 *   may operate without a concrete host.
 *
 * @typeParam T - The host type that this script attaches to. Typically implements `IDisposable`.
 * @public
 */
export class RuntimeScript<T extends IDisposable | null> {
  /**
   * Called once after construction, before the first attachment to a host.
   *
   * Use this to initialize internal state, allocate resources, or kick off
   * asynchronous loading needed by the script.
   *
   * @returns Optionally a Promise to await initialization.
   */
  onCreated(): void | Promise<void> {}
  /**
   * Called when the script is attached to a host.
   *
   * This may be called multiple times if the same instance attaches to different
   * hosts over its lifetime.
   *
   * @param _host - The host the script is being attached to.
   * @returns Optionally a Promise to await asynchronous setup.
   */
  onAttached(_host: T): void | Promise<void> {}
  /**
   * Called every update/tick while the script is active.
   *
   * Typical usage includes per-frame logic, animation, and input handling.
   *
   * @param _deltaTime - Time since last update (engine-defined units, e.g., seconds or ms).
   * @param _elapsedTime - Total elapsed time since start (engine-defined units).
   */
  onUpdate(_deltaTime: number, _elapsedTime: number) {}
  /**
   * Called when the script is detached from a host.
   *
   * Use this to stop host-specific behaviors and release host-bound resources.
   *
   * @param _host - The host the script is being detached from.
   */
  onDetached(_host: T) {}
  /**
   * Called when the script has no remaining hosts and is about to be discarded.
   *
   * Use this to release global resources and finalize the script's lifecycle.
   * This is the terminal lifecycle hook for an instance.
   */
  onDestroy() {}
}
