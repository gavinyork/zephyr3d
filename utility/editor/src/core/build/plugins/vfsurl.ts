import type { OutputBundle } from '@rollup/browser';
import type { VFS } from '@zephyr3d/base';

const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_CANDIDATES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];

function isURL(id: string) {
  return /^https?:|^blob:|^data:/.test(id);
}

async function tryResolveWithExts(vfs: VFS, base: string, exts = DEFAULT_EXTS) {
  for (const ext of exts) {
    const p = base + ext;
    if (await vfs.exists(p)) {
      return p;
    }
  }
  return null;
}
async function tryResolveDirIndex(vfs, dir: string) {
  for (const f of INDEX_CANDIDATES) {
    const p = vfs.join(dir, f);
    if (await vfs.exists(p)) {
      return p;
    }
  }
  return null;
}

export function vfsAndUrlPlugin(
  vfs: VFS,
  options?: {
    vfsRoot?: string;
    root?: string;
    alias?: Record<string, string>;
    distDir?: string;
    exts?: string[];
  }
) {
  const vfsRoot = options?.vfsRoot ?? '/';
  const root = options?.root ?? '/';
  const alias = options?.alias ?? {};
  const distDir = vfs.normalizePath(vfs.join(vfsRoot, options?.distDir ?? '/dist'));
  const exts = options?.exts ?? DEFAULT_EXTS;

  const aliasEntries = Object.entries(alias);
  const applyAlias = (spec: string): string | null => {
    for (const [from, to] of aliasEntries) {
      if (spec === from || spec.startsWith(from + '/')) {
        return spec.replace(from, to);
      }
    }
    return null;
  };

  async function resolveRelativeLike(spec: string, importer?: string) {
    if (importer && isURL(importer)) {
      const url = new URL(spec, importer).href;
      return url;
    } else {
      const start = vfs.normalizePath(
        vfs.join(
          vfsRoot,
          spec.startsWith('/') ? spec : vfs.join(importer ? vfs.dirname(importer) : root, spec)
        )
      );
      if (await vfs.exists(start)) {
        const st = await vfs.stat(start);
        if (st.isDirectory) {
          const idx = await tryResolveDirIndex(vfs, start);
          if (idx) {
            return idx;
          }
        } else {
          return start;
        }
      }
      const withExt = await tryResolveWithExts(vfs, start, exts);
      if (withExt) {
        return withExt;
      }
      const asDir = await tryResolveDirIndex(vfs, start);
      if (asDir) {
        return asDir;
      }
      return null;
    }
  }

  return {
    name: 'vfs-url',
    async resolveId(source: string, importer?: string) {
      // 1) 绝对 URL（含 blob/data/http/https）：直接返回
      if (isURL(source)) {
        return source;
      }

      // 2) 别名
      const aliased = applyAlias(source);
      if (aliased) {
        const r = await resolveRelativeLike(aliased, importer);
        if (r) {
          return r;
        }
      }

      // 3) 相对/绝对路径 -> VFS
      if (source.startsWith('.') || source.startsWith('/')) {
        const r = await resolveRelativeLike(source, importer);
        if (r) {
          return r;
        }
      }

      // 4) 裸模块：留给 importMapResolvePlugin 先处理；若没处理，这里返回 null
      return null;
    },

    async load(id: string) {
      // URL 资源：fetch
      if (isURL(id)) {
        // 仅处理文本模块（JS/TS/JSON 等）。若是二进制，可转 data URL 再导出
        const res = await fetch(id);
        if (!res.ok) {
          throw new Error(`Failed to fetch ${id}: ${res.status}`);
        }
        const contentType = res.headers.get('Content-Type') || '';
        if (
          /javascript|json|text|xml/.test(contentType) ||
          id.endsWith('.js') ||
          id.endsWith('.mjs') ||
          id.endsWith('.json')
        ) {
          return await res.text();
        } else {
          // 作为 data URL 导出
          const buf = new Uint8Array(await res.arrayBuffer());
          let binary = '';
          for (let i = 0; i < buf.length; i++) {
            binary += String.fromCharCode(buf[i]);
          }
          const base64 = btoa(binary);
          const mime = contentType || 'application/octet-stream';
          return `export default "data:${mime};base64,${base64}";`;
        }
      }

      // VFS 路径：读取文本或转 data URL
      if (await vfs.exists(id)) {
        const mime = vfs.guessMIMEType(id) || '';
        if (
          mime.startsWith('text/') ||
          /javascript|json|xml/.test(mime) ||
          /\.(m?js|tsx?|jsx|json)$/.test(id)
        ) {
          const data = await vfs.readFile(id, { encoding: 'utf8' });
          return typeof data === 'string'
            ? data
            : new TextDecoder().decode(new Uint8Array(data as ArrayBuffer));
        } else {
          const buf = (await vfs.readFile(id, { encoding: 'binary' })) as ArrayBuffer;
          const u8 = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < u8.length; i++) {
            binary += String.fromCharCode(u8[i]);
          }
          const base64 = btoa(binary);
          const code = `export default "data:${mime || 'application/octet-stream'};base64,${base64}";`;
          return code;
        }
      }

      return null;
    },

    async generateBundle(_options, bundle: OutputBundle) {
      if (!(await vfs.exists(distDir))) {
        await vfs.makeDirectory(distDir, true);
      }
      for (const [fileName, item] of Object.entries(bundle)) {
        const out = vfs.join(distDir, fileName);
        if (item.type === 'asset') {
          if (typeof item.source === 'string') {
            await vfs.writeFile(out, item.source, { encoding: 'utf8', create: true });
          } else {
            const source = item.source as Uint8Array<ArrayBuffer>;
            const buffer =
              source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
                ? source.buffer
                : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
            await vfs.writeFile(out, buffer, { encoding: 'binary', create: true });
          }
        } else {
          await vfs.writeFile(out, item.code, { encoding: 'utf8', create: true });
          if (item.map) {
            await vfs.writeFile(out + '.map', item.map.toString(), { encoding: 'utf8', create: true });
          }
        }
      }
    }
  };
}
