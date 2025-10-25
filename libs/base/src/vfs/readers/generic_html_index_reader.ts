import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './reader';
import type { FileMetadata } from '../vfs';

/**
 * A generic HTML directory reader that parses index-style HTML pages
 * to list directory entries (files and subdirectories).
 *
 * @remarks
 * - Targets simple directory listings produced by common HTTP servers (e.g., Apache, Nginx).
 * - Extracts entries from `<a>` elements and attempts to infer size and modified time
 *   from surrounding table rows or text content.
 * - Skips external links, parent-directory links, and anchors.
 * - Normalizes and resolves paths using the provided `HttpDirectoryReaderContext`.
 *
 * Limitations:
 * - Parsing depends on the server’s HTML structure; non-standard listings may yield incomplete metadata.
 * - Size/mtime extraction uses best-effort heuristics and may be unavailable for some servers.
 *
 * @public
 */
export class GenericHtmlDirectoryReader implements HttpDirectoryReader {
  readonly name = 'generic-html';

  async readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]> {
    const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html,*/*' } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${dirPath}`);
    }
    const html = await res.text();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));

    const now = new Date();
    const items: FileMetadata[] = [];
    const seen = new Set<string>();

    for (const a of links) {
      const hrefRaw = (a.getAttribute('href') || '').trim();
      const text = (a.textContent || '').trim();

      if (
        !hrefRaw ||
        hrefRaw.startsWith('../') ||
        hrefRaw.includes('/../') ||
        text === '..' ||
        hrefRaw === '#'
      ) {
        continue;
      }
      if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) {
        continue;
      }

      // Remove query/hash
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

      // resolve size/mtime
      let size = 0;
      let modified = now;

      const row = a.closest('tr');
      if (row) {
        const cells = Array.from(row.querySelectorAll('td,th')).map((td) => (td.textContent || '').trim());
        for (const c of cells) {
          const d = tryParseDate(c);
          if (d) {
            modified = d;
          }
          const s = tryParseSize(c);
          if (s != null) {
            size = s;
          }
        }
      } else {
        const line = (a.parentElement?.textContent || '').trim();
        const d = tryParseDate(line);
        if (d) {
          modified = d;
        }
        const s = tryParseSize(line);
        if (s != null) {
          size = s;
        }
      }

      items.push({
        name: cleanName,
        path: fullPath,
        size: isDir ? 0 : size,
        type: isDir ? 'directory' : 'file',
        created: modified,
        modified
      });
    }

    items.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    );
    return items;
  }
}

function tryParseSize(s: string): number | null {
  // Recoganize 123, 1.2K, 34KB, 5.6M, 7G, etc
  const m = s.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?B?)\b/i);
  if (!m) {
    return null;
  }
  const n = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  const map: Record<string, number> = {
    '': 1,
    B: 1,
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

function tryParseDate(s: string): Date | null {
  const cands = [s, s.replace(/\s+/g, ' ')];
  for (const c of cands) {
    const d = new Date(c);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  // Apache format 01-May-2024 10:20
  const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
  if (m) {
    const months: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11
    };
    const day = parseInt(m[1], 10);
    const mon = months[m[2]];
    const year = parseInt(m[3], 10);
    const [hh, mm, ss] = m[4].split(':').map((x) => parseInt(x, 10));
    const d = new Date(Date.UTC(year, mon, day, hh || 0, mm || 0, ss || 0));
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  return null;
}
