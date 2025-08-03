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
 * This VFS implementation provides read-only access to files dropped into the browser
 * from the operating system. It supports both individual files and directory structures
 * when supported by the browser.
 *
 * @remarks
 * - This is a read-only file system - write operations will throw errors
 * - Directory structure support depends on browser capabilities
 * - File access is asynchronous and may involve reading from disk
 * - All files are included regardless of size, type, or hidden status
 *
 * @example
 * ```typescript
 * // Handle drop event
 * element.addEventListener('drop', async (event) => {
 *   event.preventDefault();
 *
 *   const dtVFS = new DataTransferVFS('dropped-files');
 *   await dtVFS.initializeFromDataTransfer(event.dataTransfer);
 *
 *   const files = await dtVFS.readDirectory('/');
 *   console.log('Dropped files:', files);
 * });
 * ```
 *
 * @public
 */
export class DataTransferVFS extends VFS {
  private readonly entries: Map<string, DataTransferFileEntry> = new Map();
  private readonly directoryStructure: Map<string, Set<string>> = new Map();
  private initialized = false;
  private readonly initPromise: Promise<void> = null;

  /**
   * Constructs a DataTransfer VFS instance
   */
  constructor(data: DataTransfer | FileList) {
    super(true); // Always read-only
    this.initialized = false;
    this.initPromise =
      data instanceof DataTransfer
        ? this.initializeFromDataTransfer(data)
        : this.initializeFromFileList(data);
  }

  // VFS Implementation

  /** {@inheritDoc VFS._readDirectory} */
  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    // Make sure filesystem was initialized
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
        // It's a file
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
        // It's a directory
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

      // Apply filters
      if (this.matchesFilter(metadata, options)) {
        results.push(metadata);
      }

      // Handle recursive listing
      if (options?.recursive && metadata.type === 'directory') {
        const subResults = await this._readDirectory(childPath, options);
        results.push(...subResults);
      }
    }

    return results;
  }

  /** {@inheritDoc VFS._readFile} */
  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    // Make sure filesystem was initialized
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);
    const entry = this.entries.get(normalizedPath);

    if (!entry || entry.isDirectory) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    // Read the file
    let arrayBuffer: ArrayBuffer;

    if (options?.offset !== undefined || options?.length !== undefined) {
      // Range reading
      const offset = options.offset || 0;
      const length = options.length || entry.file.size - offset;
      const blob = entry.file.slice(offset, offset + length);
      arrayBuffer = await blob.arrayBuffer();
    } else {
      // Full file reading
      arrayBuffer = await entry.file.arrayBuffer();
    }

    // Handle encoding
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
    // Make sure filesystem was initialized
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);

    // Root always exists
    if (normalizedPath === '/') {
      return true;
    }

    // Check if it's a file
    if (this.entries.has(normalizedPath)) {
      return true;
    }

    // Check if it's a directory
    if (this.directoryStructure.has(normalizedPath)) {
      return true;
    }

    return false;
  }

  /** {@inheritDoc VFS._stat} */
  protected async _stat(path: string): Promise<FileStat> {
    // Make sure filesystem was initialized
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(path);

    // Root directory
    if (normalizedPath === '/') {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: new Date(),
        modified: new Date(),
        accessed: new Date()
      };
    }

    // Check if it's a file
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

    // Check if it's a directory
    if (this.directoryStructure.has(normalizedPath)) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: new Date(),
        modified: new Date(),
        accessed: new Date()
      };
    }

    throw new VFSError('Path does not exist', 'ENOENT', path);
  }

  // Read-only file system - throw errors for write operations

  /** {@inheritDoc VFS._writeFile} */
  protected async _writeFile(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }

  /** {@inheritDoc VFS._makeDirectory} */
  protected async _makeDirectory(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }

  /** {@inheritDoc VFS._deleteFile} */
  protected async _deleteFile(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  /** {@inheritDoc VFS._deleteDirectory} */
  protected async _deleteDirectory(): Promise<void> {
    throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
  }
  /** {@inheritDoc VFS._deleteDatabase} */
  protected async _deleteDatabase(): Promise<void> {
    return;
  }
  /** {@inheritDoc VFS._deleteFileSystem} */
  protected _deleteFileSystem(): Promise<void> {
    return;
  }
  /** {@inheritDoc VFS._move} */
  protected _move(): Promise<void> {
    return;
  }
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.initPromise;
    this.initialized = true;
  }
  /**
   * Initialize the VFS from a DataTransfer object (from drag and drop)
   *
   * @param dataTransfer - The DataTransfer object from a drop event
   */
  private async initializeFromDataTransfer(dataTransfer: DataTransfer): Promise<void> {
    this.entries.clear();
    this.directoryStructure.clear();

    if (!dataTransfer || !dataTransfer.items) {
      return;
    }

    const fileEntries: DataTransferFileEntry[] = [];

    // Process all items in the DataTransfer
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];

      if (item.kind === 'file') {
        if (item.webkitGetAsEntry) {
          // Modern browsers with directory support
          const entry = item.webkitGetAsEntry();
          if (entry) {
            await this.processWebKitEntry(entry, '', fileEntries);
          }
        } else {
          // Fallback for browsers without directory support
          const file = item.getAsFile();
          if (file) {
            await this.processFile(file, file.name, fileEntries);
          }
        }
      }
    }

    // Build internal structure
    for (const entry of fileEntries) {
      this.entries.set(entry.path, entry);
      this.updateDirectoryStructure(entry.path);
    }

    // Ensure root directory exists
    if (!this.directoryStructure.has('/')) {
      this.directoryStructure.set('/', new Set());
    }
  }

  /**
   * Initialize from a FileList (for input[type="file"] with webkitdirectory)
   *
   * @param fileList - FileList from an input element
   */
  private async initializeFromFileList(fileList: FileList): Promise<void> {
    this.entries.clear();
    this.directoryStructure.clear();

    const fileEntries: DataTransferFileEntry[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      // Use webkitRelativePath if available, otherwise use name
      const relativePath = (file as any).webkitRelativePath || file.name;
      await this.processFile(file, relativePath, fileEntries);
    }

    // Build internal structure
    for (const entry of fileEntries) {
      this.entries.set(entry.path, entry);
      this.updateDirectoryStructure(entry.path);
    }

    // Ensure root directory exists
    if (!this.directoryStructure.has('/')) {
      this.directoryStructure.set('/', new Set());
    }
  }

  /**
   * Process a WebKit file system entry (supports directories)
   */
  private async processWebKitEntry(
    entry: any,
    parentPath: string,
    fileEntries: DataTransferFileEntry[]
  ): Promise<void> {
    const fullPath = this.normalizePath(parentPath ? `${parentPath}/${entry.name}` : `/${entry.name}`);

    if (entry.isFile) {
      // It's a file
      return new Promise((resolve, reject) => {
        entry.file((file: File) => {
          this.processFile(file, fullPath.slice(1), fileEntries)
            .then(() => resolve())
            .catch(reject);
        }, reject);
      });
    } else if (entry.isDirectory) {
      // It's a directory
      return new Promise((resolve, reject) => {
        const reader = entry.createReader();

        const readEntries = (): void => {
          reader.readEntries(async (entries: any[]) => {
            if (entries.length === 0) {
              resolve();
              return;
            }

            try {
              for (const childEntry of entries) {
                await this.processWebKitEntry(childEntry, fullPath, fileEntries);
              }
              // Continue reading (directories may have more entries)
              readEntries();
            } catch (error) {
              reject(error);
            }
          }, reject);
        };

        readEntries();
      });
    }
  }

  /**
   * Process an individual file
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
   * Update the directory structure for a given file path
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
}
