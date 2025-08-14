/**
 * ScriptingSystem
 * - 负责将模块加载委托给 ScriptRegistry
 * - 负责实例化模块（支持默认导出类、create 工厂、或直接模块对象）
 * - 负责绑定/解绑到宿主，并在每帧调用已附加脚本的 update
 *
 * 依赖：
 * - ScriptRegistry（见下个 Artifact）
 * - 可选：VFSScriptRegistry（editor 模式使用 SystemJS 的实现，见第三个 Artifact）
 */

import type { ModuleId } from './types';
import { ScriptRegistry } from './scriptregistry';
import { HttpFS } from '@zephyr3d/base';

// 你项目中的宿主接口（实体/节点等），至少需要一个 id 或可作为 Map 键
export type Host = unknown;

// 外部传入的脚本描述（要附加哪个模块、初始属性）
export interface ScriptDescriptor {
  module: ModuleId; // 逻辑模块 ID（不带扩展名）；runtime 模式可为 URL 映射的 key
  props?: Record<string, any>;
}

// 附加后的脚本记录
export interface AttachedScript {
  id: ModuleId;
  url: string; // runtime: 实际 URL；editor: 逻辑 ID 或 data URL（见实现）
  instance: any;
  props?: Record<string, any>;
  dispose?: () => void;
  update?: (dt: number, time: number) => void;
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
  async attachScript(host: Host, desc: ScriptDescriptor): Promise<AttachedScript | undefined> {
    const { module, props } = desc;
    try {
      const url = await this._registry.resolveRuntimeUrl(module);
      const mod = await import(/* @vite-ignore */ url + (this._importComment ?? ''));

      let instance: any;
      let disposer: undefined | (() => void);
      let updater: undefined | ((dt: number, time: number) => void);

      if (typeof mod?.default === 'function') {
        // 默认导出类
        instance = new mod.default(host, props);
        if (typeof instance.init === 'function') {
          await instance.init();
        }
        if (typeof instance.dispose === 'function') {
          disposer = () => instance.dispose();
        }
        if (typeof instance.update === 'function') {
          updater = (dt, t) => instance.update(dt, t);
        }
      } else if (typeof mod?.create === 'function') {
        // 工厂函数
        instance = await mod.create(host, props);
        if (instance && typeof instance.dispose === 'function') {
          disposer = () => instance.dispose();
        }
        if (instance && typeof instance.update === 'function') {
          updater = (dt, t) => instance.update(dt, t);
        }
      } else {
        // 模块命名空间
        instance = mod;
        if (typeof mod?.dispose === 'function') {
          disposer = () => mod.dispose(host);
        }
        if (typeof mod?.update === 'function') {
          updater = (dt, t) => mod.update(host, dt, t);
        }
      }

      const attached: AttachedScript = {
        id: module,
        url,
        instance,
        props,
        dispose: disposer,
        update: updater
      };

      let list = this._hostScripts.get(host);
      if (!list) {
        list = [];
        this._hostScripts.set(host, list);
      }
      list.push(attached);
      this.registerHost(host);
      return attached;
    } catch (e) {
      this._onLoadError?.(e, desc.module);
      return undefined;
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
      const hit =
        typeof idOrInstance === 'string' || typeof idOrInstance === 'number'
          ? it.id === idOrInstance
          : it.instance === idOrInstance;
      if (hit) {
        try {
          it.dispose?.();
        } catch {
          // ignore user disposer errors
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
          s.update?.(deltaTime, elapsedTime);
        } catch {
          // ignore user update errors
        }
      }
    }
  }

  // 如果需要对宿主注册事件等，覆写这两个函数；默认空实现
  protected registerHost(_host: Host) {}
  protected unregisterHost(_host: Host) {}
}

export default ScriptingSystem;
