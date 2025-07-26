import { PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * HTTP 文件系统实现
 */
export class HttpFS extends VFS {
  private baseURL: string;
  private cache: Map<string, ArrayBuffer | string> = new Map();
  private manifest: Map<string, FileMetadata> = new Map();

  constructor(baseURL: string) {
    super('HttpFS', true); // 只读
    this.baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    this.loadManifest();
  }

  private async loadManifest(): Promise<void> {
    try {
      const response = await fetch(`${this.baseURL}/manifest.json`);
      if (response.ok) {
        const manifest = await response.json();
        for (const entry of manifest.files) {
          this.manifest.set(entry.path, entry);
        }
      }
    } catch (_error) {
      console.warn('Failed to load manifest, using directory listing fallback');
    }
  }

  protected async _makeDirectory(path: string, _recursive: boolean): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const normalizedPath = PathUtils.normalize(path);
    const results: FileMetadata[] = [];

    // 从 manifest 中查找
    for (const [filePath, metadata] of this.manifest) {
      const dir = PathUtils.dirname(filePath);
      if (dir === normalizedPath || (options?.recursive && dir.startsWith(normalizedPath))) {
        results.push(metadata);
      }
    }

    // 如果没有 manifest，尝试列出目录
    if (results.length === 0) {
      const response = await fetch(`${this.baseURL}${normalizedPath}`);
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        // 解析目录列表 HTML（简化版）
        const html = await response.text();
        const regex = /<a\s+href="([^"]+)">([^<]+)<\/a>/g;
        let match;

        while ((match = regex.exec(html)) !== null) {
          const [, _href, name] = match;
          if (name !== '../' && name !== './') {
            results.push({
              name: name.replace(/\/$/, ''),
              path: PathUtils.join(normalizedPath, name),
              size: 0,
              type: name.endsWith('/') ? 'directory' : 'file',
              created: new Date(),
              modified: new Date()
            });
          }
        }
      }
    }

    return results;
  }

  protected async _deleteDirectory(path: string, _recursive: boolean): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    const normalizedPath = PathUtils.normalize(path);
    const cacheKey = `${normalizedPath}:${options?.encoding || 'binary'}`;

    // 检查缓存
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const url = `${this.baseURL}${normalizedPath}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new VFSError(`HTTP error ${response.status}`, 'ENOENT', path);
    }

    let data: ArrayBuffer | string;
    if (options?.encoding === 'utf8') {
      data = await response.text();
    } else {
      data = await response.arrayBuffer();
    }

    // 缓存结果
    this.cache.set(cacheKey, data);

    return data;
  }

  protected async _writeFile(
    path: string,
    _data: ArrayBuffer | string,
    _options?: WriteOptions
  ): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _deleteFile(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _exists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalize(path);

    // 检查 manifest
    if (this.manifest.has(normalizedPath)) {
      return true;
    }

    // 尝试 HEAD 请求
    try {
      const response = await fetch(`${this.baseURL}${normalizedPath}`, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async _stat(path: string): Promise<FileStat> {
    const normalizedPath = PathUtils.normalize(path);

    // 从 manifest 获取
    const metadata = this.manifest.get(normalizedPath);
    if (metadata) {
      return {
        size: metadata.size,
        isFile: metadata.type === 'file',
        isDirectory: metadata.type === 'directory',
        created: metadata.created,
        modified: metadata.modified
      };
    }

    // 尝试 HEAD 请求
    const response = await fetch(`${this.baseURL}${normalizedPath}`, { method: 'HEAD' });
    if (!response.ok) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    const size = parseInt(response.headers.get('content-length') || '0');
    const lastModified = response.headers.get('last-modified');

    return {
      size,
      isFile: true,
      isDirectory: false,
      created: new Date(),
      modified: lastModified ? new Date(lastModified) : new Date()
    };
  }
  /** 不支持删除 */
  protected async _destroy(): Promise<void> {
    return;
  }
}
