import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme } from 'vitepress';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsRoot = path.resolve(__dirname, '..');
const base = normalizeBase(process.env.DOC_BASE || '/');
const lastUpdatedCache = new Map<string, number>();

function normalizeBase(value: string): string {
  const normalized = value.trim() || '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
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
    const apiPath = cleanHref
      .replace(/^\/?doc\/markdown\/\.?\//, '')
      .trim()
      .toLowerCase()
      .replace(/\.md$/, '')
      .replace(/^index$/, '');
    return apiPath ? `/api/markdown/${apiPath}.html` : '/api/markdown/';
  }
  if (cleanHref === 'doc/markdown/index.md' || cleanHref === '/doc/markdown/index.md') {
    return '/api/markdown/';
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

function apiSidebar(): DefaultTheme.SidebarItem[] {
  return [
    {
      text: 'API Reference',
      items: [
        { text: 'Packages', link: '/api/markdown/' },
        { text: '@zephyr3d/base', link: '/api/markdown/base' },
        { text: '@zephyr3d/device', link: '/api/markdown/device' },
        { text: '@zephyr3d/scene', link: '/api/markdown/scene' },
        { text: '@zephyr3d/loaders', link: '/api/markdown/loaders' },
        { text: '@zephyr3d/imgui', link: '/api/markdown/imgui' },
        { text: '@zephyr3d/backend-webgl', link: '/api/markdown/backend-webgl' },
        { text: '@zephyr3d/backend-webgpu', link: '/api/markdown/backend-webgpu' }
      ]
    }
  ];
}

function getLastUpdated(relativePath: string): number | undefined {
  if (relativePath.startsWith('api/markdown/')) {
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
  srcExclude: ['**/_*.md'],
  transformPageData(pageData) {
    const lastUpdated = getLastUpdated(pageData.filePath);
    return lastUpdated ? { lastUpdated } : undefined;
  },
  head: [['link', { rel: 'icon', href: 'https://cdn.zephyr3d.org/doc/assets/images/favicon.ico' }]],
  markdown: {
    config(md) {
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
    logo: 'https://cdn.zephyr3d.org/doc/assets/images/logo_i.svg',
    nav: [
      {
        text: 'Guide',
        items: [
          { text: 'English', link: '/en/' },
          { text: '简体中文', link: '/zh-cn/' }
        ]
      },
      { text: 'API', link: '/api/markdown/' }
    ],
    sidebar: {
      '/en/': parseSidebar('en/_sidebar.md'),
      '/zh-cn/': parseSidebar('zh-cn/_sidebar.md'),
      '/api/markdown/': apiSidebar()
    },
    search: {
      provider: 'local',
      options: {
        _render(src, env, md) {
          return env.relativePath.startsWith('api/markdown/') ? '' : md.render(src, env);
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
