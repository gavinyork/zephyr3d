import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, MoveOptions, ReadOptions, WriteOptions } from './vfs';
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

  constructor(readonly = false) {
    super(readonly);
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

    let data = this.files.get(path)!;
    const requestedEncoding = options?.encoding;

    // 根据请求的编码格式进行转换
    if (requestedEncoding === 'utf8') {
      // 请求 UTF-8 字符串
      if (data instanceof ArrayBuffer) {
        data = new TextDecoder().decode(data);
      }
      // 如果已经是 string，直接使用
    } else if (requestedEncoding === 'base64') {
      // 请求 Base64 字符串
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        data = btoa(String.fromCodePoint(...bytes));
      } else if (typeof data === 'string') {
        // 字符串先转为 ArrayBuffer，再转 Base64
        const bytes = new TextEncoder().encode(data);
        data = btoa(String.fromCodePoint(...bytes));
      }
    } else if (requestedEncoding === 'binary' || !requestedEncoding) {
      // 请求 ArrayBuffer（binary 或默认）
      if (typeof data === 'string') {
        data = new TextEncoder().encode(data).buffer;
      }
      // 如果已经是 ArrayBuffer，直接使用
    }

    // 处理范围读取
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

    // 处理编码选项
    if (options?.encoding === 'base64' && typeof data === 'string') {
      try {
        const binaryString = atob(data);
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
      if (data instanceof ArrayBuffer) {
        fileData = new TextDecoder().decode(data);
      }
    } else if (options?.encoding === 'binary' || !options?.encoding) {
      // 默认以二进制（ArrayBuffer）形式存储
      if (typeof data === 'string') {
        fileData = new TextEncoder().encode(data).buffer;
      }
    }

    // 处理追加模式
    if (options?.append && this.files.has(path)) {
      const existingData = this.files.get(path)!;

      if (typeof existingData === 'string' && typeof fileData === 'string') {
        // 字符串 + 字符串
        fileData = existingData + fileData;
      } else if (existingData instanceof ArrayBuffer && fileData instanceof ArrayBuffer) {
        // ArrayBuffer + ArrayBuffer
        const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
        combined.set(new Uint8Array(existingData), 0);
        combined.set(new Uint8Array(fileData), existingData.byteLength);
        fileData = combined.buffer;
      } else {
        // 混合类型：转换为字符串处理
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
  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    // 检查源路径是否存在
    if (!this.files.has(sourcePath) && !this.directories.has(sourcePath)) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    // 检查目标是否已存在
    const targetExists = this.files.has(targetPath) || this.directories.has(targetPath);
    if (targetExists && !options?.overwrite) {
      throw new VFSError('Target already exists', 'EEXIST', targetPath);
    }

    // 确保目标父目录存在
    const targetParent = PathUtils.dirname(targetPath);
    if (!this.directories.has(targetParent)) {
      throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
    }

    const now = new Date();

    if (this.files.has(sourcePath)) {
      // 移动文件
      const fileData = this.files.get(sourcePath)!;
      const sourceMetadata = this.metadata.get(sourcePath)!;

      // 如果目标存在且允许覆盖，先删除目标
      if (targetExists && options?.overwrite) {
        this.files.delete(targetPath);
        this.directories.delete(targetPath);
        this.metadata.delete(targetPath);
      }

      // 移动文件数据和元数据
      this.files.set(targetPath, fileData);
      this.metadata.set(targetPath, {
        ...sourceMetadata,
        name: PathUtils.basename(targetPath),
        path: targetPath,
        modified: now
      });

      // 删除源文件
      this.files.delete(sourcePath);
      this.metadata.delete(sourcePath);
    } else if (this.directories.has(sourcePath)) {
      // 移动目录
      const sourceMetadata = this.metadata.get(sourcePath)!;

      // 如果目标存在且允许覆盖，先删除目标（递归删除）
      if (targetExists && options?.overwrite) {
        if (this.directories.has(targetPath)) {
          await this._deleteDirectory(targetPath, true);
        } else {
          this.files.delete(targetPath);
          this.metadata.delete(targetPath);
        }
      }

      // 获取所有需要移动的子项（文件和目录）
      const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
      const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

      // 收集所有需要移动的路径
      const filesToMove: string[] = [];
      const dirsToMove: string[] = [];

      // 收集子文件
      for (const [filePath] of this.files) {
        if (filePath.startsWith(sourcePrefix)) {
          filesToMove.push(filePath);
        }
      }

      // 收集子目录（排序确保父目录在子目录之前处理）
      for (const dirPath of this.directories) {
        if (dirPath !== sourcePath && dirPath.startsWith(sourcePrefix)) {
          dirsToMove.push(dirPath);
        }
      }
      dirsToMove.sort(); // 确保父目录在前

      // 移动所有子文件
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

      // 移动所有子目录
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

      // 最后移动源目录本身
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
