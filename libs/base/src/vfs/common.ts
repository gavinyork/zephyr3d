/**
 * 路径工具类
 * @internal
 */
export class PathUtils {
  static normalize(path: string): string {
    // 移除多余的斜杠，处理 . 和 ..
    const parts = path.split('/').filter((p) => p && p !== '.');
    const result: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        result.pop();
      } else {
        result.push(part);
      }
    }

    return '/' + result.join('/');
  }

  static join(...paths: string[]): string {
    return this.normalize(paths.join('/'));
  }

  static dirname(path: string): string {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
  }

  static basename(path: string, ext?: string): string {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    let name = normalized.slice(lastSlash + 1);

    if (ext && name.endsWith(ext)) {
      name = name.slice(0, -ext.length);
    }

    return name;
  }

  static extname(path: string): string {
    const basename = this.basename(path);
    const lastDot = basename.lastIndexOf('.');
    return lastDot === -1 ? '' : basename.slice(lastDot);
  }

  static isAbsolute(path: string): boolean {
    return path.startsWith('/');
  }

  static relative(from: string, to: string): string {
    const fromParts = this.normalize(from).split('/').filter(Boolean);
    const toParts = this.normalize(to).split('/').filter(Boolean);

    let i = 0;
    while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
      i++;
    }

    const up = '../'.repeat(fromParts.length - i);
    const down = toParts.slice(i).join('/');

    return up + down || '.';
  }
}

/**
 * Detect MIME type from file path
 * @param path - file path
 * @returns MIME type
 */
export function guessMimeType(path: string): string {
  const ext = PathUtils.extname(path).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/x-typescript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.tga': 'image/tga',
    '.dds': 'image/x-dds',
    '.svg': 'image/svg+xml',
    '.hdr': 'image/vnd.radiance',
    '.exr': 'image/x-exr',
    '.tiff': 'image/tiff',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
    '.fbx': 'model/fbx',
    '.obj': 'model/obj',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.ktx': 'image/ktx',
    '.ktx2': 'image/ktx2'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
