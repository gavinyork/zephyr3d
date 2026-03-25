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

const BUILTIN_SPRING_TEST_SCRIPT_JS = `import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  createSphereCollider,
  createCapsuleCollider,
  createPlaneCollider,
  SpringModifier,
  SpringSystem,
  SpringChain
} from '@zephyr3d/scene';

export default class extends RuntimeScript {
  onAttached(host) {
    const root = host;
    const config = root?.scriptConfig;
    if (!config || !config.enabled) {
      return;
    }
    const skeleton = root.animationSet?.skeletons?.[0]?.get();
    if (!skeleton) {
      return;
    }
    const parseVec3 = (value, fallback) => {
      if (Array.isArray(value) && value.length >= 3) {
        return new Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
      }
      return fallback.clone();
    };
    const COLLIDER_PANEL_SCALE = 10;
    const scaleCapsuleAroundCenter = (start, end, scale) => {
      const center = Vector3.scale(Vector3.add(start, end, new Vector3()), 0.5, new Vector3());
      const half = Vector3.scale(Vector3.sub(end, start, new Vector3()), 0.5 * scale, new Vector3());
      return {
        start: Vector3.sub(center, half, new Vector3()),
        end: Vector3.add(center, half, new Vector3())
      };
    };
    const hierarchyColliders = [];
    root.iterate((node) => {
      const c = node?.metaData?.springCollider;
      if (!c || typeof c !== 'object') {
        return false;
      }
      if (c.type !== 'sphere' && c.type !== 'capsule' && c.type !== 'plane') {
        return false;
      }
      hierarchyColliders.push({ node, config: c });
      return false;
    });
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const chain = SpringChain.fromBoneChain(chainStart, chainEnd, {
        damping: config.chainDamping,
        stiffness: config.chainStiffness
      });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(config.gravityX, config.gravityY, config.gravityZ),
        iterations: config.iterations,
        enableInertialForces: config.enableInertialForces,
        centrifugalScale: config.centrifugalScale,
        coriolisScale: config.coriolisScale,
        solver: config.solver,
        poseFollow: config.poseFollow,
        poseFollowRoot: config.poseFollowRoot,
        poseFollowTip: config.poseFollowTip,
        poseFollowExponent: config.poseFollowExponent,
        maxPoseOffset: config.maxPoseOffset,
        maxPoseOffsetRoot: config.maxPoseOffsetRoot,
        maxPoseOffsetTip: config.maxPoseOffsetTip
      });
      if (hierarchyColliders.length > 0) {
        for (const item of hierarchyColliders) {
          const colliderConfig = item.config;
          let collider = null;
          if (colliderConfig.type === 'sphere') {
            collider = createSphereCollider(
              parseVec3(colliderConfig.offset, Vector3.zero()),
              Math.max(0, (Number(colliderConfig.radius) || 0.15) * COLLIDER_PANEL_SCALE),
              item.node
            );
            // Keep collider radius authored by node scale in editor gizmo workflow.
            collider.localRadiusScaleRef = 1;
          } else if (colliderConfig.type === 'capsule') {
            const startOffset = parseVec3(colliderConfig.offset, Vector3.zero());
            const endOffset = parseVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0));
            const scaledCapsule = scaleCapsuleAroundCenter(startOffset, endOffset, COLLIDER_PANEL_SCALE);
            collider = createCapsuleCollider(
              scaledCapsule.start,
              scaledCapsule.end,
              Math.max(0, (Number(colliderConfig.radius) || 0.1) * COLLIDER_PANEL_SCALE),
              item.node
            );
            // Keep collider radius authored by node scale in editor gizmo workflow.
            collider.localRadiusScaleRef = 1;
          } else if (colliderConfig.type === 'plane') {
            collider = createPlaneCollider(
              parseVec3(colliderConfig.offset, Vector3.zero()),
              parseVec3(colliderConfig.normal, Vector3.axisPY()),
              item.node
            );
          }
          if (collider) {
            collider.enabled = colliderConfig.enabled !== false;
            springSystem.addCollider(collider);
          }
        }
      } else if ((config.colliders ?? []).length > 0) {
        const colliderConfigs = config.colliders ?? [];
        for (const colliderConfig of colliderConfigs) {
          const attachNode = root.findNodeByName(colliderConfig.bone) ?? root;
          let collider = null;
          if (colliderConfig.type === 'sphere') {
            collider = createSphereCollider(
              new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
              Math.max(0, Number(colliderConfig.radius) * COLLIDER_PANEL_SCALE),
              attachNode
            );
          } else if (colliderConfig.type === 'capsule') {
            const startOffset = new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ);
            const endOffset = new Vector3(
              colliderConfig.endOffsetX,
              colliderConfig.endOffsetY,
              colliderConfig.endOffsetZ
            );
            const scaledCapsule = scaleCapsuleAroundCenter(startOffset, endOffset, COLLIDER_PANEL_SCALE);
            collider = createCapsuleCollider(
              scaledCapsule.start,
              scaledCapsule.end,
              Math.max(0, Number(colliderConfig.radius) * COLLIDER_PANEL_SCALE),
              attachNode
            );
          } else if (colliderConfig.type === 'plane') {
            collider = createPlaneCollider(
              new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
              new Vector3(colliderConfig.normalX, colliderConfig.normalY, colliderConfig.normalZ),
              attachNode
            );
          }
          if (collider) {
            collider.enabled = colliderConfig.enabled !== false;
            springSystem.addCollider(collider);
          }
        }
      } else {
        // Legacy fallback: keep old single-sphere config working.
        springSystem.addCollider(
          createSphereCollider(
            new Vector3(config.colliderOffsetX, config.colliderOffsetY, config.colliderOffsetZ),
            config.colliderRadius,
            root
          )
        );
      }
      const springModifier = new SpringModifier(springSystem, config.modifierWeight);
      skeleton.modifiers.push(springModifier);
    }
  }
}
`;

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
    await fs.writeFile('/scripts/springtest.js', BUILTIN_SPRING_TEST_SCRIPT_JS, {
      encoding: 'utf8',
      create: true
    });
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
