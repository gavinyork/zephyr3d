/**
 * Minimal browser-side deps installer + Rollup plugin for your VFS.
 * - Registry: esm.sh (pluggable)
 * - Stores modules under /deps/{name}@{version}/...
 * - Writes /deps.lock.json
 * - Rollup resolves bare imports via the lock and loads code from VFS
 *
 * Requires:
 * - es-module-lexer
 * - Your VFS class (as provided)
 */

import type { VFS } from '@zephyr3d/base';
import { init, parse } from 'es-module-lexer';

/* -------------------- Utilities -------------------- */

async function sha256Base64(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const b = String.fromCharCode(...new Uint8Array(digest));
  return 'sha256-' + btoa(b);
}

/* -------------------- Lockfile Types -------------------- */

export type LockEntry = {
  version: string;
  entry: string; // /deps/name@version/mod.js
  url: string; // CDN entry URL
  integrity?: string; // optional
};

export type LockFile = {
  registry: 'esm.sh' | 'jspm.io';
  dependencies: Record<string, LockEntry>;
};

/* -------------------- Lockfile IO -------------------- */

export async function readLock(vfs: VFS, projectRoot: string): Promise<LockFile | null> {
  const p = vfs.join(projectRoot, 'deps.lock.json');
  if (!(await vfs.exists(p))) return null;
  const text = (await vfs.readFile(p, { encoding: 'utf8' })) as string;
  try {
    return JSON.parse(text) as LockFile;
  } catch (e) {
    console.warn('Invalid deps.lock.json, ignoring:', e);
    return null;
  }
}

export async function writeLock(vfs: VFS, projectRoot: string, lock: LockFile): Promise<void> {
  const p = vfs.join(projectRoot, 'deps.lock.json');
  const pretty = JSON.stringify(lock, null, 2);
  await vfs.writeFile(p, pretty, { encoding: 'utf8', create: true });
}

/* -------------------- Registry Resolve (esm.sh) -------------------- */

export type ResolvedPkg = { name: string; version: string; entryUrl: string };

/**
 * 轻量级 semver 工具：解析简单范围并返回满足的最高版本
 * 仅支持常见范围：^ ~ x * >= <= > < = 精确
 */
function cmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}
function maxSatisfying(
  versions: string[],
  range: string | undefined,
  latest: string | undefined
): string | null {
  if (!versions.length) return latest ?? null;
  // 规范化、排序
  const vs = versions.filter((v) => /^\d+\.\d+\.\d+/.test(v)).sort((a, b) => cmp(a, b));

  if (!range || range === 'latest') return vs.at(-1) ?? latest ?? null;

  range = range.trim();

  // 星号或x
  if (range === '*' || /x/i.test(range)) return vs.at(-1) ?? null;

  // 精确
  if (/^\d+\.\d+\.\d+(-.*)?$/.test(range)) {
    return vs.includes(range) ? range : null;
  }

  // ^major.minor.patch
  const mCaret = range.match(/^\^(\d+)\.(\d+)\.(\d+)/);
  if (mCaret) {
    const [M, m, p] = mCaret.slice(1).map((n) => parseInt(n, 10));
    const floor = `${M}.${m}.${p}`;
    // < (M+1).0.0
    const ceil = `${M + 1}.0.0`;
    const candidates = vs.filter((v) => cmp(v, floor) >= 0 && cmp(v, ceil) < 0);
    return candidates.at(-1) ?? null;
  }

  // ~major.minor.patch 或 ~major.minor
  const mTilde = range.match(/^~(\d+)\.(\d+)(?:\.(\d+))?/);
  if (mTilde) {
    const M = parseInt(mTilde[1], 10);
    const m = parseInt(mTilde[2], 10);
    const p = mTilde[3] ? parseInt(mTilde[3], 10) : 0;
    const floor = `${M}.${m}.${p}`;
    const ceil = `${M}.${m + 1}.0`;
    const candidates = vs.filter((v) => cmp(v, floor) >= 0 && cmp(v, ceil) < 0);
    return candidates.at(-1) ?? null;
  }

  // 关系运算符：>= <= > < =
  const mRel = range.match(/^(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)/);
  if (mRel) {
    const op = mRel[1];
    const ver = mRel[2];
    const candidates = vs.filter((v) => {
      const c = cmp(v, ver);
      if (op === '>=') return c >= 0;
      if (op === '<=') return c <= 0;
      if (op === '>') return c > 0;
      if (op === '<') return c < 0;
      if (op === '=') return c === 0;
      return false;
    });
    return candidates.at(-1) ?? null;
  }

  // 未识别，回退 latest
  return vs.at(-1) ?? latest ?? null;
}

/**
 * 从 esm.sh 获取 package.json（已转发 npm registry 的精简信息）
 */
async function fetchPackageJson(name: string): Promise<any | null> {
  try {
    const url = `https://esm.sh/${name}/package.json`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 解析包规范，优先尝试从 res.url 直接得到 version；
 * 若未包含具体版本，则读取 package.json 并用 semver 解析范围以确定具体版本。
 */
export async function resolveOnEsmSh(pkgSpec: string): Promise<ResolvedPkg> {
  const m = pkgSpec.match(/^(@?[^@]+)(?:@(.+))?$/);
  if (!m) throw new Error(`Invalid spec: ${pkgSpec}`);
  const [, name, rangeRaw] = m;
  const range = rangeRaw?.trim();

  // 第一次探测
  const probe = `https://esm.sh/${name}${range ? '@' + encodeURIComponent(range) : ''}`;
  const res = await fetch(probe, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed resolving ${pkgSpec}: ${res.status}`);

  // 解析最终 URL 的 pathname，先 decode
  const u = new URL(res.url);
  const decodedPath = decodeURIComponent(u.pathname).replace(/^\/v\d+\//, '/');
  const direct = decodedPath.match(/\/(@?[^/@]+)@(\d+\.\d+\.\d+(?:[-+][^\/]+)?)(?:\/|$)/);

  if (direct) {
    // 直接得到了具体版本
    const version = direct[2];
    u.search = '';
    u.hash = '';
    return { name, version, entryUrl: u.toString() };
  }

  // 未包含具体版本——读取 package.json
  const pkg = await fetchPackageJson(name);
  if (!pkg) {
    // 最后兜底：无 package.json，只能使用“latest”作为版本名（不推荐，但避免中断）
    const version = 'latest';
    const entryUrl = `https://esm.sh/${name}@${version}`;
    return { name, version, entryUrl };
  }

  const versions: string[] = Object.keys(pkg.versions ?? {}).length
    ? Object.keys(pkg.versions)
    : Array.isArray(pkg.version)
    ? pkg.version
    : [];
  const latest: string | undefined =
    (pkg['dist-tags'] && (pkg['dist-tags'].latest as string)) || pkg.version || undefined;

  const resolved = maxSatisfying(versions, range, latest);
  if (!resolved) {
    // 仍解析不到，使用 latest 或报错
    if (latest) {
      return { name, version: latest, entryUrl: `https://esm.sh/${name}@${latest}` };
    }
    throw new Error(`Cannot resolve concrete version for ${name} with range "${range ?? 'latest'}"`);
  }

  const entryUrl = `https://esm.sh/${name}@${resolved}`;
  return { name, version: resolved, entryUrl };
}

/* -------------------- Path mapping -------------------- */

export function depsPathOf(cdnUrl: string, name: string, version: string): string {
  const u = new URL(cdnUrl);
  // 1) 去掉 /vNNN/ 与多余的前缀（保留包层之后的子路径）
  let p = u.pathname.replace(/^\/v\d+\//, '/'); // /v133/... → /...
  // 2) 找到 name@version 的锚点，并剥离其前缀
  const anchor = `${name}@${version}`;
  const idx = p.indexOf(anchor);
  let sub = '';
  if (idx >= 0) {
    sub = p.slice(idx + anchor.length); // 例如 "", "/es2022/three.mjs", "/examples/jsm/..."
  } else {
    // 某些边缘路径不含显式 name@version（少见），退化处理：以根为全部子路径
    sub = p;
  }

  // 3) 去掉常见的构建层前缀（esm.sh 可能注入的目录），仅保留包内相对路径
  // 例如 "/es2022/three.mjs" → "/three.mjs"
  sub = sub.replace(/^\/(es\d+|stable|dev|node|browser)\//, '/');

  // 4) 标准化：确保以 "/" 开头
  if (!sub.startsWith('/')) sub = '/' + sub;

  // 5) 若没有文件名（目录）则补 mod.js
  const last = sub.split('/').pop()!;
  const isDirLike = sub.endsWith('/') || !last.includes('.');
  if (isDirLike) sub = (sub.endsWith('/') ? sub : sub + '/') + 'mod.js';

  // 6) 去掉 query/hash（本地键稳定），注意：抓取请求时仍用原始 URL
  return `/deps/${name}@${version}${sub}`;
}

/* -------------------- Install (crawl + rewrite) -------------------- */

export async function crawlAndCache(vfs: VFS, entryUrl: string, name: string, version: string) {
  await init;
  const queue: string[] = [entryUrl];
  const seen = new Set<string>();

  while (queue.length) {
    const url = queue.pop()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const localPath = depsPathOf(url, name, version);
    if (await vfs.exists(localPath)) continue;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${url} (${res.status})`);
    const code = await res.text();

    const [imports] = parse(code);

    // 保证按起点排序，避免错位
    const list = [...imports].sort((a, b) => (a.s || 0) - (b.s || 0));

    let out = '';
    let last = 0;

    for (const im of list) {
      // 必须有字符串字面量边界（有引号）
      if (!im.ss || !im.se || im.se <= im.ss) continue;
      // 必须有内容区间
      if (im.e <= im.s) continue;

      // 追加 [last, s)：这段包含壳和开引号之前的所有代码
      out += code.slice(last, im.s);

      const specRaw = code.slice(im.s, im.e); // 原始 spec（无引号）

      // 解析为绝对 URL
      let childAbs: string;
      let replaced: string;
      if (specRaw.startsWith('http')) {
        childAbs = specRaw;
        replaced = `./${vfs.relative(depsPathOf(specRaw, name, version), vfs.dirname(localPath))}`;
      } else if (specRaw.startsWith('.') || specRaw.startsWith('/')) {
        childAbs = new URL(specRaw, url).href;
        replaced = specRaw.startsWith('.')
          ? specRaw
          : `./${vfs.relative(depsPathOf(childAbs, name, version), vfs.dirname(localPath))}`;
      } else {
        childAbs = new URL(specRaw, url).href;
        replaced = specRaw;
      }

      queue.push(childAbs);

      // 仅替换引号内部内容，不动引号本身
      //const replacedInner = depsPathOf(childAbs, name, version);
      out += replaced; // 不加引号

      // 将 last 设为 e（引号内内容的结束位置）
      last = im.e;
    }

    // 追加尾部原文（包括最后一个引号、分号等）
    out += code.slice(last);
    const dir = vfs.dirname(localPath);
    if (!(await vfs.exists(dir))) await vfs.makeDirectory(dir, true);
    await vfs.writeFile(localPath, out, { encoding: 'utf8', create: true });
  }
}

export async function installDeps(vfs: VFS, projectRoot: string, specs: string[]) {
  const registry: LockFile['registry'] = 'esm.sh';
  let lock = (await readLock(vfs, projectRoot)) ?? { registry, dependencies: {} };

  for (const spec of specs) {
    const { name, version, entryUrl } = await resolveOnEsmSh(spec);
    const existing = lock.dependencies[name];

    // Skip if same version already present and entry exists
    if (existing?.version === version && (await vfs.exists(existing.entry))) continue;

    await crawlAndCache(vfs, entryUrl, name, version);
    const entry = `./${vfs.relative(depsPathOf(entryUrl, name, version), '/')}`;
    const code = (await vfs.readFile(entry, { encoding: 'utf8' })) as string;
    const integrity = await sha256Base64(code);

    lock.dependencies[name] = { version, entry, url: entryUrl, integrity };
  }

  await writeLock(vfs, projectRoot, lock);
  return lock;
}

/* -------------------- Rollup plugin -------------------- */

export function depsLockPlugin(vfs: VFS, projectRoot: string) {
  let lock: LockFile | null = null;

  return {
    name: 'deps-lock-vfs',
    async buildStart() {
      lock = await readLock(vfs, projectRoot);
      if (!lock) {
        console.warn('deps.lock.json not found. Bare imports will not resolve until you install deps.');
      }
    },
    async resolveId(source, importer) {
      // If already a VFS deps path, accept
      if (source.startsWith('/deps/')) return source;

      // Bare import → lockfile
      if (!source.startsWith('.') && !source.startsWith('/') && !source.startsWith('http')) {
        return lock?.dependencies[source]?.entry || null;
      }

      // Defer relative/absolute paths to other plugins (e.g., your vfsAndUrlPlugin)
      return null;
    },
    async load(id) {
      if (id.startsWith('/deps/')) {
        const code = (await vfs.readFile(id, { encoding: 'utf8' })) as string | null;
        if (code == null) throw new Error(`VFS miss for dependency: ${id}`);
        return { code, map: null };
      }
      return null;
    }
  };
}

/* -------------------- Example integration -------------------- */

// 1) Install deps from UI action:
// await installDeps(vfs, vfsRoot, ["three@^0.158.0", "stats.js"]);

// 2) Use plugin in your existing rollup call:
// plugins: [
//   depsLockPlugin(vfs, vfsRoot),
//   vfsAndUrlPlugin(vfs, { vfsRoot, distDir, alias }),
//   tsTranspilePlugin({ compilerOptions: { sourceMap: sourcemap !== false } })
// ];
