import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * ZipJSEntry interface of zip.js
 * @public
 */
export interface ZipJSEntry {
  filename: string;
  directory: boolean;
  uncompressedSize?: number;
  lastModDate?: Date;
  comment?: string;
  getData?(writer: any): Promise<any>;
}

/**
 * ZipJSReader interface of zip.js
 * @public
 */
export interface ZipJSReader {
  getEntries(): Promise<ZipJSEntry[]>;
  close?(): Promise<void>;
}

/**
 * ZipJSWriter interface of zip.js
 * @public
 */
export interface ZipJSWriter {
  add(filename: string, reader?: any, options?: any): Promise<any>;
  close(): Promise<any>;
}

/**
 * ZipJSReader constructor interface of zip.js
 * @public
 */
export interface ZipJSReaderConstructor {
  new (reader: any): ZipJSReader;
}

/**
 * ZipJSWriter constructor interface of zip.js
 * @public
 */
export interface ZipJSWriterConstructor {
  new (writer: any): ZipJSWriter;
}

/**
 * ZipJS dependencies
 * @public
 */
export interface ZipJSDependencies {
  // Reader/Writer 构造函数
  ZipReader: ZipJSReaderConstructor;
  ZipWriter: ZipJSWriterConstructor;

  // 数据读取器
  BlobReader: new (blob: Blob) => any;
  Uint8ArrayReader: new (array: Uint8Array) => any;
  TextReader: new (text: string) => any;

  // 数据写入器
  BlobWriter: new () => any;
  Uint8ArrayWriter: new () => any;
  TextWriter: new (encoding?: string) => any;

  // 配置函数（可选）
  configure?: (options: any) => void;
}

/**
 * ZIP entry type
 * @public
 */
export interface ZipEntry {
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: Date;
  comment?: string;
}

/**
 * ZIP file system implementation using zip.js.
 *
 * Supports reading, writing, and manipulating ZIP archives as a virtual file system.
 * Can be mounted onto other file systems and used in combination with other VFS implementations.
 *
 * @remarks
 * - The class requires zip.js dependencies to be provided.
 * - Virtual files (staged but not saved/written to ZIP yet) are supported for fast file operations and batch updates.
 * - All paths are normalized to ensure consistency.
 *
 * @example
 * ```typescript
 * import { ZipFS } from './zipfs';
 * import { zipjs } from 'zip.js'; // or custom zipjs build
 *
 * const zipFS = new ZipFS('test.zip', zipjs, false);
 * await zipFS.initializeFromData(arrayBufferOrBlob);
 * const fileList = await zipFS.readDirectory('/');
 * await zipFS.writeFile('/new.txt', 'Hello!');
 * const outBlob = await zipFS.getZipBlob();
 * ```
 *
 * @public
 */
export class ZipFS extends VFS {
  private zipReader: ZipJSReader | null = null;
  private zipWriter: ZipJSWriter | null = null;
  private entries: Map<string, ZipJSEntry> = new Map();
  private virtualFiles: Map<string, { data: ArrayBuffer | string; modified: Date }> = new Map();
  private zipData: Blob | Uint8Array | ArrayBuffer | null = null;
  private isModified: boolean = false;
  private readonly zipJS: ZipJSDependencies;

  /**
   * Constructs a ZIP file system instance.
   *
   * @param name - The name of the ZIP file system (used as its identifier)
   * @param zipJS - Dependency injection of zip.js constructors/readers/writers
   * @param readonly - Whether the file system should operate in read-only mode
   */
  constructor(name: string, zipJS: ZipJSDependencies, readonly = false) {
    super(name, readonly);
    this.zipJS = zipJS;
    if (!readonly) {
      // 创建新的空 ZIP
      this.initializeEmpty();
    }
  }

  /**
   * Initializes the ZIP file system from given binary data.
   * Reads the structure and caches all entries.
   *
   * @param data - ZIP file as Blob, ArrayBuffer, or Uint8Array
   */
  async initializeFromData(data: Blob | Uint8Array | ArrayBuffer): Promise<void> {
    try {
      let reader: any;

      if (data instanceof ArrayBuffer) {
        this.zipData = new Uint8Array(data);
        reader = new this.zipJS.Uint8ArrayReader(this.zipData as Uint8Array);
      } else if (data instanceof Uint8Array) {
        this.zipData = data;
        reader = new this.zipJS.Uint8ArrayReader(data);
      } else {
        this.zipData = data;
        reader = new this.zipJS.BlobReader(data);
      }

      this.zipReader = new this.zipJS.ZipReader(reader);

      // 读取所有条目
      const entries = await this.zipReader.getEntries();
      this.entries.clear();

      for (const entry of entries) {
        const normalizedPath = PathUtils.normalize('/' + entry.filename);
        this.entries.set(normalizedPath, entry);
      }
    } catch (error) {
      throw new VFSError('Failed to initialize ZIP file', 'EINVAL', String(error));
    }
  }

  /**
   * 初始化空 ZIP
   */
  private initializeEmpty() {
    this.zipData = new Uint8Array(0);
    const writer = new this.zipJS.Uint8ArrayWriter();
    this.zipWriter = new this.zipJS.ZipWriter(writer);
    this.entries.clear();
    this.virtualFiles.clear();
  }

  /**
   * 确保 ZIP writer 存在
   */
  private async ensureWriter(): Promise<ZipJSWriter> {
    if (this.isReadOnly) {
      throw new VFSError('ZIP file system is read-only', 'EROFS');
    }

    if (!this.zipWriter) {
      const writer = new this.zipJS.Uint8ArrayWriter();
      this.zipWriter = new this.zipJS.ZipWriter(writer);

      // 如果有现有数据，先复制到新的 writer
      if (this.zipReader) {
        const entries = await this.zipReader.getEntries();
        for (const entry of entries) {
          if (!entry.directory) {
            const dataWriter = new this.zipJS.Uint8ArrayWriter();
            const data = await entry.getData!(dataWriter);
            const dataReader = new this.zipJS.Uint8ArrayReader(data);

            await this.zipWriter.add(entry.filename, dataReader, {
              lastModDate: entry.lastModDate,
              comment: entry.comment
            });
          } else {
            await this.zipWriter.add(entry.filename, undefined, {
              directory: true,
              lastModDate: entry.lastModDate,
              comment: entry.comment
            });
          }
        }
      }
    }

    return this.zipWriter;
  }

  /**
   * 应用虚拟文件的更改到 ZIP writer
   */
  private async applyVirtualFiles(): Promise<void> {
    if (this.virtualFiles.size === 0) {
      return;
    }

    const writer = await this.ensureWriter();

    for (const [path, virtualFile] of this.virtualFiles) {
      const filename = path.slice(1); // 移除开头的 /

      if (virtualFile.data instanceof ArrayBuffer) {
        const reader = new this.zipJS.Uint8ArrayReader(new Uint8Array(virtualFile.data));
        await writer.add(filename, reader, {
          lastModDate: virtualFile.modified
        });
      } else {
        const reader = new this.zipJS.TextReader(virtualFile.data);
        await writer.add(filename, reader, {
          lastModDate: virtualFile.modified
        });
      }
    }

    this.virtualFiles.clear();
    this.isModified = true;
  }

  /**
   * Returns ZIP archive data as a Uint8Array, saving any in-memory changes first.
   *
   * @returns ZIP file contents as a Uint8Array
   */
  async getZipData(): Promise<Uint8Array> {
    // 先应用虚拟文件的更改
    await this.applyVirtualFiles();

    if (this.zipWriter && this.isModified) {
      // 完成写入并获取数据
      const data = await this.zipWriter.close();
      this.zipData = data;
      this.isModified = false;

      // 重新初始化 reader
      await this.initializeFromData(data);
    }

    if (this.zipData instanceof Uint8Array) {
      return this.zipData;
    } else if (this.zipData instanceof Blob) {
      return new Uint8Array(await this.zipData.arrayBuffer());
    } else if (this.zipData instanceof ArrayBuffer) {
      return new Uint8Array(this.zipData);
    }

    return new Uint8Array(0);
  }

  /**
   * Returns ZIP archive data as a Blob, saving any in-memory changes first.
   *
   * @returns ZIP file contents as a Blob
   */
  async getZipBlob(): Promise<Blob> {
    const data = await this.getZipData();
    return new Blob([data], { type: 'application/zip' });
  }

  /**
   * Saves the ZIP archive to a target VFS at the given path.
   *
   * @param targetVFS - The file system where to save the ZIP archive
   * @param path - The destination path (including file name)
   */
  async saveToVFS(targetVFS: VFS, path: string): Promise<void> {
    const data = await this.getZipData();
    await targetVFS.writeFile(path, data.buffer);
  }

  /**
   * Returns metadata for all entries in the ZIP archive.
   * Includes in-memory (virtual) files.
   *
   * @returns List of all ZIP entries/directories/files
   */
  async getEntries(): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];

    for (const [path, entry] of this.entries) {
      entries.push({
        path,
        isDirectory: entry.directory,
        size: entry.uncompressedSize || 0,
        lastModified: entry.lastModDate || new Date(),
        comment: entry.comment
      });
    }

    // 添加虚拟文件
    for (const [path, virtualFile] of this.virtualFiles) {
      const size =
        virtualFile.data instanceof ArrayBuffer
          ? virtualFile.data.byteLength
          : new TextEncoder().encode(virtualFile.data).length;

      entries.push({
        path,
        isDirectory: false,
        size,
        lastModified: virtualFile.modified
      });
    }

    return entries;
  }

  private matchesFilter(metadata: FileMetadata, options?: ListOptions): boolean {
    if (!options) {
      return true;
    }

    // 隐藏文件过滤
    if (!options.includeHidden && metadata.name.startsWith('.')) {
      return false;
    }

    // 模式匹配
    if (options.pattern) {
      if (typeof options.pattern === 'string') {
        return metadata.name.includes(options.pattern);
      } else if (options.pattern instanceof RegExp) {
        return options.pattern.test(metadata.name);
      }
    }

    return true;
  }

  /** {@inheritDoc VFS._makeDirectory} */
  protected async _makeDirectory(path: string, recursive: boolean): Promise<void> {
    const normalizedPath = PathUtils.normalize(path);

    if (await this._exists(normalizedPath)) {
      return;
    }

    const parent = PathUtils.dirname(normalizedPath);
    if (parent !== '/' && parent !== normalizedPath) {
      const parentExists = await this._exists(parent);
      if (!parentExists) {
        if (recursive) {
          await this._makeDirectory(parent, true);
        } else {
          throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
        }
      }
    }

    const writer = await this.ensureWriter();
    const dirPath = normalizedPath.endsWith('/') ? normalizedPath.slice(1) : normalizedPath.slice(1) + '/';

    await writer.add(dirPath, undefined, {
      directory: true,
      lastModDate: new Date()
    });

    this.isModified = true;

    this.entries.set(normalizedPath, {
      filename: dirPath,
      directory: true,
      uncompressedSize: 0,
      lastModDate: new Date(),
      comment: ''
    } as ZipJSEntry);
  }

  /** {@inheritDoc VFS._readDirectory} */
  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const normalizedPath = PathUtils.normalize(path);
    const results: FileMetadata[] = [];

    const searchPath = normalizedPath === '/' ? '' : normalizedPath.slice(1) + '/';

    const foundEntries = new Set<string>();

    for (const [_entryPath, entry] of this.entries) {
      const relativePath = entry.filename;

      if (normalizedPath === '/') {
        const parts = relativePath.split('/').filter((p) => p);
        if (parts.length === 0) {
          continue;
        }

        const firstPart = parts[0];
        const isDir = relativePath.endsWith('/') || parts.length > 1;

        if (!foundEntries.has(firstPart)) {
          foundEntries.add(firstPart);
          const metadata: FileMetadata = {
            name: firstPart,
            path: '/' + firstPart,
            size: isDir ? 0 : entry.uncompressedSize || 0,
            type: isDir ? 'directory' : 'file',
            created: entry.lastModDate || new Date(),
            modified: entry.lastModDate || new Date(),
            mimeType: isDir ? undefined : guessMimeType('/' + firstPart)
          };

          if (this.matchesFilter(metadata, options)) {
            results.push(metadata);
          }
        }
      } else if (relativePath.startsWith(searchPath)) {
        const remainingPath = relativePath.slice(searchPath.length);

        if (!remainingPath) {
          continue;
        }

        if (options?.recursive) {
          const fullPath = '/' + relativePath.replace(/\/$/, '');
          if (!foundEntries.has(fullPath)) {
            foundEntries.add(fullPath);
            const metadata: FileMetadata = {
              name: PathUtils.basename(fullPath),
              path: fullPath,
              size: entry.directory ? 0 : entry.uncompressedSize || 0,
              type: entry.directory ? 'directory' : 'file',
              created: entry.lastModDate || new Date(),
              modified: entry.lastModDate || new Date(),
              mimeType: entry.directory ? undefined : guessMimeType(fullPath)
            };

            if (this.matchesFilter(metadata, options)) {
              results.push(metadata);
            }
          }
        } else {
          const parts = remainingPath.split('/').filter((p) => p);
          if (parts.length > 0) {
            const firstPart = parts[0];
            const isDir = remainingPath.includes('/') || relativePath.endsWith('/');
            const childPath = PathUtils.join(normalizedPath, firstPart);

            if (!foundEntries.has(firstPart)) {
              foundEntries.add(firstPart);
              const metadata: FileMetadata = {
                name: firstPart,
                path: childPath,
                size: isDir ? 0 : entry.uncompressedSize || 0,
                type: isDir ? 'directory' : 'file',
                created: entry.lastModDate || new Date(),
                modified: entry.lastModDate || new Date(),
                mimeType: isDir ? undefined : guessMimeType(childPath)
              };

              if (this.matchesFilter(metadata, options)) {
                results.push(metadata);
              }
            }
          }
        }
      }
    }

    for (const [virtualPath, virtualFile] of this.virtualFiles) {
      const parent = PathUtils.dirname(virtualPath);
      if (parent === normalizedPath || (options?.recursive && virtualPath.startsWith(normalizedPath + '/'))) {
        const name = PathUtils.basename(virtualPath);
        if (!foundEntries.has(name)) {
          foundEntries.add(name);
          const size =
            virtualFile.data instanceof ArrayBuffer
              ? virtualFile.data.byteLength
              : new TextEncoder().encode(virtualFile.data).length;

          const metadata: FileMetadata = {
            name,
            path: virtualPath,
            size,
            type: 'file',
            created: virtualFile.modified,
            modified: virtualFile.modified,
            mimeType: guessMimeType(virtualPath)
          };

          if (this.matchesFilter(metadata, options)) {
            results.push(metadata);
          }
        }
      }
    }

    return results;
  }

  /** {@inheritDoc VFS._deleteDirectory} */
  protected async _deleteDirectory(path: string, recursive: boolean): Promise<void> {
    const normalizedPath = PathUtils.normalize(path);

    const dirExists = await this._exists(normalizedPath);
    if (!dirExists) {
      throw new VFSError('Directory does not exist', 'ENOENT', path);
    }

    const children = await this._readDirectory(normalizedPath);
    if (children.length > 0 && !recursive) {
      throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
    }

    if (recursive) {
      for (const child of children) {
        if (child.type === 'directory') {
          await this._deleteDirectory(child.path, true);
        } else {
          await this._deleteFile(child.path);
        }
      }
    }

    const searchPath = normalizedPath.slice(1);
    const toDelete: string[] = [];

    for (const [entryPath, entry] of this.entries) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        toDelete.push(entryPath);
      }
    }

    for (const path of toDelete) {
      this.entries.delete(path);
    }

    this.virtualFiles.delete(normalizedPath);

    this.isModified = true;
  }

  /** {@inheritDoc VFS._readFile} */
  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    const normalizedPath = PathUtils.normalize(path);

    if (this.virtualFiles.has(normalizedPath)) {
      const virtualFile = this.virtualFiles.get(normalizedPath)!;
      let data = virtualFile.data;

      if (options?.encoding === 'utf8' && data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(data);
      } else if (options?.encoding === 'base64') {
        if (data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(data);
          data = btoa(String.fromCodePoint(...bytes));
        } else if (typeof data === 'string') {
          data = btoa(data);
        }
      }

      if (options?.offset !== undefined || options?.length !== undefined) {
        const offset = options.offset || 0;
        const length = options.length;

        if (data instanceof ArrayBuffer) {
          const end = length !== undefined ? offset + length : data.byteLength;
          data = data.slice(offset, end);
        } else if (typeof data === 'string') {
          const end = length !== undefined ? offset + length : data.length;
          data = data.slice(offset, end);
        }
      }

      return data;
    }

    const searchPath = normalizedPath.slice(1);
    const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);

    if (!entry || entry.directory) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    if (!entry.getData) {
      throw new VFSError('Cannot read file data', 'EIO', path);
    }

    if (options?.encoding === 'utf8') {
      const textWriter = new this.zipJS.TextWriter();
      let data = await entry.getData(textWriter);

      if (options?.offset !== undefined || options?.length !== undefined) {
        const offset = options.offset || 0;
        const length = options.length;
        const end = length !== undefined ? offset + length : data.length;
        data = data.slice(offset, end);
      }

      return data;
    } else {
      const arrayWriter = new this.zipJS.Uint8ArrayWriter();
      const uint8Array = await entry.getData(arrayWriter);
      let arrayBuffer: ArrayBuffer = uint8Array.buffer;

      if (options?.encoding === 'base64') {
        const bytes = new Uint8Array(arrayBuffer);
        let base64String = btoa(String.fromCodePoint(...bytes));

        if (options?.offset !== undefined || options?.length !== undefined) {
          const offset = options.offset || 0;
          const length = options.length;
          const end = length !== undefined ? offset + length : base64String.length;
          base64String = base64String.slice(offset, end);
        }

        return base64String;
      }

      if (options?.offset !== undefined || options?.length !== undefined) {
        const offset = options.offset || 0;
        const length = options.length;
        const end = length !== undefined ? offset + length : arrayBuffer.byteLength;
        arrayBuffer = arrayBuffer.slice(offset, end);
      }

      return arrayBuffer;
    }
  }

  /** {@inheritDoc VFS._writeFile} */
  protected async _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void> {
    const normalizedPath = PathUtils.normalize(path);
    const parent = PathUtils.dirname(normalizedPath);

    if (parent !== '/' && !(await this._exists(parent))) {
      if (options?.create) {
        await this._makeDirectory(parent, true);
      } else {
        throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
      }
    }

    let fileData: ArrayBuffer | string = data;

    if (options?.append) {
      let existingData: ArrayBuffer | string | null = null;

      try {
        existingData = await this._readFile(normalizedPath);
      } catch (_error) {}

      if (existingData) {
        if (typeof data === 'string' && typeof existingData === 'string') {
          fileData = existingData + data;
        } else if (data instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
          const combined = new Uint8Array(existingData.byteLength + data.byteLength);
          combined.set(new Uint8Array(existingData), 0);
          combined.set(new Uint8Array(data), existingData.byteLength);
          fileData = combined.buffer;
        } else {
          const existingStr =
            existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
          const newStr = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : data;
          fileData = existingStr + newStr;
        }
      }
    }

    // 处理编码
    if (options?.encoding === 'base64' && typeof fileData === 'string') {
      try {
        const binaryString = atob(fileData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.codePointAt(i);
        }
        fileData = bytes.buffer;
      } catch (_error) {
        throw new VFSError('Invalid base64 data', 'EINVAL', path);
      }
    }

    this.virtualFiles.set(normalizedPath, {
      data: fileData,
      modified: new Date()
    });

    this.isModified = true;
  }

  /** {@inheritDoc VFS._deleteFile} */
  protected async _deleteFile(path: string): Promise<void> {
    const normalizedPath = PathUtils.normalize(path);

    if (!(await this._exists(normalizedPath))) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    this.virtualFiles.delete(normalizedPath);

    const searchPath = normalizedPath.slice(1);
    const toDelete: string[] = [];

    for (const [entryPath, entry] of this.entries) {
      if (entry.filename === searchPath && !entry.directory) {
        toDelete.push(entryPath);
      }
    }

    for (const path of toDelete) {
      this.entries.delete(path);
    }

    this.isModified = true;
  }

  /** {@inheritDoc VFS._exists} */
  protected async _exists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalize(path);

    if (this.virtualFiles.has(normalizedPath)) {
      return true;
    }

    const searchPath = normalizedPath.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        return true;
      }
    }

    if (normalizedPath !== '/') {
      const searchPrefix = searchPath + '/';
      for (const entry of this.entries.values()) {
        if (entry.filename.startsWith(searchPrefix)) {
          return true;
        }
      }

      for (const virtualPath of this.virtualFiles.keys()) {
        if (virtualPath.startsWith(normalizedPath + '/')) {
          return true;
        }
      }
    }

    return false;
  }

  /** {@inheritDoc VFS._stat} */
  protected async _stat(path: string): Promise<FileStat> {
    const normalizedPath = PathUtils.normalize(path);

    if (this.virtualFiles.has(normalizedPath)) {
      const virtualFile = this.virtualFiles.get(normalizedPath)!;
      const size =
        virtualFile.data instanceof ArrayBuffer
          ? virtualFile.data.byteLength
          : new TextEncoder().encode(virtualFile.data).length;

      return {
        size,
        isFile: true,
        isDirectory: false,
        created: virtualFile.modified,
        modified: virtualFile.modified,
        accessed: virtualFile.modified
      };
    }

    const searchPath = normalizedPath.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        return {
          size: entry.directory ? 0 : entry.uncompressedSize || 0,
          isFile: !entry.directory,
          isDirectory: entry.directory,
          created: entry.lastModDate || new Date(),
          modified: entry.lastModDate || new Date(),
          accessed: entry.lastModDate || new Date()
        };
      }
    }

    if (normalizedPath !== '/') {
      const searchPrefix = searchPath + '/';
      for (const entry of this.entries.values()) {
        if (entry.filename.startsWith(searchPrefix)) {
          return {
            size: 0,
            isFile: false,
            isDirectory: true,
            created: new Date(),
            modified: new Date(),
            accessed: new Date()
          };
        }
      }

      for (const virtualPath of this.virtualFiles.keys()) {
        if (virtualPath.startsWith(normalizedPath + '/')) {
          return {
            size: 0,
            isFile: false,
            isDirectory: true,
            created: new Date(),
            modified: new Date(),
            accessed: new Date()
          };
        }
      }
    }

    throw new VFSError('Path does not exist', 'ENOENT', path);
  }

  /**
   * Close zip archive and release resources
   */
  async close(): Promise<void> {
    if (this.zipReader && this.zipReader.close) {
      await this.zipReader.close();
    }

    if (this.zipWriter) {
      if (this.isModified || this.virtualFiles.size > 0) {
        await this.getZipData();
      }
    }

    this.zipReader = null;
    this.zipWriter = null;
    this.entries.clear();
    this.virtualFiles.clear();
    this.zipData = null;
  }

  /**
   * Check whether we have unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.isModified || this.virtualFiles.size > 0;
  }

  /**
   * Force all data to be saved
   */
  async flush(): Promise<void> {
    if (this.hasUnsavedChanges()) {
      await this.getZipData();
    }
  }

  /**
   * Get compression state
   */
  async getCompressionStats(): Promise<{
    totalEntries: number;
    totalUncompressedSize: number;
    totalCompressedSize: number;
    compressionRatio: number;
  }> {
    let totalEntries = 0;
    let totalUncompressedSize = 0;

    for (const entry of this.entries.values()) {
      if (!entry.directory) {
        totalEntries++;
        totalUncompressedSize += entry.uncompressedSize || 0;
      }
    }

    for (const virtualFile of this.virtualFiles.values()) {
      totalEntries++;
      const size =
        virtualFile.data instanceof ArrayBuffer
          ? virtualFile.data.byteLength
          : new TextEncoder().encode(virtualFile.data).length;
      totalUncompressedSize += size;
    }

    const zipData = await this.getZipData();
    const totalCompressedSize = zipData.length;
    const compressionRatio = totalUncompressedSize > 0 ? totalCompressedSize / totalUncompressedSize : 0;

    return {
      totalEntries,
      totalUncompressedSize,
      totalCompressedSize,
      compressionRatio
    };
  }

  /**
   * Extract all content of the zip archive to another VFS
   */
  async extractTo(
    targetVFS: VFS,
    targetPath: string = '/',
    options?: {
      overwrite?: boolean;
      filter?: (path: string) => boolean;
      progress?: (current: number, total: number, path: string) => void;
    }
  ): Promise<void> {
    const entries = await this.getEntries();
    const filteredEntries = options?.filter
      ? entries.filter((entry) => options.filter!(entry.path))
      : entries;

    let current = 0;
    const total = filteredEntries.length;

    for (const entry of filteredEntries) {
      const targetFilePath = PathUtils.join(targetPath, entry.path);

      if (options?.progress) {
        options.progress(current, total, entry.path);
      }

      if (entry.isDirectory) {
        if (!(await targetVFS.exists(targetFilePath))) {
          await targetVFS.makeDirectory(targetFilePath, true);
        }
      } else {
        if (!options?.overwrite && (await targetVFS.exists(targetFilePath))) {
          current++;
          continue;
        }

        const fileData = await this.readFile(entry.path);
        await targetVFS.writeFile(targetFilePath, fileData, { create: true });
      }

      current++;
    }

    if (options?.progress) {
      options.progress(total, total, '');
    }
  }

  /**
   * Add file to the zip archive from another VFS
   */
  async addFromVFS(
    sourceVFS: VFS,
    sourcePath: string,
    targetPath?: string,
    options?: {
      recursive?: boolean;
      filter?: (path: string) => boolean;
      progress?: (current: number, total: number, path: string) => void;
    }
  ): Promise<void> {
    if (this.isReadOnly) {
      throw new VFSError('ZIP file system is read-only', 'EROFS');
    }

    const actualTargetPath = targetPath || sourcePath;

    if (!(await sourceVFS.exists(sourcePath))) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    const stat = await sourceVFS.stat(sourcePath);

    if (stat.isFile) {
      if (!options?.filter || options.filter(sourcePath)) {
        if (options?.progress) {
          options.progress(0, 1, sourcePath);
        }

        const data = await sourceVFS.readFile(sourcePath);
        await this.writeFile(actualTargetPath, data);

        if (options?.progress) {
          options.progress(1, 1, sourcePath);
        }
      }
    } else if (stat.isDirectory) {
      const entries = await sourceVFS.readDirectory(sourcePath, {
        recursive: options?.recursive
      });

      const filteredEntries = options?.filter
        ? entries.filter((entry) => options.filter!(entry.path))
        : entries;

      let current = 0;
      const total = filteredEntries.length;

      if (!options?.filter || options.filter(sourcePath)) {
        await this.makeDirectory(actualTargetPath, true);
      }

      for (const entry of filteredEntries) {
        if (options?.progress) {
          options.progress(current, total, entry.path);
        }

        const relativePath = PathUtils.relative(sourcePath, entry.path);
        const targetFilePath = PathUtils.join(actualTargetPath, relativePath);

        if (entry.type === 'directory') {
          await this.makeDirectory(targetFilePath, true);
        } else {
          const data = await sourceVFS.readFile(entry.path);
          await this.writeFile(targetFilePath, data);
        }

        current++;
      }

      if (options?.progress) {
        options.progress(total, total, '');
      }
    }
  }

  /**
   * Verify ZIP archive
   */
  async verify(): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const entries = await this.getEntries();

      for (const entry of entries) {
        if (!entry.isDirectory) {
          try {
            await this.readFile(entry.path);
          } catch (error) {
            errors.push(`Failed to read file: ${entry.path} - ${error}`);
          }
        }
      }

      for (const entry of entries) {
        if (entry.path.includes('..')) {
          warnings.push(`Potentially unsafe path: ${entry.path}`);
        }

        if (entry.path.includes('//')) {
          warnings.push(`Path contains double slashes: ${entry.path}`);
        }
      }
    } catch (error) {
      errors.push(`ZIP structure error: ${error}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Gets CRC32 of a file in the zip archive（if it exists）
   */
  async getFileCRC32(path: string): Promise<number | null> {
    const normalizedPath = PathUtils.normalize(path);
    const searchPath = normalizedPath.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath && !entry.directory) {
        // zip.js 的 Entry 可能包含 CRC32 信息
        return (entry as any).crc32 || null;
      }
    }

    return null;
  }

  /**
   * No support for destroying
   */
  protected async _destroy(): Promise<void> {
    return;
  }
}
