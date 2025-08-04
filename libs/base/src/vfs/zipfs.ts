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
  // Reader/Writer constructors
  ZipReader: ZipJSReaderConstructor;
  ZipWriter: ZipJSWriterConstructor;

  // Readers
  BlobReader: new (blob: Blob) => any;
  Uint8ArrayReader: new (array: Uint8Array) => any;
  TextReader: new (text: string) => any;

  // Writers
  BlobWriter: new () => any;
  Uint8ArrayWriter: new () => any;
  TextWriter: new (encoding?: string) => any;

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
  private zipReader: ZipJSReader;
  private zipWriter: ZipJSWriter;
  private readonly entries: Map<string, ZipJSEntry>;
  private readonly virtualFiles: Map<string, { data: ArrayBuffer | string; modified: Date }>;
  private zipData: Blob | Uint8Array | ArrayBuffer;
  private isModified: boolean;
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
    this.zipReader = null;
    this.zipWriter = null;
    this.entries = new Map();
    this.virtualFiles = new Map();
    this.zipData = null;
    this.isModified = false;
    if (!readonly) {
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
   * Returns ZIP archive data as a Uint8Array, saving any in-memory changes first.
   *
   * @returns ZIP file contents as a Uint8Array
   */
  async getZipData(): Promise<Uint8Array> {
    await this.applyVirtualFiles();

    if (this.zipWriter && this.isModified) {
      const data = await this.zipWriter.close();
      this.zipData = data;
      this.isModified = false;

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

    const writer = await this.ensureWriter();
    const dirPath = path.endsWith('/') ? path.slice(1) : path.slice(1) + '/';

    try {
      await writer.add(dirPath, undefined, {
        directory: true,
        lastModDate: new Date()
      });
    } catch (_error) {
      // zip.js will throw an error if directory already exists
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
    if (path === '/' && this.entries.size === 0 && this.virtualFiles.size === 0) {
      return [];
    }

    const results: FileMetadata[] = [];
    const searchPath = path === '/' ? '' : path.slice(1) + '/';
    const foundEntries = new Set<string>();

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
    if (this.virtualFiles.has(path)) {
      const virtualFile = this.virtualFiles.get(path)!;
      return this.processFileData(virtualFile.data, options);
    }

    const searchPath = path.slice(1);
    const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);

    if (!entry || entry.directory) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    if (!entry.getData) {
      throw new VFSError('Cannot read file data', 'EIO', path);
    }

    const arrayWriter = new this.zipJS.Uint8ArrayWriter();
    const uint8Array = await entry.getData(arrayWriter);
    const arrayBuffer = uint8Array.buffer;

    return this.processFileData(arrayBuffer, options);
  }

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

    const fileExists = await this._exists(path);
    if (fileExists) {
      const stat = await this._stat(path);
      if (stat.isDirectory) {
        throw new VFSError('Path is a directory', 'EISDIR', path);
      }

      if (options?.create === false) {
        throw new VFSError('File already exists', 'EEXIST', path);
      }
    }

    let fileData: ArrayBuffer | string = data;

    if (options?.encoding === 'base64' && typeof fileData === 'string') {
      try {
        const binaryString = atob(fileData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileData = bytes.buffer;
      } catch (_error) {
        throw new VFSError('Invalid base64 data', 'EINVAL', path);
      }
    } else if (options?.encoding === 'utf8') {
      if (fileData instanceof ArrayBuffer) {
        fileData = new TextDecoder().decode(fileData);
      }
    } else if (options?.encoding === 'binary' || !options?.encoding) {
      if (typeof fileData === 'string') {
        fileData = new TextEncoder().encode(fileData).buffer;
      }
    }

    let createdTime = new Date();
    let isExistingFile = false;

    if (fileExists) {
      try {
        const existingStat = await this._stat(path);
        createdTime = existingStat.created;
        isExistingFile = true;
      } catch (_error) {}
    }

    if (options?.append && isExistingFile) {
      let existingData: ArrayBuffer | string | null = null;

      try {
        existingData = await this._readFile(path);
      } catch (_error) {}

      if (existingData) {
        if (typeof fileData === 'string' && typeof existingData === 'string') {
          fileData = existingData + fileData;
        } else if (fileData instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
          const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
          combined.set(new Uint8Array(existingData), 0);
          combined.set(new Uint8Array(fileData), existingData.byteLength);
          fileData = combined.buffer;
        } else {
          const existingStr =
            existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
          const newStr = fileData instanceof ArrayBuffer ? new TextDecoder().decode(fileData) : fileData;
          fileData = existingStr + newStr;
        }
      }
    }

    this.virtualFiles.set(path, {
      data: fileData,
      modified: new Date()
    });

    if (isExistingFile) {
      const searchPath = path.slice(1);
      this.entries.set(path, {
        filename: searchPath,
        directory: false,
        uncompressedSize:
          typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
        lastModDate: createdTime,
        comment: '',
        getData: undefined
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
    if (path === '/') {
      return true;
    }

    if (this.virtualFiles.has(path)) {
      return true;
    }

    const searchPath = path.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        return true;
      }
    }

    const searchPrefix = searchPath + '/';
    for (const entry of this.entries.values()) {
      if (entry.filename.startsWith(searchPrefix)) {
        return true;
      }
    }

    for (const virtualPath of this.virtualFiles.keys()) {
      if (virtualPath.startsWith(path + '/')) {
        return true;
      }
    }

    return false;
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

    if (!(await this._exists(sourcePath))) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    const targetExists = await this._exists(targetPath);
    if (targetExists && !options?.overwrite) {
      throw new VFSError('Target already exists', 'EEXIST', targetPath);
    }

    const targetParent = PathUtils.dirname(targetPath);
    if (targetParent !== '/' && !(await this._exists(targetParent))) {
      throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
    }

    const sourceStat = await this._stat(sourcePath);

    if (sourceStat.isFile) {
      await this.moveFile(sourcePath, targetPath, sourceStat, options);
    } else if (sourceStat.isDirectory) {
      await this.moveDirectory(sourcePath, targetPath, sourceStat, options);
    }

    this.isModified = true;
  }

  /** {@inheritDoc VFS._stat} */
  protected async _stat(path: string): Promise<FileStat> {
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

    if (this.virtualFiles.has(path)) {
      const virtualFile = this.virtualFiles.get(path)!;
      const size =
        virtualFile.data instanceof ArrayBuffer
          ? virtualFile.data.byteLength
          : new TextEncoder().encode(virtualFile.data).length;

      let createdTime = virtualFile.modified;
      const searchPath = path.slice(1);
      const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);
      if (entry && entry.lastModDate) {
        createdTime = entry.lastModDate;
      }

      return {
        size,
        isFile: true,
        isDirectory: false,
        created: createdTime,
        modified: virtualFile.modified,
        accessed: virtualFile.modified
      };
    }

    const searchPath = path.slice(1);

    for (const entry of this.entries.values()) {
      if (entry.filename === searchPath || entry.filename === searchPath + '/') {
        const timestamp = entry.lastModDate || new Date();
        return {
          size: entry.directory ? 0 : entry.uncompressedSize || 0,
          isFile: !entry.directory,
          isDirectory: entry.directory,
          created: timestamp,
          modified: timestamp,
          accessed: timestamp
        };
      }
    }

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
  private initializeEmpty(): void {
    this.zipData = new Uint8Array(0);
    const writer = new this.zipJS.Uint8ArrayWriter();
    this.zipWriter = new this.zipJS.ZipWriter(writer);
    this.entries.clear();
    this.virtualFiles.clear();
  }

  private async ensureWriter(): Promise<ZipJSWriter> {
    if (this.readOnly) {
      throw new VFSError('ZIP file system is read-only', 'EROFS');
    }

    if (!this.zipWriter) {
      const writer = new this.zipJS.Uint8ArrayWriter();
      this.zipWriter = new this.zipJS.ZipWriter(writer);

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

  private async applyVirtualFiles(): Promise<void> {
    if (this.virtualFiles.size === 0) {
      return;
    }

    const writer = await this.ensureWriter();

    for (const [path, virtualFile] of this.virtualFiles) {
      const filename = path.slice(1);

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
  private matchesFilter(metadata: FileMetadata, options?: ListOptions): boolean {
    if (!options) {
      return true;
    }

    if (!options.includeHidden && metadata.name.startsWith('.')) {
      return false;
    }

    if (options.pattern) {
      if (typeof options.pattern === 'string') {
        return metadata.name.includes(options.pattern);
      } else if (options.pattern instanceof RegExp) {
        return options.pattern.test(metadata.name);
      }
    }

    return true;
  }
  private processFileData(data: ArrayBuffer | string, options?: ReadOptions): ArrayBuffer | string {
    let processedData = data;
    const requestedEncoding = options?.encoding;

    if (requestedEncoding === 'utf8') {
      if (processedData instanceof ArrayBuffer) {
        processedData = new TextDecoder().decode(processedData);
      }
    } else if (requestedEncoding === 'base64') {
      if (processedData instanceof ArrayBuffer) {
        const bytes = new Uint8Array(processedData);
        processedData = btoa(String.fromCodePoint(...bytes));
      } else if (typeof processedData === 'string') {
        const bytes = new TextEncoder().encode(processedData);
        processedData = btoa(String.fromCodePoint(...bytes));
      }
    } else if (requestedEncoding === 'binary' || !requestedEncoding) {
      if (typeof processedData === 'string') {
        processedData = new TextEncoder().encode(processedData).buffer;
      }
    }

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
  private async moveFile(
    sourcePath: string,
    targetPath: string,
    sourceStat: FileStat,
    options?: MoveOptions
  ): Promise<void> {
    const fileData = await this._readFile(sourcePath);
    let originalCreated = sourceStat.created;

    if (!this.virtualFiles.has(sourcePath)) {
      const searchPath = sourcePath.slice(1);
      const entry = Array.from(this.entries.values()).find((e) => e.filename === searchPath);
      if (entry && entry.lastModDate) {
        originalCreated = entry.lastModDate;
      }
    }

    if (options?.overwrite && (await this._exists(targetPath))) {
      await this._deleteFile(targetPath);
    }

    await this._deleteFile(sourcePath);

    const moveTime = new Date();

    this.virtualFiles.set(targetPath, {
      data: fileData,
      modified: moveTime
    });

    const targetSearchPath = targetPath.slice(1);
    this.entries.set(targetPath, {
      filename: targetSearchPath,
      directory: false,
      uncompressedSize:
        typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
      lastModDate: originalCreated,
      comment: '',
      getData: undefined
    } as ZipJSEntry);
  }

  private async moveDirectory(
    sourcePath: string,
    targetPath: string,
    sourceStat: FileStat,
    options?: MoveOptions
  ): Promise<void> {
    let originalCreated = sourceStat.created;

    const searchPath = sourcePath.slice(1);
    const entry = Array.from(this.entries.values()).find(
      (e) => e.filename === searchPath || e.filename === searchPath + '/'
    );
    if (entry && entry.lastModDate) {
      originalCreated = entry.lastModDate;
    }

    if (options?.overwrite && (await this._exists(targetPath))) {
      await this._deleteDirectory(targetPath, true);
    }

    const children = await this._readDirectory(sourcePath, { recursive: true });
    const fileDataBackup = new Map<string, ArrayBuffer | string>();

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

    const moveTime = new Date();

    await this._deleteDirectory(sourcePath, true);
    await this.createDirectoryWithMetadata(targetPath, originalCreated);

    const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
    const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';
    const sortedChildren = children.sort((a, b) => a.path.length - b.path.length);

    for (const child of sortedChildren) {
      const relativePath = child.path.slice(sourcePrefix.length);
      const newPath = targetPrefix + relativePath;

      if (child.type === 'directory') {
        await this.createDirectoryWithMetadata(newPath, child.created);
      } else {
        const fileData = fileDataBackup.get(child.path);
        if (!fileData) {
          throw new VFSError('Failed to recover file data', 'EIO', child.path);
        }
        this.virtualFiles.set(newPath, {
          data: fileData,
          modified: moveTime
        });
        const newSearchPath = newPath.slice(1);
        this.entries.set(newPath, {
          filename: newSearchPath,
          directory: false,
          uncompressedSize:
            typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
          lastModDate: child.created,
          comment: '',
          getData: undefined
        } as ZipJSEntry);
      }
    }
  }

  private async createDirectoryWithMetadata(path: string, createdTime: Date): Promise<void> {
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
}
