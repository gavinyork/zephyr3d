import type { VFS } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript } from './runtimescript';

/**
 * Lightweight facade over {@link ScriptingSystem} that adds feature gating.
 *
 * Responsibilities:
 * - Construct and expose a scripting system for script lifecycle management.
 * - Provide an `enabled` flag to globally gate attach/detach/update operations
 *   without tearing down the underlying registry or state.
 *
 * Notes:
 * - When `enabled` is `false`, all mutating operations are no-ops and `attachScript`
 *   returns `null`. This is useful for pausing runtime behavior in editor or paused modes.
 *
 * @public
 */
export class RuntimeManager {
  private scriptingSystem: ScriptingSystem;
  private enabled: boolean;
  /**
   * Creates a new runtime manager.
   *
   * @param VFS - Optional virtual file system passed to the internal {@link ScriptingSystem}.
   * @param scriptsRoot - Optional scripts root path within the VFS. Defaults as in `ScriptingSystem`.
   * @param editorMode - Optional editor mode flag for the underlying `ScriptingSystem`.
   * @param enabled - Whether runtime operations are active. Defaults to `true`.
   */
  constructor(VFS?: VFS, scriptsRoot?: string, editorMode?: boolean, enabled?: boolean) {
    this.scriptingSystem = new ScriptingSystem({ VFS, scriptsRoot, editorMode });
    this.enabled = enabled ?? true;
  }
  /**
   * Exposes the virtual file system used by the underlying {@link ScriptingSystem}'s registry.
   */
  get VFS() {
    return this.scriptingSystem.registry.VFS;
  }
  /**
   * Detaches all scripts from all hosts, if enabled.
   *
   * No-op when `enabled === false`.
   */
  detachAllScripts() {
    if (this.enabled) {
      this.scriptingSystem.detachAllScripts();
    }
  }
  /**
   * Attaches a script module to the given host, if enabled.
   *
   * Delegates to {@link ScriptingSystem.attachScript}. When disabled,
   * this method resolves to `null` without side effects.
   *
   * @typeParam T - Host type.
   * @param host - Host object to attach the script to.
   * @param module - Module identifier to resolve and load.
   * @returns The `RuntimeScript<T>` instance, or `null` if disabled or on failure.
   */
  async attachScript<T extends Host>(host: T, module: string): Promise<RuntimeScript<T>> {
    return this.enabled ? await this.scriptingSystem.attachScript(host, module) : null;
  }
  /**
   * Detaches a script from a host, by module ID or instance, if enabled.
   *
   * Delegates to {@link ScriptingSystem.detachScript}. No-op when disabled.
   *
   * @typeParam T - Host type.
   * @param host - Host to detach from.
   * @param idOrInstance - Target script by module ID or instance reference.
   */
  detachScript<T extends Host>(host: T, idOrInstance: string | RuntimeScript<T>) {
    if (this.enabled) {
      this.scriptingSystem.detachScript(host, idOrInstance);
    }
  }
  /**
   * Ticks all attached scripts by calling their `onUpdate` hooks, if enabled.
   *
   * Delegates to {@link ScriptingSystem.update}. No-op when disabled.
   *
   * @param deltaTime - Time since last update (engine-defined units).
   * @param elapsedTime - Total elapsed time (engine-defined units).
   */
  update(deltaTime: number, elapsedTime: number) {
    if (this.enabled) {
      this.scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
}
