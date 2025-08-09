import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, ReadOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * File entry interface for DataTransfer file system
 * @public
 */
export interface DataTransferFileEntry {
  /** The file path */
  path: string;
  /** The File object from DataTransfer */
  file: File;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes */
  size: number;
  /** Last modified time */
  lastModified: Date;
}

/**
 * DataTransfer-based virtual file system for handling dropped files and directories.
 *
 * Read-only VFS populated from DataTransfer (drag-and-drop) or FileList (input with webkitdirectory).
 */
export class DataTransferVFS extends VFS {
  private readonly entries: Map<string, DataTransferFileEntry> = new Map();
  private readonly directoryStructure: Map<string, Set<string>> = new Map();
  private initialized = false;
  private readonly initPromise: Promise<void>;

  constructor(data: DataTransfer | FileList) {
    super(true); // Always read-only
    this.initialized = false;
    this.initPromise =
      data instanceof DataTransfer
        ? this.initializeFromDataTransfer(data)
        : this.initializeFromFileList(data);
  }

  // ============== VFS Implementation ==============

  /** {@inheritDoc VFS._readDirectory} */
  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);

    if (!this.directoryStructure.has(normalizedPath)) {
      throw new VFSError('Directory does not exist', 'ENOENT', path);
    }

    const children = this.directoryStructure.get(normalizedPath)!;
    const results: FileMetadata[] = [];

    for (const childName of children) {
      const childPath = PathUtils.join(normalizedPath, childName);
      const entry = this.entries.get(childPath);

      let metadata: FileMetadata;

      if (entry) {
        metadata = {
          name: childName,
          path: childPath,
          size: entry.size,
          type: 'file',
          created: entry.lastModified,
          modified: entry.lastModified,
          mimeType: entry.file.type || guessMimeType(childPath)
        };
      } else {
        metadata = {
          name: childName,
          path: childPath,
          size: 0,
          type: 'directory',
          created: new Date(),
          modified: new Date(),
          mimeType: undefined
        };
      }

      if (this.matchesFilter(metadata, options)) {
        results.push(metadata);
      }

      if (options?.recursive && metadata.type === 'directory') {
        const subResults = await this._readDirectory(childPath, options);
        results.push(...subResults);
      }
    }

    return results;
  }

  /** {@inheritDoc VFS._readFile} */
  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);
    const entry = this.entries.get(normalizedPath);

    if (!entry || entry.isDirectory) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    let arrayBuffer: ArrayBuffer;

    if (options?.offset !== undefined || options?.length !== undefined) {
      const offset = options.offset ?? 0;
      const length = options.length ?? entry.file.size - offset;
      const blob = entry.file.slice(offset, offset + length);
      arrayBuffer = await blob.arrayBuffer();
    } else {
      arrayBuffer = await entry.file.arrayBuffer();
    }

    if (options?.encoding === 'utf8') {
      return new TextDecoder().decode(arrayBuffer);
    } else if (options?.encoding === 'base64') {
      const bytes = new Uint8Array(arrayBuffer);
      return btoa(String.fromCharCode(...bytes));
    } else {
      return arrayBuffer;
    }
  }

  /** {@inheritDoc VFS._exists} */
  protected async _exists(path: string): Promise<boolean> {
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);
    if (normalizedPath === '/') {
      return true;
    }

    return this.entries.has(normalizedPath) || this.directoryStructure.has(normalizedPath);
  }

  /** {@inheritDoc VFS._stat} */
  protected async _stat(path: string): Promise<FileStat> {
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);

    if (normalizedPath === '/') {
      const now = new Date();
      return { size: 0, isFile: false, isDirectory: true, created: now, modified: now, accessed: now };
    }

    const entry = this.entries.get(normalizedPath);
    if (entry) {
      return {
        size: entry.size,
        isFile: true,
        isDirectory: false,
        created: entry.lastModified,
        modified: entry.lastModified,
        accessed: entry.lastModified
      };
    }

    if (this.directoryStructure.has(normalizedPath)) {
      const now = new Date();
      return { size: 0, isFile: false, isDirectory: true, created: now, modified: now, accessed: now };
    }

    throw new VFSError('Path does not exist', 'ENOENT', path);
  }

  // Read-only file system - throw errors for write operations
  protected async _writeFile(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  protected async _makeDirectory(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  protected async _deleteFile(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  protected async _deleteDirectory(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  protected async _wipe(): Promise<void> {
    return;
  }
  protected _deleteFileSystem(): Promise<void> {
    return Promise.resolve();
  }
  protected _move(): Promise<void> {
    return Promise.resolve();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.initPromise;
    this.initialized = true;
  }

  // ============== Initialization ==============

  /**
   * Initialize the VFS from a DataTransfer object (from drag and drop).
   *
   * 核心策略：
   * - 同步遍历 items，立即启动 entry.file()/readEntries()；
   * - 将每个启动后的回调包装成 Promise 收集；
   * - 最后统一 Promise.all 等待；
   * - 避免保存 FileSystemEntry 到后续再访问。
   */
  private async initializeFromDataTransfer(dataTransfer: DataTransfer): Promise<void> {
    this.entries.clear();
    this.directoryStructure.clear();

    if (!dataTransfer || !dataTransfer.items) {
      return;
    }

    const filePromises: Array<Promise<{ file: File; path: string } | Array<{ file: File; path: string }>>> =
      [];

    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind !== 'file') {
        continue;
      }

      // 优先使用支持目录的 entry
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) {
        const rootPath = this.normalizePath(`/${entry.name}`);
        if ((entry as any).isFile) {
          filePromises.push(this.collectFileOperation(entry as FileSystemFileEntry, rootPath.slice(1)));
        } else if ((entry as any).isDirectory) {
          filePromises.push(this.collectDirectoryOperation(entry as FileSystemDirectoryEntry, rootPath));
        }
        continue;
      }

      // 回退：直接文件
      const file = item.getAsFile && item.getAsFile();
      if (file) {
        filePromises.push(Promise.resolve({ file, path: file.name }));
      }
    }

    // 统一等待所有已启动的操作
    const results = await Promise.all(filePromises);
    const flattened = results.flat() as Array<{ file: File; path: string }>;

    // 构建内部结构
    const fileEntries: DataTransferFileEntry[] = [];
    for (const { file, path } of flattened) {
      await this.processFile(file, path, fileEntries);
    }
    for (const e of fileEntries) {
      this.entries.set(e.path, e);
      this.updateDirectoryStructure(e.path);
    }
    if (!this.directoryStructure.has('/')) {
      this.directoryStructure.set('/', new Set());
    }
  }

  /**
   * Initialize from a FileList (for input[type="file"] with webkitdirectory)
   */
  private async initializeFromFileList(fileList: FileList): Promise<void> {
    this.entries.clear();
    this.directoryStructure.clear();

    const fileEntries: DataTransferFileEntry[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const relativePath = (file as any).webkitRelativePath || file.name;
      await this.processFile(file, relativePath, fileEntries);
    }

    for (const entry of fileEntries) {
      this.entries.set(entry.path, entry);
      this.updateDirectoryStructure(entry.path);
    }

    if (!this.directoryStructure.has('/')) {
      this.directoryStructure.set('/', new Set());
    }
  }

  // ============== Helpers: synchronous start, promise collection ==============

  /**
   * 同步启动文件读取（entry.file），返回在回调触发时 resolve 的 Promise。
   */
  private collectFileOperation(
    fileEntry: FileSystemFileEntry,
    relativePath: string
  ): Promise<{ file: File; path: string }> {
    return new Promise((resolve, reject) => {
      try {
        // 同步触发 entry.file(...)
        fileEntry.file(
          (file: File) => resolve({ file, path: relativePath }),
          (err: any) => {
            console.warn('collectFileOperation error:', err);
            reject(err);
          }
        );
      } catch (e) {
        console.warn('collectFileOperation exception:', e);
        reject(e);
      }
    });
  }

  /**
   * 同步启动目录读取（createReader + 连续 readEntries），
   * 目录完全读取后，递归对子项同步启动收集，返回扁平化文件列表。
   */
  private collectDirectoryOperation(
    dirEntry: FileSystemDirectoryEntry,
    basePath: string
  ): Promise<Array<{ file: File; path: string }>> {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      const batchEntries: FileSystemEntry[] = [];

      const readBatch = () => {
        try {
          reader.readEntries(
            (entries: FileSystemEntry[]) => {
              if (entries.length === 0) {
                // 目录读完，递归处理所有子项
                const promises: Array<
                  Promise<{ file: File; path: string } | Array<{ file: File; path: string }>>
                > = [];

                for (const child of batchEntries) {
                  const childFullPath = this.normalizePath(`${basePath}/${child.name}`);
                  if ((child as any).isFile) {
                    promises.push(
                      this.collectFileOperation(child as FileSystemFileEntry, childFullPath.slice(1))
                    );
                  } else if ((child as any).isDirectory) {
                    promises.push(
                      this.collectDirectoryOperation(child as FileSystemDirectoryEntry, childFullPath)
                    );
                  }
                }

                Promise.all(promises)
                  .then((res) => resolve(res.flat() as Array<{ file: File; path: string }>))
                  .catch((err) => {
                    console.warn('collectDirectoryOperation child error:', err);
                    reject(err);
                  });
                return;
              }

              // 累积条目并继续读取下一批
              batchEntries.push(...entries);
              readBatch();
            },
            (err: any) => {
              console.warn('collectDirectoryOperation readEntries error:', err);
              reject(err);
            }
          );
        } catch (e) {
          console.warn('collectDirectoryOperation exception:', e);
          reject(e);
        }
      };

      // 立即开始读取
      readBatch();
    });
  }

  // ============== Internal builders ==============

  /**
   * Process an individual file into VFS entry structures (no disk I/O here).
   */
  private async processFile(
    file: File,
    relativePath: string,
    fileEntries: DataTransferFileEntry[]
  ): Promise<void> {
    const normalizedPath = this.normalizePath('/' + relativePath);

    const entry: DataTransferFileEntry = {
      path: normalizedPath,
      file,
      isDirectory: false,
      size: file.size,
      lastModified: new Date(file.lastModified)
    };

    fileEntries.push(entry);
  }

  /**
   * Update the directory structure for a given file path.
   */
  private updateDirectoryStructure(filePath: string): void {
    const parts = filePath.split('/').filter((p) => p);
    let currentPath = '';

    // Create all parent directories
    for (let i = 0; i < parts.length - 1; i++) {
      const parentPath = currentPath || '/';
      currentPath = currentPath + '/' + parts[i];
      const normalizedPath = this.normalizePath(currentPath);

      if (!this.directoryStructure.has(parentPath)) {
        this.directoryStructure.set(parentPath, new Set());
      }
      this.directoryStructure.get(parentPath)!.add(parts[i]);

      if (!this.directoryStructure.has(normalizedPath)) {
        this.directoryStructure.set(normalizedPath, new Set());
      }
    }

    // Add file to its parent directory
    const parentPath = PathUtils.dirname(filePath);
    const fileName = PathUtils.basename(filePath);

    if (!this.directoryStructure.has(parentPath)) {
      this.directoryStructure.set(parentPath, new Set());
    }
    this.directoryStructure.get(parentPath)!.add(fileName);
  }

  private matchesFilter(metadata: FileMetadata, options?: ListOptions): boolean {
    if (!options) {
      return true;
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
}
