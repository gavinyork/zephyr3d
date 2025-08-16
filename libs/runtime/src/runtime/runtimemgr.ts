import type { VFS } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import { RuntimeScript } from './runtimescript';
import { ModuleId } from './types';

export class RuntimeManager {
  private scriptingSystem: ScriptingSystem;
  private enabled: boolean;
  constructor(VFS?: VFS, scriptsRoot?: string, editorMode?: boolean, enabled?: boolean) {
    this.scriptingSystem = new ScriptingSystem({ VFS, scriptsRoot, editorMode });
    this.enabled = enabled ?? true;
  }
  get VFS() {
    return this.scriptingSystem.registry.VFS;
  }
  detachAllScripts() {
    if (this.enabled) {
      this.scriptingSystem.detachAllScripts();
    }
  }
  async attachScript<T extends Host>(host: T, module: ModuleId): Promise<RuntimeScript<T>> {
    return this.enabled ? await this.scriptingSystem.attachScript(host, module) : null;
  }
  detachScript<T extends Host>(host: T, idOrInstance: ModuleId | RuntimeScript<T>) {
    if (this.enabled) {
      this.scriptingSystem.detachScript(host, idOrInstance);
    }
  }
  update(deltaTime: number, elapsedTime: number) {
    if (this.enabled) {
      this.scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
}
