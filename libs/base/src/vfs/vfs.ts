import { PathUtils } from './common';

/**
 * Represents metadata information for a file or directory.
 *
 * @public
 */
export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory';
  created: Date;
  modified: Date;
  mimeType?: string;
  permissions?: number;
}

/**
 * Represents statistical information about a file or directory.
 *
 * @public
 */
export interface FileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  created: Date;
  modified: Date;
  accessed?: Date;
}

/**
 * Options for reading files.
 *
 * @public
 */
export interface ReadOptions {
  encoding?: 'utf8' | 'binary' | 'base64';
  offset?: number;
  length?: number;
}

/**
 * Options for writing files.
 *
 * @public
 */
export interface WriteOptions {
  encoding?: 'utf8' | 'binary' | 'base64';
  append?: boolean;
  create?: boolean;
}

/**
 * Options for listing directory contents.
 *
 * @public
 */
export interface ListOptions {
  recursive?: boolean;
  pattern?: string | RegExp;
  includeHidden?: boolean;
}

/**
 * Represents an error that occurred during a VFS operation.
 *
 * @public
 */
export class VFSError extends Error {
  constructor(message: string, public code?: string, public path?: string) {
    super(message);
    this.name = 'VFSError';
  }
}

/**
 * Information about a simple mount point.
 *
 * @internal
 */
export interface SimpleMountInfo {
  mountPath: string;
  vfs: VFS;
  relativePath: string;
}

/**
 * Options for glob pattern matching.
 *
 * @public
 */
export interface GlobOptions {
  /** Whether to recursively search subdirectories */
  recursive?: boolean;
  /** Whether to include hidden files (starting with .) */
  includeHidden?: boolean;
  /** Whether to include directories in results */
  includeDirs?: boolean;
  /** Whether to include files in results */
  includeFiles?: boolean;
  /** Whether pattern matching is case sensitive */
  caseSensitive?: boolean;
  /** The root directory to search from */
  cwd?: string;
  /** Patterns to exclude from results */
  ignore?: string | string[];
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Represents a file or directory that matches a glob pattern.
 *
 * @public
 */
export interface GlobResult extends FileMetadata {
  /** The path relative to the search root directory */
  relativePath: string;
  /** The glob pattern that matched this result */
  matchedPattern: string;
}

/**
 * A matcher for glob patterns that converts wildcard patterns to regular expressions.
 *
 * @public
 */
export class GlobMatcher {
  private pattern: string;
  private regex: RegExp;

  /**
   * Creates a new glob pattern matcher.
   *
   * @param pattern - The glob pattern to match
   * @param caseSensitive - Whether matching should be case sensitive
   */
  constructor(pattern: string, caseSensitive = true) {
    this.pattern = pattern;
    this.regex = this.compilePattern(pattern, caseSensitive);
  }

  /**
   * 将通配符模式编译为正则表达式
   */
  private compilePattern(str: string, caseSensitive: boolean) {
    // The regexp we are building, as a string.
    let reStr = '';

    // Whether we are matching so called "extended" globs (like bash) and should
    // support single character matching, matching ranges of characters, group
    // matching, etc.
    const extended = true;

    // When globstar is _false_ (default), '/foo/*' is translated a regexp like
    // '^\/foo\/.*$' which will match any string beginning with '/foo/'
    // When globstar is _true_, '/foo/*' is translated to regexp like
    // '^\/foo\/[^/]*$' which will match any string beginning with '/foo/' BUT
    // which does not have a '/' to the right of it.
    // E.g. with '/foo/*' these will match: '/foo/bar', '/foo/bar.txt' but
    // these will not '/foo/bar/baz', '/foo/bar/baz.txt'
    // Lastely, when globstar is _true_, '/foo/**' is equivelant to '/foo/*' when
    // globstar is _false_
    const globstar = true;

    // If we are doing extended matching, this boolean is true when we are inside
    // a group (eg {*.html,*.js}), and false otherwise.
    let inGroup = false;

    // RegExp flags (eg "i" ) to pass in to RegExp constructor.
    const flags = caseSensitive ? '' : 'i';

    let c: string;
    for (let i = 0, len = str.length; i < len; i++) {
      c = str[i];

      switch (c) {
        case '/':
        case '$':
        case '^':
        case '+':
        case '.':
        case '(':
        case ')':
        case '=':
        case '!':
        case '|':
          reStr += '\\' + c;
          break;

        case '?':
          if (extended) {
            reStr += '.';
            break;
          }

        case '[':
        case ']':
          if (extended) {
            reStr += c;
            break;
          }

        case '{':
          if (extended) {
            inGroup = true;
            reStr += '(';
            break;
          }

        case '}':
          if (extended) {
            inGroup = false;
            reStr += ')';
            break;
          }

        case ',':
          if (inGroup) {
            reStr += '|';
            break;
          }
          reStr += '\\' + c;
          break;

        case '*':
          // Move over all consecutive "*"'s.
          // Also store the previous and next characters
          const prevChar = str[i - 1];
          let starCount = 1;
          while (str[i + 1] === '*') {
            starCount++;
            i++;
          }
          const nextChar = str[i + 1];

          if (!globstar) {
            // globstar is disabled, so treat any number of "*" as one
            reStr += '.*';
          } else {
            // globstar is enabled, so determine if this is a globstar segment
            const isGlobstar =
              starCount > 1 && // multiple "*"'s
              (prevChar === '/' || prevChar === undefined) && // from the start of the segment
              (nextChar === '/' || nextChar === undefined); // to the end of the segment

            if (isGlobstar) {
              // it's a globstar, so match zero or more path segments
              reStr += '((?:[^/]*(?:/|$))*)';
              i++; // move over the "/"
            } else {
              // it's not a globstar, so only match one path segment
              reStr += '([^/]*)';
            }
          }
          break;

        default:
          reStr += c;
      }
    }

    // When regexp 'g' flag is specified don't
    // constrain the regular expression with ^ & $
    if (!flags || !~flags.indexOf('g')) {
      reStr = '^' + reStr + '$';
    }

    return new RegExp(reStr, flags);
  }

  /**
   * 测试路径是否匹配模式
   */
  test(path: string): boolean {
    return this.regex.test(path);
  }

  /**
   * 获取原始模式
   */
  getPattern(): string {
    return this.pattern;
  }
}

/**
 * Abstract base class for virtual file systems.
 *
 * Provides a standardized interface for file system operations and supports
 * mounting other VFS instances at specific paths for composition.
 *
 * @public
 *
 */
export abstract class VFS {
  /** The name of this file system instance */
  public readonly name: string;
  /** Whether this file system is read-only */
  public readonly isReadOnly: boolean;

  // 简单挂载支持（向后兼容）
  private simpleMounts: Map<string, VFS> = new Map();
  private sortedMountPaths: string[] = [];

  /**
   * Creates a new VFS instance.
   *
   * @param name - The name of this file system
   * @param isReadOnly - Whether this file system should be read-only
   */
  constructor(name: string, isReadOnly: boolean = false) {
    this.name = name;
    this.isReadOnly = isReadOnly;
  }

  /**
   * Mounts another VFS at the specified path.
   *
   * Simple mounting functionality for backward compatibility.
   * For complex mounting requirements, consider using a dedicated MountFS implementation.
   *
   * @param path - The path where to mount the VFS
   * @param vfs - The VFS instance to mount
   *
   * @example
   * ```typescript
   * const mainFS = new MyVFS('main');
   * const dataFS = new MyVFS('data');
   * mainFS.mount('/data', dataFS);
   *
   * // Now operations on /data/* will be handled by dataFS
   * await mainFS.writeFile('/data/file.txt', 'content');
   * ```
   */
  mount(path: string, vfs: VFS): void {
    const normalizedPath = PathUtils.normalize(path);
    this.simpleMounts.set(normalizedPath, vfs);

    // 重新排序挂载路径（按长度降序）
    this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b) => b.length - a.length);
  }

  /**
   * Unmounts a VFS from the specified path.
   *
   * @param path - The path to unmount
   * @returns True if a VFS was unmounted, false if no VFS was mounted at that path
   */
  unmount(path: string): boolean {
    const normalizedPath = PathUtils.normalize(path);
    const result = this.simpleMounts.delete(normalizedPath);

    if (result) {
      // 重新排序挂载路径
      this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b) => b.length - a.length);
    }

    return result;
  }

  /**
   * Gets the mounted VFS for a given path, if any.
   *
   * Uses improved path matching to ensure the longest matching mount path is selected.
   *
   * @param path - The path to check for mounts
   * @returns Mount information if found, null otherwise
   *
   * @internal
   */
  protected getMountedVFS(path: string): SimpleMountInfo | null {
    const normalizedPath = PathUtils.normalize(path);

    // 使用排序后的路径进行匹配，确保匹配最长的路径
    for (const mountPath of this.sortedMountPaths) {
      if (normalizedPath === mountPath || normalizedPath.startsWith(mountPath + '/')) {
        const relativePath = normalizedPath === mountPath ? '/' : normalizedPath.slice(mountPath.length);

        return {
          mountPath,
          vfs: this.simpleMounts.get(mountPath)!,
          relativePath
        };
      }
    }

    return null;
  }

  /**
   * Gets all simple mount points.
   *
   * @returns Array of mount point paths
   */
  getSimpleMountPoints(): string[] {
    return Array.from(this.simpleMounts.keys());
  }

  /**
   * Checks if this VFS has any mount points.
   *
   * @returns True if there are mounted VFS instances, false otherwise
   */
  hasMounts(): boolean {
    return this.simpleMounts.size > 0;
  }

  // 公共接口方法

  /**
   * Creates a directory at the specified path.
   *
   * @param path - The path where to create the directory
   * @param recursive - Whether to create parent directories if they don't exist
   *
   * @example
   * ```typescript
   * await fs.makeDirectory('/path/to/dir', true); // Create with parents
   * ```
   */
  async makeDirectory(path: string, recursive?: boolean): Promise<void> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.makeDirectory(mounted.relativePath, recursive);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', path);
    }

    return this._makeDirectory(path, recursive ?? false);
  }

  /**
   * Reads the contents of a directory.
   *
   * @param path - The path of the directory to read
   * @param options - Options for directory listing
   * @returns Promise that resolves to an array of file metadata
   *
   * @example
   * ```typescript
   * const files = await fs.readDirectory('/path', { recursive: true });
   * ```
   */
  async readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.readDirectory(mounted.relativePath, options);
    }

    return this._readDirectory(path, options);
  }

  /**
   * Deletes a directory.
   *
   * @param path - The path of the directory to delete
   * @param options - Options for directory deletion
   *
   * @example
   * ```typescript
   * await fs.deleteDirectory('/path/to/dir', { recursive: true });
   * ```
   */
  async deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.deleteDirectory(mounted.relativePath, options);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', path);
    }

    return this._deleteDirectory(path, options?.recursive ?? false);
  }

  /**
   * Reads the contents of a file.
   *
   * @param path - The path of the file to read
   * @param options - Options for reading (encoding, offset, length)
   * @returns Promise that resolves to the file contents as ArrayBuffer or string
   *
   * @example
   * ```typescript
   * const content = await fs.readFile('/file.txt', { encoding: 'utf8' });
   * const buffer = await fs.readFile('/binary.dat');
   * ```
   */
  async readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.readFile(mounted.relativePath, options);
    }

    return this._readFile(path, options);
  }

  /**
   * Writes data to a file.
   *
   * @param path - The path where to write the file
   * @param data - The data to write (ArrayBuffer or string)
   * @param options - Options for writing (append mode, encoding, create parent dirs)
   *
   * @example
   * ```typescript
   * await fs.writeFile('/file.txt', 'Hello World!', { create: true });
   * await fs.writeFile('/data.bin', buffer);
   * ```
   */
  async writeFile(path: string, data: ArrayBuffer | string, options?: WriteOptions): Promise<void> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.writeFile(mounted.relativePath, data, options);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', path);
    }

    return this._writeFile(path, data, options);
  }

  /**
   * Deletes a file.
   *
   * @param path - The path of the file to delete
   *
   * @example
   * ```typescript
   * await fs.deleteFile('/file.txt');
   * ```
   */
  async deleteFile(path: string): Promise<void> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.deleteFile(mounted.relativePath);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', path);
    }

    return this._deleteFile(path);
  }

  /**
   * Checks if a path exists in the file system.
   *
   * @param path - The path to check
   * @returns Promise that resolves to true if path exists, false otherwise
   *
   * @example
   * ```typescript
   * const exists = await fs.exists('/file.txt');
   * if (exists) {
   *   // File exists
   * }
   * ```
   */
  async exists(path: string): Promise<boolean> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.exists(mounted.relativePath);
    }

    return this._exists(path);
  }

  /**
   * Gets file or directory statistics.
   *
   * @param path - The path to get statistics for
   * @returns Promise that resolves to file statistics
   *
   * @example
   * ```typescript
   * const stats = await fs.stat('/file.txt');
   * console.log(`Size: ${stats.size}, Modified: ${stats.modified}`);
   * ```
   */
  async stat(path: string): Promise<FileStat> {
    const mounted = this.getMountedVFS(path);
    if (mounted) {
      return mounted.vfs.stat(mounted.relativePath);
    }

    return this._stat(path);
  }

  /**
   * Copies a file from source to destination.
   *
   * @param src - The source file path
   * @param dest - The destination file path
   * @param options - Options for copying
   *
   * @example
   * ```typescript
   * await fs.copyFile('/src.txt', '/dest.txt', { overwrite: true });
   * ```
   */
  async copyFile(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void> {
    if (!options?.overwrite && (await this.exists(dest))) {
      throw new VFSError('Destination file already exists', 'EEXIST', dest);
    }

    const data = await this.readFile(src);
    await this.writeFile(dest, data, { create: true });
  }

  /**
   * Moves or renames a file from source to destination.
   *
   * @param src - The source file path
   * @param dest - The destination file path
   * @param options - Options for moving
   *
   * @example
   * ```typescript
   * await fs.moveFile('/old.txt', '/new.txt');
   * ```
   */
  async moveFile(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void> {
    await this.copyFile(src, dest, options);
    await this.deleteFile(src);
  }

  /**
   * Disposes of this file system and cleans up resources.
   *
   * @example
   * ```typescript
   * await fs.dispose();
   * ```
   */
  async deleteFileSystem() {
    await this._deleteFileSystem();
  }
  /**
   * Gets information about this file system.
   *
   * @returns Object containing file system information
   *
   * @example
   * ```typescript
   * const info = fs.getInfo();
   * console.log(`FS: ${info.name}, Read-only: ${info.isReadOnly}`);
   * ```
   */
  getInfo(): {
    name: string;
    isReadOnly: boolean;
    mountCount: number;
    mountPoints: string[];
  } {
    return {
      name: this.name,
      isReadOnly: this.isReadOnly,
      mountCount: this.simpleMounts.size,
      mountPoints: this.getSimpleMountPoints()
    };
  }

  /**
   * Searches for files and directories using glob patterns.
   *
   * Supports standard glob patterns including wildcards (*), character classes ([abc]),
   * and globstar (**) for recursive matching.
   *
   * @param pattern - The glob pattern(s) to match
   * @param options - Options for glob matching
   * @returns Promise that resolves to an array of matching files and directories
   *
   * @example
   * ```typescript
   * // Find all .txt files
   * const txtFiles = await fs.glob('**\/*.txt');
   *
   * // Find files with multiple patterns
   * const files = await fs.glob(['**\/*.js', '**\/*.ts'], {
   *   cwd: '/src',
   *   ignore: ['node_modules/**']
   * });
   * ```
   */
  async glob(pattern: string | string[], options: GlobOptions = {}): Promise<GlobResult[]> {
    const {
      recursive = true,
      includeHidden = false,
      includeDirs = true,
      includeFiles = true,
      caseSensitive = true,
      cwd = '/',
      ignore = [],
      limit
    } = options;

    const patterns = (Array.isArray(pattern) ? pattern : [pattern]).filter((pattern) => !!pattern);
    if (patterns.length === 0) {
      return [];
    }
    const ignorePatterns = Array.isArray(ignore) ? ignore : [ignore];

    const matchers = patterns.map((p) => new GlobMatcher(p, caseSensitive));
    const ignoreMatchers = ignorePatterns.map((p) => new GlobMatcher(p, caseSensitive));

    const results: GlobResult[] = [];
    const normalizedCwd = PathUtils.normalize(cwd);

    const searchDirectory = async (dirPath: string): Promise<void> => {
      if (limit && results.length >= limit) {
        return;
      }

      try {
        const entries = await this._readDirectory(dirPath, {
          includeHidden: true
        });

        for (const entry of entries) {
          if (limit && results.length >= limit) {
            break;
          }

          const fullPath = entry.path;
          const relativePath = PathUtils.relative(normalizedCwd, fullPath);

          if (entry.type === 'file' && !includeFiles) {
            continue;
          }
          if (entry.type === 'file' || (entry.type === 'directory' && includeDirs)) {
            if (!includeHidden && entry.name.startsWith('.')) {
              continue;
            }

            const shouldIgnore = ignoreMatchers.some(
              (matcher) => matcher.test(relativePath) || matcher.test(fullPath)
            );
            if (shouldIgnore) {
              continue;
            }

            for (const matcher of matchers) {
              if (matcher.test(relativePath)) {
                const result: GlobResult = {
                  ...entry,
                  relativePath,
                  matchedPattern: matcher.getPattern()
                };
                results.push(result);
                break;
              }
            }
          }
          if (recursive && entry.type === 'directory') {
            await searchDirectory(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Cannot access directory: ${dirPath}`, error);
      }
    };

    await searchDirectory(normalizedCwd);

    return results;
  }

  /**
   * Creates a directory in the file system.
   *
   * @param path - Directory path
   * @param recursive - Whether to create parent directories
   */
  protected abstract _makeDirectory(path: string, recursive: boolean): Promise<void>;
  /**
   * Reads the contents of a directory from the file system.
   *
   * @param path - Directory path
   * @param options - Listing options (recursive, filter, etc)
   * @returns List of FileMetadata for entries in the directory
   */
  protected abstract _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]>;
  /**
   * Deletes a directory and its contents (if recursive).
   *
   * @param path - Directory path
   * @param recursive - If true, delete contents recursively
   */
  protected abstract _deleteDirectory(path: string, recursive: boolean): Promise<void>;
  /**
   * Reads a file from the file system.
   *
   * @param path - Path to file
   * @param options - Read options (encoding, offset, length)
   * @returns File contents as ArrayBuffer or string
   */
  protected abstract _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string>;
  /**
   * Writes data to a file (or stages for writing in memory).
   *
   * @param path - File path
   * @param data - Data to write
   * @param options - Write options (append, encoding, create parent dirs)
   */
  protected abstract _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void>;
  /**
   * Deletes a file in the file system.
   *
   * @param path - File path
   */
  protected abstract _deleteFile(path: string): Promise<void>;
  /**
   * Checks if a file or directory exists in the file system.
   *
   * @param path - File or directory path
   * @returns True if exists
   */
  protected abstract _exists(path: string): Promise<boolean>;
  /**
   * Gets statistics/metadata for a file or directory.
   *
   * @param path - File or directory path
   * @returns FileStat (type, size, times, etc)
   */
  protected abstract _stat(path: string): Promise<FileStat>;
  protected abstract _deleteFileSystem(): Promise<void>;
}
