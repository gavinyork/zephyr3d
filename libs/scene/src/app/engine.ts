import type { IDisposable, Nullable, ReadOptions } from '@zephyr3d/base';
import { MemoryFS, objectEntries } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { HttpFS, type VFS } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript } from './runtimescript';
import { ResourceManager } from '../utility/serialization/manager';
import type { Scene } from '../scene';
import { BoxShape, CylinderShape, PlaneShape, SphereShape, TetrahedronShape, TorusShape } from '../shapes';
import {
  BlinnMaterial,
  LambertMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../material';
import { StandardSpriteMaterial } from '../material/sprite_std';
import { ScreenAdapter } from './screen';

/**
 * Interface for objects that can be rendered.
 *
 * @public
 */
export interface IRenderable extends IDisposable {
  render(): void;
}

/**
 * Interface for render hooks to customize rendering behavior.
 *
 * @public
 */
export interface IRenderHook {
  // If presents, called before rendering the renderable. Return `false` to skip rendering.
  beforeRender?: (renderable: any) => boolean | void;
  // If presents, called after rendering the renderable.
  afterRender?: (renderable: any) => void;
}

/**
 * Core engine class managing scripting, serialization, and rendering.
 *
 * Responsibilities:
 * - Manages a {@link ScriptingSystem} for dynamic script attachment and lifecycle.
 * - Manages a {@link ResourceManager} for loading scenes and assets.
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
  private _builtinsVFS: Nullable<MemoryFS>;
  private _scriptingSystem: ScriptingSystem;
  private _resourceManager: ResourceManager;
  private _enabled: boolean;
  private _screen: ScreenAdapter;
  protected _activeRenderables: {
    renderable: DRef<IRenderable>;
    hook: Nullable<IRenderHook>;
  }[];
  private _loadingScenes: Partial<Record<string, Promise<Nullable<Scene>>>>;
  /**
   * Creates a new runtime manager.
   *
   * @param VFS - Optional virtual file system passed to the internal {@link ScriptingSystem}.
   * @param scriptsRoot - Optional scripts root path within the VFS. Defaults as in `ScriptingSystem`.
   * @param enabled - Whether runtime operations are active. Defaults to `true`.
   */
  constructor(VFS?: VFS, scriptsRoot?: string, enabled?: boolean) {
    VFS = VFS ?? new HttpFS('./');
    this._builtinsVFS = null;
    this._scriptingSystem = new ScriptingSystem({ VFS, scriptsRoot });
    this._resourceManager = new ResourceManager(VFS);
    this._enabled = enabled ?? true;
    this._activeRenderables = [];
    this._loadingScenes = {};
    this._screen = new ScreenAdapter();
  }
  /**
   * Exposes the instance of {@link ScriptingSystem}.
   */
  get scriptingSystem() {
    return this._scriptingSystem;
  }
  /**
   * Exposes the virtual file system used by the underlying {@link ScriptingSystem}'s registry.
   */
  get VFS() {
    return this._scriptingSystem.registry.VFS;
  }
  set VFS(vfs: VFS) {
    if (vfs !== this._resourceManager.VFS) {
      this._resourceManager.VFS?.close();
      this._resourceManager.VFS = vfs;
      this._scriptingSystem.registry.VFS = vfs;
      this.ensureBuiltinVFS();
    }
  }
  /**
   * Exposes the instance of {@link ResourceManager}.
   */
  get resourceManager() {
    return this._resourceManager;
  }
  /**
   * Exposes the instanceof {@link Screen}
   */
  get screen() {
    return this._screen;
  }
  /** @internal */
  async init() {
    await this.ensureBuiltinVFS();
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
  async attachScript<T extends Host>(host: Nullable<T>, module: string) {
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
  getScriptObjects<T extends RuntimeScript<any>>(host: unknown) {
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
  async loadSceneFromFile(path: string) {
    path = this.VFS.normalizePath(path);
    if (!this._loadingScenes[path]) {
      this._loadingScenes[path] = this._loadScene(path);
    }
    return this._loadingScenes[path]!;
  }
  setRenderable(renderable: Nullable<IRenderable>, layer = 0, hook?: IRenderHook) {
    if (!this._activeRenderables[layer]) {
      this._activeRenderables[layer] = {
        renderable: new DRef<IRenderable>(null),
        hook: null
      };
    }
    this._activeRenderables[layer].hook = hook ?? null;
    this._activeRenderables[layer].renderable.set(renderable);
  }
  async readFile<T extends ReadOptions['encoding'] = 'binary'>(path: string, encoding?: T) {
    try {
      const content = await this.VFS.readFile(path, { encoding: encoding ?? 'binary' });
      return content as T extends 'binary' ? ArrayBuffer : string;
    } catch (err) {
      console.error(`Read file '${path}' failed: ${err}`);
      return null;
    }
  }
  async startup(
    startupScene?: Nullable<string>,
    splashScreen?: Nullable<string>,
    startupScript?: Nullable<string>
  ) {
    const splashScreenLayer = 9999;
    if (splashScreen) {
      const splashScreenScene = await this.loadSceneFromFile(splashScreen);
      if (splashScreenScene) {
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
    this._activeRenderables.forEach((info) => {
      const render = info.hook?.beforeRender
        ? (info.hook.beforeRender(info.renderable.get() ?? null) ?? true)
        : true;
      if (render) {
        info.renderable.get()?.render();
      }
      if (info.hook?.afterRender) {
        info.hook.afterRender(info.renderable.get() ?? null);
      }
    });
  }
  private async ensureBuiltinVFS() {
    if (!this._builtinsVFS) {
      this._builtinsVFS = await this.createBuiltinVFS();
    }
    this.VFS.unmount('/assets/@builtins');
    this.VFS.mount('/assets/@builtins', this._builtinsVFS);
  }
  private async createBuiltinVFS() {
    const fs = new MemoryFS();
    const shapeClsMap = {
      '/primitives/box.zmsh': BoxShape,
      '/primitives/sphere.zmsh': SphereShape,
      '/primitives/cylinder.zmsh': CylinderShape,
      '/primitives/plane.zmsh': PlaneShape,
      '/primitives/torus.zmsh': TorusShape,
      '/primitives/tetrahedron.zmsh': TetrahedronShape,
      '/materials/unlit.zmtl': UnlitMaterial,
      '/materials/lambert.zmtl': LambertMaterial,
      '/materials/blinnphong.zmtl': BlinnMaterial,
      '/materials/pbr_metallic_roughness.zmtl': PBRMetallicRoughnessMaterial,
      '/materials/pbr_specular_glossiness.zmtl': PBRSpecularGlossinessMaterial,
      '/materials/sprite_std.zmtl': StandardSpriteMaterial
    } as const;
    for (const [key] of objectEntries(shapeClsMap)) {
      const obj = new shapeClsMap[key]();
      await this.writeSerializableObject(fs, 'Default', obj, key);
      obj.dispose();
    }
    fs.readOnly = true;
    return fs;
  }
  private async writeSerializableObject(VFS: VFS, type: string, obj: any, path: string) {
    try {
      const data = await this.resourceManager.serializeObject(obj);
      const content = JSON.stringify({ type, data }, null, 2);
      await VFS.writeFile(path, content, { encoding: 'utf8', create: true });
    } catch (err) {
      console.error(`Write file '${path}' failed: ${err}`);
    }
  }
  private async _loadScene(path: string) {
    try {
      const scene = await this._resourceManager.loadScene(path);
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
