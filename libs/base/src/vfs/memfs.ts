import { base64ToUint8Array, uint8ArrayToBase64 } from '../utils';
import { PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, MoveOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * Memory file system.
 *
 * @public
 */
export class MemoryFS extends VFS {
  private readonly files: Map<string, ArrayBuffer | string>;
  private readonly directories: Set<string>;
  private readonly metadata: Map<string, FileMetadata>;

  constructor(readonly = false) {
    super(readonly);
    this.files = new Map();
    this.directories = new Set(['/']);
    this.metadata = new Map();
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
      const pathPrefix = path + '/';

      for (const [filePath] of this.files) {
        if (filePath.startsWith(pathPrefix)) {
          this.files.delete(filePath);
          this.metadata.delete(filePath);
        }
      }

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
      throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
    }

    let data = this.files.get(path)!;
    const requestedEncoding = options?.encoding;

    // Encoding conversions
    if (requestedEncoding === 'utf8') {
      if (data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(data);
      }
    } else if (requestedEncoding === 'base64') {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        data = uint8ArrayToBase64(bytes);
      } else if (typeof data === 'string') {
        const bytes = new TextEncoder().encode(data);
        data = uint8ArrayToBase64(bytes);
      }
    } else if (requestedEncoding === 'binary' || !requestedEncoding) {
      if (typeof data === 'string') {
        data = new TextEncoder().encode(data).buffer;
      }
    }

    // Range read
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

    let fileData: ArrayBuffer | string = data;

    if (options?.encoding === 'base64' && typeof data === 'string') {
      try {
        const bytes = base64ToUint8Array(data);
        fileData = bytes.buffer;
      } catch {
        throw new VFSError('Invalid base64 data', 'EINVAL', path);
      }
    } else if (options?.encoding === 'utf8') {
      if (data instanceof ArrayBuffer) {
        fileData = new TextDecoder().decode(data);
      }
    } else if (options?.encoding === 'binary' || !options?.encoding) {
      if (typeof data === 'string') {
        fileData = new TextEncoder().encode(data).buffer;
      }
    }

    if (options?.append && this.files.has(path)) {
      const existingData = this.files.get(path)!;

      if (typeof existingData === 'string' && typeof fileData === 'string') {
        fileData = existingData + fileData;
      } else if (existingData instanceof ArrayBuffer && fileData instanceof ArrayBuffer) {
        const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
        combined.set(new Uint8Array(existingData), 0);
        combined.set(new Uint8Array(fileData), existingData.byteLength);
        fileData = combined.buffer;
      } else {
        const existingStr =
          typeof existingData === 'string' ? existingData : new TextDecoder().decode(existingData);
        const newStr = typeof fileData === 'string' ? fileData : new TextDecoder().decode(fileData);
        fileData = existingStr + newStr;
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
      modified: new Date()
    });
  }

  protected async _deleteFile(path: string): Promise<void> {
    if (!this.files.has(path)) {
      throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
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
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  protected async _wipe(): Promise<void> {
    return;
  }
  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    if (!this.files.has(sourcePath) && !this.directories.has(sourcePath)) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    const targetExists = this.files.has(targetPath) || this.directories.has(targetPath);
    if (targetExists && !options?.overwrite) {
      throw new VFSError('Target already exists', 'EEXIST', targetPath);
    }

    const targetParent = PathUtils.dirname(targetPath);
    if (!this.directories.has(targetParent)) {
      throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
    }

    const now = new Date();

    if (this.files.has(sourcePath)) {
      const fileData = this.files.get(sourcePath)!;
      const sourceMetadata = this.metadata.get(sourcePath)!;

      if (targetExists && options?.overwrite) {
        this.files.delete(targetPath);
        this.directories.delete(targetPath);
        this.metadata.delete(targetPath);
      }

      this.files.set(targetPath, fileData);
      this.metadata.set(targetPath, {
        ...sourceMetadata,
        name: PathUtils.basename(targetPath),
        path: targetPath,
        modified: now
      });

      this.files.delete(sourcePath);
      this.metadata.delete(sourcePath);
    } else if (this.directories.has(sourcePath)) {
      const sourceMetadata = this.metadata.get(sourcePath)!;

      if (targetExists && options?.overwrite) {
        if (this.directories.has(targetPath)) {
          await this._deleteDirectory(targetPath, true);
        } else {
          this.files.delete(targetPath);
          this.metadata.delete(targetPath);
        }
      }

      const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
      const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

      const filesToMove: string[] = [];
      const dirsToMove: string[] = [];

      for (const [filePath] of this.files) {
        if (filePath.startsWith(sourcePrefix)) {
          filesToMove.push(filePath);
        }
      }

      for (const dirPath of this.directories) {
        if (dirPath !== sourcePath && dirPath.startsWith(sourcePrefix)) {
          dirsToMove.push(dirPath);
        }
      }
      dirsToMove.sort();

      for (const oldFilePath of filesToMove) {
        const newFilePath = oldFilePath.replace(sourcePrefix, targetPrefix);
        const fileData = this.files.get(oldFilePath)!;
        const fileMetadata = this.metadata.get(oldFilePath)!;

        this.files.set(newFilePath, fileData);
        this.metadata.set(newFilePath, {
          ...fileMetadata,
          name: PathUtils.basename(newFilePath),
          path: newFilePath,
          modified: now
        });

        this.files.delete(oldFilePath);
        this.metadata.delete(oldFilePath);
      }

      for (const oldDirPath of dirsToMove) {
        const newDirPath = oldDirPath.replace(sourcePrefix, targetPrefix);
        const dirMetadata = this.metadata.get(oldDirPath)!;

        this.directories.add(newDirPath);
        this.metadata.set(newDirPath, {
          ...dirMetadata,
          name: PathUtils.basename(newDirPath),
          path: newDirPath,
          modified: now
        });

        this.directories.delete(oldDirPath);
        this.metadata.delete(oldDirPath);
      }

      this.directories.add(targetPath);
      this.metadata.set(targetPath, {
        ...sourceMetadata,
        name: PathUtils.basename(targetPath),
        path: targetPath,
        modified: now
      });

      this.directories.delete(sourcePath);
      this.metadata.delete(sourcePath);
    }
  }
}
