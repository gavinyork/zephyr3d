// readers/PythonHttpServerReader.ts
import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './reader';
import type { FileMetadata } from '../vfs';

/**
 * Directory reader for Python's built-in `http.server` (and similar)
 * HTML directory listings.
 *
 * @remarks
 * - Detects pages served by Python's `http.server` by scanning the `<title>` or `<h1>` tags.
 * - Parses `<ul><li><a>` (default Python layout) and falls back to plain `<a>` links.
 * - Skips parent directory entries (`../`), external links, and anchors.
 * - Attempts to extract file size and modification date from the link's surrounding text.
 * - Normalizes resolved paths via the provided `HttpDirectoryReaderContext`.
 *
 * Limitations:
 * - Parsing depends on the server's HTML structure; non-standard variants may not be fully parsed.
 * - Size and date extraction are best-effort and may be unavailable in some cases.
 *
 * @public
 */
export class PythonHttpServerReader implements HttpDirectoryReader {
  readonly name = 'python-http-server';

  async canHandle(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<boolean> {
    try {
      const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html' } });
      if (!res.ok) {
        return false;
      }
      const html = await res.text();
      // Default title for Python http.server
      return /<title>\s*Directory listing for /i.test(html) || /<h1>\s*Directory listing for /i.test(html);
    } catch {
      return false;
    }
  }

  async readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]> {
    const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html,*/*' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${dirPath}`);
    }
    const html = await res.text();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Python uses <ul><li><a>... by default
    const links = Array.from(doc.querySelectorAll('ul li a, a'));

    const now = new Date();
    const out: FileMetadata[] = [];
    const seen = new Set<string>();

    for (const a of links) {
      const hrefRaw = (a.getAttribute('href') || '').trim();
      const label = (a.textContent || '').trim();
      if (!hrefRaw || hrefRaw === '../' || label === '..') {
        continue;
      }
      if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) {
        continue;
      }

      let href = hrefRaw.split('#')[0].split('?')[0];
      if (href.startsWith('./')) {
        href = href.slice(2);
      }

      const isDir = href.endsWith('/');
      const cleanName =
        decodeURIComponent(isDir ? href.slice(0, -1) : href)
          .split('/')
          .filter(Boolean)
          .pop() || '';
      if (!cleanName) {
        continue;
      }

      const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, cleanName + (isDir ? '/' : '')));
      if (seen.has(fullPath)) {
        continue;
      }
      seen.add(fullPath);

      let size = 0;
      let modified = now;
      const line = (a.parentElement?.textContent || '').trim();

      const d = tryParsePythonDate(line);
      if (d) {
        modified = d;
      }

      const s = tryParsePythonSize(line);
      if (s != null) {
        size = s;
      }

      out.push({
        name: cleanName,
        path: fullPath,
        size: isDir ? 0 : size,
        type: isDir ? 'directory' : 'file',
        created: modified,
        modified
      });
    }

    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    return out;
  }
}

function tryParsePythonSize(s: string): number | null {
  const m1 = s.match(/\b(\d+(?:\.\d+)?)\s*(K|KB|M|MB|G|GB|T|TB|P|PB)\b/i);
  if (m1) {
    const n = parseFloat(m1[1]);
    const unit = m1[2].toUpperCase();
    const map: Record<string, number> = {
      K: 1024,
      KB: 1024,
      M: 1024 ** 2,
      MB: 1024 ** 2,
      G: 1024 ** 3,
      GB: 1024 ** 3,
      T: 1024 ** 4,
      TB: 1024 ** 4,
      P: 1024 ** 5,
      PB: 1024 ** 5
    };
    return Math.round(n * (map[unit] ?? 1));
  }
  const m2 = s.match(/\b(\d{1,12})\b/); // 防止匹配年份时间等超长数字
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return null;
}

function tryParsePythonDate(s: string): Date | null {
  // Default date format of Python output "YYYY-MM-DD HH:MM" 或 "YYYY-MM-DD HH:MM:SS"
  const m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (m) {
    const year = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(year, mon, day, hh, mm, ss);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  const d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}
