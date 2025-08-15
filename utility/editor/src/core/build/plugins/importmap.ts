export type ImportMap = {
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
};

// 读取 DOM importmap（可选）
function readImportMapFromDOM(): ImportMap | null {
  const el = document.querySelector('script[type="importmap"]');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || '{}');
  } catch (e) {
    console.warn('Invalid import map JSON', e);
    return null;
  }
}

// 规范要求的“最长匹配”选择器（支持通配符 key）
function resolveFromSpecifierMap(
  specifierMap: Record<string, string>,
  specifier: string,
  baseURL: string
): string | null {
  let bestKey: string | null = null;

  // 1) 精确匹配先试
  if (specifierMap[specifier]) {
    bestKey = specifier;
  } else {
    // 2) 通配符匹配，选择最长匹配的 key
    for (const key of Object.keys(specifierMap)) {
      const star = key.indexOf('*');
      if (star === -1) continue;
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
        if (!bestKey || key.length > bestKey.length) {
          bestKey = key;
        }
      }
    }
  }

  if (!bestKey) return null;

  const target = specifierMap[bestKey];
  if (bestKey.includes('*')) {
    // 插入中间段
    const star = bestKey.indexOf('*');
    const pre = bestKey.slice(0, star);
    const suf = bestKey.slice(star + 1);
    const middle = specifier.slice(pre.length, specifier.length - suf.length);
    const mapped = target.replace('*', middle);
    return new URL(mapped, baseURL).toString();
  }
  return new URL(target, baseURL).toString();
}

// 选择最适用的 scope（按“最深的父 URL 路径”匹配 importer）
function pickBestScope(
  scopes: Record<string, Record<string, string>>,
  importerURL: string
): Record<string, string> | null {
  let bestScopeUrl: string | null = null;
  for (const scopeURL of Object.keys(scopes)) {
    // 按 URL 前缀匹配（标准中是 URL base 匹配）
    const normalizedScope = new URL(scopeURL, location.href).toString();
    if (importerURL.startsWith(normalizedScope)) {
      if (!bestScopeUrl || normalizedScope.length > new URL(bestScopeUrl, location.href).toString().length) {
        bestScopeUrl = scopeURL;
      }
    }
  }
  return bestScopeUrl ? scopes[bestScopeUrl] : null;
}

export function importMapResolvePlugin(importMap?: ImportMap | 'auto', opts?: { baseURL?: string }) {
  const map = importMap === 'auto' ? readImportMapFromDOM() : importMap ?? null;
  const base = opts?.baseURL ?? location.href;

  return {
    name: 'import-map-resolve',

    async resolveId(source: string, importer?: string) {
      // 只处理“裸模块/别名样式”的 specifier。URL/相对/绝对留给后续插件
      if (source.startsWith('.') || source.startsWith('/') || source.includes(':')) {
        return null;
      }

      const scopes = map?.scopes || {};
      const imports = map?.imports || {};

      // importer 可能是 VFS 路径或 URL，将其转为绝对 URL 用于 scope 选择
      let importerURL: string | null = null;
      if (importer) {
        try {
          // 如果是 URL
          if (/^(https?:|blob:|data:)/.test(importer)) {
            importerURL = importer;
          } else {
            // 将 VFS 路径相对到 baseURL 形成“伪 URL”，仅用于前缀判断
            importerURL = new URL(importer, base).toString();
          }
        } catch {
          importerURL = null;
        }
      }

      // 1) scope 优先：选最深匹配 scope，对应的 specifierMap 做映射
      if (importerURL) {
        const scopeMap = pickBestScope(scopes, importerURL);
        if (scopeMap) {
          const scoped = resolveFromSpecifierMap(scopeMap, source, base);
          if (scoped) return scoped; // 返回绝对 URL（http/https/blob/data）
        }
      }

      // 2) 顶层 imports
      const mapped = resolveFromSpecifierMap(imports, source, base);
      if (mapped) return mapped;

      // 3) 未匹配则交给其他插件（如 VFS/URL 插件或外部）
      return null;
    }
  };
}
