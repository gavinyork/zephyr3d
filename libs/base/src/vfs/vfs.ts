import { makeEventTarget } from '../event';
import { guessMimeType, PathUtils } from './common';

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
 * Options for move operations.
 *
 * @public
 */
export interface MoveOptions {
  overwrite?: boolean; // 是否覆盖目标（如果存在）
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
export abstract class VFS extends makeEventTarget(Object)<{
  changed: [type: 'created' | 'deleted' | 'moved' | 'modified', path: string, itemType: 'file' | 'directory'];
}>() {
  /** The name of this file system instance */
  public readonly name: string;
  /** Whether this file system is read-only */
  public readonly isReadOnly: boolean;

  // CWD 支持
  private _cwd: string = '/';
  private _dirStack: string[] = [];

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
    super();
    this.name = name;
    this.isReadOnly = isReadOnly;
  }

  /**
   * Gets the current working directory.
   *
   * @returns The current working directory path
   *
   * @example
   * ```typescript
   * const cwd = fs.getCwd();
   * console.log(`Current directory: ${cwd}`);
   * ```
   */
  getCwd(): string {
    return this._cwd;
  }

  /**
   * Changes the current working directory.
   *
   * @param path - The new working directory path (absolute or relative)
   * @returns Promise that resolves when directory is changed
   *
   * @example
   * ```typescript
   * await fs.chdir('/home/user');
   * await fs.chdir('../documents'); // Relative path
   * ```
   */
  async chdir(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);

    // 检查目录是否存在
    if (!(await this.exists(normalizedPath))) {
      throw new VFSError(`Directory does not exist: ${normalizedPath}`, 'ENOENT', normalizedPath);
    }

    // 检查是否为目录
    const stat = await this.stat(normalizedPath);
    if (!stat.isDirectory) {
      throw new VFSError(`Not a directory: ${normalizedPath}`, 'ENOTDIR', normalizedPath);
    }

    this._cwd = normalizedPath;
  }

  /**
   * Pushes the current directory onto the directory stack and changes to the specified directory.
   *
   * @param path - The directory to change to (absolute or relative)
   * @returns Promise that resolves when directory is changed
   *
   * @example
   * ```typescript
   * await fs.pushd('/tmp');        // Push current dir and go to /tmp
   * await fs.pushd('../other');    // Push /tmp and go to /other
   * ```
   */
  async pushd(path: string): Promise<void> {
    this._dirStack.push(this._cwd);
    await this.chdir(path);
  }

  /**
   * Pops a directory from the directory stack and changes to it.
   *
   * @returns Promise that resolves when directory is changed
   * @throws VFSError if the directory stack is empty
   *
   * @example
   * ```typescript
   * await fs.popd(); // Return to previously pushed directory
   * ```
   */
  async popd(): Promise<void> {
    if (this._dirStack.length === 0) {
      throw new VFSError('Directory stack is empty', 'ENOENT');
    }

    const previousDir = this._dirStack.pop()!;
    this._cwd = previousDir;
  }

  /**
   * Gets the current directory stack.
   *
   * @returns Array of directory paths in the stack
   *
   * @example
   * ```typescript
   * const stack = fs.getDirStack();
   * console.log(`Stack depth: ${stack.length}`);
   * ```
   */
  getDirStack(): string[] {
    return [...this._dirStack]; // 返回副本
  }

  /**
   * Normalizes a path, resolving . and .. components and making it absolute.
   * Supports both absolute and relative paths.
   *
   * @param path - The path to normalize
   * @returns The normalized absolute path
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.normalizePath('.');           // -> /home/user
   * fs.normalizePath('..');          // -> /home
   * fs.normalizePath('../docs');     // -> /home/docs
   * fs.normalizePath('/tmp');        // -> /tmp
   * fs.normalizePath('sub/dir');     // -> /home/user/sub/dir
   * ```
   */
  normalizePath(path: string): string {
    if (!path) {
      return this._cwd;
    }

    // 如果是绝对路径，直接使用 PathUtils.normalize
    if (path.startsWith('/')) {
      return PathUtils.normalize(path);
    }

    if (this.isObjectURL(path) || this.parseDataURI(path)) {
      // 是ObjectURL或dataURL，不执行规范化
      return path;
    }

    // 相对路径：先与 CWD 合并，然后规范化
    const absolutePath = PathUtils.join(this._cwd, path);
    return PathUtils.normalize(absolutePath);
  }

  /**
   * Join paths together, making the result relative to CWD if not absolute.
   *
   * @param paths - Paths to join
   * @returns Complete normalized path
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.join('docs', 'file.txt');     // -> /home/user/docs/file.txt
   * fs.join('/tmp', 'file.txt');     // -> /tmp/file.txt
   * ```
   */
  join(...paths: string[]): string {
    if (paths.length === 0) {
      return this._cwd;
    }

    // 如果第一个路径是绝对路径，直接使用 PathUtils.join
    if (paths[0].startsWith('/')) {
      return PathUtils.normalize(PathUtils.join(...paths));
    }

    // 如果是相对路径，先与 CWD 合并，然后 join 剩余路径
    const allPaths = [this._cwd, ...paths];
    return PathUtils.normalize(PathUtils.join(...allPaths));
  }
  /**
   * Extract directory part for a path
   * @param path - path
   * @returns Directory part of the path
   */
  dirname(path: string) {
    return PathUtils.dirname(path);
  }
  /**
   * Extract base file name part for a path
   * @param path - path
   * @returns Base file name part of the path
   */
  basename(path: string) {
    return PathUtils.basename(path);
  }
  /**
   * Converts an absolute path to a path relative to the current working directory.
   *
   * @param path - The absolute path to convert
   * @returns The relative path from CWD
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.relative('/home/user/docs');  // -> docs
   * fs.relative('/home');            // -> ..
   * fs.relative('/tmp');             // -> ../../tmp
   * ```
   */
  relative(path: string): string {
    if (this.isObjectURL(path) || this.parseDataURI(path)) {
      // ObjectURL和DataURL不支持相对路径
      return path;
    }
    const absolutePath = this.normalizePath(path);
    return PathUtils.relative(this._cwd, absolutePath);
  }

  /**
   * Moves/renames a file or directory.
   *
   * @param sourcePath - Source path
   * @param targetPath - Target path
   * @param options - Move options
   *
   * @example
   * ```typescript
   * // Rename file
   * await fs.move('/old_name.txt', '/new_name.txt');
   *
   * // Move file to directory
   * await fs.move('/file.txt', '/subdir/file.txt');
   *
   * // Rename directory
   * await fs.move('/old_dir', '/new_dir');
   * ```
   */
  async move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    const normalizedSource = this.normalizePath(sourcePath);
    const normalizedTarget = this.normalizePath(targetPath);

    // 1. 检查根目录限制
    this._validateMoveRootRestrictions(normalizedSource, normalizedTarget);

    // 2. 检查是否跨 VFS
    const sourceMount = this.getMountedVFS(normalizedSource);
    const targetMount = this.getMountedVFS(normalizedTarget);

    if (sourceMount || targetMount) {
      // 如果涉及挂载点，检查是否为同一个VFS
      const sourceVFS = sourceMount ? sourceMount.vfs : this;
      const targetVFS = targetMount ? targetMount.vfs : this;

      if (sourceVFS !== targetVFS) {
        throw new VFSError('Cross-VFS move is not supported', 'EXDEV', normalizedSource);
      }

      // 如果都在同一个挂载的VFS中，委托给该VFS处理
      if (sourceMount && targetMount && sourceMount.vfs === targetMount.vfs) {
        return sourceMount.vfs.move(sourceMount.relativePath, targetMount.relativePath, options);
      }
    }

    // 3. 检查源和目标类型匹配
    await this._validateMoveTypeCompatibility(normalizedSource, normalizedTarget, options);

    // 4. 如果文件系统是只读的，抛出错误
    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedSource);
    }

    const sourceStat = await this.stat(normalizedSource);
    const itemType = sourceStat.isDirectory ? 'directory' : 'file';

    // 5. 执行移动操作
    await this._move(normalizedSource, normalizedTarget, options);

    this.onChange('moved', normalizedTarget, itemType);
  }

  // 修改所有公共方法以使用新的路径规范化
  async makeDirectory(path: string, recursive?: boolean): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.makeDirectory(mounted.relativePath, recursive);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._makeDirectory(normalizedPath, recursive ?? false);
    this.onChange('created', normalizedPath, 'directory');
  }

  async readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.readDirectory(mounted.relativePath, options);
    }

    return this._readDirectory(normalizedPath, options);
  }

  async deleteDirectory(path: string, recursive?: boolean): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.deleteDirectory(mounted.relativePath, recursive);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._deleteDirectory(normalizedPath, recursive ?? false);
    this.onChange('deleted', normalizedPath, 'directory');
  }

  async readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    // Special case for Object URL and Data URL
    if (this.isObjectURL(path) || this.parseDataURI(path)) {
      try {
        const response = await fetch(path);
        if (!response.ok) {
          throw new VFSError('Failed to fetch', 'ENOENT', path);
        }
        let data: ArrayBuffer | string;
        if (options?.encoding === 'utf8') {
          data = await response.text();
        } else if (options?.encoding === 'base64') {
          const arrayBuffer = await response.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          data = btoa(String.fromCodePoint(...bytes));
        } else {
          data = await response.arrayBuffer();
        }
        return data;
      } catch (err) {
        throw new VFSError(`Failed to fetch: ${err}`, 'EIO', path);
      }
    }
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.readFile(mounted.relativePath, options);
    }

    return this._readFile(normalizedPath, options);
  }

  async writeFile(path: string, data: ArrayBuffer | string, options?: WriteOptions): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.writeFile(mounted.relativePath, data, options);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    const existed = await this._exists(normalizedPath);
    await this._writeFile(normalizedPath, data, options);
    this.onChange(existed ? 'modified' : 'created', normalizedPath, 'file');
  }

  async deleteFile(path: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.deleteFile(mounted.relativePath);
    }

    if (this.isReadOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._deleteFile(normalizedPath);
    this.onChange('deleted', normalizedPath, 'file');
  }

  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.exists(mounted.relativePath);
    }

    return this._exists(normalizedPath);
  }

  async stat(path: string): Promise<FileStat> {
    const normalizedPath = this.normalizePath(path);
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.stat(mounted.relativePath);
    }

    return this._stat(normalizedPath);
  }

  async copyFile(src: string, dest: string, options?: { overwrite?: boolean }): Promise<void> {
    const normalizedSrc = this.normalizePath(src);
    const normalizedDest = this.normalizePath(dest);

    if (!options?.overwrite && (await this.exists(normalizedDest))) {
      throw new VFSError('Destination file already exists', 'EEXIST', normalizedDest);
    }

    const data = await this.readFile(normalizedSrc);
    await this.writeFile(normalizedDest, data, { create: true });
  }

  async glob(pattern: string | string[], options: GlobOptions = {}): Promise<GlobResult[]> {
    // 使用 CWD 作为默认搜索根目录
    const defaultOptions = {
      cwd: this._cwd,
      ...options
    };

    // 规范化 cwd 选项
    if (defaultOptions.cwd) {
      defaultOptions.cwd = this.normalizePath(defaultOptions.cwd);
    }

    const {
      recursive = true,
      includeHidden = false,
      includeDirs = true,
      includeFiles = true,
      caseSensitive = true,
      cwd = this._cwd,
      ignore = [],
      limit
    } = defaultOptions;

    const patterns = (Array.isArray(pattern) ? pattern : [pattern]).filter((pattern) => !!pattern);
    if (patterns.length === 0) {
      return [];
    }

    const ignorePatterns = Array.isArray(ignore) ? ignore : [ignore];
    const matchers = patterns.map((p) => new GlobMatcher(p, caseSensitive));
    const ignoreMatchers = ignorePatterns.map((p) => new GlobMatcher(p, caseSensitive));

    const results: GlobResult[] = [];
    const normalizedCwd = this.normalizePath(cwd);

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

  guessMIMEType(path: string) {
    return guessMimeType(this.normalizePath(path));
  }
  // 更新 getInfo 方法以包含 CWD 信息
  getInfo(): {
    name: string;
    isReadOnly: boolean;
    cwd: string;
    dirStackDepth: number;
    mountCount: number;
    mountPoints: string[];
  } {
    return {
      name: this.name,
      isReadOnly: this.isReadOnly,
      cwd: this._cwd,
      dirStackDepth: this._dirStack.length,
      mountCount: this.simpleMounts.size,
      mountPoints: this.getSimpleMountPoints()
    };
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

  /**
   * Parse DataURL
   * @param uri - URL to parse
   * @returns parts of data URL
   */
  parseDataURI(uri: string) {
    return uri?.match(/^data:([^;]+)/) ?? null;
  }
  /**
   * Checks wether a URL is object url created by URL.createObjectURL()
   * @param url - URL to check
   * @returns true if the URL is object url, otherwise false
   */
  isObjectURL(url: string) {
    return typeof url === 'string' && url.startsWith('blob:');
  }
  /**
   * Disposes of this file system and cleans up resources. (for IndexedDB only).
   */
  async deleteFileSystem() {
    await this._deleteFileSystem();
  }

  /**
   * Delete entire database (for IndexedDB only).
   */
  async deleteDatabase() {
    await this._deleteDatabase();
  }

  private _validateMoveRootRestrictions(sourcePath: string, targetPath: string): void {
    // 不允许移动根目录
    if (sourcePath === '/') {
      throw new VFSError('Cannot move root directory', 'EINVAL', sourcePath);
    }

    // 不允许移动到根目录（替换根目录）
    if (targetPath === '/') {
      throw new VFSError('Cannot move to root directory', 'EINVAL', targetPath);
    }

    // 不允许移动到自己的子目录
    if (targetPath.startsWith(sourcePath + '/')) {
      throw new VFSError('Cannot move directory to its subdirectory', 'EINVAL', sourcePath);
    }

    const cwd = this.getCwd();

    // 检查是否尝试移动当前工作目录
    if (sourcePath === cwd) {
      throw new VFSError('Cannot move current working directory', 'EBUSY', sourcePath);
    }

    // 检查是否尝试移动当前工作目录的父目录
    // 如果CWD在源路径下面，说明源路径是CWD的父目录
    if (cwd.startsWith(sourcePath + '/')) {
      throw new VFSError('Cannot move parent directory of current working directory', 'EBUSY', sourcePath);
    }
  }

  /**
   * 检查源和目标类型兼容性
   */
  private async _validateMoveTypeCompatibility(
    sourcePath: string,
    targetPath: string,
    options?: MoveOptions
  ): Promise<void> {
    const sourceExists = await this.exists(sourcePath);
    if (!sourceExists) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    const sourceStat = await this.stat(sourcePath);

    // 检查目标是否存在
    const targetExists = await this.exists(targetPath);
    if (targetExists) {
      if (!options?.overwrite) {
        throw new VFSError('Target already exists', 'EEXIST', targetPath);
      }

      const targetStat = await this.stat(targetPath);

      // 只允许相同类型的替换
      if (sourceStat.isFile !== targetStat.isFile || sourceStat.isDirectory !== targetStat.isDirectory) {
        throw new VFSError('Cannot move file to directory or directory to file', 'EISDIR', sourcePath);
      }
    }
  }

  protected onChange(
    type: 'created' | 'deleted' | 'moved' | 'modified',
    path: string,
    itemType: 'file' | 'directory'
  ): void {
    this.dispatchEvent('changed', type, path, itemType);
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
  protected abstract _deleteDatabase(): Promise<void>;
  /**
   * Moves/renames a file or directory within the same VFS.
   * Implementation should avoid file copying and use metadata operations only.
   *
   * @param sourcePath - Source path (normalized)
   * @param targetPath - Target path (normalized)
   * @param options - Move options
   */
  protected abstract _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void>;
}
