import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError, GlobMatcher } from './vfs';
import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './readers/reader';
import { PathUtils } from './common';

export interface HttpFSOptions {
  timeout?: number;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  urlResolver?: (url: string) => string;
  directoryReader?: HttpDirectoryReader | HttpDirectoryReader[];
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
  private readonly dirReaders: HttpDirectoryReader[];

  constructor(baseURL: string, options: HttpFSOptions = {}) {
    super(true); // Readonly
    baseURL = baseURL || './';
    const url = new URL(baseURL, window.location.href);
    this.basePath = url.pathname;
    if (this.basePath.endsWith('/')) {
      this.basePath = this.basePath.slice(0, -1);
    }
    this.baseOrigin = url.origin;
    this.options = {
      timeout: 30000,
      ...options
    };
    this.dirReaders = Array.isArray(options.directoryReader)
      ? options.directoryReader
      : options.directoryReader
      ? [options.directoryReader]
      : [];
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

  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const normalized = this.normalizePath(path);
    const dirPath = normalized.endsWith('/') ? normalized : normalized + '/';

    if (!this.dirReaders.length) {
      throw new VFSError('No HttpDirectoryReader configured for HttpFS', 'ENOTSUP', dirPath);
    }

    const ctx: HttpDirectoryReaderContext = {
      fetch: (url, init) => this.fetchWithTimeout(url, init),
      toURL: (p) => this.toAbsoluteURL(p),
      normalizePath: (p) => super.normalizePath(p), // 调用父类 normalize，保留 urlResolver 规则
      joinPath: (...parts) => PathUtils.join(...parts),
      guessMimeType: (name) => this.guessMIMEType(name)
    };

    // 选择 reader
    const reader = await this.selectReader(dirPath, ctx);

    // 读取一层
    let layer = await reader.readOnce(dirPath, ctx);

    // 统一过滤 includeHidden
    const includeHidden = options?.includeHidden ?? false;
    layer = layer.filter((e) => includeHidden || !e.name.startsWith('.'));

    // 统一 pattern 过滤
    if (options?.pattern) {
      const pattern = options.pattern!;
      if (typeof pattern === 'string') {
        const matcher = new GlobMatcher(pattern, true);
        layer = layer.filter((e) => matcher.test(e.name) || matcher.test(e.path));
      } else {
        layer = layer.filter((e) => pattern.test(e.name) || pattern.test(e.path));
      }
    }

    if (!options?.recursive) return layer;

    // 递归收集
    const out: FileMetadata[] = [...layer];
    for (const e of layer) {
      if (e.type === 'directory') {
        try {
          const sub = await this._readDirectory(e.path, options);
          out.push(...sub);
        } catch (err) {
          // 忽略或记录
        }
      }
    }
    return out;
  }

  private async selectReader(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<HttpDirectoryReader> {
    // 若只配置一个，直接用
    if (this.dirReaders.length === 1) return this.dirReaders[0];

    // 多个 reader：按 canHandle 动态选择
    for (const r of this.dirReaders) {
      if (!r.canHandle) continue;
      try {
        if (await r.canHandle(dirPath, ctx)) return r;
      } catch {
        /* 忽略 */
      }
    }
    // 若都没有 canHandle 或都未通过，取第一个作为默认
    return this.dirReaders[0];
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
  protected async _wipe(): Promise<void> {
    return;
  }
  protected async _move(): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS');
  }
  private toAbsoluteURL(url: string): string {
    url =
      this.isObjectURL(url) || this.parseDataURI(url)
        ? url
        : new URL(this.join(this.basePath, url), this.baseOrigin).href;
    return url;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
    url =
      this.isObjectURL(url) || this.parseDataURI(url)
        ? url
        : new URL(this.join(this.basePath, url), this.baseOrigin).href;
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
