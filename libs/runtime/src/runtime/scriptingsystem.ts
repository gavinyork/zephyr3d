import type { ModuleId } from './types';
import { ScriptRegistry } from './scriptregistry';
import type { IDisposable, VFS } from '@zephyr3d/base';
import { HttpFS } from '@zephyr3d/base';
import { RuntimeScript } from './runtimescript';

export type Host = IDisposable;

export interface AttachedScript {
  id: ModuleId;
  url: string;
  instance: RuntimeScript<any>;
}

export class ScriptingSystem {
  private _registry: ScriptRegistry;
  private _hostScripts: Map<Host, AttachedScript[]>;
  private _scriptHosts: Map<RuntimeScript<any>, Host[]>;
  private _onLoadError?: (e: unknown, id: ModuleId) => void;
  private _importComment?: string;

  constructor(
    opts: {
      VFS?: VFS;
      scriptsRoot?: string;
      editorMode?: boolean;
      importComment?: string;
      onLoadError?: (e: unknown, id: ModuleId) => void;
    } = {}
  ) {
    this._registry = new ScriptRegistry(
      opts.VFS ?? new HttpFS('./'),
      opts.scriptsRoot ?? '/',
      opts.editorMode ?? false
    );
    this._hostScripts = new Map();
    this._scriptHosts = new Map();
    this._importComment = opts.importComment;
    this._onLoadError = opts.onLoadError;
  }

  get registry() {
    return this._registry;
  }

  // Attachs a script to object and returns the script instance
  async attachScript<T extends Host>(host: T, module: string): Promise<RuntimeScript<T>> {
    try {
      const url = await this._registry.resolveRuntimeUrl(module);
      if (!url) {
        return null;
      }
      const mod = await import(url + (this._importComment ?? ''));
      let instance: RuntimeScript<T>;
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
        }
      } else {
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

      const attached: AttachedScript = {
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

      const P = instance.onAttached(host);
      if (P instanceof Promise) {
        await P;
      }
      return attached.instance;
    } catch (e) {
      const moduleName = module ? String(module).slice(0, 64) : '';
      console.error(`Load module '${moduleName}' failed: ${e}`);
      this._onLoadError?.(e, module);
      return null;
    }
  }

  // Detach script from host object
  detachScript<T extends Host>(host: T, idOrInstance?: ModuleId | RuntimeScript<T>) {
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

  // Update script instances
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

  // Detach all script instances
  detachAllScripts() {
    while (this._hostScripts.size > 0) {
      for (const entry of this._hostScripts) {
        this.detachScript(entry[0]);
      }
    }
  }
}
