import { DRef, HttpFS, type VFS } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript } from './runtimescript';
import { SerializationManager } from '../utility';
import { Scene, SceneNode } from '../scene';

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
export class Engine {
  private _scriptingSystem: ScriptingSystem;
  private _serializationManager: SerializationManager;
  private _enabled: boolean;
  private _activeScenes: DRef<Scene>[];
  private _loadingScenes: Record<string, Promise<Scene>>[];
  /**
   * Creates a new runtime manager.
   *
   * @param VFS - Optional virtual file system passed to the internal {@link ScriptingSystem}.
   * @param scriptsRoot - Optional scripts root path within the VFS. Defaults as in `ScriptingSystem`.
   * @param editorMode - Optional editor mode flag for the underlying `ScriptingSystem`.
   * @param enabled - Whether runtime operations are active. Defaults to `true`.
   */
  constructor(VFS?: VFS, scriptsRoot?: string, editorMode?: boolean, enabled?: boolean) {
    VFS = VFS ?? new HttpFS('./');
    this._scriptingSystem = new ScriptingSystem({ VFS, scriptsRoot, editorMode });
    this._serializationManager = new SerializationManager(VFS);
    this._enabled = enabled ?? true;
    this._activeScenes = [];
    this._loadingScenes = [];
  }
  /**
   * Exposes the virtual file system used by the underlying {@link ScriptingSystem}'s registry.
   */
  get VFS() {
    return this._scriptingSystem.registry.VFS;
  }
  /**
   * Exposes the instance of {@link SerializationManager}.
   */
  get serializationManager() {
    return this._serializationManager;
  }
  /**
   * Detaches all scripts from all hosts, if enabled.
   *
   * No-op when `enabled === false`.
   */
  detachAllScripts() {
    if (this._enabled) {
      this._scriptingSystem.detachAllScripts();
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
    return this._enabled ? await this._scriptingSystem.attachScript(host, module) : null;
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
    if (this._enabled) {
      this._scriptingSystem.detachScript(host, idOrInstance);
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
    if (this._enabled) {
      this._scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
  async loadSceneFromFile(path: string): Promise<Scene> {
    path = this.VFS.normalizePath(path);
    if (!this._loadingScenes[path]) {
      this._loadingScenes[path] = this._loadScene(path);
    }
    return this._loadingScenes[path];
  }
  private async _loadScene(path: string): Promise<Scene> {
    try {
      const scene = await this._serializationManager.loadScene(path);
      if (scene) {
        if (scene.script) {
          try {
            await this.attachScript(scene, scene.script);
          } catch (err) {
            console.error(`Attach script failed: ${err}`);
          }
        }
        const P: Promise<any>[] = [];
        const scripts: string[] = [];
        scene.rootNode.iterate((node) => {
          if (node.script) {
            scripts.push(node.script);
            P.push(this.attachScript(node, node.script));
          }
        });
        if (P.length > 0) {
          const result = await Promise.allSettled(P);
          for (let i = 0; i < result.length; i++) {
            if (result[i].status === 'rejected') {
              console.error(`Attach script failed: ${scripts[i]}`);
            }
          }
        }
      }
      return scene;
    } catch (err) {
      console.error(`Load scene from '${path}' failed: ${err}`);
      return null;
    }
  }
}
