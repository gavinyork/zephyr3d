import type { VFS } from '@zephyr3d/base';
import { textToBase64 } from '@zephyr3d/base';
import { ScriptRegistry } from '@zephyr3d/runtime';
import type { ModuleId, RegistryOptions } from '@zephyr3d/runtime';

function toDataUrl(js: string, id: string): string {
  const b64 = textToBase64(js);
  return `data:text/javascript;base64,${b64}#${encodeURIComponent(String(id))}`;
}

function isAbsoluteUrl(spec: string): boolean {
  return /^https?:\/\//i.test(spec);
}
function isSpecialUrl(spec: string): boolean {
  return /^(data|blob):/i.test(spec);
}
function isBareModule(spec: string): boolean {
  return !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/') && !spec.startsWith('#/');
}

export class VFSScriptRegistry extends ScriptRegistry {
  private _vfs: VFS;
  private _scriptsRoot: string;
  private _built = new Map<string, string>(); // logicalId -> dataURL

  constructor(opts: RegistryOptions, vfs: VFS, scriptsRoot: string) {
    super(opts);
    this._vfs = vfs;
    this._scriptsRoot = scriptsRoot;
  }

  protected async fetchSource(
    _id: ModuleId
  ): Promise<{ code: string; type: 'js' | 'ts'; sourceMap?: string } | undefined> {
    for (const type of ['ts', 'js']) {
      const pathWithExt = `${_id}.${type}`;
      const exists = await this._vfs.exists(pathWithExt);
      if (exists) {
        const stats = await this._vfs.stat(pathWithExt);
        if (stats.isFile) {
          const code = (await this._vfs.readFile(pathWithExt, { encoding: 'utf8' })) as string;
          return { code, type: type as 'js' | 'ts' };
        }
      }
    }
  }

  async resolveRuntimeUrl(entryId: ModuleId): Promise<string> {
    const id = this.resolveLogicalId(entryId);
    return await this.build(String(id));
  }

  async getDependencies(
    entryId: string,
    fromId: string,
    dependencies: Record<string, string>
  ): Promise<void> {
    const reStatic = /\b(?:import|export)\s+[^"']*?from\s+(['"])([^'"]+)\1/g;
    const reDynamic = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

    const normalizedId = this.resolveLogicalId(entryId, fromId);
    if (dependencies[normalizedId] !== undefined) {
      return;
    }
    const src = await this.fetchSource(normalizedId);
    dependencies[normalizedId] = src.code;

    const gather = async (input: string, re: RegExp) => {
      let last = 0;
      for (;;) {
        const m = re.exec(input);
        if (!m) {
          break;
        }

        const spec = m[2];
        let replacement = spec;

        if (isAbsoluteUrl(spec) || isSpecialUrl(spec) || isBareModule(spec)) {
          replacement = spec;
        } else if (spec.startsWith('./') || spec.startsWith('../')) {
          await this.getDependencies(spec, normalizedId, dependencies);
        }

        last = m.index + m[0].length;
      }
    };

    await gather(src.code, reStatic);
    await gather(src.code, reDynamic);
  }

  private async build(id: string): Promise<string> {
    const key = String(id);
    const cached = this._built.get(key);
    if (cached) {
      return cached;
    }

    const src = await this.fetchSource(key);
    if (!src) {
      throw new Error(`Module not found: ${key}`);
    }

    const rewritten = await this.rewriteImports(src.code, key);
    const js = await this.transpile(rewritten, key, src.type);
    const url = toDataUrl(js, key);
    this._built.set(key, url);
    return url;
  }

  protected async transpile(code: string, _id: ModuleId, type: 'js' | 'ts'): Promise<string> {
    const logicalId = String(_id);

    if (type === 'js') {
      return `${code}\n//# sourceURL=${logicalId}`;
    }

    const ts = (window as any).ts as typeof import('typescript');
    if (!ts) {
      throw new Error('TypeScript runtime (window.ts) not found. Load /vendor/typescript.js first.');
    }

    const res = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2015,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
        inlineSources: true,
        experimentalDecorators: true,
        useDefineForClassFields: false
      },
      fileName: logicalId
    });

    let out = res.outputText || '';
    if (res.sourceMapText) {
      const mapBase64 = btoa(unescape(encodeURIComponent(res.sourceMapText)));
      out += `\n//# sourceMappingURL=data:application/json;base64,${mapBase64}`;
    }
    out += `\n//# sourceURL=${logicalId}`;
    return out;
  }

  protected async rewriteImports(code: string, fromId: ModuleId): Promise<string> {
    if (this.opts.mode !== 'editor') {
      return code;
    }

    const reStatic = /\b(?:import|export)\s+[^"']*?from\s+(['"])([^'"]+)\1/g;
    const reDynamic = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

    const replaceAsync = async (input: string, re: RegExp) => {
      let out = '';
      let last = 0;
      for (;;) {
        const m = re.exec(input);
        if (!m) {
          break;
        }
        out += input.slice(last, m.index);

        const quote = m[1];
        const spec = m[2];
        let replacement = spec;

        if (isAbsoluteUrl(spec) || isSpecialUrl(spec) || isBareModule(spec)) {
          replacement = spec;
        } else {
          const depId = this.resolveLogicalId(spec, String(fromId));
          replacement = await this.build(depId); // 递归构建为 data URL
        }

        const replaced = m[0].replace(`${quote}${spec}${quote}`, `${quote}${replacement}${quote}`);
        out += replaced;
        last = m.index + m[0].length;
      }
      out += input.slice(last);
      return out;
    };

    let out = await replaceAsync(code, reStatic);
    out = await replaceAsync(out, reDynamic);
    return out;
  }

  resolveLogicalId(spec: string, fromId?: string): string {
    let path: string;

    if (spec.startsWith('#/')) {
      path = this._vfs.normalizePath(this._vfs.join(this._scriptsRoot, spec.slice(2)));
    } else if (spec.startsWith('./') || spec.startsWith('../')) {
      if (!fromId) {
        throw new Error(`Relative import "${spec}" requires fromId`);
      }
      path = this._vfs.normalizePath(
        this._vfs.join(this._vfs.dirname(this._vfs.normalizePath(fromId)), spec)
      );
    } else if (spec.startsWith('/')) {
      path = spec.replace(/^\/+/, '/');
    } else {
      return spec;
    }
    return path;
  }
}
