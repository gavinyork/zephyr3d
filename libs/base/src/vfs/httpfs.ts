import type { FileMetadata, FileStat, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

export interface HttpFSOptions {
  timeout?: number;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  urlResolver?: (url: string) => string;
}

/**
 * Http file system.
 *
 * @public
 */

export class HttpFS extends VFS {
  private readonly baseOrigin: string;
  private readonly basePath: string;
  private readonly options: HttpFSOptions;

  constructor(baseURL: string, options: HttpFSOptions = {}) {
    super(true); // Readonly
    baseURL = baseURL || new URL(window.location.href).origin;
    if (!URL.canParse(baseURL)) {
      throw new Error(`Invalid base URL while contructing HttpFS: ${baseURL}`);
    }
    const url = new URL(baseURL);
    this.basePath = url.pathname;
    if (this.basePath.endsWith('/')) {
      this.basePath = this.basePath.slice(0, -1);
    }
    this.baseOrigin = url.origin;
    this.options = {
      timeout: 30000,
      ...options
    };
  }

  get urlResolver(): (url: string) => string {
    return this.options.urlResolver ?? null;
  }
  set urlResolver(resolver: (url: string) => string) {
    this.options.urlResolver = resolver ?? null;
  }
  normalizePath(path: string): string {
    if (this.options.urlResolver) {
      path = this.options.urlResolver(path);
    }
    path = path.trim();
    if (this.parseDataURI(path) || this.isObjectURL(path)) {
      return path;
    }
    return super.normalizePath(path);
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
    try {
      const response = await this.fetchWithTimeout(path);

      if (!response.ok) {
        if (response.status === 404) {
          throw new VFSError('File not found', 'ENOENT', path);
        } else if (response.status === 403) {
          throw new VFSError('Access denied', 'EACCES', path);
        } else if (response.status >= 500) {
          throw new VFSError('Server error', 'EIO', path);
        } else {
          throw new VFSError(`HTTP error ${response.status}: ${response.statusText}`, 'EIO', path);
        }
      }

      if (options?.offset !== undefined || options?.length !== undefined) {
        // TODO: HTTP Range request
      }

      let data: ArrayBuffer | string;
      if (options?.encoding === 'utf8') {
        data = await response.text();
      } else if (options?.encoding === 'base64') {
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        data = btoa(String.fromCodePoint(...bytes));
      } else {
        data = await response.arrayBuffer();
      }

      return data;
    } catch (error) {
      if (error instanceof VFSError) {
        throw error;
      }
      throw new VFSError(`Failed to read file: ${error}`, 'EIO', path);
    }
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

    try {
      const response = await this.fetchWithTimeout(normalizedPath, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async _stat(path: string): Promise<FileStat> {
    try {
      const response = await this.fetchWithTimeout(path, { method: 'HEAD' });

      if (!response.ok) {
        if (response.status === 404) {
          throw new VFSError('File not found', 'ENOENT', path);
        } else {
          throw new VFSError(`HTTP error ${response.status}`, 'EIO', path);
        }
      }

      const size = parseInt(response.headers.get('content-length') || '0');
      const lastModified = response.headers.get('last-modified');
      const contentType = response.headers.get('content-type');

      const isDirectory = contentType?.includes('text/html') && path.endsWith('/');
      const modifiedDate = lastModified ? new Date(lastModified) : new Date();

      return {
        size,
        isFile: !isDirectory,
        isDirectory,
        created: modifiedDate,
        modified: modifiedDate,
        accessed: modifiedDate
      };
    } catch (error) {
      if (error instanceof VFSError) {
        throw error;
      }
      throw new VFSError(`Failed to stat file: ${error}`, 'EIO', path);
    }
  }
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  protected async _deleteDatabase(): Promise<void> {
    return;
  }
  protected async _move(): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS');
  }
  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
    url = new URL(this.join(this.basePath, url), this.baseOrigin).href;
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.options.headers,
          ...init?.headers
        },
        credentials: this.options.credentials
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
