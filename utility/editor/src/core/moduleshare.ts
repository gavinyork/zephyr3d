/**
 * 运行时模块共享系统
 * 主应用可以将已打包的模块动态暴露给子模块使用
 */
export class RuntimeModuleSharing {
  private sharedModules = new Map<string, any>();
  private moduleUrls = new Map<string, string>();
  private importMapElement: HTMLScriptElement | null = null;

  /**
   * 主应用注册要共享的模块
   * @param name 模块名称（如 '@zephyr3d/base'）
   * @param moduleExports 模块的导出内容
   */
  shareModule(name: string, moduleExports: any): void {
    console.log(`[ModuleSharing] Sharing module: ${name}`);

    // 1. 存储模块内容
    this.sharedModules.set(name, moduleExports);

    // 2. 创建一个 data URL，包含模块的导出
    const moduleUrl = this.createModuleDataUrl(name, moduleExports);
    this.moduleUrls.set(name, moduleUrl);

    // 3. 更新 import map，让浏览器知道如何解析这个模块
    this.updateImportMap(name, moduleUrl);

    console.log(`[ModuleSharing] Module ${name} is now available for import`);
  }

  /**
   * 批量共享多个模块
   */
  shareModules(modules: Record<string, any>): void {
    console.log(`[ModuleSharing] Sharing ${Object.keys(modules).length} modules`);

    // 批量创建 data URLs
    const urlMappings: Record<string, string> = {};

    for (const [name, moduleExports] of Object.entries(modules)) {
      this.sharedModules.set(name, moduleExports);
      const moduleUrl = this.createModuleDataUrl(name, moduleExports);
      this.moduleUrls.set(name, moduleUrl);
      urlMappings[name] = moduleUrl;
    }

    // 批量更新 import map
    this.batchUpdateImportMap(urlMappings);

    console.log('[ModuleSharing] All modules shared:', Object.keys(modules));
  }

  /**
   * 创建模块的 data URL
   */
  private createModuleDataUrl(name: string, moduleExports: any): string {
    // 创建一个 ES 模块，导出所有内容
    let moduleCode = '';

    // 导出默认导出
    if (moduleExports.default !== undefined) {
      moduleCode += `export { default } from '${this.getGlobalVarName(name)}';\n`;
    } else {
      moduleCode += `export default window['${this.getGlobalVarName(name)}'];\n`;
    }

    // 导出具名导出
    const exportedKeys = Object.keys(moduleExports).filter((key) => key !== 'default');
    if (exportedKeys.length > 0) {
      moduleCode += `const __module = window['${this.getGlobalVarName(name)}'];\n`;
      for (const key of exportedKeys) {
        moduleCode += `export const ${key} = __module.${key};\n`;
      }
    }

    // 将模块内容存储到全局变量
    const globalVarName = this.getGlobalVarName(name);
    (window as any)[globalVarName] = moduleExports;

    // 创建 data URL
    const encoded = btoa(unescape(encodeURIComponent(moduleCode)));
    return `data:text/javascript;base64,${encoded}`;
  }

  /**
   * 生成全局变量名
   */
  private getGlobalVarName(moduleName: string): string {
    return `__shared_module_${moduleName.replace(/[@\/\-\.]/g, '_')}__`;
  }

  /**
   * 更新 import map
   */
  private updateImportMap(name: string, url: string): void {
    this.batchUpdateImportMap({ [name]: url });
  }

  /**
   * 批量更新 import map
   */
  private batchUpdateImportMap(mappings: Record<string, string>): void {
    if (!this.importMapElement) {
      this.importMapElement = document.createElement('script');
      this.importMapElement.type = 'importmap';
      document.head.appendChild(this.importMapElement);
    }

    const currentMap = this.importMapElement.textContent
      ? JSON.parse(this.importMapElement.textContent)
      : { imports: {} };

    Object.assign(currentMap.imports, mappings);

    this.importMapElement.textContent = JSON.stringify(currentMap, null, 2);

    console.log('[ModuleSharing] Updated import map:', mappings);
  }

  /**
   * 检查模块是否已共享
   */
  isModuleShared(name: string): boolean {
    return this.sharedModules.has(name);
  }

  /**
   * 获取已共享的模块列表
   */
  getSharedModules(): string[] {
    return Array.from(this.sharedModules.keys());
  }

  /**
   * 动态导入共享模块（用于测试）
   */
  async importSharedModule(name: string): Promise<any> {
    if (!this.isModuleShared(name)) {
      throw new Error(`Module ${name} is not shared`);
    }

    try {
      /* @vite-ignore */
      return await import(this.moduleUrls.get(name)!);
    } catch (e) {
      console.error(`Failed to import shared module ${name}:`, e);
      // 回退：直接返回存储的模块
      return this.sharedModules.get(name);
    }
  }

  /**
   * 清理所有共享模块
   */
  cleanup(): void {
    // 清理全局变量
    for (const moduleName of this.sharedModules.keys()) {
      const globalVarName = this.getGlobalVarName(moduleName);
      try {
        delete (window as any)[globalVarName];
      } catch (_e) {}
    }

    // 清理 import map
    if (this.importMapElement && this.importMapElement.parentNode) {
      this.importMapElement.parentNode.removeChild(this.importMapElement);
      this.importMapElement = null;
    }

    this.sharedModules.clear();
    this.moduleUrls.clear();
  }
}

// 导出单例
export const moduleSharing = new RuntimeModuleSharing();

// 全局访问
declare global {
  interface Window {
    moduleSharing: RuntimeModuleSharing;
  }
}

if (typeof window !== 'undefined') {
  window.moduleSharing = moduleSharing;
}

export default RuntimeModuleSharing;

/*
import * as zephyr3d_base from '@zephyr3d/base';
import * as zephyr3d_device from '@zephyr3d/device';
// ... 其他模块

// 方案1：使用运行时模块共享
import { moduleSharing } from './runtime-module-sharing';

// 主应用启动时，共享模块
moduleSharing.shareModules({
  '@zephyr3d/base': zephyr3d_base,
  '@zephyr3d/device': zephyr3d_device,
  '@zephyr3d/scene': zephyr3d_scene,
  '@zephyr3d/runtime': zephyr3d_runtime
});

// 现在子模块可以正常使用 import 语句了！
const userScript = `
  import { Vector3, Matrix4 } from '@zephyr3d/base';
  import { Device } from '@zephyr3d/device';

  export function createScene() {
    const pos = new Vector3(1, 2, 3);
    const matrix = new Matrix4();
    return { pos, matrix };
  }
`;

// 子模块现在可以通过标准 ES modules 语法导入
const userModule = await import('data:text/javascript;base64,' + btoa(userScript));
 */
