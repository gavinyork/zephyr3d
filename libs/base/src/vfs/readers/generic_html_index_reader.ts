// readers/GenericHtmlDirectoryReader.ts
import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './reader';
import type { FileMetadata } from '../vfs';

export class GenericHtmlDirectoryReader implements HttpDirectoryReader {
  readonly name = 'generic-html';

  async readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]> {
    const res = await ctx.fetch(dirPath, { method: 'GET', headers: { Accept: 'text/html,*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${dirPath}`);
    const html = await res.text();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));

    const now = new Date();
    const items: FileMetadata[] = [];
    const seen = new Set<string>();

    for (const a of links) {
      const hrefRaw = (a.getAttribute('href') || '').trim();
      const text = (a.textContent || '').trim();

      // 排除上级目录或空链接
      if (
        !hrefRaw ||
        hrefRaw.startsWith('../') ||
        hrefRaw.includes('/../') ||
        text === '..' ||
        hrefRaw === '#'
      )
        continue;
      if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) continue;

      // 处理相对路径、去除 query/hash
      let href = hrefRaw.split('#')[0].split('?')[0];
      if (href.startsWith('./')) href = href.slice(2);

      // 可能出现绝对路径或跨目录引用，这里只接受当前目录下一层（不含 '/' 的名字 或 以 '/' 结尾的子目录）
      // 但 web-dev-server 也可能以 'subdir/' 或 'file.ext' 形式列出，保留这两种
      // 如果 href 包含多级路径，这里仍接受，稍后 joinPath 统一化
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

      // 解析 size/mtime：表格行或父容器文本
      let size = 0;
      let modified = now;

      // 表格行启发
      const row = a.closest('tr');
      if (row) {
        const cells = Array.from(row.querySelectorAll('td,th')).map((td) => (td.textContent || '').trim());
        for (const c of cells) {
          const d = tryParseDate(c);
          if (d) modified = d;
          const s = tryParseSize(c);
          if (s != null) size = s;
        }
      } else {
        // 列表/pre 启发：在同一行或同一父块文本中寻找日期/大小
        const line = (a.parentElement?.textContent || '').trim();
        const d = tryParseDate(line);
        if (d) modified = d;
        const s = tryParseSize(line);
        if (s != null) size = s;
      }

      items.push({
        name: cleanName,
        path: fullPath,
        size: isDir ? 0 : size,
        type: isDir ? 'directory' : 'file',
        created: modified,
        modified,
        mimeType: isDir ? undefined : ctx.guessMimeType(cleanName)
      });
    }

    // 目录优先 + 名称排序（可选）
    items.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    );
    return items;
  }
}

function tryParseSize(s: string): number | null {
  // 识别 123, 1.2K, 34KB, 5.6M, 7G 等
  const m = s.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?B?)\b/i);
  if (!m) return null;
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
  // 广谱日期解析，兼容多种本地化格式（交给 Date 尝试）
  const cands = [s, s.replace(/\s+/g, ' ')];
  for (const c of cands) {
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  // 常见 Apache 格式 01-May-2024 10:20
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
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
