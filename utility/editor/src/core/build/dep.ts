import { init, parse } from 'es-module-lexer';
import type { VFS } from '@zephyr3d/base';
import { loadTypes } from './loadtypes';
import { ProjectService } from '../services/project';
import { DlgMessageBoxEx } from '../../views/dlg/messageexdlg';

async function sha256Base64(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const b = String.fromCharCode(...new Uint8Array(digest));
  return 'sha256-' + btoa(b);
}

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

export async function readLock(vfs: VFS, projectRoot: string): Promise<LockFile | null> {
  const p = vfs.join(projectRoot, 'deps.lock.json');
  if (!(await vfs.exists(p))) {
    return null;
  }
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

export type ResolvedPkg = { name: string; version: string; entryUrl: string };

// semver helper (^ ~ x * >= <= > < =)
function cmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) {
      return 1;
    }
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) {
      return -1;
    }
  }
  return 0;
}
function maxSatisfying(
  versions: string[],
  range: string | undefined,
  latest: string | undefined
): string | null {
  if (!versions.length) {
    return latest ?? null;
  }
  const vs = versions.filter((v) => /^\d+\.\d+\.\d+/.test(v)).sort((a, b) => cmp(a, b));
  if (!range || range === 'latest') {
    return vs.at(-1) ?? latest ?? null;
  }

  range = range.trim();
  if (range === '*' || /x/i.test(range)) {
    return vs.at(-1) ?? null;
  }

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

  // ~major.minor.patch or ~major.minor
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

  // >= <= > < =
  const mRel = range.match(/^(>=|<=|>|<|=)\s*(\d+\.\d+\.\d+)/);
  if (mRel) {
    const op = mRel[1];
    const ver = mRel[2];
    const candidates = vs.filter((v) => {
      const c = cmp(v, ver);
      if (op === '>=') {
        return c >= 0;
      }
      if (op === '<=') {
        return c <= 0;
      }
      if (op === '>') {
        return c > 0;
      }
      if (op === '<') {
        return c < 0;
      }
      if (op === '=') {
        return c === 0;
      }
      return false;
    });
    return candidates.at(-1) ?? null;
  }

  return vs.at(-1) ?? latest ?? null;
}

async function fetchPackageJson(name: string): Promise<any | null> {
  try {
    const url = `https://esm.sh/${name}/package.json`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      return null;
    }
    const text = await res.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function resolveOnEsmSh(pkgSpec: string): Promise<ResolvedPkg> {
  const m = pkgSpec.match(/^(@?[^@]+)(?:@(.+))?$/);
  if (!m) {
    throw new Error(`Invalid spec: ${pkgSpec}`);
  }
  const [, name, rangeRaw] = m;
  const range = rangeRaw?.trim();

  const probe = `https://esm.sh/${name}${range ? '@' + encodeURIComponent(range) : ''}`;
  const res = await fetch(probe, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed resolving ${pkgSpec}: ${res.status}`);
  }

  const u = new URL(res.url);
  const decodedPath = decodeURIComponent(u.pathname).replace(/^\/v\d+\//, '/');
  const direct = decodedPath.match(/\/(@?[^/@]+)@(\d+\.\d+\.\d+(?:[-+][^/]+)?)(?:\/|$)/);

  if (direct) {
    const version = direct[2];
    u.search = '';
    u.hash = '';
    return { name, version, entryUrl: u.toString() };
  }

  // No version found, query version from package.json
  const pkg = await fetchPackageJson(name);
  if (!pkg) {
    // No package.json, use latest
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
    // Not resolved
    if (latest) {
      return { name, version: latest, entryUrl: `https://esm.sh/${name}@${latest}` };
    }
    throw new Error(`Cannot resolve concrete version for ${name} with range "${range ?? 'latest'}"`);
  }

  const entryUrl = `https://esm.sh/${name}@${resolved}`;
  return { name, version: resolved, entryUrl };
}

export function depsPathOf(cdnUrl: string, name: string, version: string): string {
  const u = new URL(cdnUrl);
  // Remove prefix
  const p = u.pathname.replace(/^\/v\d+\//, '/'); // /v133/... → /...
  // Find anchor: name@version
  const anchor = `${name}@${version}`;
  const idx = p.indexOf(anchor);
  let sub = '';
  if (idx >= 0) {
    sub = p.slice(idx + anchor.length); // 例如 "", "/es2022/three.mjs", "/examples/jsm/..."
  } else {
    sub = p;
  }
  sub = sub.replace(/^\/(es\d+|stable|dev|node|browser)\//, '/');
  if (!sub.startsWith('/')) {
    sub = '/' + sub;
  }
  const last = sub.split('/').pop()!;
  const isDirLike = sub.endsWith('/') || !last.includes('.');
  if (isDirLike) {
    sub = (sub.endsWith('/') ? sub : sub + '/') + 'mod.js';
  }
  return `/deps/${name}@${version}${sub}`;
}

export async function crawlAndCache(vfs: VFS, entryUrl: string, name: string, version: string) {
  await init;
  const queue: string[] = [entryUrl];
  const seen = new Set<string>();

  while (queue.length) {
    const url = queue.pop()!;
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);

    const localPath = depsPathOf(url, name, version);
    if (await vfs.exists(localPath)) {
      continue;
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Fetch failed: ${url} (${res.status})`);
    }
    const code = await res.text();
    const [imports] = parse(code);
    const list = [...imports].sort((a, b) => (a.s || 0) - (b.s || 0));
    let out = '';
    let last = 0;

    for (const im of list) {
      // Must have quotes
      const hasQuote = im.ss != null && im.se != null;
      if (!hasQuote || im.se <= im.ss) {
        continue;
      }
      // Must have contents
      if (im.e <= im.s) {
        continue;
      }
      // append [last, s)
      out += code.slice(last, im.s);
      const specRaw = code.slice(im.s, im.e); // original spec
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
      out += replaced; // 不加引号
      last = im.e;
    }
    out += code.slice(last);

    const dir = vfs.dirname(localPath);
    if (!(await vfs.exists(dir))) {
      await vfs.makeDirectory(dir, true);
    }
    await vfs.writeFile(localPath, out, { encoding: 'utf8', create: true });
  }
}

export async function ensureDependencies() {
  if (!(await checkDependencies())) {
    await reinstallPackages();
  }
}

export async function checkDependencies(): Promise<boolean> {
  if (await ProjectService.VFS.exists('/deps.lock.json')) {
    const content = (await ProjectService.VFS.readFile('/deps.lock.json', { encoding: 'utf8' })) as string;
    const deps = JSON.parse(content) as {
      dependencies: Record<string, { version: string; entry: string }>;
    };
    for (const k in deps.dependencies) {
      const path = ProjectService.VFS.join('/', deps.dependencies[k].entry);
      if (!(await ProjectService.VFS.exists(path))) {
        return false;
      }
    }
  }
  return true;
}

export async function reinstallPackages() {
  if (!(await ProjectService.VFS.exists('/deps.lock.json'))) {
    return;
  }
  if (await ProjectService.VFS.exists('/deps')) {
    await ProjectService.VFS.deleteDirectory('/deps', true);
  }
  const content = (await ProjectService.VFS.readFile('/deps.lock.json', { encoding: 'utf8' })) as string;
  const entries = JSON.parse(content) as {
    dependencies: Record<string, { version: string }>;
  };
  const deps = entries.dependencies ?? {};
  for (const pkg of Object.keys(deps)) {
    const packageName = `${pkg}@${deps[pkg].version}`;
    const dlgMessageBoxEx = new DlgMessageBoxEx(
      'Install package',
      `Installing ${packageName}`,
      [],
      400,
      0,
      false
    );
    dlgMessageBoxEx.showModal();
    await installDeps(ProjectService.currentProject, ProjectService.VFS, '/', [packageName], null, true);
    dlgMessageBoxEx.close('');
  }
}

export async function installDeps(
  project: string,
  vfs: VFS,
  projectRoot: string,
  specs: string[],
  onProgress?: (msg: string) => void,
  noFetchDTS?: boolean
) {
  let numPackagesInstalled = 0;
  onProgress?.('Reading lock file...');
  const registry: LockFile['registry'] = 'esm.sh';
  const lock = (await readLock(vfs, projectRoot)) ?? { registry, dependencies: {} };

  for (const spec of specs) {
    try {
      onProgress?.(`Installing package ${spec}...`);
      const { name, version, entryUrl } = await resolveOnEsmSh(spec);
      const existing = lock.dependencies[name];

      // Skip if same version already present and entry exists
      if (existing?.version === version && (await vfs.exists(existing.entry))) {
        continue;
      }

      await crawlAndCache(vfs, entryUrl, name, version);
      const entry = `./${vfs.relative(depsPathOf(entryUrl, name, version), '/')}`;
      const code = (await vfs.readFile(entry, { encoding: 'utf8' })) as string;
      const integrity = await sha256Base64(code);

      lock.dependencies[name] = { version, entry, url: entryUrl, integrity };
      numPackagesInstalled++;

      if (!noFetchDTS) {
        // Loading types
        onProgress?.(`Loading DTS from package ${spec}...`);
        await loadTypes(project, spec, window.monaco);
      }
    } catch (err) {
      onProgress?.(`Failed to fetch ${spec}: ${err}`);
    }
  }

  onProgress?.('Writing lock file...');
  await writeLock(vfs, projectRoot, lock);
  onProgress?.(`${numPackagesInstalled} packages installed`);
  return lock;
}
