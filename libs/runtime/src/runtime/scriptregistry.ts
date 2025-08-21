import type { VFS } from '@zephyr3d/base';
import { textToBase64 } from '@zephyr3d/base';
import type { ModuleId } from './types';
import { init, parse } from 'es-module-lexer';

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

export class ScriptRegistry {
  private _vfs: VFS;
  private _scriptsRoot: string;
  private _built = new Map<string, string>(); // logicalId -> dataURL
  private _editorMode = false;

  constructor(vfs: VFS, scriptsRoot: string, editorMode: boolean) {
    this._vfs = vfs;
    this._scriptsRoot = scriptsRoot;
    this._editorMode = editorMode;
  }

  get VFS() {
    return this._vfs;
  }
  set VFS(vfs: VFS) {
    if (vfs !== this._vfs) {
      this._vfs = vfs;
      this._built.clear();
    }
  }

  get editorMode() {
    return this._editorMode;
  }
  set editorMode(val: boolean) {
    this._editorMode = val;
  }

  get scriptsRoot() {
    return this._scriptsRoot;
  }
  set scriptsRoot(path: string) {
    this._scriptsRoot = path;
  }

  protected async fetchSource(
    _id: ModuleId
  ): Promise<{ code: string; path: string; type: 'js' | 'ts'; sourceMap?: string } | undefined> {
    let type: 'js' | 'ts' = null;
    let pathWithExt = '';
    if (_id.endsWith('.ts')) {
      pathWithExt = _id;
      type = 'ts';
    } else if (_id.endsWith('.js')) {
      pathWithExt = _id;
      type = 'js';
    }
    if (type) {
      const exists = await this._vfs.exists(pathWithExt);
      if (!exists) {
        type = null;
      }
      const stat = await this._vfs.stat(pathWithExt);
      if (stat.isDirectory) {
        type = null;
      }
    }
    const types = ['ts', 'js'] as const;
    if (!type) {
      for (const t of types) {
        pathWithExt = `${_id}.${t}`;
        const exists = await this._vfs.exists(pathWithExt);
        if (exists) {
          const stats = await this._vfs.stat(pathWithExt);
          if (stats.isFile) {
            type = t;
            break;
          }
        }
      }
    }
    if (type) {
      const code = (await this._vfs.readFile(pathWithExt, { encoding: 'utf8' })) as string;
      return { code, type, path: pathWithExt };
    }
  }

  async resolveRuntimeUrl(entryId: ModuleId): Promise<string> {
    const id = await this.resolveLogicalId(entryId);
    return this._editorMode
      ? await this.build(String(id))
      : id.endsWith('.js')
      ? id
      : id.endsWith('.ts')
      ? `${id.slice(0, -3)}.js`
      : `${id}.js`;
  }

  async getDependencies(
    entryId: string,
    fromId: string,
    dependencies: Record<string, string>
  ): Promise<void> {
    const reStatic = /\b(?:import|export)\s+[^"']*?from\s+(['"])([^'"]+)\1/g;
    const reDynamic = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

    const normalizedId = await this.resolveLogicalId(entryId, fromId);
    const srcPath = await this.resolveSourcePath(normalizedId);
    if (!srcPath || dependencies[srcPath.path] !== undefined) {
      return;
    }
    const code = (await this._vfs.readFile(srcPath.path, { encoding: 'utf8' })) as string;
    dependencies[srcPath.path] = code;

    const gather = async (input: string, re: RegExp) => {
      for (;;) {
        const m = re.exec(input);
        if (!m) {
          break;
        }

        const spec = m[2];

        if (spec.startsWith('./') || spec.startsWith('../')) {
          await this.getDependencies(spec, normalizedId, dependencies);
        }
      }
    };

    await gather(code, reStatic);
    await gather(code, reDynamic);
  }

  private async build(id: string): Promise<string> {
    const key = String(id);
    const cached = this._built.get(key);
    if (cached) {
      return cached;
    }

    const srcPath = await this.resolveSourcePath(key);
    if (!srcPath) {
      return '';
    }
    const code = (await this._vfs.readFile(srcPath.path, { encoding: 'utf8' })) as string;

    const rewritten = await this.rewriteImports(code, key);
    const js = await this.transpile(rewritten, key, srcPath.type);
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
      throw new Error('TypeScript runtime (window.ts) not found. Load typescript.js first.');
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
    await init;
    const [imports] = parse(code);

    // 保证按起点排序，避免错位
    const list = [...imports].sort((a, b) => (a.s || 0) - (b.s || 0));

    let out = '';
    let last = 0;

    for (const im of list) {
      // 必须有字符串字面量边界（有引号）
      if (!im.ss || !im.se || im.se <= im.ss) {
        continue;
      }
      // 必须有内容区间
      if (im.e <= im.s) {
        continue;
      }

      // 追加 [last, s)：这段包含壳和开引号之前的所有代码
      out += code.slice(last, im.s);

      const spec = code.slice(im.s, im.e); // 原始 spec（无引号）

      let replacement = spec;

      if (isAbsoluteUrl(spec) || isSpecialUrl(spec) || isBareModule(spec)) {
        if (spec.startsWith('@zephyr3d/')) {
          replacement = spec;
        } else {
          const depId = await this.resolveLogicalId(spec);
          replacement = await this.build(depId); // 尝试构建为依赖项
        }
      } else {
        const depId = await this.resolveLogicalId(spec, String(fromId));
        replacement = await this.build(depId); // 递归构建为 data URL
      }

      // 仅替换引号内部内容，不动引号本身
      //const replacedInner = depsPathOf(childAbs, name, version);
      out += replacement; // 不加引号

      // 将 last 设为 e（引号内内容的结束位置）
      last = im.e;
    }

    // 追加尾部原文（包括最后一个引号、分号等）
    out += code.slice(last);
    return out;
    /*
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
          if (spec.startsWith('@zephyr3d/')) {
            replacement = spec;
          } else {
            const depId = await this.resolveLogicalId(spec);
            replacement = await this.build(depId); // 尝试构建为依赖项
          }
        } else {
          const depId = await this.resolveLogicalId(spec, String(fromId));
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
    */
  }

  async resolveLogicalId(spec: string, fromId?: string): Promise<string> {
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
    } else if (this._editorMode) {
      // naked module, checking if it is a installed module in editor mode
      const depsExists = await this._vfs.exists('/deps.lock.json');
      if (depsExists) {
        const content = (await this._vfs.readFile('/deps.lock.json', { encoding: 'utf8' })) as string;
        const depsInfo = JSON.parse(content) as { dependencies: Record<string, { entry: string }> };
        if (depsInfo?.dependencies[spec]) {
          path = this._vfs.normalizePath(depsInfo.dependencies[spec].entry);
        }
      }
    } else {
      return spec;
    }
    return path;
  }

  async resolveSourcePath(logicalId: string) {
    let type: 'js' | 'ts' = null;
    let pathWithExt = '';
    if (logicalId.endsWith('.ts')) {
      pathWithExt = logicalId;
      type = 'ts';
    } else if (logicalId.endsWith('.js') || logicalId.endsWith('.mjs')) {
      pathWithExt = logicalId;
      type = 'js';
    }
    if (type) {
      const exists = await this._vfs.exists(pathWithExt);
      if (!exists) {
        type = null;
      }
      const stat = await this._vfs.stat(pathWithExt);
      if (stat.isDirectory) {
        type = null;
      }
    }
    const types = ['ts', 'js', 'mjs'] as const;
    if (!type) {
      for (const t of types) {
        pathWithExt = `${logicalId}.${t}`;
        const exists = await this._vfs.exists(pathWithExt);
        if (exists) {
          const stats = await this._vfs.stat(pathWithExt);
          if (stats.isFile) {
            type = t === 'ts' ? 'ts' : 'js';
            break;
          }
        }
      }
    }
    return type ? { type, path: pathWithExt } : null;
  }
}
