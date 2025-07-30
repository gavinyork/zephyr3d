import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * Memory file system.
 *
 * @public
 */
export class MemoryFS extends VFS {
  private files: Map<string, ArrayBuffer | string> = new Map();
  private directories: Set<string> = new Set(['/']);
  private metadata: Map<string, FileMetadata> = new Map();

  constructor(name = 'MemoryFS', readonly = false) {
    super(name, readonly);
    const now = new Date();
    this.metadata.set('/', {
      created: now,
      modified: now,
      name: '',
      path: '/',
      size: 0,
      type: 'directory'
    });
  }

  protected async _makeDirectory(path: string, recursive: boolean): Promise<void> {
    if (this.directories.has(path)) {
      throw new VFSError('Directory already exists', 'EEXIST', path);
    }

    const parent = PathUtils.dirname(path);
    if (!this.directories.has(parent)) {
      if (recursive) {
        await this._makeDirectory(parent, true);
      } else {
        throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
      }
    }

    this.directories.add(path);
    this.metadata.set(path, {
      name: PathUtils.basename(path),
      path: path,
      size: 0,
      type: 'directory',
      created: new Date(),
      modified: new Date()
    });
  }

  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    if (!this.directories.has(path)) {
      throw new VFSError('Directory does not exist', 'ENOENT', path);
    }

    const results: FileMetadata[] = [];
    const pathPrefix = path === '/' ? '/' : path + '/';

    // 列出目录
    for (const dir of this.directories) {
      if (dir !== path && dir.startsWith(pathPrefix)) {
        const relativePath = dir.slice(pathPrefix.length);
        if (!options?.recursive && relativePath.includes('/')) {
          continue;
        }

        const metadata = this.metadata.get(dir);
        if (metadata) {
          results.push(metadata);
        }
      }
    }

    // 列出文件
    for (const [filePath] of this.files) {
      if (filePath.startsWith(pathPrefix)) {
        const relativePath = filePath.slice(pathPrefix.length);
        if (!options?.recursive && relativePath.includes('/')) {
          continue;
        }

        const metadata = this.metadata.get(filePath);
        if (metadata) {
          results.push(metadata);
        }
      }
    }

    return results;
  }

  protected async _deleteDirectory(path: string, recursive: boolean): Promise<void> {
    if (!this.directories.has(path)) {
      throw new VFSError('Directory does not exist', 'ENOENT', path);
    }

    const children = await this._readDirectory(path);
    if (children.length > 0 && !recursive) {
      throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
    }

    if (recursive) {
      // 删除所有子项
      const pathPrefix = path + '/';

      // 删除子文件
      for (const [filePath] of this.files) {
        if (filePath.startsWith(pathPrefix)) {
          this.files.delete(filePath);
          this.metadata.delete(filePath);
        }
      }

      // 删除子目录
      for (const dir of this.directories) {
        if (dir.startsWith(pathPrefix)) {
          this.directories.delete(dir);
          this.metadata.delete(dir);
        }
      }
    }

    this.directories.delete(path);
    this.metadata.delete(path);
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    if (!this.files.has(path)) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    const data = this.files.get(path)!;

    if (options?.encoding === 'utf8' && data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }

    return data;
  }

  protected async _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void> {
    const parent = PathUtils.dirname(path);

    if (!this.directories.has(parent)) {
      if (options?.create) {
        await this._makeDirectory(parent, true);
      } else {
        throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
      }
    }

    let fileData: ArrayBuffer | string;

    // 处理追加模式
    if (options?.append && this.files.has(path)) {
      const existingData = this.files.get(path)!;

      // 统一数据类型进行追加
      if (typeof existingData === 'string' && typeof data === 'string') {
        // 字符串 + 字符串
        fileData = existingData + data;
      } else if (existingData instanceof ArrayBuffer && data instanceof ArrayBuffer) {
        // ArrayBuffer + ArrayBuffer
        const combined = new Uint8Array(existingData.byteLength + data.byteLength);
        combined.set(new Uint8Array(existingData), 0);
        combined.set(new Uint8Array(data), existingData.byteLength);
        fileData = combined.buffer;
      } else {
        // 混合类型：转换为字符串处理
        const existingStr =
          typeof existingData === 'string' ? existingData : new TextDecoder().decode(existingData);
        const newStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
        fileData = existingStr + newStr;
      }
    } else {
      // 非追加模式，直接设置数据
      if (typeof data === 'string' && options?.encoding !== 'utf8') {
        fileData = new TextEncoder().encode(data).buffer;
      } else {
        fileData = data;
      }
    }

    this.files.set(path, fileData);

    const size =
      typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength;

    this.metadata.set(path, {
      name: PathUtils.basename(path),
      path: path,
      size,
      type: 'file',
      created: this.metadata.get(path)?.created || new Date(),
      modified: new Date(),
      mimeType: guessMimeType(path)
    });
  }

  protected async _deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new VFSError('File does not exist', 'ENOENT', path);
    }

    this.files.delete(path);
    this.metadata.delete(path);
  }

  protected async _exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  protected async _stat(path: string): Promise<FileStat> {
    const metadata = this.metadata.get(path);

    if (!metadata) {
      throw new VFSError('Path does not exist', 'ENOENT', path);
    }

    return {
      size: metadata.size,
      isFile: metadata.type === 'file',
      isDirectory: metadata.type === 'directory',
      created: metadata.created,
      modified: metadata.modified
    };
  }
  /**
   * 不支持删除
   */
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  /**
   * 不支持删除
   */
  protected async _deleteDatabase(): Promise<void> {
    return;
  }
}
