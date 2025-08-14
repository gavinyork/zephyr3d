import { VFS } from '@zephyr3d/base';
import ScriptingSystem from './scriptingsystem';

export class RuntimeManager {
  private static scriptingSystem: ScriptingSystem = null;
  static async init(vfs: VFS, scriptsRoot: string, editorMode: boolean) {
    // init scripting system
    if (!this.scriptingSystem) {
      this.scriptingSystem = new ScriptingSystem();
    }
    this.scriptingSystem.registry.VFS = vfs;
    this.scriptingSystem.registry.scriptsRoot = scriptsRoot;
    this.scriptingSystem.registry.editorMode = editorMode;
    // load startup script if exists
    await this.scriptingSystem.attachScript(null, '#/index');
  }
  static dispose() {
    if (this.scriptingSystem) {
      this.scriptingSystem.dispose();
    }
  }
  static update(deltaTime: number, elapsedTime: number) {
    if (this.scriptingSystem) {
      this.scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
}
