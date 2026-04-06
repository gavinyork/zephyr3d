declare const __DEV__: boolean;
declare const __ZEPHYR3D_MONACO_PACKAGES__: Array<{
  name: string;
  devEntry: string;
  devRoot: string;
  prodDts: string;
  useSourceInDev: boolean;
}>;
declare const monaco: any;
declare const require: {
  config: (config: Record<string, unknown>) => void;
  (deps: string[], callback: () => void): void;
};

type MonacoPackage = (typeof __ZEPHYR3D_MONACO_PACKAGES__)[number];

const zephyrPackages = __ZEPHYR3D_MONACO_PACKAGES__;

function appendCss() {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = './vendor/monaco/vs/editor/editor.main.css';
  css.type = 'text/css';
  document.head.append(css);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadMonaco() {
  appendCss();
  await loadScript('./vendor/monaco/vs/loader.js');
  const a = document.createElement('a');
  a.href = './vendor/monaco/vs';
  require.config({ paths: { vs: a.href } });
  window.MonacoEnvironment = {
    getWorkerUrl() {
      return './vendor/monaco/vs/base/worker/workerMain.js';
    }
  };
  await new Promise<void>((resolve) => {
    require(['vs/editor/editor.main'], () => resolve());
  });
}

function createVirtualFileName(pkg: MonacoPackage, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `file:///node_modules/${pkg.name}/${normalized}`;
}

function parseRelativeImports(source: string) {
  const imports = new Set<string>();
  const importExportRe =
    /\b(?:import|export)\b(?:[\s\w*{},]+from\s*)?\(\s*["']([^"']+)["']\s*\)|\b(?:import|export)\b[\s\w*{},]*from\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = importExportRe.exec(source))) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier?.startsWith('./') || specifier?.startsWith('../')) {
      imports.add(specifier);
    }
  }
  return [...imports];
}

function resolveRelativeCandidates(specifier: string, baseUrl: string) {
  const resolved = new URL(specifier, baseUrl);
  const href = resolved.toString();
  if (/\.[a-z0-9]+$/i.test(resolved.pathname)) {
    return [href];
  }
  const base = href.endsWith('/') ? href.slice(0, -1) : href;
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.d.ts`
  ];
}

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}

async function tryFetchFirst(candidates: string[]) {
  for (const url of candidates) {
    try {
      const content = await fetchText(url);
      return { url, content };
    } catch {
      // keep trying
    }
  }
  return null;
}

async function loadDevSourceTypes(pkg: MonacoPackage) {
  const visited = new Set<string>();
  const pending = [pkg.devEntry];
  const defaults = monaco.languages.typescript.typescriptDefaults;

  while (pending.length > 0) {
    const currentUrl = pending.shift();
    if (!currentUrl || visited.has(currentUrl)) {
      continue;
    }
    visited.add(currentUrl);

    let content: string;
    try {
      content = await fetchText(currentUrl);
    } catch (error) {
      console.warn(`Failed to load ${currentUrl}:`, (error as Error).message);
      continue;
    }

    const relativePath = currentUrl.startsWith(pkg.devRoot)
      ? currentUrl.slice(pkg.devRoot.length).replace(/^\/+/, '')
      : currentUrl.split('/').pop() ?? 'index.ts';
    defaults.addExtraLib(content, createVirtualFileName(pkg, relativePath));

    for (const specifier of parseRelativeImports(content)) {
      const resolved = await tryFetchFirst(resolveRelativeCandidates(specifier, currentUrl));
      if (resolved && !visited.has(resolved.url)) {
        pending.push(resolved.url);
      }
    }
  }
}

async function loadProdTypes(pkg: MonacoPackage) {
  try {
    const content = await fetchText(pkg.prodDts);
    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      `file:///node_modules/${pkg.name}/index.d.ts`
    );
  } catch (error) {
    console.warn(`Failed to load ${pkg.prodDts}:`, (error as Error).message);
  }
}

async function loadZephyrTypes() {
  for (const pkg of zephyrPackages) {
    if (__DEV__ && pkg.useSourceInDev) {
      await loadDevSourceTypes(pkg);
    } else {
      await loadProdTypes(pkg);
    }
  }
}

function configureTypeScript() {
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
    baseUrl: 'file:///',
    typeRoots: ['file:///node_modules/@types'],
    resolveJsonModule: true
  });
}

function registerPackageCompletion() {
  monaco.languages.registerCompletionItemProvider('typescript', {
    triggerCharacters: ["'", '"', '/'],
    provideCompletionItems: (model, position) => {
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
      const suggestions = [];
      for (const pkg of zephyrPackages) {
        if (pkg.name.startsWith(typedPath)) {
          suggestions.push({
            label: pkg.name,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: pkg.name,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column - typedPath.length,
              endColumn: position.column
            },
            detail: `Zephyr3D module: ${pkg.name}`,
            documentation: `Import from ${pkg.name}`
          });
        }
      }
      return { suggestions };
    }
  });
}

async function bootstrapMonaco() {
  await loadMonaco();
  configureTypeScript();
  await loadZephyrTypes();
  registerPackageCompletion();
}

void bootstrapMonaco();
