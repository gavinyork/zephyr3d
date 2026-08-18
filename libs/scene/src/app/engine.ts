import type { GenericConstructor, IDisposable, Nullable, ReadOptions } from '@zephyr3d/base';
import { MemoryFS, objectEntries } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { HttpFS, type VFS } from '@zephyr3d/base';
import { createDeclarativeScriptSignature, ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript, RuntimeScriptConfig } from './runtimescript';
import { ResourceManager } from '../utility/serialization/manager';
import type { Scene, SceneNode } from '../scene';
import {
  BoxShape,
  CapsuleShape,
  CylinderShape,
  PlaneShape,
  SphereShape,
  TetrahedronShape,
  TorusShape
} from '../shapes';
import {
  BlinnMaterial,
  EyeMaterial,
  LambertMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../material';
import { StandardSpriteMaterial } from '../material/sprite_std';
import { SkinMaterial } from '../material/skin';
import { HairMaterial } from '../material/hair';
import { ScreenAdapter } from './screen';
import { MSDFTextAtlasManager } from '../text/runtime';

/**
 * Interface for objects that can be rendered.
 *
 * @public
 */
export interface IRenderable extends IDisposable {
  render(): void;
}

/**
 * Type for render functions that can be registered as renderables.
 *
 * @public
 */
export type RenderFunc = () => void;

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
  private _msdfTextAtlasManager: MSDFTextAtlasManager;
  private _enabled: boolean;
  private _screen: ScreenAdapter;
  protected _activeRenderables: {
    renderable: Nullable<RenderFunc> | DRef<IRenderable>;
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
    this._msdfTextAtlasManager = new MSDFTextAtlasManager();
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
   * Exposes the shared runtime MSDF text atlas manager.
   */
  get msdfTextAtlasManager() {
    return this._msdfTextAtlasManager;
  }
  /**
   * Releases a loaded font asset from the resource cache and disposes its shared MSDF atlas textures.
   *
   * Existing scene nodes that still reference this font asset are not updated automatically.
   * Call this only after you have stopped using the font, or when you intentionally want it to rebuild later.
   *
   * @param font - The loaded font asset path to release.
   * @returns `true` if either the atlas cache or the font cache had an entry to remove.
   */
  releaseFontAsset(font: string) {
    const fontAsset = this._resourceManager.getFontAsset(font);
    if (!fontAsset) {
      return false;
    }
    const atlasReleased = this._msdfTextAtlasManager.releaseAtlas(fontAsset);
    const fontReleased = this._resourceManager.releaseFontAsset(fontAsset);
    return atlasReleased || fontReleased;
  }
  /**
   * Configures the MSDF atlas for a given font asset, creating or replacing the atlas as needed.
   *
   * This is useful to customize the glyph size, atlas page size, distance range, and padding for MSDF text rendering.
   * Existing scene nodes that reference this font asset will use the updated atlas automatically.
   *
   * @param font - The font asset path to configure the MSDF atlas for.
   * @param pageSize - The size of each atlas page in pixels (e.g., 512, 1024).
   * @param glyphSize - The size of each glyph in pixels (e.g., 32, 64).
   * @param distanceRange - The distance range for MSDF generation. Defaults to 4.
   * @param padding - The padding between glyphs in the atlas in pixels. Defaults to 2.
   * @returns `true` if the atlas was successfully configured, or `false` if the font asset was not found.
   *
   * @remarks
   * The font asset must be loaded and available in the resource manager for the atlas to be configured.
   */
  configureMSDFAtlas(
    font: string,
    pageSize: number,
    glyphSize: number,
    distanceRange?: number,
    padding?: number
  ) {
    const fontAsset = this._resourceManager.getFontAsset(font);
    if (!fontAsset) {
      console.warn(`Font asset '${font}' not found for MSDF atlas configuration.`);
      return false;
    }
    this._msdfTextAtlasManager.configureAtlas(fontAsset, pageSize, glyphSize, distanceRange, padding);
    return true;
  }
  /**
   * Exposes the active {@link ScreenAdapter}.
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
   * Loads a runtime script class from file
   * @param module - file path
   * @returns The runtime script class or null
   */
  async loadRuntimeScriptClass<T extends Host = Host>(
    module: string
  ): Promise<Nullable<{ url: string; cls: GenericConstructor<RuntimeScript<T>> }>> {
    return await this._scriptingSystem.loadRuntimeScriptClass(module);
  }
  /**
   * Attaches a script module to the given host, if enabled.
   *
   * When disabled, this method resolves to `null` without side effects.
   *
   * @typeParam T - Host type.
   * @param host - Host object to attach the script to.
   * @param module - Module identifier to resolve and load.
   * @param config - Optional configuration passed to the script instance.
   * @returns The `RuntimeScript<T>` instance, or `null` if disabled or on failure.
   */
  async attachScript<T extends Host>(
    host: Nullable<T>,
    module: string,
    config?: Nullable<RuntimeScriptConfig>
  ) {
    return this._enabled ? await this._scriptingSystem.attachScript(host, module, config) : null;
  }
  /**
   * Attaches all serialized script declarations on a scene node subtree.
   *
   * The operation is explicit and idempotent. Repeated or concurrent calls reuse
   * instances already attached for the same declaration, while duplicate declarations
   * within one host remain distinct.
   *
   * @param root - Root node whose own declarations and descendants are processed.
   * @returns Script instances in host/declaration order. Failed declarations are omitted.
   */
  async attachScriptsInSubtree(root: SceneNode) {
    if (!this._enabled) {
      return [];
    }
    const nodes: SceneNode[] = [];
    root.iterate((node) => {
      nodes.push(node);
    });
    const results = await Promise.all(nodes.map((node) => this.attachDeclaredScripts(node)));
    return results.flat();
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
   * @param deltaTime - Time since last update in Seconds.
   * @param elapsedTime - Total elapsed time in Seconds.
   */
  update(deltaTime: number, elapsedTime: number) {
    if (this._enabled) {
      this._scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
  /**
   * Loads a scene from a file path.
   *
   * Concurrent requests for the same normalized path share the same loading promise.
   * Scripts declared on the scene and its nodes are attached after the scene is loaded.
   *
   * @param path - Scene file path in the current VFS.
   * @returns The loaded scene, or `null` when loading fails.
   */
  async loadSceneFromFile(path: string) {
    path = this.VFS.normalizePath(path);
    if (!this._loadingScenes[path]) {
      this._loadingScenes[path] = this._loadScene(path);
    }
    return this._loadingScenes[path]!;
  }
  /**
   * Sets or clears the renderable for a render layer.
   *
   * Passing `null` clears the layer. Object renderables are held through a strong reference wrapper,
   * while render functions are stored directly.
   *
   * @param renderable - Renderable object or render function to assign, or `null` to clear.
   * @param layer - Render layer index. Defaults to `0`.
   * @param hook - Optional render hook invoked before and after this layer renders.
   */
  setRenderable(renderable: Nullable<IRenderable | RenderFunc>, layer = 0, hook?: IRenderHook) {
    const entry = this._activeRenderables[layer];
    if (!entry) {
      this._activeRenderables[layer] = {
        renderable: renderable
          ? typeof renderable === 'function'
            ? renderable
            : new DRef<IRenderable>(renderable)
          : null,
        hook: hook ?? null
      };
    } else {
      if (entry.renderable) {
        if (entry.renderable instanceof DRef) {
          entry.renderable.dispose();
        }
        entry.renderable = null;
      }
      if (typeof renderable === 'function') {
        entry.renderable = renderable;
      } else if (renderable) {
        entry.renderable = new DRef<IRenderable>(renderable);
      }
      entry.hook = hook ?? null;
    }
  }
  /**
   * Reads a file from the current VFS.
   *
   * @typeParam T - Requested read encoding.
   * @param path - File path to read.
   * @param encoding - Optional read encoding. Defaults to `binary`.
   * @returns The file content, or `null` when the read fails.
   */
  async readFile<T extends ReadOptions['encoding'] = 'binary'>(path: string, encoding?: T) {
    try {
      const content = await this.VFS.readFile(path, { encoding: encoding ?? 'binary' });
      return content as T extends 'binary' ? ArrayBuffer : string;
    } catch (err) {
      console.error(`Read file '${path}' failed: ${err}`);
      return null;
    }
  }
  /**
   * Starts the runtime by optionally showing a splash screen, running a startup script,
   * and loading the startup scene.
   *
   * @param startupScene - Optional scene path rendered on layer `0` after startup completes.
   * @param splashScreen - Optional scene path rendered on a temporary splash layer during startup.
   * @param startupScript - Optional startup script module path. A trailing `.ts` or `.js`
   * extension is removed before loading.
   */
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
  /**
   * Renders all active render layers.
   *
   * Each layer's `beforeRender` hook can return `false` to skip rendering that layer.
   * The `afterRender` hook is invoked after the render attempt.
   */
  render() {
    this._activeRenderables.forEach((info) => {
      if (!info.renderable) {
        return;
      }
      const render = info.hook?.beforeRender
        ? (info.hook.beforeRender(
            typeof info.renderable === 'function' ? info.renderable : info.renderable.get()
          ) ?? true)
        : true;
      if (render) {
        if (typeof info.renderable === 'function') {
          info.renderable();
        } else {
          info.renderable.get()?.render();
        }
      }
      if (info.hook?.afterRender) {
        info.hook.afterRender(
          typeof info.renderable === 'function' ? info.renderable : info.renderable.get()
        );
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
      '/primitives/capsule.zmsh': CapsuleShape,
      '/materials/unlit.zmtl': UnlitMaterial,
      '/materials/lambert.zmtl': LambertMaterial,
      '/materials/blinnphong.zmtl': BlinnMaterial,
      '/materials/pbr_metallic_roughness.zmtl': PBRMetallicRoughnessMaterial,
      '/materials/pbr_specular_glossiness.zmtl': PBRSpecularGlossinessMaterial,
      '/materials/sprite_std.zmtl': StandardSpriteMaterial,
      '/materials/skin.zmtl': SkinMaterial,
      '/materials/hair.zmtl': HairMaterial,
      '/materials/eye.zmtl': EyeMaterial
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
        await this.attachDeclaredScripts(scene);
        await this.attachScriptsInSubtree(scene.rootNode);
      }
      return scene;
    } catch (err) {
      console.error(`Load scene from '${path}' failed: ${err}`);
      return null;
    }
  }
  private async attachDeclaredScripts<
    T extends Host & {
      scripts: { script: string; config: unknown }[];
      script: string;
      scriptConfig: unknown;
    }
  >(host: T) {
    const attachments =
      host.scripts.length > 0
        ? host.scripts
        : host.script
          ? [{ script: host.script, config: host.scriptConfig }]
          : [];
    const occurrences = new Map<string, number>();
    const declarationKeys = new Set<string>();
    const requests = attachments
      .filter((attachment) => !!attachment.script)
      .map((attachment) => {
        const config = (attachment.config ?? null) as RuntimeScriptConfig | null;
        const signature = createDeclarativeScriptSignature(attachment.script, config);
        const occurrence = occurrences.get(signature) ?? 0;
        occurrences.set(signature, occurrence + 1);
        declarationKeys.add(`${signature}\n${occurrence}`);
        return this._scriptingSystem
          .attachDeclarativeScript(host, attachment.script, config, occurrence)
          .catch((err) => {
            console.error(`Attach script '${attachment.script}' failed: ${err}`);
            return null;
          });
      });
    this._scriptingSystem.synchronizeDeclarativeScripts(host, declarationKeys);
    const instances = await Promise.all(requests);
    return instances.filter((instance): instance is RuntimeScript<T> => !!instance);
  }
}

export { MSDFTextAtlasManager };
