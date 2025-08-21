type Monaco = typeof import('monaco-editor');

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LoadTypesOptions {
  fetcher?: Fetcher;
  maxFiles?: number;
  createModels?: boolean;
  typesReferenceMap?: Record<string, string>;
  concurrency?: number; // 并发抓取上限（默认 8）
}

export async function loadTypes(
  packageName: string,
  monaco: Monaco,
  opts: LoadTypesOptions = {}
): Promise<void> {
  const fetcher: Fetcher = opts.fetcher ?? ((i, init) => fetch(i, { redirect: 'follow', ...init }));
  const maxFiles = opts.maxFiles ?? 500;
  const createModels = opts.createModels ?? true;
  const typesRefMap = opts.typesReferenceMap ?? {};
  const concurrency = Math.max(1, opts.concurrency ?? 8);

  // 全局缓存/去重结构（可上移为模块级单例）
  const urlContentCache = new Map<string, string>(); // finalUrl -> content
  const existsCache = new Map<string, boolean>(); // candidateUrl -> existence
  const resolvedModuleUrlCache = new Map<string, string | null>(); // base::spec -> finalUrl|null
  const urlToVirtualPath = new Map<string, string>(); // finalUrl -> virtualPath
  const virtualPathRegistered = new Set<string>(); // virtualPath added
  const visited = new Set<string>(); // 已处理 finalUrl 或入队 URL

  // 注册串行队列，避免竞争导致重复 model
  const registrationQueue: Array<() => void> = [];
  let draining = false;
  function enqueueRegistration(fn: () => void) {
    registrationQueue.push(fn);
    if (!draining) {
      draining = true;
      Promise.resolve().then(() => {
        try {
          let f: (() => void) | undefined;
          while ((f = registrationQueue.shift())) f();
        } finally {
          draining = false;
        }
      });
    }
  }

  function simpleHash(input: string): string {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
      h = (h << 5) - h + input.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(36);
  }

  function toVirtualPath(finalUrl: string): string {
    let vp = urlToVirtualPath.get(finalUrl);
    if (!vp) {
      vp = `file:///types/${simpleHash(finalUrl)}.d.ts`;
      urlToVirtualPath.set(finalUrl, vp);
    }
    return vp;
  }

  function toAbsoluteUrl(maybe: string, base: string): string {
    try {
      return new URL(maybe, base).toString();
    } catch {
      if (/^(data:|blob:|https?:)/i.test(maybe)) return maybe;
      return maybe;
    }
  }

  // 统一抓取：返回最终 URL 和正文，并缓存正文到 finalUrl 键
  async function fetchWithFinalUrl(url: string): Promise<{ finalUrl: string; content: string }> {
    if (url.startsWith('data:')) {
      const content = decodeDataUrlToText(url);
      if (!urlContentCache.has(url)) urlContentCache.set(url, content);
      return { finalUrl: url, content };
    }

    // 若已缓存（以 finalUrl 存），用当前键做一次直取（无法知道重定向），先尝试按 url 命中
    if (urlContentCache.has(url)) {
      return { finalUrl: url, content: urlContentCache.get(url)! };
    }

    // HEAD 获取最终 URL，如果可用可避免重复 GET（有些 CDN 不支持 HEAD）
    try {
      const h = await fetcher(url, { method: 'HEAD' });
      if (h.ok) {
        const finalUrl = h.url || url;
        if (urlContentCache.has(finalUrl)) {
          return { finalUrl, content: urlContentCache.get(finalUrl)! };
        }
        const g = await fetcher(url);
        if (!g.ok) throw new Error(`GET ${url} failed: ${g.status}`);
        const finalUrl2 = g.url || finalUrl;
        const text = await g.text();
        urlContentCache.set(finalUrl2, text);
        return { finalUrl: finalUrl2, content: text };
      }
    } catch {
      // ignore and fallback
    }

    // Fallback: 直接 GET
    const resp = await fetcher(url);
    if (!resp.ok) throw new Error(`GET ${url} failed: ${resp.status}`);
    const finalUrl = resp.url || url;
    const text = await resp.text();
    urlContentCache.set(finalUrl, text);
    return { finalUrl, content: text };
  }

  async function checkExists(url: string): Promise<boolean> {
    if (url.startsWith('data:')) return true;
    const cached = existsCache.get(url);
    if (typeof cached === 'boolean') return cached;
    try {
      const h = await fetcher(url, { method: 'HEAD' });
      if (h.ok) {
        existsCache.set(url, true);
        return true;
      }
      const g = await fetcher(url, { method: 'GET' });
      const ok = g.ok;
      existsCache.set(url, ok);
      return ok;
    } catch {
      existsCache.set(url, false);
      return false;
    }
  }

  function parseDtsDependencies(source: string): {
    paths: string[];
    tripleSlashPaths: string[];
    tripleSlashTypes: string[];
  } {
    const paths = new Set<string>();
    const tsPaths = new Set<string>();
    const tsTypes = new Set<string>();

    const importExportRe =
      /\b(?:import|export)\b(?:[\s\w*{},]+from\s*)?\(\s*["']([^"']+)["']\s*\)|\b(?:import|export)\b[\s\w*{},]*from\s*["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = importExportRe.exec(source))) {
      const spec = m[1] || m[2] || m[3];
      if (spec && isLikelyPathOrUrl(spec)) paths.add(spec);
    }

    const triplePathRe = /\/\/\/\s*<reference\s+path=["']([^"']+)["']\s*\/>/g;
    while ((m = triplePathRe.exec(source))) tsPaths.add(m[1]);

    const tripleTypesRe = /\/\/\/\s*<reference\s+types=["']([^"']+)["']\s*\/>/g;
    while ((m = tripleTypesRe.exec(source))) tsTypes.add(m[1]);

    return { paths: [...paths], tripleSlashPaths: [...tsPaths], tripleSlashTypes: [...tsTypes] };
  }

  function isLikelyPathOrUrl(spec: string): boolean {
    return (
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/') ||
      spec.startsWith('http://') ||
      spec.startsWith('https://') ||
      spec.startsWith('data:')
    );
  }

  function resolveAsTypeScriptModule(spec: string, baseUrl: string): string[] {
    const abs = toAbsoluteUrl(spec, baseUrl);
    if (abs.startsWith('data:')) return [abs];
    const u = tryNewUrl(abs, baseUrl);
    if (!u) return [abs];
    const href = u.toString();
    const hasExt = /\.[a-zA-Z0-9]+$/.test(u.pathname);
    const c: string[] = [];
    if (hasExt) {
      c.push(href);
      if (u.pathname.endsWith('.ts') && !u.pathname.endsWith('.d.ts')) {
        c.unshift(href.replace(/\.ts$/, '.d.ts'));
      } else if (u.pathname.endsWith('.mts')) {
        c.unshift(href.replace(/\.mts$/, '.d.mts'), href.replace(/\.mts$/, '.d.ts'));
      } else if (u.pathname.endsWith('.cts')) {
        c.unshift(href.replace(/\.cts$/, '.d.cts'), href.replace(/\.cts$/, '.d.ts'));
      }
    } else {
      const s = href.endsWith('/') ? href.slice(0, -1) : href;
      c.push(
        s + '.d.ts',
        s + '.ts',
        s + '.mts',
        s + '.cts',
        s + '/index.d.ts',
        s + '/index.ts',
        s + '/index.mts',
        s + '/index.cts'
      );
    }
    return [...new Set(c)];
  }

  function tryNewUrl(input: string, base: string): URL | null {
    try {
      return new URL(input, base);
    } catch {
      return null;
    }
  }

  async function resolveFirstExisting(spec: string, baseUrl: string): Promise<string | null> {
    const key = `${baseUrl}::${spec}`;
    if (resolvedModuleUrlCache.has(key)) return resolvedModuleUrlCache.get(key)!;

    const candidates = resolveAsTypeScriptModule(spec, baseUrl);
    for (const u of candidates) {
      if (await checkExists(u)) {
        resolvedModuleUrlCache.set(key, u);
        return u;
      }
    }
    resolvedModuleUrlCache.set(key, null);
    return null;
  }

  function registerOnce(finalUrl: string, content: string) {
    const virtualPath = toVirtualPath(finalUrl);
    if (virtualPathRegistered.has(virtualPath)) return;
    enqueueRegistration(() => {
      if (!virtualPathRegistered.has(virtualPath)) {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(content, virtualPath);
        if (createModels) {
          const uri = monaco.Uri.parse(virtualPath);
          const existing = monaco.editor.getModel(uri);
          if (!existing) monaco.editor.createModel(content, 'typescript', uri);
        }
        virtualPathRegistered.add(virtualPath);
      }
    });
  }

  // 1) 获取入口 d.ts
  const entryResp = await fetcher(`https://esm.sh/${encodeURIComponent(packageName)}`);
  if (!entryResp.ok)
    throw new Error(
      `Failed to fetch esm.sh entry for ${packageName}: ${entryResp.status} ${entryResp.statusText}`
    );
  const baseForEntry = entryResp.url || `https://esm.sh/${encodeURIComponent(packageName)}`;
  const typesHeader =
    entryResp.headers.get('X-Typescript-Types') || entryResp.headers.get('x-typescript-types');
  if (!typesHeader) throw new Error(`No X-Typescript-Types header for ${packageName}`);
  const typesEntryUrl = toAbsoluteUrl(typesHeader, baseForEntry);

  // 2) 并发受限递归抓取
  const queue: string[] = [typesEntryUrl];
  let processed = 0;

  async function worker() {
    while (queue.length > 0 && processed < maxFiles) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      processed++;
      try {
        const { finalUrl, content } = await fetchWithFinalUrl(url);
        if (!visited.has(finalUrl)) visited.add(finalUrl);

        registerOnce(finalUrl, content);

        const { paths, tripleSlashPaths, tripleSlashTypes } = parseDtsDependencies(content);

        for (const p of paths) {
          const resolved = await resolveFirstExisting(p, finalUrl);
          if (resolved && !visited.has(resolved)) queue.push(resolved);
        }

        for (const p of tripleSlashPaths) {
          const abs = toAbsoluteUrl(p, finalUrl);
          const resolved = await resolveFirstExisting(abs, finalUrl);
          if (resolved && !visited.has(resolved)) queue.push(resolved);
        }

        for (const t of tripleSlashTypes) {
          const mapped = typesRefMap[t];
          if (mapped) {
            const abs = toAbsoluteUrl(mapped, finalUrl);
            if (!visited.has(abs)) queue.push(abs);
          }
        }
      } catch (e) {
        console.warn('Failed to process', url, e);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
}

/* -------------- data: URL 解码 -------------- */
function decodeDataUrlToText(url: string): string {
  const m = url.match(/^data:([^,]*?),(.*)$/s);
  if (!m) throw new Error('Invalid data URL');
  const meta = m[1] || '';
  const data = m[2] || '';
  const isBase64 = /;base64/i.test(meta);

  let raw: string;
  if (isBase64) {
    raw = atob(data);
  } else {
    raw = decodeURIComponent(data.replace(/\+/g, '%20'));
  }

  if (typeof TextDecoder !== 'undefined') {
    const bytes = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return raw;
}
