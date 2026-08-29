import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(docsRoot, 'api');
const generatedTutorialRoot = path.join(docsRoot, 'public', 'tut');
const generatedShowcaseBundle = path.join(docsRoot, 'public', 'js', 'showcase.js');
const base = normalizeBase(process.env.DOC_BASE || '/');
const lastUpdatedCache = new Map<string, number>();
let generatedReloadTimer: ReturnType<typeof setTimeout> | undefined;

function normalizeBase(value: string): string {
  const normalized = value.trim() || '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Reloads the browser when the generated tutorial/showcase output changes.
 *
 * These files are build products, not Vite modules, so they are excluded from
 * Vite's own watcher and handled by a dedicated one here. Letting them reach
 * Vite's HMR pipeline crashed `npm run dev`: the tutorial and showcase watchers
 * start in parallel with VitePress and write into `web/public` immediately, and
 * a change arriving before `@vitejs/plugin-vue` has run `buildStart` hit its
 * `handleHotUpdate` while `options.compiler` was still null
 * ("Cannot read properties of null (reading 'invalidateTypeCache')").
 * Returning `[]` from our own hook could not prevent that, because Vite runs
 * every `handleHotUpdate` hook regardless of what earlier ones return.
 */
const generatedAssetReloadPlugin = {
  name: 'reload-generated-doc-assets',
  config() {
    // These become picomatch patterns, which only match POSIX separators, so a
    // Windows path has to be normalized. Glob metacharacters that can appear in
    // a real path are escaped.
    const toGlob = (target: string) =>
      target
        .split(path.sep)
        .join('/')
        .replace(/[()[\]{}!*?]/g, '\\$&');
    return {
      server: {
        watch: {
          ignored: [`${toGlob(generatedTutorialRoot)}/**`, toGlob(generatedShowcaseBundle)]
        }
      }
    };
  },
  configureServer(server: {
    ws: { send: (payload: object) => void };
    httpServer?: { once: (event: string, listener: () => void) => void } | null;
  }) {
    const scheduleReload = () => {
      if (generatedReloadTimer) {
        return;
      }
      generatedReloadTimer = setTimeout(() => {
        generatedReloadTimer = undefined;
        server.ws.send({ type: 'full-reload', path: '*' });
      }, 50);
    };
    // Either path may be missing before the first tutorial/showcase build.
    const watchers: fs.FSWatcher[] = [];
    for (const [target, options] of [
      [generatedTutorialRoot, { recursive: true }],
      [generatedShowcaseBundle, {}]
    ] as const) {
      if (fs.existsSync(target)) {
        watchers.push(fs.watch(target, options, scheduleReload));
      }
    }
    server.httpServer?.once('close', () => {
      for (const watcher of watchers) {
        watcher.close();
      }
    });
  }
};

// VitePress treats the line expression in a code snippet (for example,
// `{113-186 js}`) as a list of lines to highlight.  Documentation snippets use
// the expression to select the lines that should be included instead, so slice
// the file before VitePress's snippet renderer passes it to the highlighter.
const snippetLineRange = /\{(\d+(?:[,-]\d+)*)\}/;

function selectSnippetLines(content: string, expression: string): string | undefined {
  const sourceLines = content.replace(/\r\n/g, '\n').split('\n');
  const selected = new Set<number>();

  for (const range of expression.split(',')) {
    const [startText, endText] = range.split('-');
    const start = Number.parseInt(startText, 10);
    const end = endText ? Number.parseInt(endText, 10) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      continue;
    }
    for (let line = start; line <= Math.min(end, sourceLines.length); line++) {
      selected.add(line);
    }
  }

  if (!selected.size) {
    return undefined;
  }
  return sourceLines.filter((_line, index) => selected.has(index + 1)).join('\n');
}

function configureSnippetLineSelection(md: {
  renderer: { rules: Record<string, (...args: any[]) => string> };
}) {
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (...args) => {
    const token = args[0][args[1]] as { src?: [string, string]; info: string; content: string };
    // Region snippets are still handled by VitePress's native region parser;
    // this override only changes the meaning of standalone line expressions.
    const rangeMatch = token.src && !token.src[1] ? snippetLineRange.exec(token.info) : undefined;
    if (!rangeMatch) {
      return defaultFence(...args);
    }

    const [snippetPath] = token.src;
    if (!fs.existsSync(snippetPath) || !fs.statSync(snippetPath).isFile()) {
      return defaultFence(...args);
    }

    const selected = selectSnippetLines(fs.readFileSync(snippetPath, 'utf8'), rangeMatch[1]);
    if (selected === undefined) {
      return defaultFence(...args);
    }

    // Keep the include dependency used by VitePress's watcher, while hiding the
    // source path from the built-in renderer so it does not replace our content.
    const env = args[3] as { includes?: string[] } | undefined;
    env?.includes?.push(snippetPath);
    const source = token.src;
    const info = token.info;
    const content = token.content;
    token.src = undefined;
    token.content = selected;
    token.info = token.info.replace(rangeMatch[0], '').trim();
    try {
      return defaultFence(...args);
    } finally {
      token.src = source;
      token.info = info;
      token.content = content;
    }
  };
}

// API reference pages are generated by TypeDoc (typedoc-plugin-markdown) under web/api,
// organised as /api/<package>/src/<kind>/<TypeName>.md (kind = classes|interfaces|...).
// The guide markdown still links to the legacy api-documenter scheme,
// e.g. /doc/markdown/./device.abstractdevice.createvertexbuffer .
// We build a lookup from the generated tree so those legacy links keep working
// without editing the guide sources: `<package>.<typename>` (lowercased) -> page link.
const API_KIND_DIRS = ['classes', 'interfaces', 'enumerations', 'type-aliases', 'functions', 'variables'];

function buildApiSymbolMap(): Map<string, string> {
  const map = new Map<string, string>();
  let packages: string[] = [];
  try {
    packages = fs
      .readdirSync(apiRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return map;
  }
  for (const pkg of packages) {
    for (const kind of API_KIND_DIRS) {
      const kindDir = path.join(apiRoot, pkg, kind);
      let files: string[] = [];
      try {
        files = fs.readdirSync(kindDir).filter((f) => f.endsWith('.md'));
      } catch {
        continue;
      }
      for (const file of files) {
        const typeName = file.replace(/\.md$/, '');
        const key = `${pkg}.${typeName}`.toLowerCase();
        // First match wins; type kinds are listed in priority order above.
        if (!map.has(key)) {
          map.set(key, `/api/${pkg}/${kind}/${typeName}.html`);
        }
      }
    }
  }
  return map;
}

const apiSymbolMap = buildApiSymbolMap();

function resolveLegacyApiLink(target: string): string {
  // target like "device.abstractdevice.createvertexbuffer" or "device.abstractdevice"
  const clean = target.trim().toLowerCase().replace(/\.md$/, '');
  if (!clean || clean === 'index') {
    return '/api/';
  }
  const parts = clean.split('.');
  // Find the longest leading "<package>.<typename>" prefix that maps to a page;
  // any remaining trailing segments form the in-page member anchor.
  for (let end = Math.min(parts.length, 2); end >= 2; end--) {
    const key = parts.slice(0, end).join('.');
    const link = apiSymbolMap.get(key);
    if (link) {
      const anchor = parts.slice(end).join('');
      return anchor ? `${link}#${anchor}` : link;
    }
  }
  // Package-level link (e.g. "device") -> package entry page.
  if (parts.length === 1 && apiSymbolMap.size) {
    return `/api/${parts[0]}/`;
  }
  return '/api/';
}

function normalizeDocLink(href: string): string {
  const cleanHref = href.trim();
  if (!cleanHref) {
    return cleanHref;
  }
  if (/^(https?:)?\/\//.test(cleanHref) || cleanHref.startsWith('#')) {
    return cleanHref;
  }
  if (/^\/?doc\/markdown\/\.?\//.test(cleanHref)) {
    const target = cleanHref.replace(/^\/?doc\/markdown\/\.?\//, '');
    return resolveLegacyApiLink(target);
  }
  if (cleanHref === 'doc/markdown/index.md' || cleanHref === '/doc/markdown/index.md') {
    return '/api/';
  }
  return cleanHref;
}

function parseSidebar(relativePath: string): DefaultTheme.SidebarItem[] {
  const sidebarPath = path.join(docsRoot, relativePath);
  const content = fs.readFileSync(sidebarPath, 'utf8');
  const roots: DefaultTheme.SidebarItem[] = [];
  const stack: Array<{ indent: number; item: DefaultTheme.SidebarItem }> = [];

  for (const line of content.split(/\r?\n/)) {
    const match = /^(\s*)-\s+(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const rawText = match[2].trim();
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rawText);
    const item: DefaultTheme.SidebarItem = linkMatch
      ? {
          text: linkMatch[1],
          link: `/${linkMatch[2].replace(/\.md$/, '').replace(/\\/g, '/')}`
        }
      : {
          text: rawText,
          items: []
        };

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (stack.length) {
      const parent = stack[stack.length - 1].item;
      parent.items = parent.items || [];
      parent.items.push(item);
    } else {
      roots.push(item);
    }

    stack.push({ indent, item });
  }

  return roots;
}

function readApiSidebar(): DefaultTheme.SidebarItem[] {
  // TypeDoc (typedoc-vitepress-theme) writes the API sidebar tree here at build time.
  // Each top-level node is a package (named via the @module tag in its index.ts),
  // already shaped as: package -> kind (Classes/Interfaces/...) -> symbol.
  try {
    return JSON.parse(fs.readFileSync(path.join(apiRoot, 'typedoc-sidebar.json'), 'utf8'));
  } catch {
    return [];
  }
}

/** First path segment under /api/ for a sidebar entry, e.g. `scene`. */
function apiPackageDir(item: DefaultTheme.SidebarItem): string | undefined {
  const link = item.link;
  if (typeof link === 'string') {
    return link.split('/').filter(Boolean)[1];
  }
  for (const child of item.items ?? []) {
    const found = apiPackageDir(child);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Per-package sidebars for the API reference.
 *
 * A single `/api/` sidebar holding all ~1590 symbols is server-rendered into
 * every one of the ~1569 generated pages, which made the sidebar markup dominate
 * both build time and output size. Scoping by package means a page only carries
 * its own package's tree plus a short list of the other packages.
 */
function apiSidebars(): DefaultTheme.SidebarMulti {
  const packages = readApiSidebar();
  if (!packages.length) {
    return {};
  }

  const links = packages.map((pkg) => {
    const dir = apiPackageDir(pkg);
    return { text: pkg.text ?? dir ?? '', link: dir ? `/api/${dir}/` : '/api/' };
  });

  const sidebars: DefaultTheme.SidebarMulti = {};
  packages.forEach((pkg, index) => {
    const dir = apiPackageDir(pkg);
    if (!dir) {
      return;
    }
    sidebars[`/api/${dir}/`] = [
      { text: 'API Reference', items: links.filter((_link, i) => i !== index) },
      { text: pkg.text ?? dir, items: pkg.items ?? [] }
    ];
  });
  // Landing page and anything not under a package directory.
  sidebars['/api/'] = [{ text: 'API Reference', items: links }];
  return sidebars;
}

function getLastUpdated(relativePath: string): number | undefined {
  if (relativePath.startsWith('api/')) {
    return undefined;
  }

  const cached = lastUpdatedCache.get(relativePath);
  if (cached !== undefined) {
    return cached || undefined;
  }

  const result = spawnSync('git', ['log', '-1', '--pretty=%ct', '--', relativePath], {
    cwd: docsRoot,
    encoding: 'utf8'
  });
  const timestamp = result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) * 1000 : 0;
  lastUpdatedCache.set(relativePath, Number.isFinite(timestamp) ? timestamp : 0);
  return timestamp || undefined;
}

export default defineConfig({
  title: 'Zephyr3d',
  description: 'Zephyr3d documentation',
  base,
  outDir: '../dist/web',
  metaChunk: true,
  cleanUrls: false,
  lastUpdated: false,
  ignoreDeadLinks: true,
  // The ~1569 generated API pages dominate build time. Set DOC_SKIP_API=1 to
  // exclude them when iterating on the guides or the examples; never use it for
  // a release build, which must contain the API reference.
  srcExclude: process.env.DOC_SKIP_API ? ['**/_*.md', 'api/**'] : ['**/_*.md'],
  transformPageData(pageData) {
    const lastUpdated = getLastUpdated(pageData.filePath);
    return lastUpdated ? { lastUpdated } : undefined;
  },
  head: [['link', { rel: 'icon', href: 'https://cdn.zephyr3d.org/doc/assets/images/favicon.ico' }]],
  vite: {
    plugins: [generatedAssetReloadPlugin]
  },
  markdown: {
    config(md) {
      configureSnippetLineSelection(md);
      const defaultLinkOpen =
        md.renderer.rules.link_open ||
        ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const hrefIndex = token.attrIndex('href');
        if (hrefIndex >= 0 && token.attrs) {
          token.attrs[hrefIndex][1] = normalizeDocLink(token.attrs[hrefIndex][1]);
        }
        return defaultLinkOpen(tokens, idx, options, env, self);
      };
    }
  },
  themeConfig: {
    logo: 'https://cdn.zephyr3d.org/doc/assets/images/icon.png',
    nav: [
      {
        text: 'Guide',
        items: [
          { text: 'English', link: '/en/' },
          { text: '简体中文', link: '/zh-cn/' }
        ]
      },
      { text: 'API', link: '/api/' }
    ],
    sidebar: {
      '/en/': parseSidebar('en/_sidebar.md'),
      '/zh-cn/': parseSidebar('zh-cn/_sidebar.md'),
      // More specific /api/<pkg>/ keys must come before the /api/ fallback.
      ...apiSidebars()
    },
    search: {
      provider: 'local',
      options: {
        // The API reference is large (1500+ generated pages). Indexing the full
        // body (signatures, parameter tables, inherited-from notes) bloated the
        // local search index to ~28MB. For API pages we index only the type name
        // (H1) and member names (H3) — the identifiers users actually search for —
        // dropping generic section labels (H2: "Methods"/"Properties") and the
        // ~32k boilerplate sub-headings (H4: "Returns"/"Parameters"/"Inherited from").
        // This keeps symbol search sharp while shrinking the index dramatically.
        // Guide pages keep full-text indexing.
        _render(src, env, md) {
          if (env.relativePath.startsWith('api/')) {
            const symbolsOnly = src
              .replace(/```[\s\S]*?```/g, '') // drop fenced code blocks first
              .split(/\r?\n/)
              .filter((line) => /^#\s+/.test(line) || /^###\s+/.test(line))
              .join('\n');
            return md.render(symbolsOnly, env);
          }
          return md.render(src, env);
        },
        locales: {
          'zh-cn': {
            translations: {
              button: {
                buttonText: '搜索',
                buttonAriaLabel: '搜索'
              },
              modal: {
                displayDetails: '显示详情',
                resetButtonTitle: '清除查询',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到结果',
                footer: {
                  selectText: '选择',
                  selectKeyAriaLabel: 'enter',
                  navigateText: '切换',
                  navigateUpKeyAriaLabel: 'up arrow',
                  navigateDownKeyAriaLabel: 'down arrow',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'escape'
                }
              }
            }
          }
        }
      }
    },
    outline: {
      level: [2, 3]
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/gavinyork/zephyr3d' }],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Zephyr3d'
    }
  }
});
