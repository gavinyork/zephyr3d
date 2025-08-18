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

    const blob = new Blob([moduleCode], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }

  private getGlobalVarName(moduleName: string): string {
    return `__shared_module_${moduleName.replace(/[@\/\-\.]/g, '_')}__`;
  }

  private updateImportMap(name: string, url: string): void {
    this.batchUpdateImportMap({ [name]: url });
  }

  private batchUpdateImportMap(mappings: Record<string, string>): void {
    // Get current importmap
    const currentMap = this.importMapElement?.textContent
      ? JSON.parse(this.importMapElement.textContent)
      : { imports: {} };

    // merge
    const mergedImports = { ...currentMap.imports, ...mappings };

    // rebuild importmap
    this.rebuildImportMap(mergedImports);

    console.log('[ModuleSharing] Updated import map:', mappings);
  }

  private rebuildImportMap(imports: Record<string, string>): void {
    // remove current importmap
    if (this.importMapElement && this.importMapElement.parentNode) {
      this.importMapElement.parentNode.removeChild(this.importMapElement);
      this.importMapElement = null;
    }

    this.importMapElement = document.createElement('script');
    this.importMapElement.type = 'importmap';
    this.importMapElement.textContent = JSON.stringify({ imports }, null, 2);
    document.head.appendChild(this.importMapElement);
  }

  async waitForImportMapReady(): Promise<void> {
    return new Promise((resolve) => {
      const checkReady = () => {
        if (this.importMapElement && document.head.contains(this.importMapElement)) {
          setTimeout(() => resolve(), 100);
        } else {
          setTimeout(checkReady, 10);
        }
      };
      checkReady();
    });
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
      await this.waitForImportMapReady();
      return await import(name);
    } catch (e) {
      console.error(`Failed to import shared module ${name}:`, e);
      console.log(`Falling back to direct module reference for ${name}`);
      return this.sharedModules.get(name);
    }
  }

  cleanup(): void {
    for (const url of this.moduleUrls.values()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }

    // cleanup global variables
    for (const moduleName of this.sharedModules.keys()) {
      const globalVarName = this.getGlobalVarName(moduleName);
      try {
        delete (window as any)[globalVarName];
      } catch (_e) {}
    }

    // remove importmap
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
