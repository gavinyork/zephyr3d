import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, MoveOptions, ReadOptions, WriteOptions } from './vfs';
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
   * @param zipJS - Dependency injection of zip.js constructors/readers/writers
   * @param readonly - Whether the file system should operate in read-only mode
   */
  constructor(zipJS: ZipJSDependencies, readonly = false) {
    super(readonly);
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
        const normalizedPath = this.normalizePath('/' + entry.filename);
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
    if (this.readOnly) {
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
    if (await this._exists(path)) {
      return;
    }

    const parent = PathUtils.dirname(path);
    if (parent !== '/' && parent !== path) {
      const parentExists = await this._exists(parent);
      if (!parentExists) {
        if (recursive) {
          await this._makeDirectory(parent, true);
        } else {
          throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
        }
      }
    }

    // 使用 writer 创建目录（保持原有行为）
    const writer = await this.ensureWriter();
    const dirPath = path.endsWith('/') ? path.slice(1) : path.slice(1) + '/';

    try {
      await writer.add(dirPath, undefined, {
        directory: true,
        lastModDate: new Date()
      });
    } catch (error) {
      // 如果是重复条目错误，忽略它（目录已存在）
      if (String(error).includes('already exists')) {
        // 目录已存在，直接更新内部数据结构
      } else {
        // 其他错误，重新抛出
        throw error;
      }
    }

    this.isModified = true;

    this.entries.set(path, {
      filename: dirPath,
      directory: true,
      uncompressedSize: 0,
      lastModDate: new Date(),
      comment: ''
    } as ZipJSEntry);
  }

  /** {@inheritDoc VFS._readDirectory} */
  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    // 根目录的特殊处理 - 即使是空 ZIP 也应该能读取根目录
    if (path === '/' && this.entries.size === 0 && this.virtualFiles.size === 0) {
      return []; // 空目录，但不抛出错误
    }

    const results: FileMetadata[] = [];
    const searchPath = path === '/' ? '' : path.slice(1) + '/';
    const foundEntries = new Set<string>();

    // ... 其余代码保持不变
    for (const [_entryPath, entry] of this.entries) {
      const relativePath = entry.filename;

      if (path === '/') {
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
        // ... 其余逻辑保持不变
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
            const childPath = PathUtils.join(path, firstPart);

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

    // 处理虚拟文件
    for (const [virtualPath, virtualFile] of this.virtualFiles) {
      const parent = PathUtils.dirname(virtualPath);
      if (parent === path || (options?.recursive && virtualPath.startsWith(path + '/'))) {
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
    const dirExists = await this._exists(path);
    if (!dirExists) {
      throw new VFSError('Directory does not exist', 'ENOENT', path);
    }

    const children = await this._readDirectory(path);
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

    const searchPath = path.slice(1);
    const toDelete: string[] = [];

    for (const [entryPath, entry] of this.entries) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        toDelete.push(entryPath);
      }
    }

    for (const path of toDelete) {
      this.entries.delete(path);
    }

    this.virtualFiles.delete(path);

    this.isModified = true;
  }

  /** {@inheritDoc VFS._readFile} */
  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    // 先检查虚拟文件
    if (this.virtualFiles.has(path)) {
      const virtualFile = this.virtualFiles.get(path)!;
      return this.processFileData(virtualFile.data, options);
    }

    // 检查ZIP条目
    const searchPath = path.slice(1);
    const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);

    if (!entry || entry.directory) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    if (!entry.getData) {
      throw new VFSError('Cannot read file data', 'EIO', path);
    }

    // 总是先读取为ArrayBuffer，然后统一处理编码
    const arrayWriter = new this.zipJS.Uint8ArrayWriter();
    const uint8Array = await entry.getData(arrayWriter);
    const arrayBuffer = uint8Array.buffer;

    return this.processFileData(arrayBuffer, options);
  }

  /**
   * 统一的文件数据处理方法
   */
  private processFileData(data: ArrayBuffer | string, options?: ReadOptions): ArrayBuffer | string {
    let processedData = data;
    const requestedEncoding = options?.encoding;

    // 根据请求的编码格式进行转换
    if (requestedEncoding === 'utf8') {
      // 请求 UTF-8 字符串
      if (processedData instanceof ArrayBuffer) {
        processedData = new TextDecoder().decode(processedData);
      }
      // 如果已经是 string，直接使用
    } else if (requestedEncoding === 'base64') {
      // 请求 Base64 字符串
      if (processedData instanceof ArrayBuffer) {
        const bytes = new Uint8Array(processedData);
        processedData = btoa(String.fromCodePoint(...bytes));
      } else if (typeof processedData === 'string') {
        // 字符串先转为 ArrayBuffer，再转 Base64
        const bytes = new TextEncoder().encode(processedData);
        processedData = btoa(String.fromCodePoint(...bytes));
      }
    } else if (requestedEncoding === 'binary' || !requestedEncoding) {
      // 请求 ArrayBuffer（binary 或默认）
      if (typeof processedData === 'string') {
        processedData = new TextEncoder().encode(processedData).buffer;
      }
      // 如果已经是 ArrayBuffer，直接使用
    }

    // 处理范围读取
    if (options?.offset !== undefined || options?.length !== undefined) {
      const offset = options.offset || 0;
      const length = options.length;

      if (processedData instanceof ArrayBuffer) {
        const end = length !== undefined ? offset + length : processedData.byteLength;
        processedData = processedData.slice(offset, end);
      } else if (typeof processedData === 'string') {
        const end = length !== undefined ? offset + length : processedData.length;
        processedData = processedData.slice(offset, end);
      }
    }

    return processedData;
  }

  /** {@inheritDoc VFS._writeFile} */
  /** {@inheritDoc VFS._writeFile} */
  protected async _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void> {
    const parent = PathUtils.dirname(path);

    if (parent !== '/' && !(await this._exists(parent))) {
      if (options?.create) {
        await this._makeDirectory(parent, true);
      } else {
        throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
      }
    }

    // 检查文件是否已存在
    const fileExists = await this._exists(path);
    if (fileExists) {
      // 检查是否是目录
      const stat = await this._stat(path);
      if (stat.isDirectory) {
        throw new VFSError('Path is a directory', 'EISDIR', path);
      }

      // 只有在明确指定 create: false 时才抛出错误
      if (options?.create === false) {
        throw new VFSError('File already exists', 'EEXIST', path);
      }
      // 否则允许覆盖（这是标准的文件系统行为）
    }

    let fileData: ArrayBuffer | string = data;

    // 处理编码选项
    if (options?.encoding === 'base64' && typeof fileData === 'string') {
      try {
        const binaryString = atob(fileData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileData = bytes.buffer;
      } catch (error) {
        throw new VFSError('Invalid base64 data', 'EINVAL', path);
      }
    } else if (options?.encoding === 'utf8') {
      // 确保以字符串形式存储UTF-8数据
      if (fileData instanceof ArrayBuffer) {
        fileData = new TextDecoder().decode(fileData);
      }
    } else if (options?.encoding === 'binary' || !options?.encoding) {
      // 默认以二进制（ArrayBuffer）形式存储
      if (typeof fileData === 'string') {
        fileData = new TextEncoder().encode(fileData).buffer;
      }
    }

    // 获取现有文件的创建时间（如果存在）
    let createdTime = new Date();
    let isExistingFile = false;

    if (fileExists) {
      try {
        const existingStat = await this._stat(path);
        createdTime = existingStat.created;
        isExistingFile = true;
      } catch (error) {
        // 忽略错误，使用默认时间
      }
    }

    // 处理追加模式
    if (options?.append && isExistingFile) {
      let existingData: ArrayBuffer | string | null = null;

      try {
        existingData = await this._readFile(path);
      } catch (error) {
        // 读取失败，忽略错误
      }

      if (existingData) {
        if (typeof fileData === 'string' && typeof existingData === 'string') {
          fileData = existingData + fileData;
        } else if (fileData instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
          const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
          combined.set(new Uint8Array(existingData), 0);
          combined.set(new Uint8Array(fileData), existingData.byteLength);
          fileData = combined.buffer;
        } else {
          // 混合类型：转换为字符串处理
          const existingStr =
            existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
          const newStr = fileData instanceof ArrayBuffer ? new TextDecoder().decode(fileData) : fileData;
          fileData = existingStr + newStr;
        }
      }
    }

    // 存储为虚拟文件
    this.virtualFiles.set(path, {
      data: fileData,
      modified: new Date()
    });

    // 如果这是一个现有文件，保持元数据
    if (isExistingFile) {
      // 保持现有文件的创建时间，更新修改时间
      const searchPath = path.slice(1);
      this.entries.set(path, {
        filename: searchPath,
        directory: false,
        uncompressedSize:
          typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
        lastModDate: createdTime, // 保持原始创建时间
        comment: '',
        getData: undefined // 这个会在applyVirtualFiles时重新设置
      } as ZipJSEntry);
    }

    this.isModified = true;
  }

  /** {@inheritDoc VFS._deleteFile} */
  protected async _deleteFile(path: string): Promise<void> {
    if (!(await this._exists(path))) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    this.virtualFiles.delete(path);

    const searchPath = path.slice(1);
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
    // 根目录总是存在
    if (path === '/') {
      return true;
    }

    // 检查虚拟文件
    if (this.virtualFiles.has(path)) {
      return true;
    }

    const searchPath = path.slice(1);

    // 检查确切匹配
    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        return true;
      }
    }

    // 检查是否作为目录存在（有子条目）
    const searchPrefix = searchPath + '/';
    for (const entry of this.entries.values()) {
      if (entry.filename.startsWith(searchPrefix)) {
        return true;
      }
    }

    // 检查虚拟文件中是否有子条目
    for (const virtualPath of this.virtualFiles.keys()) {
      if (virtualPath.startsWith(path + '/')) {
        return true;
      }
    }

    return false;
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
    if (this.readOnly) {
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
    const searchPath = path.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath && !entry.directory) {
        // zip.js 的 Entry 可能包含 CRC32 信息
        return (entry as any).crc32 || null;
      }
    }

    return null;
  }

  /**
   * No support for deleting filesystem
   */
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  /**
   * No support for deleting database
   */
  protected async _deleteDatabase(): Promise<void> {
    return;
  }
  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    if (this.readOnly) {
      throw new VFSError('ZIP file system is read-only', 'EROFS');
    }

    // 检查源路径是否存在
    if (!(await this._exists(sourcePath))) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    // 检查目标是否已存在
    const targetExists = await this._exists(targetPath);
    if (targetExists && !options?.overwrite) {
      throw new VFSError('Target already exists', 'EEXIST', targetPath);
    }

    // 确保目标父目录存在
    const targetParent = PathUtils.dirname(targetPath);
    if (targetParent !== '/' && !(await this._exists(targetParent))) {
      throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
    }

    const sourceStat = await this._stat(sourcePath);

    if (sourceStat.isFile) {
      // 移动文件
      await this.moveFile(sourcePath, targetPath, sourceStat, options);
    } else if (sourceStat.isDirectory) {
      // 移动目录
      await this.moveDirectory(sourcePath, targetPath, sourceStat, options);
    }

    this.isModified = true;
  }

  private async moveFile(
    sourcePath: string,
    targetPath: string,
    sourceStat: FileStat,
    options?: MoveOptions
  ): Promise<void> {
    // 读取源文件数据
    const fileData = await this._readFile(sourcePath);

    // 获取源文件的原始创建时间
    let originalCreated = sourceStat.created;

    // 如果源文件在ZIP条目中，尝试获取更准确的创建时间
    if (!this.virtualFiles.has(sourcePath)) {
      const searchPath = sourcePath.slice(1);
      const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);
      if (entry && entry.lastModDate) {
        originalCreated = entry.lastModDate;
      }
    }

    // 如果目标存在且允许覆盖，先删除
    if (options?.overwrite && (await this._exists(targetPath))) {
      await this._deleteFile(targetPath);
    }

    // 删除源文件
    await this._deleteFile(sourcePath);

    // 直接写入目标位置，绕过 _writeFile 的存在性检查
    const moveTime = new Date(); // 移动操作的时间

    this.virtualFiles.set(targetPath, {
      data: fileData,
      modified: moveTime // 移动操作更新修改时间
    });

    // 创建新条目来保持元数据
    const targetSearchPath = targetPath.slice(1);
    this.entries.set(targetPath, {
      filename: targetSearchPath,
      directory: false,
      uncompressedSize:
        typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
      lastModDate: originalCreated, // 保持原始创建时间
      comment: '',
      getData: undefined // 会在applyVirtualFiles时重新设置
    } as ZipJSEntry);
  }

  private async moveDirectoryImproved(
    sourcePath: string,
    targetPath: string,
    sourceStat: FileStat,
    options?: MoveOptions
  ): Promise<void> {
    // 获取源目录的原始创建时间
    let originalCreated = sourceStat.created;

    // 尝试从ZIP条目获取更准确的创建时间
    const searchPath = sourcePath.slice(1);
    const entry = Array.from(this.entries.values()).find(
      (e) => e.filename === searchPath || e.filename === searchPath + '/'
    );
    if (entry && entry.lastModDate) {
      originalCreated = entry.lastModDate;
    }

    // 如果目标存在且允许覆盖，先删除
    if (options?.overwrite && (await this._exists(targetPath))) {
      await this._deleteDirectory(targetPath, true);
    }

    // 获取所有子项并备份文件数据
    const children = await this._readDirectory(sourcePath, { recursive: true });
    const fileDataBackup = new Map<string, ArrayBuffer | string>();

    // 备份所有文件数据
    for (const child of children) {
      if (child.type === 'file') {
        try {
          const data = await this._readFile(child.path);
          fileDataBackup.set(child.path, data);
        } catch (error) {
          console.warn(`Failed to backup file ${child.path}:`, error);
        }
      }
    }

    // 移动操作的时间
    const moveTime = new Date();

    // 删除源目录
    await this._deleteDirectory(sourcePath, true);

    // 创建目标目录，保持原始创建时间但更新修改时间
    await this.createDirectoryWithMetadata(targetPath, originalCreated, moveTime);

    // 移动所有子项
    const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
    const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

    // 按路径长度排序，确保先处理父目录
    const sortedChildren = children.sort((a, b) => a.path.length - b.path.length);

    for (const child of sortedChildren) {
      const relativePath = child.path.slice(sourcePrefix.length);
      const newPath = targetPrefix + relativePath;

      if (child.type === 'directory') {
        await this.createDirectoryWithMetadata(newPath, child.created, moveTime);
      } else {
        // 从备份恢复文件数据
        const fileData = fileDataBackup.get(child.path);
        if (!fileData) {
          throw new VFSError('Failed to recover file data', 'EIO', child.path);
        }

        // 直接写入新位置
        this.virtualFiles.set(newPath, {
          data: fileData,
          modified: moveTime // 移动操作更新修改时间
        });

        // 保持原始创建时间
        const newSearchPath = newPath.slice(1);
        this.entries.set(newPath, {
          filename: newSearchPath,
          directory: false,
          uncompressedSize:
            typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
          lastModDate: child.created, // 保持原始创建时间
          comment: '',
          getData: undefined
        } as ZipJSEntry);
      }
    }
  }

  // 更新 moveDirectory 方法使用改进版本
  private async moveDirectory(
    sourcePath: string,
    targetPath: string,
    sourceStat: FileStat,
    options?: MoveOptions
  ): Promise<void> {
    return this.moveDirectoryImproved(sourcePath, targetPath, sourceStat, options);
  }
  /**
   * 创建目录并设置指定的创建时间和修改时间
   */
  private async createDirectoryWithMetadata(
    path: string,
    createdTime: Date,
    modifiedTime?: Date
  ): Promise<void> {
    if (await this._exists(path)) {
      return;
    }

    const parent = PathUtils.dirname(path);
    if (parent !== '/' && parent !== path) {
      const parentExists = await this._exists(parent);
      if (!parentExists) {
        await this._makeDirectory(parent, true);
      }
    }

    // 直接更新内部数据结构，避免通过 ZIP writer 可能的重复条目错误
    const dirPath = path.endsWith('/') ? path.slice(1) : path.slice(1) + '/';

    this.entries.set(path, {
      filename: dirPath,
      directory: true,
      uncompressedSize: 0,
      lastModDate: createdTime, // ZIP条目中保存创建时间
      comment: ''
    } as ZipJSEntry);

    this.isModified = true;
  }

  /** {@inheritDoc VFS._stat} */
  protected async _stat(path: string): Promise<FileStat> {
    // 根目录的特殊处理
    if (path === '/') {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: new Date(),
        modified: new Date(),
        accessed: new Date()
      };
    }

    // 检查虚拟文件
    if (this.virtualFiles.has(path)) {
      const virtualFile = this.virtualFiles.get(path)!;
      const size =
        virtualFile.data instanceof ArrayBuffer
          ? virtualFile.data.byteLength
          : new TextEncoder().encode(virtualFile.data).length;

      // 从ZIP条目获取创建时间，虚拟文件记录修改时间
      let createdTime = virtualFile.modified; // 默认值
      const searchPath = path.slice(1);
      const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);
      if (entry && entry.lastModDate) {
        createdTime = entry.lastModDate; // ZIP条目中的时间作为创建时间
      }

      return {
        size,
        isFile: true,
        isDirectory: false,
        created: createdTime, // 从ZIP条目获取的创建时间
        modified: virtualFile.modified, // 虚拟文件的修改时间
        accessed: virtualFile.modified
      };
    }

    const searchPath = path.slice(1);

    // 检查 ZIP 条目中的确切匹配
    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        const timestamp = entry.lastModDate || new Date();
        return {
          size: entry.directory ? 0 : entry.uncompressedSize || 0,
          isFile: !entry.directory,
          isDirectory: entry.directory,
          created: timestamp, // ZIP中只有一个时间戳，用作创建时间
          modified: timestamp, // 同时也用作修改时间
          accessed: timestamp
        };
      }
    }

    // 检查是否作为目录存在（有子条目）
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

    // 检查虚拟文件中是否有子条目
    for (const virtualPath of this.virtualFiles.keys()) {
      if (virtualPath.startsWith(path + '/')) {
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

    throw new VFSError('Path does not exist', 'ENOENT', path);
  }
}
