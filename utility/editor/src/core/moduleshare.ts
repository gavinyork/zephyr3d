import { textToBase64 } from '@zephyr3d/base';

/**
 * Runtime module sharing system
 */
export class RuntimeModuleSharing {
  private sharedModules = new Map<string, any>();
  private moduleUrls = new Map<string, string>();
  private importMapElement: HTMLScriptElement | null = null;

  shareModule(name: string, moduleExports: any): void {
    console.log(`[ModuleSharing] Sharing module: ${name}`);
    this.sharedModules.set(name, moduleExports);
    const moduleUrl = this.createModuleDataUrl(name, moduleExports);
    this.moduleUrls.set(name, moduleUrl);
    this.updateImportMap(name, moduleUrl);
    console.log(`[ModuleSharing] Module ${name} is now available for import`);
  }

  shareModules(modules: Record<string, any>): void {
    console.log(`[ModuleSharing] Sharing ${Object.keys(modules).length} modules`);

    const urlMappings: Record<string, string> = {};
    for (const [name, moduleExports] of Object.entries(modules)) {
      this.sharedModules.set(name, moduleExports);
      const moduleUrl = this.createModuleDataUrl(name, moduleExports);
      this.moduleUrls.set(name, moduleUrl);
      urlMappings[name] = moduleUrl;
    }

    this.batchUpdateImportMap(urlMappings);
    console.log('[ModuleSharing] All modules shared:', Object.keys(modules));
  }

  private createModuleDataUrl(name: string, moduleExports: any): string {
    let moduleCode = '';

    if (moduleExports.default !== undefined) {
      moduleCode += `export { default } from '${this.getGlobalVarName(name)}';\n`;
    } else {
      moduleCode += `export default window['${this.getGlobalVarName(name)}'];\n`;
    }

    const exportedKeys = Object.keys(moduleExports).filter((key) => key !== 'default');
    if (exportedKeys.length > 0) {
      moduleCode += `const __module = window['${this.getGlobalVarName(name)}'];\n`;
      for (const key of exportedKeys) {
        moduleCode += `export const ${key} = __module.${key};\n`;
      }
    }

    const globalVarName = this.getGlobalVarName(name);
    (window as any)[globalVarName] = moduleExports;

    const encoded = textToBase64(moduleCode); // btoa(unescape(encodeURIComponent(moduleCode)));
    return `data:text/javascript;base64,${encoded}`;
  }

  private getGlobalVarName(moduleName: string): string {
    return `__shared_module_${moduleName.replace(/[@\/\-\.]/g, '_')}__`;
  }

  private updateImportMap(name: string, url: string): void {
    this.batchUpdateImportMap({ [name]: url });
  }

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

  isModuleShared(name: string): boolean {
    return this.sharedModules.has(name);
  }

  getSharedModules(): string[] {
    return Array.from(this.sharedModules.keys());
  }

  async importSharedModule(name: string): Promise<any> {
    if (!this.isModuleShared(name)) {
      throw new Error(`Module ${name} is not shared`);
    }

    try {
      /* @vite-ignore */
      return await import(this.moduleUrls.get(name)!);
    } catch (e) {
      console.error(`Failed to import shared module ${name}:`, e);
      return this.sharedModules.get(name);
    }
  }

  cleanup(): void {
    for (const moduleName of this.sharedModules.keys()) {
      const globalVarName = this.getGlobalVarName(moduleName);
      try {
        delete (window as any)[globalVarName];
      } catch (_e) {}
    }

    if (this.importMapElement && this.importMapElement.parentNode) {
      this.importMapElement.parentNode.removeChild(this.importMapElement);
      this.importMapElement = null;
    }

    this.sharedModules.clear();
    this.moduleUrls.clear();
  }
}

export const moduleSharing = new RuntimeModuleSharing();

declare global {
  interface Window {
    moduleSharing: RuntimeModuleSharing;
  }
}

if (typeof window !== 'undefined') {
  window.moduleSharing = moduleSharing;
}

export default RuntimeModuleSharing;
