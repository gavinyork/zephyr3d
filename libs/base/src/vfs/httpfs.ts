import { PathUtils } from './common';
import type { FileMetadata, FileStat, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * Http file system.
 *
 * @public
 */

export class HttpFS extends VFS {
  private baseURL: string;

  constructor(baseURL: string) {
    super('HttpFS', true); // 只读
    this.baseURL = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
  }

  protected normalizePath(path: string) {
    path = path.trim().toLowerCase();
    if (!this.baseURL || path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    } else {
      return `${this.baseURL}${PathUtils.normalize(path)}`;
    }
  }
  protected async _makeDirectory(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _readDirectory(path: string): Promise<FileMetadata[]> {
    throw new VFSError('HTTP file system does not support reading directory', 'EROFS', path);
  }

  protected async _deleteDirectory(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    const url = this.normalizePath(path);

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
    const normalizedPath = this.normalizePath(path);

    // Try HEAD request
    try {
      const response = await fetch(normalizedPath, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async _stat(path: string): Promise<FileStat> {
    const normalizedPath = this.normalizePath(path);

    // try HEAD request
    const response = await fetch(normalizedPath, { method: 'HEAD' });
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
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
}
