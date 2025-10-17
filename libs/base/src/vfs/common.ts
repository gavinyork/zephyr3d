/**
 * Path utilities.
 *
 * Provides POSIX-like path manipulation helpers (pure string operations),
 * including normalization, joining, dirname/basename/extname extraction,
 * absolute-path detection, and relative path computation.
 *
 * Notes:
 * - Uses "/" as the separator (web/URL or POSIX-like paths).
 * - All methods are pure and do not touch a real filesystem.
 * - `normalize` collapses ".", "..", and redundant slashes.
 *
 * @public
 */
export class PathUtils {
  /**
   * Normalizes a path by collapsing redundant slashes, removing "." segments,
   * and resolving ".." segments.
   *
   * Rules:
   * - Multiple consecutive "/" are collapsed into a single "/".
   * - "." segments are removed.
   * - ".." removes the previous segment (no-op at root).
   * - The result always starts with "/" (absolute form).
   *
   * Example:
   * - normalize('/a//b/./c/../d') -\> '/a/b/d'
   *
   * @param path - Input path (relative or absolute).
   * @returns The normalized absolute path (always starting with "/").
   */
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

  /**
   * Joins multiple path segments and normalizes the result.
   *
   * Behavior:
   * - Concatenates segments with "/" and then runs `normalize`.
   * - The returned path is always absolute.
   *
   * Example:
   * - join('/a', 'b', '../c') -\> '/a/c'
   *
   * @param paths - Path segments in order.
   * @returns Normalized absolute path.
   */
  static join(...paths: string[]): string {
    return this.normalize(paths.join('/'));
  }

  /**
   * Returns the directory name (parent directory) of a path.
   *
   * Behavior:
   * - Applies `normalize` first.
   * - If the path is root "/" or has no parent, returns "/".
   *
   * Examples:
   * - dirname('/a/b/c') -\> '/a/b'
   * - dirname('/a') -\> '/'
   * - dirname('/') -\> '/'
   *
   * @param path - Input path.
   * @returns Directory path of the input.
   */
  static dirname(path: string): string {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
  }

  /**
   * Returns the last portion of a path (file name).
   *
   * Behavior:
   * - Applies `normalize` first.
   * - If `ext` is provided and the name ends with it, the extension is stripped.
   *
   * Examples:
   * - basename('/a/b/c.txt') -\> 'c.txt'
   * - basename('/a/b/c.txt', '.txt') -\> 'c'
   * - basename('/') -\> ''
   *
   * @param path - Input path.
   * @param ext - Optional extension to strip (exact suffix match).
   * @returns The base name of the path.
   */
  static basename(path: string, ext?: string): string {
    const normalized = this.normalize(path);
    const lastSlash = normalized.lastIndexOf('/');
    let name = normalized.slice(lastSlash + 1);

    if (ext && name.endsWith(ext)) {
      name = name.slice(0, -ext.length);
    }

    return name;
  }

  /**
   * Returns the extension of the path, including the leading dot.
   *
   * Behavior:
   * - Based on the result of `basename`.
   * - If there is no dot, returns an empty string.
   *
   * Examples:
   * - extname('/a/b/c.txt') -\> '.txt'
   * - extname('/a/b/c') -\> ''
   *
   * @param path - Input path.
   * @returns The extension (e.g., ".txt") or an empty string if none.
   */
  static extname(path: string): string {
    const basename = this.basename(path);
    const lastDot = basename.lastIndexOf('.');
    return lastDot === -1 ? '' : basename.slice(lastDot);
  }

  /**
   * Determines whether the path is absolute.
   *
   * Definition here: absolute paths start with "/".
   *
   * @param path - Input path.
   * @returns True if the path starts with "/", otherwise false.
   */
  static isAbsolute(path: string): boolean {
    return path.startsWith('/');
  }

  /**
   * Computes a relative path from one path to another.
   *
   * Behavior:
   * - Both `from` and `to` are normalized first.
   * - The returned path does not start with "/" (relative form).
   * - If both resolve to the same path, returns ".".
   *
   * Examples:
   * - relative('/a/b/c', '/a/d/e') -\> '../../d/e'
   * - relative('/a/b', '/a/b/c') -\> 'c'
   * - relative('/a/b', '/a/b') -\> '.'
   *
   * @param from - Base path to start from.
   * @param to - Target path to reach.
   * @returns Relative path from `from` to `to`.
   */
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
 * Guesses the MIME type based on a file path or file name.
 *
 * Behavior:
 * - Uses `PathUtils.extname` to extract the extension (case-insensitive).
 * - Falls back to `application/octet-stream` if unknown.
 *
 * Notes:
 * - The mapping is intentionally minimal and web-oriented.
 * - Extend the `mimeTypes` table if you need additional types.
 *
 * Examples:
 * - guessMimeType('image.png') -\> 'image/png'
 * - guessMimeType('/a/b/model.glb') -\> 'model/gltf-binary'
 * - guessMimeType('unknown.ext') -\> 'application/octet-stream'
 *
 * @param path - File path or name used to infer the MIME type.
 * @returns The guessed MIME type string.
 *
 * @public
 */
export function guessMimeType(path: string): string {
  const ext = PathUtils.extname(path).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.ts': 'text/x-typescript',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.tga': 'image/tga',
    '.ico': 'image/x-icon',
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
    '.ktx2': 'image/ktx2',
    // zephyr3d specific
    '.zbpt': 'application/vnd.zephyr3d.blueprint+json',
    '.zmsh': 'application/vnd.zephyr3d.mesh+json',
    '.zmtl': 'application/vnd.zephyr3d.material+json',
    '.zmf': 'application/vnd.zephyr3d.blueprint.mf+json',
    '.zscn': 'application/vnd.zephyr3d.scene+json',
    '.zprefab': 'application/vnd.zephyr3d.prefab+json'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}
