import type { IDisposable, VFS } from '@zephyr3d/base';
import { HttpFS } from '@zephyr3d/base';
import { ScriptRegistry } from './scriptregistry';
import { RuntimeScript } from './runtimescript';
import type { EditorMode } from './app';

/**
 * A host object that supports disposal.
 *
 * Hosts are objects to which scripts can be attached. They are expected to
 * emit a `'dispose'` event compatible with `IDisposable` so that scripts
 * can be automatically detached when the host is destroyed.
 *
 * @public
 */
export type Host = IDisposable;

/**
 * Options for configuring a `ScriptingSystem`.
 *
 * @public
 */
export type ScriptingSystemOptions = {
  /** Virtual file system used by the script registry. Defaults to `new HttpFS('./')`. */
  VFS?: VFS;
  /** Root path for scripts within the VFS. Defaults to `/`. */
  scriptsRoot?: string;
  /** Editor Mode. Defaults to `none`. */
  editorMode?: EditorMode;
  /**
   * Optional string appended to dynamic import URLs (e.g., for cache busting).
   * Example: `'?v=' + Date.now()`
   */
  importComment?: string;
  /**
   * Optional callback invoked when a module fails to load.
   * @param e - The error that occurred.
   * @param id - The module ID that failed to load.
   */
  onLoadError?: (e: unknown, id: string) => void;
};

/**
 * Information about a script attached to a host.
 *
 * @public
 */
export interface IAttachedScript {
  /** The logical module identifier used to resolve the script. */
  id: string;
  /** The resolved runtime URL used for dynamic import. */
  url: string;
  /** The instantiated runtime script. */
  instance: RuntimeScript<any>;
}

/**
 * Script system that resolves, loads, and manages lifecycle of runtime scripts.
 *
 * Responsibilities:
 * - Resolves module IDs to URLs via {@link ScriptRegistry}
 * - Dynamically imports modules and instantiates a `RuntimeScript` (default export)
 * - Tracks attachments between hosts and script instances
 * - Bridges script lifecycle hooks: `onCreated`, `onAttached`, `onDetached`, `onDestroy`, `onUpdate`
 * - Auto-detaches scripts when a host is disposed
 *
 * Notes:
 * - Multiple hosts can reference the same `RuntimeScript` instance; destruction
 *   occurs when the last host detaches.
 * - Errors during load/attach/update are caught and logged; an optional
 *   `onLoadError` callback can be provided.
 *
 * @public
 */
export class ScriptingSystem {
  private _registry: ScriptRegistry;
  private _hostScripts: Map<Host, IAttachedScript[]>;
  private _scriptHosts: Map<RuntimeScript<any>, Host[]>;
  private _onLoadError?: (e: unknown, id: string) => void;
  private _importComment?: string;

  /**
   * Constructs a new scripting system.
   *
   * @param opts - Optional configuration.
   */
  constructor(opts: ScriptingSystemOptions = {}) {
    this._registry = new ScriptRegistry(
      opts.VFS ?? new HttpFS('./'),
      opts.scriptsRoot ?? '/',
      opts.editorMode ?? 'none'
    );
    this._hostScripts = new Map();
    this._scriptHosts = new Map();
    this._importComment = opts.importComment;
    this._onLoadError = opts.onLoadError;
  }

  /**
   * Accessor for the underlying script registry used for module resolution.
   */
  get registry() {
    return this._registry;
  }

  /**
   * Attaches a script to a host and returns the `RuntimeScript` instance.
   *
   * Process:
   * 1. Resolve module ID to a runtime URL via the registry.
   * 2. Dynamically import the module.
   * 3. Instantiate the default export if it is a constructor.
   * 4. If this is the first time the instance is seen, call `onCreated()`.
   * 5. Link the instance to the host, and call `onAttached(host)`.
   * 6. Subscribe to the host's `'dispose'` event to auto-detach.
   *
   * If the module cannot be resolved or does not export a default `RuntimeScript`
   * subclass, a warning is logged and `null` is returned.
   *
   * @typeParam T - Host type.
   * @param host - The host object to attach the script to.
   * @param module - Module identifier used by the registry (logical ID or path).
   * @returns The instantiated `RuntimeScript<T>` or `null` on failure.
   */
  async attachScript<T extends Host>(host: T, module: string): Promise<RuntimeScript<T>> {
    try {
      const url = await this._registry.resolveRuntimeUrl(module);
      if (!url) {
        return null;
      }
      const mod = await import(url + (this._importComment ?? ''));
      let instance: RuntimeScript<T> = null;
      if (typeof mod?.default === 'function') {
        // default export
        instance = new mod.default();
        if (instance instanceof RuntimeScript) {
          if (!this._scriptHosts.has(instance)) {
            const P = instance.onCreated();
            if (P instanceof Promise) {
              await P;
            }
          }
        } else {
          instance = null;
        }
      }
      if (!instance) {
        console.warn(`Script '${module}' does not have RuntimeScript class exported as default`);
        return null;
      }

      let hostList = this._scriptHosts.get(instance);
      if (!hostList) {
        hostList = [];
        this._scriptHosts.set(instance, hostList);
      }
      if (hostList.includes(host)) {
        console.warn(`Script '${module}' already attached`);
        return instance;
      }
      hostList.push(host);

      const P = instance.onAttached(host);
      if (P instanceof Promise) {
        await P;
      }

      const attached: IAttachedScript = {
        id: module,
        url,
        instance
      };

      let list = this._hostScripts.get(host);
      if (!list) {
        list = [];
        this._hostScripts.set(host, list);
        if (host) {
          host.on('dispose', () => {
            this.detachScript(host);
          });
        }
      }
      list.push(attached);

      return attached.instance;
    } catch (e) {
      const moduleName = module ? String(module).slice(0, 64) : '';
      console.error(`Load module '${moduleName}' failed: ${e}`);
      this._onLoadError?.(e, module);
      return null;
    }
  }

  /**
   * Detaches script(s) from a host.
   *
   * Behavior:
   * - If `idOrInstance` is omitted, detaches all scripts from the host.
   * - If a module ID is provided, detaches only the matching script.
   * - If a `RuntimeScript` instance is provided, detaches that instance.
   * - Invokes `onDetached(host)` on each detached instance.
   * - If the instance has no remaining hosts, invokes `onDestroy()` and disposes tracking.
   *
   * @typeParam T - Host type.
   * @param host - The host to detach from.
   * @param idOrInstance - Optional module ID or script instance to target.
   */
  detachScript<T extends Host>(host: T, idOrInstance?: string | RuntimeScript<T>) {
    const list = this._hostScripts.get(host);
    if (!list || list.length === 0) {
      return;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      const hit =
        !idOrInstance || typeof idOrInstance === 'string'
          ? it.id === idOrInstance
          : it.instance === idOrInstance;
      if (hit) {
        list.splice(i, 1);
        try {
          it.instance.onDetached(host);
        } catch (err) {
          console.error(`Error occured at onDetach() of module '${it.id}': ${err}`);
        }

        const hostList = this._scriptHosts.get(it.instance);
        const index = hostList.indexOf(host);
        if (index >= 0) {
          hostList.splice(index, 1);
        }

        if (hostList.length === 0) {
          try {
            it.instance.onDestroy();
          } catch (err) {
            console.error(`Error occured at onDestroy() of module '${it.id}': ${err}`);
          } finally {
            this._scriptHosts.delete(it.instance);
          }
        }
      }
    }
    if (list.length === 0) {
      this._hostScripts.delete(host);
    }
  }

  /**
   * Get all script instances attached to a host.
   *
   * @typeParam T - Expected script type.
   * @param host - The host whose scripts to retrieve.
   * @returns Script instances attached to the host, or an empty array if none.
   */
  getScriptObjects<T extends RuntimeScript<any>>(host: unknown): T[] {
    return (this._hostScripts.get(host as Host) as unknown as T[]) || [];
  }

  /**
   * Ticks all attached script instances.
   *
   * Calls `onUpdate(deltaTime, elapsedTime)` on every attached script instance
   * across all hosts. Exceptions thrown by a script are caught and logged,
   * allowing other scripts to continue updating.
   *
   * @param deltaTime - Time in seconds since last update.
   * @param elapsedTime - Total time in seconds since start.
   */
  update(deltaTime: number, elapsedTime: number): void {
    if (this._hostScripts.size === 0) {
      return;
    }
    for (const list of this._hostScripts.values()) {
      for (const s of list) {
        try {
          s.instance.onUpdate(deltaTime, elapsedTime);
        } catch (err) {
          console.error(`Error occured at onUpdate() of module '${s.id}': ${err}`);
        }
      }
    }
  }

  /**
   * Detaches all scripts from all hosts.
   *
   * Iteratively calls {@link ScriptingSystem.detachScript} on each host until no attachments remain.
   */
  detachAllScripts() {
    while (this._hostScripts.size > 0) {
      for (const entry of this._hostScripts) {
        this.detachScript(entry[0]);
      }
    }
  }
}
