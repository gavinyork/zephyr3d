import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError, GlobMatcher } from './vfs';
import type { HttpDirectoryReader, HttpDirectoryReaderContext } from './readers/reader';
import { PathUtils } from './common';
import { uint8ArrayToBase64 } from '../utils';

/**
 * Options for {@link HttpFS}.
 *
 * @public
 */
export interface HttpFSOptions {
  /**
   * Request timeout in milliseconds for HTTP operations. Defaults to 30000.
   */
  timeout?: number;
  /**
   * Default headers to include with each HTTP request.
   */
  headers?: Record<string, string>;
  /**
   * Fetch credentials policy for cross-origin requests.
   * See `RequestCredentials` for allowed values.
   */
  credentials?: RequestCredentials;
  /**
   * Optional URL pre-processor. If provided, every incoming VFS path is first
   * passed through this resolver to produce the final URL or path string.
   *
   * Use cases:
   * - Rewriting logical VFS paths to CDN URLs
   * - Injecting cache-busting query params
   * - Mapping to object/data URLs
   */
  urlResolver?: (url: string) => string;
  /**
   * One or more directory readers used to enumerate HTTP-backed directories.
   * If not provided, directory listing is not supported.
   */
  directoryReader?: HttpDirectoryReader | HttpDirectoryReader[];
}

/**
 * HTTP-backed virtual file system.
 *
 * Provides a read-only VFS implementation that resolves files via HTTP(S).
 * Supports:
 * - File reads via `GET`
 * - Existence/stat probing via `HEAD`
 * - Optional directory listing via pluggable {@link HttpDirectoryReader}s
 *
 * Limitations:
 * - This FS is read-only; mutating operations throw `VFSError` with code `"EROFS"`.
 * - Partial reads (HTTP range) are not implemented yet.
 *
 * @public
 */
export class HttpFS extends VFS {
  private readonly baseOrigin: string;
  private readonly basePath: string;
  private readonly options: HttpFSOptions;
  private readonly dirReaders: HttpDirectoryReader[];

  /**
   * Creates an HTTP file system rooted at `baseURL`.
   *
   * All relative VFS paths are resolved against `baseURL` and fetched using
   * the configured options.
   *
   * @param baseURL - Base URL of the HTTP root. Can be absolute or relative to `window.location`.
   * @param options - Optional HTTP and directory-reading configuration.
   */
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

  /**
   * Optional URL resolver hook that transforms VFS paths into concrete URLs.
   *
   * If present, it is applied by {@link VFS.normalizePath} before other checks.
   */
  get urlResolver(): (url: string) => string {
    return this.options.urlResolver ?? null;
  }
  set urlResolver(resolver: (url: string) => string) {
    this.options.urlResolver = resolver ?? null;
  }
  /**
   * Normalizes a VFS path for HTTP use.
   *
   * Behavior:
   * - Applies `urlResolver` if provided.
   * - If the result is a data URI or an object URL, it is returned as-is.
   * - Otherwise falls back to the base VFS `normalizePath` logic.
   *
   * @param path - Input VFS path or URL-like string.
   * @returns Normalized path or URL.
   */
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

  /** {@inheritDoc VFS._makeDirectory} */
  protected async _makeDirectory(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  /** {@inheritDoc VFS._readDirectory} */
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

    const reader = await this.selectReader(dirPath, ctx);
    if (!reader) {
      console.warn('No directory reader can handle this directory');
      return [];
    }

    let layer = await reader.readOnce(dirPath, ctx);

    const includeHidden = options?.includeHidden ?? false;
    layer = layer.filter((e) => includeHidden || !e.name.startsWith('.'));

    if (options?.pattern) {
      const pattern = options.pattern!;
      if (typeof pattern === 'string') {
        const matcher = new GlobMatcher(pattern, true);
        layer = layer.filter((e) => matcher.test(e.name) || matcher.test(e.path));
      } else {
        layer = layer.filter((e) => pattern.test(e.name) || pattern.test(e.path));
      }
    }

    if (!options?.recursive) {
      return layer;
    }

    const out: FileMetadata[] = [...layer];
    for (const e of layer) {
      if (e.type === 'directory') {
        try {
          const sub = await this._readDirectory(e.path, options);
          out.push(...sub);
        } catch {
          // ignore
        }
      }
    }
    return out;
  }

  /** {@inheritDoc VFS._deleteDirectory} */
  protected async _deleteDirectory(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  /** {@inheritDoc VFS._readFile} */
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
        data = uint8ArrayToBase64(bytes);
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

  /** {@inheritDoc VFS._writeFile} */
  protected async _writeFile(
    path: string,
    _data: ArrayBuffer | string,
    _options?: WriteOptions
  ): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  /** {@inheritDoc VFS._deleteFile} */
  protected async _deleteFile(path: string): Promise<void> {
    throw new VFSError('HTTP file system is read-only', 'EROFS', path);
  }

  /** {@inheritDoc VFS._exists} */
  protected async _exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);

    try {
      const response = await this.fetchWithTimeout(normalizedPath, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** {@inheritDoc VFS._stat} */
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
  /** {@inheritDoc VFS._deleteFileSystem} */
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  /** {@inheritDoc VFS._wipe} */
  protected async _wipe(): Promise<void> {
    return;
  }
  /** {@inheritDoc VFS._move} */
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
  private async selectReader(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<HttpDirectoryReader> {
    if (this.dirReaders.length === 1) {
      return this.dirReaders[0];
    }

    for (const r of this.dirReaders) {
      if (!r.canHandle) {
        continue;
      }
      try {
        if (await r.canHandle(dirPath, ctx)) {
          return r;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }
}
