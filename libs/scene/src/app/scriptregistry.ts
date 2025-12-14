import type * as TS from 'typescript';
import type { VFS } from '@zephyr3d/base';
import { textToBase64 } from '@zephyr3d/base';
import { init, parse } from 'es-module-lexer';
import type { EditorMode } from './app';

/**
 * Converts JavaScript source to a data URL tied to a logical module id.
 *
 * @param js - The JavaScript source code to embed.
 * @param id - Logical module identifier (used only for sourceURL tagging).
 * @returns A `data:text/javascript;base64,...` URL with an encoded `#id` suffix.
 * @internal
 */
function toDataUrl(js: string, id: string): string {
  const b64 = textToBase64(js);
  return `data:text/javascript;base64,${b64}#${encodeURIComponent(String(id))}`;
}

/**
 * Checks whether a specifier is an absolute HTTP(S) URL.
 * @internal
 */
function isAbsoluteUrl(spec: string): boolean {
  return /^https?:\/\//i.test(spec);
}

/**
 * Checks whether a specifier is a special URL (data: or blob:).
 * @internal
 */
function isSpecialUrl(spec: string): boolean {
  return /^(data|blob):/i.test(spec);
}

/**
 * Checks whether a specifier is a bare module (not starting with ./, ../, /, or #/).
 * @internal
 */
function isBareModule(spec: string): boolean {
  return !spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/') && !spec.startsWith('#/');
}

/**
 * Resolves, builds, and serves runtime modules using a VFS.
 *
 * Responsibilities:
 * - Resolve logical module IDs to physical paths or URLs.
 * - In editor mode, rewrite import specifiers and serve modules as data URLs after transpile.
 * - Transpile TypeScript to JavaScript on the fly (requires `window.ts` TypeScript runtime).
 * - Gather static and dynamic import dependencies for tooling.
 *
 * Modes:
 * - Editor mode (`editorMode === true`): modules are rewritten to data URLs after transpile/build.
 * - Runtime mode (`editorMode === false`): returns .js URLs directly (with .ts -\> .js mapping).
 *
 * Caching:
 * - Built modules are memoized in `_built` map keyed by logical ID.
 *
 * @public
 */
export class ScriptRegistry {
  private _vfs: VFS;
  private _scriptsRoot: string;
  private _built: Map<string, string>; // logicalId -> dataURL
  private _editorMode: EditorMode;

  /**
   * @param vfs - The virtual file system for existence checks, reads, and path ops.
   * @param scriptsRoot - Root directory for script resolution (used with `#/` specifiers).
   * @param editorMode - Whether to build modules to data URLs and rewrite imports.
   */
  constructor(vfs: VFS, scriptsRoot: string, editorMode: EditorMode) {
    this._vfs = vfs;
    this._scriptsRoot = scriptsRoot;
    this._built = new Map();
    this._editorMode = editorMode;
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
    }
  }

  /**
   * Whether the registry operates in editor mode (rewrite/build to data URLs).
   */
  get editorMode() {
    return this._editorMode;
  }
  set editorMode(val: EditorMode) {
    this._editorMode = val;
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
   * Fetches raw source for a logical module id by probing known extensions.
   *
   * Search order:
   * - If `id` already ends with `.ts` or `.js` and is a file -\> return it.
   * - Else try `.id.ts`, then `.id.js`.
   *
   * @param id - Logical module identifier (absolute or logical path-like).
   * @returns Source code, resolved path, and type (`'js' | 'ts'`), or `undefined` if not found.
   */
  protected async fetchSource(
    id: string
  ): Promise<{ code: string; path: string; type: 'js' | 'ts'; sourceMap?: string } | undefined> {
    let type: 'js' | 'ts' = null;
    let pathWithExt = '';
    if (id.endsWith('.ts')) {
      pathWithExt = id;
      type = 'ts';
    } else if (id.endsWith('.js')) {
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
      for (const t of types) {
        pathWithExt = `${id}.${t}`;
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

  /**
   * Resolves a module entry to a URL suitable for dynamic import.
   *
   * Behavior:
   * - In editor mode, builds the module to a data URL.
   * - Otherwise, returns `.js` URL directly:
   *   - If `id` ends with `.js`: return as-is.
   *   - If `id` ends with `.ts`: map to `.js` (assumes pre-built file exists).
   *   - Else: append `.js`.
   *
   * @param entryId - Entry module identifier (logical or path-like).
   * @returns A URL string that can be used in `import(...)`.
   */
  async resolveRuntimeUrl(entryId: string): Promise<string> {
    const id = await this.resolveLogicalId(entryId);
    return this._editorMode !== 'none'
      ? await this.build(String(id))
      : id.endsWith('.js')
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

  /**
   * Builds a logical module id into a data URL (editor mode pipeline).
   *
   * Steps:
   * - Resolve source path (.ts/.js) via {@link ScriptRegistry.resolveSourcePath}.
   * - Read source code.
   * - Rewrite import specifiers via {@link ScriptRegistry.rewriteImports}.
   * - Transpile TypeScript if needed via {@link ScriptRegistry.transpile}.
   * - Convert to `data:` URL and memoize in `_built`.
   *
   * @param id - Logical module id to build.
   * @returns Data URL string for dynamic import, or empty string if not found.
   */
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

  /**
   * Transpiles code to JavaScript and appends sourceURL/sourceMap hints.
   *
   * Behavior:
   * - For `'js'`, returns code with `//# sourceURL=logicalId`.
   * - For `'ts'`, requires `window.ts` (TypeScript compiler) to be present and
   *   transpiles to ES2015/ESNext module with inline source maps.
   *
   * @param code - Source code to transpile.
   * @param _id - Logical module id (used for fileName/sourceURL).
   * @param type - Source type (`'js' | 'ts'`).
   * @returns Transpiled JavaScript source.
   * @throws If TypeScript runtime is not found for TS input.
   */
  private async transpile(code: string, _id: string, type: 'js' | 'ts'): Promise<string> {
    const logicalId = String(_id);

    if (type === 'js') {
      return `${code}\n//# sourceURL=${logicalId}`;
    }

    const ts = (window as any).ts as typeof TS;
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

  /**
   * Rewrites ESM import specifiers in `code` into runtime-loadable URLs.
   *
   * Parsing:
   * - Uses `es-module-lexer` to find import spans; sorts them ascending by start.
   *
   * Replacement rules:
   * - Skip invalid spans or ones without quoted specifiers.
   * - If spec is absolute URL, special URL (data:, blob:), or bare module:
   *   - If it starts with `@zephyr3d/`, keep as-is (external).
   *   - Otherwise resolve to a logical id and attempt to `build` it (if available).
   * - Else (relative spec), resolve from `fromId` and `build` recursively.
   *
   * Output:
   * - Directly writes the replacement specifier without re-adding quotes,
   *   so replacements must themselves be quoted or be valid URLs/data URLs.
   *
   * @param code - Module source code to transform.
   * @param fromId - The logical id of the current module (resolution base for relatives).
   * @returns Transformed source with rewritten import specifiers.
   */
  private async rewriteImports(code: string, fromId: string): Promise<string> {
    await init;
    const [imports] = parse(code);
    const list = [...imports].sort((a, b) => (a.s || 0) - (b.s || 0));
    let out = '';
    let last = 0;

    for (const im of list) {
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
      let replacement = spec;
      if (isAbsoluteUrl(spec) || isSpecialUrl(spec) || isBareModule(spec)) {
        if (spec.startsWith('@zephyr3d/')) {
          replacement = spec;
        } else {
          const depId = await this.resolveLogicalId(spec);
          replacement = await this.build(depId); // try build as dependence
        }
      } else {
        const depId = await this.resolveLogicalId(spec, String(fromId));
        replacement = await this.build(depId); // recursively build as dataURL
      }
      out += replacement; // 不加引号
      last = im.e;
    }
    out += code.slice(last);
    return out;
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
    } else if (this._editorMode !== 'none') {
      // naked module, checking if it is a installed module in editor mode
      const depsExists = await this._vfs.exists('/libs/deps.lock.json');
      if (depsExists) {
        const content = (await this._vfs.readFile('/libs/deps.lock.json', { encoding: 'utf8' })) as string;
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
