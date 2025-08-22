// readers/PythonHttpServerReader.ts
import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './reader';
import type { FileMetadata } from '../vfs';

export class PythonHttpServerReader implements HttpDirectoryReader {
  readonly name = 'python-http-server';

  async canHandle(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<boolean> {
    try {
      const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html' } });
      if (!res.ok) return false;
      const html = await res.text();
      // 标志：Python http.server 默认标题/标题
      return /<title>\s*Directory listing for /i.test(html) || /<h1>\s*Directory listing for /i.test(html);
    } catch {
      return false;
    }
  }

  async readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]> {
    const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html,*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${dirPath}`);
    const html = await res.text();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Python 默认使用 <ul><li><a>... 结构（不同版本有细微差异）
    const links = Array.from(doc.querySelectorAll('ul li a, a'));

    const now = new Date();
    const out: FileMetadata[] = [];
    const seen = new Set<string>();

    for (const a of links) {
      const hrefRaw = (a.getAttribute('href') || '').trim();
      const label = (a.textContent || '').trim();
      if (!hrefRaw || hrefRaw === '../' || label === '..') continue;
      if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) continue;

      let href = hrefRaw.split('#')[0].split('?')[0];
      if (href.startsWith('./')) href = href.slice(2);

      const isDir = href.endsWith('/');
      const cleanName =
        decodeURIComponent(isDir ? href.slice(0, -1) : href)
          .split('/')
          .filter(Boolean)
          .pop() || '';
      if (!cleanName) continue;

      const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, cleanName + (isDir ? '/' : '')));
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      // Python 的大小/时间通常同在 <li> 文本中
      let size = 0;
      let modified = now;
      const line = (a.parentElement?.textContent || '').trim();

      const d = tryParsePythonDate(line);
      if (d) modified = d;

      const s = tryParsePythonSize(line);
      if (s != null) size = s;

      out.push({
        name: cleanName,
        path: fullPath,
        size: isDir ? 0 : size,
        type: isDir ? 'directory' : 'file',
        created: modified,
        modified,
        mimeType: isDir ? undefined : ctx.guessMimeType(cleanName)
      });
    }

    // 排序
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    return out;
  }
}

function tryParsePythonSize(s: string): number | null {
  // Python http.server 输出通常是字节数或人类可读
  // e.g. "file.txt 1234" 或 "file.txt (1.2 KB) 2024-05-01 10:20"
  // 先尝试人类可读
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
  // 再尝试纯数字字节
  const m2 = s.match(/\b(\d{1,12})\b/); // 防止匹配年份时间等超长数字
  if (m2) {
    const n = parseInt(m2[1], 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function tryParsePythonDate(s: string): Date | null {
  // Python 默认格式一般是 "YYYY-MM-DD HH:MM" 或 "YYYY-MM-DD HH:MM:SS"
  const m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
  if (m) {
    const year = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    const d = new Date(year, mon, day, hh, mm, ss);
    if (!isNaN(d.getTime())) return d;
  }
  // 兜底
  const d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}
