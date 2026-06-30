import type * as TS from 'typescript';
import type { Nullable, VFS } from '@zephyr3d/base';
import { textToBase64 } from '@zephyr3d/base';
import { init, parse } from 'es-module-lexer';
import { getApp } from './api';

/**
 * Converts JavaScript source to a data URL tied to a logical module id.
 *
 * @param js - The JavaScript source code to embed.
 * @param id - Logical module identifier (used only for sourceURL tagging).
 * @returns A `data:text/javascript;base64,...` URL with an encoded `#id` suffix.
 * @internal
 */
function toDataUrl(js: string, id: string) {
  const b64 = textToBase64(js);
  return `data:text/javascript;base64,${b64}#${encodeURIComponent(String(id))}`;
}

/**
 * Checks whether a specifier is an absolute HTTP(S) URL.
 * @internal
 */
function isAbsoluteUrl(spec: string) {
  return /^https?:\/\//i.test(spec);
}

/**
 * Checks whether a specifier is a special URL (data: or blob:).
 * @internal
 */
function isSpecialUrl(spec: string) {
  return /^(data|blob):/i.test(spec);
}

/**
 * Checks whether a specifier is a bare module (not starting with ./, ../, /, or #/).
 * @internal
 */
function isBareModule(spec: string) {
  return !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/') && !spec.startsWith('#/');
}

function splitSpecifierQuery(spec: string) {
  const hashIndex = spec.indexOf('#');
  const queryIndex = spec.indexOf('?');
  const cutIndex =
    queryIndex >= 0 && hashIndex >= 0
      ? Math.min(queryIndex, hashIndex)
      : queryIndex >= 0
        ? queryIndex
        : hashIndex;
  if (cutIndex < 0) {
    return {
      path: spec,
      suffix: ''
    };
  }
  return {
    path: spec.slice(0, cutIndex),
    suffix: spec.slice(cutIndex)
  };
}

function hasRawQuery(spec: string) {
  const { suffix } = splitSpecifierQuery(spec);
  if (!suffix || suffix[0] !== '?') {
    return false;
  }
  const queryEnd = suffix.indexOf('#');
  const query = (queryEnd >= 0 ? suffix.slice(1, queryEnd) : suffix.slice(1)).trim();
  if (!query) {
    return false;
  }
  return query.split('&').some((part) => part.trim() === 'raw');
}

type ScriptModuleType = 'js' | 'ts';

type ScriptModuleInfo = {
  id: string;
  path: string;
  type: ScriptModuleType;
  deps: string[];
  systemCode: string;
};

/**
 * Resolves, builds, and serves runtime modules using a VFS.
 *
 * Responsibilities:
 * - Resolve logical module IDs to physical paths or URLs.
 * - In editor mode, bundle local script modules into a single data URL after transpile.
 * - Transpile TypeScript to JavaScript on the fly (requires `window.ts` TypeScript runtime).
 * - Gather static and dynamic import dependencies for tooling.
 *
 * Modes:
 * - Editor mode (`editorMode === true`): local script graphs are bundled to data URLs.
 * - Runtime mode (`editorMode === false`): returns .js/.mjs URLs directly (with .ts -\> .js mapping).
 *
 * Caching:
 * - Built bundles are memoized in `_built` map keyed by canonical source path.
 *
 * @public
 */
export class ScriptRegistry {
  private _vfs: VFS;
  private _scriptsRoot: string;
  private _built: Map<string, string>; // logicalId -> dataURL
  private _building: Map<string, Promise<string>>;
  private _builtDeps: Map<string, Set<string>>;

  /**
   * @param vfs - The virtual file system for existence checks, reads, and path ops.
   * @param scriptsRoot - Root directory for script resolution (used with `#/` specifiers).
   */
  constructor(vfs: VFS, scriptsRoot: string) {
    this._vfs = vfs;
    this._scriptsRoot = scriptsRoot;
    this._built = new Map();
    this._building = new Map();
    this._builtDeps = new Map();
  }

  /**
   * The active virtual file system.
   *
   * Assigning a new VFS clears the build cache.
   */
  get VFS() {
    return this._vfs;
  }
  set VFS(vfs: VFS) {
    if (vfs !== this._vfs) {
      this._vfs = vfs;
      this._built.clear();
      this._building.clear();
      this._builtDeps.clear();
    }
  }

  /**
   * The root path used by `#/` specifiers.
   */
  get scriptsRoot() {
    return this._scriptsRoot;
  }
  set scriptsRoot(path: string) {
    this._scriptsRoot = path;
  }

  /**
   * Invalidates cached built module output for one logical module id, or clears the full cache.
   *
   * Pass the same logical id shape that callers use with {@link ScriptRegistry.resolveRuntimeUrl},
   * for example `/assets/scripts/foo.ts`, `/assets/scripts/foo.js`, or `/assets/scripts/foo`.
   *
   * @param moduleId - Optional logical module id to invalidate. Omit to clear the entire build cache.
   */
  invalidate(moduleId?: string) {
    if (!moduleId) {
      this._built.clear();
      this._building.clear();
      this._builtDeps.clear();
      return;
    }
    const normalized = String(moduleId);
    const variants = new Set([normalized]);
    if (normalized.endsWith('.ts') || normalized.endsWith('.js')) {
      variants.add(normalized.slice(0, -3));
    } else if (normalized.endsWith('.mjs')) {
      variants.add(normalized.slice(0, -4));
    } else {
      variants.add(`${normalized}.ts`);
      variants.add(`${normalized}.js`);
      variants.add(`${normalized}.mjs`);
    }
    for (const key of variants) {
      this._built.delete(key);
      this._building.delete(key);
      this._builtDeps.delete(key);
    }
    for (const [entryId, deps] of [...this._builtDeps]) {
      for (const variant of variants) {
        if (deps.has(variant)) {
          this._built.delete(entryId);
          this._building.delete(entryId);
          this._builtDeps.delete(entryId);
          break;
        }
      }
    }
  }

  /**
   * Fetches raw source for a logical module id by probing known extensions.
   *
   * Search order:
   * - If `id` already ends with `.ts`, `.js`, or `.mjs` and is a file -\> return it.
   * - Else try `.id.ts`, then `.id.js`, then `.id.mjs`.
   *
   * @param id - Logical module identifier (absolute or logical path-like).
   * @returns Source code, resolved path, and type (`'js' | 'ts'`), or `undefined` if not found.
   */
  protected async fetchSource(id: string) {
    let type: Nullable<'js' | 'ts'> = null;
    let pathWithExt = '';
    if (id.endsWith('.ts')) {
      pathWithExt = id;
      type = 'ts';
    } else if (id.endsWith('.js') || id.endsWith('.mjs')) {
      pathWithExt = id;
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
      for (const t of [...types, 'mjs'] as const) {
        pathWithExt = `${id}.${t}`;
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
    if (type) {
      const code = (await this._vfs.readFile(pathWithExt, { encoding: 'utf8' })) as string;
      return { code, type, path: pathWithExt };
    }
  }

  /**
   * Resolves a module entry to a URL suitable for dynamic import.
   *
   * Behavior:
   * - In editor mode, builds the module to a data URL.
   * - Otherwise, returns `.js` or `.mjs` URL directly:
   *   - If `id` ends with `.js`: return as-is.
   *   - If `id` ends with `.mjs`: return as-is.
   *   - If `id` ends with `.ts`: map to `.js` (assumes pre-built file exists).
   *   - Else: append `.js`.
   *
   * @param entryId - Entry module identifier (logical or path-like).
   * @returns A URL string that can be used in `import(...)`.
   */
  async resolveRuntimeUrl(entryId: string) {
    const id = await this.resolveLogicalId(entryId);
    if (id.startsWith('/assets/@builtins/')) {
      return await this.build(String(id));
    }
    return getApp().editorMode !== 'none'
      ? await this.build(String(id))
      : id.endsWith('.js') || id.endsWith('.mjs')
        ? id
        : id.endsWith('.ts')
          ? `${id.slice(0, -3)}.js`
          : `${id}.js`;
  }

  /**
   * Recursively gathers direct static and dynamic import dependencies for a module.
   *
   * Only relative specifiers (`./` or `../`) are followed. Absolute, special, and bare
   * module specifiers are ignored here.
   *
   * @param entryId - The starting (possibly relative) specifier from `fromId`.
   * @param fromId - The logical id of the module containing `entryId`.
   * @param dependencies - Output map of `resolvedSourcePath -\> file contents`.
   */
  async getDependencies(entryId: string, fromId: string, dependencies: Record<string, string>) {
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

  /**
   * Builds a logical module id into a bundled data URL (editor mode pipeline).
   *
   * Steps:
   * - Resolve source path (.ts/.js) via {@link ScriptRegistry.resolveSourcePath}.
   * - Collect reachable local imports without recursively building data URLs.
   * - Transpile local modules to `System.register`.
   * - Emit a single `data:` URL with a small module loader and memoize it in `_built`.
   *
   * @param id - Logical module id to build.
   * @returns Data URL string for dynamic import, or empty string if not found.
   */
  private async build(id: string) {
    const entry = await this.resolveModuleInfo(String(id));
    if (!entry) {
      return '';
    }

    const key = entry.id;
    const cached = this._built.get(key);
    if (cached) {
      return cached;
    }
    const pending = this._building.get(key);
    if (pending) {
      return await pending;
    }

    const task = this.buildBundle(key);
    this._building.set(key, task);
    try {
      const url = await task;
      if (url) {
        this._built.set(key, url);
      }
      return url;
    } finally {
      this._building.delete(key);
    }
  }

  private async buildBundle(entryId: string) {
    const modules = new Map<string, ScriptModuleInfo>();
    const entry = await this.collectModule(entryId, modules);
    if (!entry) {
      return '';
    }

    const chunks = [this.getSystemBundleRuntime()];
    for (const module of modules.values()) {
      chunks.push(`__z3dRegister(${JSON.stringify(module.id)}, () => {\n${module.systemCode}\n});`);
    }
    chunks.push(
      `const __z3dEntry = await __z3dLoad(${JSON.stringify(entry.id)});\n` +
        `const plugin = __z3dEntry.plugin;\n` +
        `const __z3dDefault = __z3dEntry.default ?? __z3dEntry.plugin ?? __z3dEntry;\n` +
        `export { plugin };\n` +
        `export default __z3dDefault;\n` +
        `//# sourceURL=${entry.id}`
    );

    const url = toDataUrl(chunks.join('\n'), entry.id);
    this._builtDeps.set(entry.id, new Set(modules.keys()));
    return url;
  }

  private async collectModule(id: string, modules: Map<string, ScriptModuleInfo>) {
    const module = await this.resolveModuleInfo(id);
    if (!module) {
      return null;
    }
    if (modules.has(module.id)) {
      return modules.get(module.id)!;
    }

    modules.set(module.id, module);

    const source = (await this._vfs.readFile(module.path, { encoding: 'utf8' })) as string;
    const esmCode = hasRawQuery(module.id)
      ? `export default ${JSON.stringify(source)};\n`
      : await this.transpileToESModule(source, module.id, module.type);
    const rewritten = await this.rewriteImportsToLogicalIds(esmCode, module.id);
    module.deps = rewritten.deps;
    module.systemCode = await this.transpileToSystemModule(rewritten.code, module.id);

    for (const dep of module.deps) {
      await this.collectModule(dep, modules);
    }
    return module;
  }

  private async resolveModuleInfo(id: string): Promise<Nullable<ScriptModuleInfo>> {
    const srcPath = await this.resolveSourcePath(id);
    if (!srcPath) {
      return null;
    }
    const { suffix } = splitSpecifierQuery(String(id));
    const path = this._vfs.normalizePath(srcPath.path);
    return {
      id: `${path}${suffix}`,
      path,
      type: srcPath.type,
      deps: [],
      systemCode: ''
    };
  }

  private getTypeScriptRuntime() {
    const ts = (window as any).ts as typeof TS;
    if (!ts) {
      throw new Error('TypeScript runtime (window.ts) not found. Load typescript.js first.');
    }
    return ts;
  }

  private async transpileToESModule(code: string, _id: string, type: ScriptModuleType) {
    const logicalId = String(_id);

    if (type === 'js') {
      return code;
    }

    const ts = this.getTypeScriptRuntime();

    const res = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        experimentalDecorators: true,
        useDefineForClassFields: false
      },
      fileName: logicalId
    });

    return res.outputText || '';
  }

  private async transpileToSystemModule(code: string, _id: string) {
    const logicalId = String(_id);
    const ts = this.getTypeScriptRuntime();
    const res = ts.transpileModule(code, {
      compilerOptions: {
        allowJs: true,
        // Keep modern syntax such as async generators, class fields, and private fields intact.
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.System,
        esModuleInterop: true,
        experimentalDecorators: true,
        useDefineForClassFields: true
      },
      fileName: logicalId
    });
    return res.outputText || '';
  }

  /**
   * Rewrites local ESM specifiers to canonical source paths and records local deps.
   * External URLs and package imports are left for the native dynamic import path.
   */
  private async rewriteImportsToLogicalIds(code: string, fromId: string) {
    await init;
    const [imports] = parse(code);
    const list = [...imports].sort((a, b) => (a.s || 0) - (b.s || 0));
    const deps = new Set<string>();
    let out = '';
    let last = 0;

    for (const im of list) {
      // Skip import.meta entries reported by es-module-lexer.
      // Their "specifier" span points to the whole "import.meta" expression,
      // which must remain untouched.
      if (im.d === -2) {
        continue;
      }
      // must have quotes
      const hasQuote = im.ss != null && im.se != null;
      if (!hasQuote || im.se <= im.ss) {
        continue;
      }
      // must have contents
      if (im.e <= im.s) {
        continue;
      }
      // append [last, s)
      out += code.slice(last, im.s);

      const spec = code.slice(im.s, im.e); // original spec
      const resolved = await this.resolveImportTarget(spec, String(fromId));
      const replacement = resolved.id ?? spec;
      if (resolved.id) {
        deps.add(resolved.id);
      }
      out += replacement; // Do not wrap in quotes
      last = im.e;
    }
    out += code.slice(last);
    return { code: out, deps: [...deps] };
  }

  private async resolveImportTarget(spec: string, fromId: string) {
    if (isAbsoluteUrl(spec) || isSpecialUrl(spec) || spec.startsWith('@zephyr3d/')) {
      return { id: null };
    }

    const depId = await this.resolveLogicalId(spec, isBareModule(spec) ? undefined : fromId);
    const module = await this.resolveModuleInfo(depId);
    return { id: module?.id ?? null };
  }

  private getSystemBundleRuntime() {
    return `
const __z3dRegistry = new Map();
let __z3dCurrentId = '';
const System = {
  register(deps, declare) {
    if (!__z3dCurrentId) {
      throw new Error('System.register called without module id');
    }
    __z3dRegistry.set(__z3dCurrentId, {
      id: __z3dCurrentId,
      deps,
      declare,
      exports: Object.create(null),
      setters: [],
      execute: null,
      importers: [],
      state: 0
    });
  }
};
function __z3dRegister(id, factory) {
  const prev = __z3dCurrentId;
  __z3dCurrentId = id;
  try {
    factory();
  } finally {
    __z3dCurrentId = prev;
  }
}
function __z3dResolve(spec, parentId) {
  if (__z3dRegistry.has(spec)) {
    return spec;
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = parentId.slice(0, parentId.lastIndexOf('/') + 1);
    return new URL(spec, 'file://' + base).pathname;
  }
  return spec;
}
function __z3dExport(record, name, value) {
  if (name && typeof name === 'object') {
    for (const key of Object.keys(name)) {
      __z3dExport(record, key, name[key]);
    }
    return name;
  }
  record.exports[name] = value;
  for (const notify of record.importers) {
    notify(record.exports);
  }
  return value;
}
async function __z3dLoad(spec, parentId = '') {
  const id = parentId ? __z3dResolve(spec, parentId) : spec;
  const record = __z3dRegistry.get(id);
  if (!record) {
    return await import(id);
  }
  if (record.state === 2 || record.state === 1) {
    return record.exports;
  }
  record.state = 1;
  const declaration = record.declare((name, value) => __z3dExport(record, name, value), {
    id,
    import: (dep) => __z3dLoad(dep, id),
    meta: { url: id }
  }) || {};
  record.setters = declaration.setters || [];
  record.execute = declaration.execute || (() => {});
  for (let i = 0; i < record.deps.length; i++) {
    const depId = __z3dResolve(record.deps[i], id);
    const depRecord = __z3dRegistry.get(depId);
    const depExports = depRecord ? await __z3dLoad(depId) : await import(depId);
    const setter = record.setters[i];
    if (typeof setter === 'function') {
      setter(depExports);
      if (depRecord) {
        depRecord.importers.push((exports) => setter(exports));
      }
    }
  }
  const result = record.execute();
  if (result && typeof result.then === 'function') {
    await result;
  }
  record.state = 2;
  return record.exports;
}
`;
  }

  /**
   * Resolves a specifier to a logical id suitable for further processing.
   *
   * Resolution rules:
   * - `#/path`: resolved against `scriptsRoot` via VFS join/normalize.
   * - `./` or `../`: resolved relative to `fromId` directory (requires `fromId`).
   * - `/absolute`: treated as absolute from root (normalized).
   * - Bare module in editor mode: if `/deps.lock.json` exists and contains an entry,
   *   map to the dependency's `entry` path; otherwise return as-is.
   * - Else (non-editor bare module): return `spec` unchanged (external).
   *
   * @param spec - Import specifier string.
   * @param fromId - Optional base logical id used for relative resolution.
   * @returns A normalized logical id or an external specifier string.
   * @throws If a relative import is provided without `fromId`.
   */
  async resolveLogicalId(spec: string, fromId?: string) {
    const { path: baseSpec, suffix } = splitSpecifierQuery(spec);
    if (baseSpec.startsWith('#/')) {
      return `${this._vfs.normalizePath(this._vfs.join(this._scriptsRoot, baseSpec.slice(2)))}${suffix}`;
    } else if (baseSpec.startsWith('./') || baseSpec.startsWith('../')) {
      if (!fromId) {
        throw new Error(`Relative import "${spec}" requires fromId`);
      }
      const fromPath = splitSpecifierQuery(this._vfs.normalizePath(fromId)).path;
      return `${this._vfs.normalizePath(this._vfs.join(this._vfs.dirname(fromPath), baseSpec))}${suffix}`;
    } else if (baseSpec.startsWith('/')) {
      return `${baseSpec.replace(/^\/+/, '/')}${suffix}`;
    } else if (getApp().editorMode !== 'none') {
      const libRoot = '/'; //this._vfs.normalizePath(this._scriptsRoot || '/');
      // naked module, checking if it is a installed module in editor mode
      let depsLockPath = this._vfs.normalizePath(this._vfs.join(libRoot, 'libs/deps.lock.json'));
      let depsExists = await this._vfs.exists(depsLockPath);
      if (depsExists) {
        const content = (await this._vfs.readFile(depsLockPath, { encoding: 'utf8' })) as string;
        const depsInfo = JSON.parse(content) as { dependencies: Record<string, { entry: string }> };
        if (depsInfo?.dependencies[baseSpec]) {
          return `${this._vfs.normalizePath(this._vfs.join(libRoot, depsInfo.dependencies[baseSpec].entry))}${suffix}`;
        }
      }
    }
    return spec;
  }

  /**
   * Resolves a logical id to a concrete source path and type by probing extensions.
   *
   * Rules:
   * - If `logicalId` ends with `.ts` or `.js`/`.mjs` and is a file, return it.
   * - Else probe `logicalId.ts`, `logicalId.js`, `logicalId.mjs` in that order.
   * - Maps `.mjs` to type `'js'`.
   *
   * @param logicalId - The normalized logical module id (path-like).
   * @returns `{ type, path }` or `null` if not found.
   */
  async resolveSourcePath(logicalId: string) {
    const { path: normalizedLogicalId } = splitSpecifierQuery(logicalId);
    let type: Nullable<'js' | 'ts'> = null;
    let pathWithExt = '';
    if (normalizedLogicalId.endsWith('.ts')) {
      pathWithExt = normalizedLogicalId;
      type = 'ts';
    } else if (normalizedLogicalId.endsWith('.js') || normalizedLogicalId.endsWith('.mjs')) {
      pathWithExt = normalizedLogicalId;
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
        pathWithExt = `${normalizedLogicalId}.${t}`;
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
