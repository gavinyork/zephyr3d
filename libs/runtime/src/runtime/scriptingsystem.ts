import type { ModuleId } from './types';
import { ScriptRegistry } from './scriptregistry';
import { HttpFS } from '@zephyr3d/base';
import { RuntimeScript } from './runtimescript';

// 你项目中的宿主接口（实体/节点等），至少需要一个 id 或可作为 Map 键
export type Host = unknown;

export interface AttachedScript {
  id: ModuleId;
  url: string; // runtime: 实际 URL；editor: 逻辑 ID 或 data URL（见实现）
  instance: RuntimeScript<any>;
}

export class ScriptingSystem {
  private _registry: ScriptRegistry;
  private _hostScripts = new Map<Host, AttachedScript[]>();
  private _onLoadError?: (e: unknown, id: ModuleId) => void;
  private _importComment?: string;

  constructor(
    opts: {
      importComment?: string;
      onLoadError?: (e: unknown, id: ModuleId) => void;
    } = {}
  ) {
    this._registry = new ScriptRegistry(new HttpFS('./'), '/', false);
    this._importComment = opts.importComment;
    this._onLoadError = opts.onLoadError;
  }

  get registry() {
    return this._registry;
  }

  // 将脚本模块附加到宿主，返回附加记录
  async attachScript(host: Host, module: string): Promise<AttachedScript> {
    try {
      const url = await this._registry.resolveRuntimeUrl(module);
      if (!url) {
        return null;
      }
      const mod = await import(/* @vite-ignore */ url + (this._importComment ?? ''));
      let instance: RuntimeScript<any>;
      if (typeof mod?.default === 'function') {
        // 默认导出类
        instance = new mod.default();
        if (instance instanceof RuntimeScript) {
          const P = instance.onCreated();
          if (P instanceof Promise) {
            await P;
          }
        }
      } else {
        console.warn(`Script '${module}' does not have RuntimeScript class exported as default`);
        return null;
      }

      const attached: AttachedScript = {
        id: module,
        url,
        instance
      };

      let list = this._hostScripts.get(host);
      if (!list) {
        list = [];
        this._hostScripts.set(host, list);
      }
      list.push(attached);
      this.registerHost(host);
      const P = instance.onAttached(host);
      if (P instanceof Promise) {
        await P;
      }
      return attached;
    } catch (e) {
      this._onLoadError?.(e, module);
      return null;
    }
  }

  // 将模块从宿主解绑；idOrInstance 可为 ModuleId 或实际实例对象
  detachScript(host: Host, idOrInstance: ModuleId | any): boolean {
    const list = this._hostScripts.get(host);
    if (!list || list.length === 0) {
      return false;
    }
    let removed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      const hit = typeof idOrInstance === 'string' ? it.id === idOrInstance : it.instance === idOrInstance;
      if (hit) {
        try {
          it.instance.onDetached();
        } catch (err) {
          console.error(`Error occured at onDetach() of module '${it.id}': ${err}`);
        }
        try {
          it.instance.onDestroy();
        } catch (err) {
          console.error(`Error occured at onDestroy() of module '${it.id}': ${err}`);
        }
        list.splice(i, 1);
        removed = true;
      }
    }
    if (list.length === 0) {
      this._hostScripts.delete(host);
      this.unregisterHost(host);
    }
    return removed;
  }

  // 每帧更新：遍历每个宿主的脚本实例，调用其 update
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

  dispose() {
    while (this._hostScripts.size > 0) {
      for (const entry of this._hostScripts) {
        for (const attached of entry[1]) {
          this.detachScript(entry[0], attached.instance);
        }
      }
    }
  }

  // 如果需要对宿主注册事件等，覆写这两个函数；默认空实现
  protected registerHost(_host: Host) {}
  protected unregisterHost(_host: Host) {}
}

export default ScriptingSystem;
