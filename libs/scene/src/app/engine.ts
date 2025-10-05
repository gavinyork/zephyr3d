import type { IDisposable, ReadOptions } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { HttpFS, type VFS } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript } from './runtimescript';
import { SerializationManager } from '../utility';
import type { Scene } from '../scene';

/**
 * Interface for objects that can be rendered.
 *
 * @public
 */
export interface IRenderable extends IDisposable {
  render(): void;
}

/**
 * Core engine class managing scripting, serialization, and rendering.
 *
 * Responsibilities:
 * - Manages a {@link ScriptingSystem} for dynamic script attachment and lifecycle.
 * - Manages a {@link SerializationManager} for loading scenes and assets.
 * - Maintains a list of active renderable objects to be rendered each frame.
 * - Provides methods to attach/detach scripts, update scripts, load scenes, and read files.
 * - Supports enabling/disabling of runtime operations.
 *
 * @remarks
 * The engine can be configured with a virtual file system (VFS) and script root path.
 * It exposes methods to manage scripts on host objects, update scripts each frame,
 * load scenes from files, and render active objects.
 *
 * @public
 */
export class Engine {
  private _scriptingSystem: ScriptingSystem;
  private _serializationManager: SerializationManager;
  private _enabled: boolean;
  protected _activeRenderables: DRef<IRenderable>[];
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
    this._activeRenderables = [];
    this._loadingScenes = [];
  }
  /**
   * Exposes the virtual file system used by the underlying {@link ScriptingSystem}'s registry.
   */
  get VFS() {
    return this._scriptingSystem.registry.VFS;
  }
  set VFS(vfs: VFS) {
    this._serializationManager.VFS = vfs;
    this._scriptingSystem.registry.VFS = vfs;
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
   * When disabled, this method resolves to `null` without side effects.
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
   * No-op when disabled.
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
   * Gets all scripts attached to a host.
   *
   * Delegates to {@link ScriptingSystem.getScriptObjects}.
   *
   * @typeParam T - Expected script type.
   * @param host - Host object to query.
   * @returns Script instances attached to the host, or an empty array.
   */
  getScriptObjects<T extends RuntimeScript<any>>(host: unknown): T[] {
    return this._scriptingSystem.getScriptObjects(host) as T[];
  }
  /**
   * Ticks all attached scripts by calling their `onUpdate` hooks, if enabled.
   *
   * Delegates to {@link ScriptingSystem.update}. No-op when disabled.
   *
   * @param deltaTime - Time since last update in Seconds.
   * @param elapsedTime - Total elapsed time in Seconds.
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
  setRenderable(renderable: IRenderable, layer = 0) {
    if (this._activeRenderables[layer]) {
      if (renderable) {
        this._activeRenderables[layer].set(renderable);
      } else {
        this._activeRenderables[layer].dispose();
        delete this._activeRenderables[layer];
      }
    } else if (renderable) {
      this._activeRenderables[layer] = new DRef(renderable);
    }
  }
  async readFile<T extends ReadOptions['encoding'] = 'binary'>(
    path: string,
    encoding?: T
  ): Promise<T extends 'binary' ? ArrayBuffer : string> {
    try {
      const content = await this.VFS.readFile(path, { encoding: encoding ?? 'binary' });
      return content as T extends 'binary' ? ArrayBuffer : string;
    } catch (err) {
      console.error(`Read file '${path}' failed: ${err}`);
      return null;
    }
  }
  async startup(startupScene: string, splashScreen: string, startupScript: string) {
    const splashScreenLayer = 9999;
    if (splashScreen) {
      const splashScreenScene = await this.loadSceneFromFile(splashScreen);
      if (splashScreen) {
        this.setRenderable(splashScreenScene, splashScreenLayer);
      }
    }
    if (startupScript) {
      const path =
        startupScript.toLowerCase().endsWith('.ts') || startupScript.toLowerCase().endsWith('.js')
          ? startupScript.slice(0, -3)
          : startupScript;
      await this.attachScript(null, path);
    }
    if (startupScene) {
      const scene = await this.loadSceneFromFile(startupScene);
      this.setRenderable(scene, 0);
    }
    this.setRenderable(null, splashScreenLayer);
  }
  render() {
    for (const k of Object.keys(this._activeRenderables)) {
      this._activeRenderables[k].get().render();
    }
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
