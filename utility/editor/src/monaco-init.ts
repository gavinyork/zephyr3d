declare global {
  interface Window {
    require?: {
      config?: (config: unknown) => void;
      (modules: string[], callback: () => void): void;
    };
  }
}

const monacoCssHref = './vendor/monaco/vs/editor/editor.main.css';
const monacoLoaderHref = './vendor/monaco/vs/loader.js';
const monacoBaseHref = './vendor/monaco/vs';

const typeFiles = [
  { path: './vendor/zephyr3d/base/dist/index.d.ts', name: '@zephyr3d/base' },
  { path: './vendor/zephyr3d/device/dist/index.d.ts', name: '@zephyr3d/device' },
  { path: './vendor/zephyr3d/scene/dist/index.d.ts', name: '@zephyr3d/scene' },
  { path: './vendor/zephyr3d/imgui/dist/index.d.ts', name: '@zephyr3d/imgui' },
  { path: './vendor/zephyr3d/backend-webgl/dist/index.d.ts', name: '@zephyr3d/backend-webgl' },
  { path: './vendor/zephyr3d/backend-webgpu/dist/index.d.ts', name: '@zephyr3d/backend-webgpu' },
  {
    path: './vendor/zephyr3d/editor/dist/pluginapi/core/pluginapi.d.ts',
    name: '@zephyr3d/editor/editor-plugin'
  }
] as const;

const zephyrPackages = [
  '@zephyr3d/base',
  '@zephyr3d/device',
  '@zephyr3d/scene',
  '@zephyr3d/backend-webgl',
  '@zephyr3d/backend-webgpu',
  '@zephyr3d/editor/editor-plugin'
] as const;

let monacoInitPromise: Promise<void> | null = null;

function ensureMonacoCss() {
  const existing = document.querySelector(`link[data-monaco-editor="true"]`);
  if (existing) {
    return;
  }
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = monacoCssHref;
  css.type = 'text/css';
  css.dataset.monacoEditor = 'true';
  document.head.append(css);
}

function loadScriptOnce(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as any)._loaded) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load script '${src}'`)), {
        once: true
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener(
      'load',
      () => {
        (script as any)._loaded = true;
        resolve();
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error(`Failed to load script '${src}'`)), {
      once: true
    });
    document.head.appendChild(script);
  });
}

function requireModules(modules: string[]) {
  return new Promise<void>((resolve, reject) => {
    const req = window.require;
    if (!req) {
      reject(new Error('Monaco loader is not available'));
      return;
    }
    try {
      req(modules, () => resolve());
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function loadTypeFiles(monaco: any) {
  const loadPromises = typeFiles.map(async (file) => {
    try {
      const response = await fetch(file.path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const content = await response.text();
      const fileName = `file:///node_modules/${file.name}/index.d.ts`;
      monaco.languages.typescript.typescriptDefaults.addExtraLib(content, fileName);
      return { success: true, file: file.path };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to load ${file.path}:`, message);
      return { success: false, file: file.path, error: message };
    }
  });
  return Promise.allSettled(loadPromises);
}

function configureMonacoDefaults(monaco: any) {
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: false,
    strictNullChecks: false,
    noImplicitAny: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    baseUrl: '.',
    typeRoots: ['file:///node_modules/@types'],
    resolveJsonModule: true,
    experimentalDecorators: true,
    useDefineForClassFields: false
  });
}

function registerZephyrCompletionProvider(monaco: any) {
  monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ["'", '"', '/'],
    provideCompletionItems: (model: any, position: any) => {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const importMatch = textUntilPosition.match(/import\s+.*\s+from\s+['"]([^'"]*)$/);
      if (!importMatch) {
        return { suggestions: [] };
      }
      const typedPath = importMatch[1];
      const suggestions = zephyrPackages
        .filter((pkg) => pkg.startsWith(typedPath))
        .map((pkg) => ({
          label: pkg,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: pkg,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - typedPath.length,
            endColumn: position.column
          },
          detail: `Zephyr3D module: ${pkg}`,
          documentation: `Import from ${pkg}`
        }));
      return { suggestions };
    }
  });
}

async function initMonaco() {
  const monaco = (window as any).monaco;
  if (monaco?.languages?.typescript?.typescriptDefaults) {
    return;
  }

  ensureMonacoCss();
  await loadScriptOnce(monacoLoaderHref);

  const anchor = document.createElement('a');
  anchor.href = monacoBaseHref;
  window.require?.config?.({ paths: { vs: anchor.href } });
  (window as any).MonacoEnvironment = {
    getWorkerUrl: () => './vendor/monaco/vs/base/worker/workerMain.js'
  };

  await requireModules(['vs/editor/editor.main']);

  const readyMonaco = (window as any).monaco;
  if (!readyMonaco?.languages?.typescript?.typescriptDefaults) {
    throw new Error('Monaco initialized without TypeScript defaults');
  }

  configureMonacoDefaults(readyMonaco);
  await loadTypeFiles(readyMonaco);
  registerZephyrCompletionProvider(readyMonaco);
  window.dispatchEvent(new Event('monaco-ready'));
}

export function ensureMonacoInitialized() {
  if (!monacoInitPromise) {
    monacoInitPromise = initMonaco().catch((err) => {
      monacoInitPromise = null;
      throw err;
    });
  }
  return monacoInitPromise;
}

void ensureMonacoInitialized().catch((err) => {
  console.error('Monaco initialization failed:', err);
});
