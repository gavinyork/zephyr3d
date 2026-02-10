import { Observable } from '../event';
import type { Nullable } from '../utils';
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
  constructor(
    message: string,
    public code?: string,
    public path?: string
  ) {
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
  matchedPattern: Nullable<string>;
}

/**
 * A matcher for glob patterns that converts wildcard patterns to regular expressions.
 *
 * @public
 */
export class GlobMatcher {
  private readonly pattern: string;
  private readonly regex: RegExp;

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
   * Test if a path is a match pattern
   */
  test(path: string) {
    return this.regex.test(path);
  }

  /**
   * Get original match pattern
   */
  getPattern() {
    return this.pattern;
  }
  /**
   * Compile the match pattern to RegExp
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
        /* falls through */

        case '[':
        case ']':
          if (extended) {
            reStr += c;
            break;
          }
        /* falls through */

        case '{':
          if (extended) {
            inGroup = true;
            reStr += '(';
            break;
          }
        /* falls through */

        case '}':
          if (extended) {
            inGroup = false;
            reStr += ')';
            break;
          }
        /* falls through */

        case ',':
          if (inGroup) {
            reStr += '|';
            break;
          }
          reStr += '\\' + c;
          break;

        case '*': {
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
        }
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
export abstract class VFS extends Observable<{
  changed: [type: 'created' | 'deleted' | 'moved' | 'modified', path: string, itemType: 'file' | 'directory'];
}> {
  /** Whether this file system is read-only */
  protected _readOnly: boolean;

  // CWD support
  private _cwd: string = '/';
  private readonly _dirStack: string[];

  // Simple mounting support
  private readonly simpleMounts: Map<string, VFS>;
  private sortedMountPaths: string[];
  private mountChangeCallbacks: Map<
    string,
    (type: 'created' | 'deleted' | 'moved' | 'modified', path: string, itemType: 'file' | 'directory') => void
  >;

  /**
   * Creates a new VFS instance.
   *
   * @param readOnly - Whether this file system should be read-only
   */
  constructor(readOnly: boolean = false) {
    super();
    this._readOnly = readOnly;
    this._dirStack = [];
    this.simpleMounts = new Map();
    this._cwd = '/';
    this.sortedMountPaths = [];
    this.mountChangeCallbacks = new Map();
  }

  /** Toggle readonly */
  get readOnly() {
    return this._readOnly;
  }
  set readOnly(val: boolean) {
    this.setReadonly(val);
  }
  /**
   * Gets all simple mount points.
   *
   * @returns Array of mount point paths
   */
  getSimpleMountPoints() {
    return Array.from(this.simpleMounts.keys());
  }

  /**
   * Checks if this VFS has any mount points.
   *
   * @returns True if there are mounted VFS instances, false otherwise
   */
  hasMounts() {
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
   * Checks wether a URL is absolute URL
   * @param url - URL to check
   * @returns true if the URL is absolute URL, otherwise false
   */
  isAbsoluteURL(url: string) {
    return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
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
  async wipe() {
    await this._wipe();
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
  getCwd() {
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
  async chdir(path: string) {
    const normalizedPath = this.normalizePath(path);

    // Test directory existence
    if (!(await this.exists(normalizedPath))) {
      throw new VFSError(`Directory does not exist: ${normalizedPath}`, 'ENOENT', normalizedPath);
    }

    // Test wether it is a directory
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
  async pushd(path: string) {
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
  async popd() {
    if (this._dirStack.length === 0) {
      throw new VFSError('Directory stack is empty', 'ENOENT');
    }

    const previousDir = this._dirStack.pop()!;
    this._cwd = previousDir;
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
  normalizePath(path: string) {
    if (!path) {
      return this._cwd;
    }

    // Use PathUtils.normalize if it is an absolute path
    if (path.startsWith('/')) {
      return PathUtils.normalize(path);
    }

    if (this.isAbsoluteURL(path) || this.isObjectURL(path) || this.parseDataURI(path)) {
      // Normalize URL
      return encodeURI(path);
    }

    // Relative path: merged with CWD and then do normalization
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
  join(...paths: string[]) {
    if (paths.length === 0) {
      return this._cwd;
    }

    // Use PathUtils.join if the first path is an absolute path
    if (paths[0].startsWith('/')) {
      return PathUtils.normalize(PathUtils.join(...paths));
    }

    // Relative path, merged with CWD first, and join with rest
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
   * Returns whether a path is absolute or not
   * @param path - path to check
   * @returns true if the path is an absolute path
   */
  isAbsolute(path: string) {
    return PathUtils.isAbsolute(path);
  }
  /**
   * Extract base file name part for a path
   * @param path - path
   * @param ext - Optional extension to strip (exact suffix match).
   * @returns The base name of the path.
   */
  basename(path: string, ext?: string) {
    return PathUtils.basename(path, ext);
  }
  /**
   * Extract extension file name part for a path
   * @param path - path
   * @returns extension file name part of the path
   */
  extname(path: string) {
    return PathUtils.extname(path);
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
  relative(path: string, parent?: string) {
    if (this.isObjectURL(path) || this.parseDataURI(path)) {
      // No relative support for ObjectURL and DataURL
      return path;
    }
    const absolutePath = this.normalizePath(path);
    return PathUtils.relative(parent ?? this._cwd, absolutePath);
  }
  /**
   * Determine whether parentPath is parent directory of path (includes the case where parentPath is same as path)
   *
   * @param parentPath - The possible parent path
   * @param path - The possible child path
   * @returns true if parentPath is parent directory of path or parent directory is same as path
   *
   */
  isParentOf(parentPath: string, path: string) {
    let normalizedParentPath = this.normalizePath(parentPath);
    if (normalizedParentPath !== '/' && !normalizedParentPath.endsWith('/')) {
      normalizedParentPath += '/';
    }
    let normalizedPath = this.normalizePath(path);
    if (path !== '/' && !normalizedPath.endsWith('/')) {
      normalizedPath += '/';
    }
    return normalizedPath.startsWith(normalizedParentPath);
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
  async move(sourcePath: string, targetPath: string, options?: MoveOptions) {
    const normalizedSource = this.normalizePath(sourcePath);
    const normalizedTarget = this.normalizePath(targetPath);

    // Test for root directory restrictions
    this._validateRootRestrictions(normalizedSource, normalizedTarget);

    // 2. Test for crossing VFS boundary
    const sourceMount = this.getMountedVFS(normalizedSource);
    const targetMount = this.getMountedVFS(normalizedTarget);

    if (sourceMount || targetMount) {
      const sourceVFS = sourceMount ? sourceMount.vfs : this;
      const targetVFS = targetMount ? targetMount.vfs : this;

      if (sourceVFS !== targetVFS) {
        throw new VFSError('Cross-VFS move is not supported', 'EXDEV', normalizedSource);
      }

      if (sourceMount && targetMount && sourceMount.vfs === targetMount.vfs) {
        sourceMount.vfs.move(sourceMount.relativePath, targetMount.relativePath, options);
      }
    }

    // Check for type compatibility
    await this._validateTypeCompatibility(normalizedSource, normalizedTarget, options);

    if (this._readOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedSource);
    }

    const sourceStat = await this.stat(normalizedSource);
    const itemType = sourceStat.isDirectory ? 'directory' : 'file';

    // Do moving operation
    await this._move(normalizedSource, normalizedTarget, options);

    this.onChange('moved', normalizedTarget, itemType);
  }

  /**
   * Makes new directory
   * @param path - Directory path
   * @param recursive - If true, create parent directory if not exists
   */
  async makeDirectory(path: string, recursive?: boolean) {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      mounted.vfs.makeDirectory(mounted.relativePath, recursive);
    }

    if (this._readOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._makeDirectory(normalizedPath, recursive ?? false);
    this.onChange('created', normalizedPath, 'directory');
  }

  async readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      const v = this.simpleMounts.get(normalizedPath)!;
      const childEntries = await v.readDirectory('/', options).catch(() => []);
      return childEntries.map((e) => ({
        ...e,
        path: PathUtils.normalize(PathUtils.join(normalizedPath, e.path === '/' ? '' : e.path))
      }));
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      const childEntries = await mounted.vfs.readDirectory(mounted.relativePath, options);
      // Rewrite child paths back to host namespace: <mountPath>/<childPath>
      return childEntries.map((e) => ({
        ...e,
        path: PathUtils.normalize(PathUtils.join(mounted.mountPath, e.path === '/' ? '' : e.path))
      }));
    }

    const entries = await this._readDirectory(normalizedPath, options);

    return this.injectDirectMountDirs(normalizedPath, entries, options);
  }

  async deleteDirectory(path: string, recursive?: boolean) {
    const normalizedPath = this.normalizePath(path);
    const exists = await this.exists(normalizedPath);
    if (!exists) {
      return;
    }
    const stat = await this.stat(normalizedPath);
    if (!stat.isDirectory) {
      throw new VFSError('Target path is not a directory', 'ENOTDIR', normalizedPath);
    }
    for (const mountPath of this.sortedMountPaths) {
      if (
        (mountPath.endsWith('/') ? mountPath : `${mountPath}/`).startsWith(
          normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/'
        )
      ) {
        // Attempt to delete a mounted path or it's parent
        throw new VFSError(
          'Cannot delete a directory that contains mounted subdirectories. Unmount them first.',
          'EBUSY',
          normalizedPath
        );
      }
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      mounted.vfs.deleteDirectory(mounted.relativePath, recursive);
    }

    if (this._readOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._deleteDirectory(normalizedPath, recursive ?? false);
    this.onChange('deleted', normalizedPath, 'directory');
  }

  /**
   * Read from a VFS file
   * @param path - File path to read
   * @param options - Read options
   * @returns The file contents
   */
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
    if (this.simpleMounts.has(normalizedPath)) {
      throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
    }

    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.readFile(mounted.relativePath, options);
    }

    return this._readFile(normalizedPath, options);
  }

  /**
   * Write to a VFS file
   * @param path - File path to write
   * @param data - Data to be written
   * @param options - Write options
   */
  async writeFile(path: string, data: ArrayBuffer | string, options?: WriteOptions) {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      mounted.vfs.writeFile(mounted.relativePath, data, options);
    }

    if (this._readOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    const existed = await this._exists(normalizedPath);
    if (existed) {
      const stat = await this._stat(normalizedPath);
      if (stat.isDirectory) {
        throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
      }
    }
    await this._writeFile(normalizedPath, data, options);
    this.onChange(existed ? 'modified' : 'created', normalizedPath, 'file');
  }

  /**
   * Deletes a VFS file
   * @param path - File path to delete
   */
  async deleteFile(path: string) {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      mounted.vfs.deleteFile(mounted.relativePath);
    }

    if (this._readOnly) {
      throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
    }

    await this._deleteFile(normalizedPath);
    this.onChange('deleted', normalizedPath, 'file');
  }

  /**
   * Test whether a VFS file or directory exists for given path
   * @param path - Path to test
   * @returns true if exists
   */
  async exists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      return true;
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.exists(mounted.relativePath);
    }

    return this._exists(normalizedPath);
  }

  /**
   * Gets the statistics about a given path
   * @param path - path
   * @returns Statistics about the path
   */
  async stat(path: string): Promise<FileStat> {
    const normalizedPath = this.normalizePath(path);
    if (this.simpleMounts.has(normalizedPath)) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: new Date(0),
        modified: new Date(0)
      };
    }
    const mounted = this.getMountedVFS(normalizedPath);
    if (mounted) {
      return mounted.vfs.stat(mounted.relativePath);
    }

    return this._stat(normalizedPath);
  }

  /**
   * Copies a VFS file
   * @param src - Source file path
   * @param dest - Destination file path
   * @param options - Copy options
   */
  async copyFile(src: string, dest: string, options?: { overwrite?: boolean; targetVFS?: VFS }) {
    // Detect if we are copying to a mounted VFS
    const destMount = this.getMountedVFS(dest);
    const targetVFS = options?.targetVFS ?? (destMount ? destMount.vfs : this);
    const overwrite = !!options?.overwrite;

    // Check if target VFS is writable
    if (targetVFS._readOnly) {
      throw new VFSError('Target VFS is read-only', 'EROFS', dest);
    }

    const normalizedSrc = this.normalizePath(src);
    const normalizedDest = targetVFS.normalizePath(destMount ? destMount.relativePath : dest);

    // Check source file
    if (!(await this.exists(normalizedSrc))) {
      throw new VFSError(`Source file does not exist: ${normalizedSrc}`, 'ENOENT', normalizedSrc);
    }
    const sourceStat = await this.stat(normalizedSrc);
    if (!sourceStat.isFile) {
      throw new VFSError('Source path is not a file', 'EISDIR', normalizedSrc);
    }

    // Check target file
    const targetExists = await targetVFS.exists(normalizedDest);
    if (targetExists && !overwrite) {
      throw new VFSError('Target file already exists', 'EEXIST', normalizedDest);
    }
    if (targetExists) {
      const tStat = await targetVFS.stat(normalizedDest);
      if (tStat.isDirectory) {
        throw new VFSError('Target path is a directory', 'EISDIR', normalizedDest);
      }
    }

    // Make sure target directory exists
    const parentDir = targetVFS.dirname(normalizedDest);
    if (!(await targetVFS.exists(parentDir))) {
      await targetVFS.makeDirectory(parentDir, true);
    }

    // Copy file
    const data = await this.readFile(normalizedSrc, { encoding: 'binary' });
    await targetVFS.writeFile(normalizedDest, data, {
      create: true,
      encoding: 'binary'
    });
  }

  /**
   * Copy multiple files matching a pattern to a target directory
   *
   * @param sourcePattern - Source pattern (glob pattern, file path, or array of file paths)
   * @param targetDirectory - Target directory path
   * @param options - Copy options (can include targetVFS for cross-VFS copy)
   * @returns Copy operation result
   *
   * @example
   * ```typescript
   * // Copy all .txt files to backup directory
   * const result = await vfs.copyFileEx('/data/*.txt', '/backup');
   *
   * // Copy directory to different VFS
   * const result = await vfsA.copyFileEx('DirToCopy/**\/*', 'Foo/DirToCopy', {
   *   overwrite: true,
   *   targetVFS: vfsB
   * });
   *
   * // Copy specific files
   * const result = await vfs.copyFileEx(['/file1.txt', '/file2.txt'], '/backup');
   * ```
   */
  async copyFileEx(
    sourcePattern: string | string[],
    targetDirectory: string,
    options?: {
      cwd?: string;
      overwrite?: boolean;
      targetVFS?: VFS;
      onProgress?: (current: number, total: number) => void;
    }
  ) {
    // Detect if we are copying to mounted VFS
    const targetMount = this.getMountedVFS(targetDirectory);
    const targetVFS = options?.targetVFS ?? (targetMount ? targetMount.vfs : this);
    const overwrite = !!options?.overwrite;

    if (targetVFS._readOnly) {
      throw new VFSError('Target VFS is read-only', 'EROFS', targetDirectory);
    }

    try {
      const normalizedTargetDir = targetVFS.normalizePath(
        targetMount ? targetMount.relativePath : targetDirectory
      );

      // Make sure that target directory exists
      if (!(await targetVFS.exists(normalizedTargetDir))) {
        await targetVFS.makeDirectory(normalizedTargetDir, true);
      } else {
        const targetStat = await targetVFS.stat(normalizedTargetDir);
        if (!targetStat.isDirectory) {
          throw new VFSError('Target path is not a directory', 'ENOTDIR', normalizedTargetDir);
        }
      }

      // Calculate source file list
      let filesToCopy: string[] = [];
      if (Array.isArray(sourcePattern)) {
        filesToCopy = sourcePattern;
      } else {
        filesToCopy = await this.expandGlobPattern(sourcePattern, options?.cwd);
      }

      // Copy files
      let copied = 0;
      options?.onProgress?.(copied, filesToCopy.length);

      for (const sourcePath of filesToCopy) {
        try {
          if (!(await this.exists(sourcePath))) {
            console.warn(`Source file missing: ${sourcePath}`);
            continue;
          }

          const sourceStat = await this.stat(sourcePath);
          const targetFilePath = this.calculateTargetPath(sourcePattern, sourcePath, normalizedTargetDir);

          // Get relative mounted paths of target files
          const targetRel =
            targetMount?.vfs === targetVFS
              ? targetVFS.normalizePath(PathUtils.relative(targetMount.mountPath, targetFilePath))
              : targetFilePath;

          if (sourceStat.isDirectory) {
            await targetVFS.makeDirectory(targetRel, true);
            continue;
          }

          const exists = await targetVFS.exists(targetRel);
          if (exists && !overwrite) {
            continue;
          }

          const parent = targetVFS.dirname(targetRel);
          if (!(await targetVFS.exists(parent))) {
            await targetVFS.makeDirectory(parent, true);
          }

          const data = await this.readFile(sourcePath, { encoding: 'binary' });
          await targetVFS.writeFile(targetRel, data, {
            create: true,
            encoding: 'binary'
          });

          options?.onProgress?.(++copied, filesToCopy.length);
        } catch (err) {
          console.error(String(err));
        }
      }
    } catch (err) {
      console.error(String(err));
    }
  }

  /**
   * Query file list by matching pattern(s)
   * @param pattern - Matching pattern(s)
   * @param options - Matching options
   * @returns Informations of matching files
   */
  async glob(pattern: string | string[], options: GlobOptions = {}) {
    const {
      recursive = true,
      includeHidden = false,
      includeDirs = false,
      includeFiles = true,
      caseSensitive = true,
      cwd = this._cwd,
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
    const normalizedCwd = this.normalizePath(cwd);

    const searchDirectory = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (limit && results.length >= limit) {
        return;
      }

      try {
        const entries = await this.readDirectory(dirPath, {
          includeHidden: true
        });

        for (const entry of entries) {
          if (limit && results.length >= limit) {
            break;
          }

          const fullPath = entry.path;

          // Calculates the relative path about the search directory
          let relativePath: string;
          if (fullPath === normalizedCwd) {
            relativePath = '.';
          } else if (fullPath.startsWith(normalizedCwd + '/')) {
            relativePath = fullPath.substring(normalizedCwd.length + 1);
          } else if (normalizedCwd === '/' && fullPath.startsWith('/')) {
            relativePath = fullPath.substring(1);
          } else {
            // Skip if it is not under the search path
            continue;
          }

          // Filter hidden files
          if (!includeHidden && entry.name.startsWith('.')) {
            if (recursive && entry.type === 'directory') {
              await searchDirectory(fullPath, depth + 1);
            }
            continue;
          }

          // Test for ignore patterns
          const shouldIgnore = ignoreMatchers.some(
            (matcher) => matcher.test(relativePath) || matcher.test(fullPath)
          );
          if (shouldIgnore) {
            if (recursive && entry.type === 'directory') {
              await searchDirectory(fullPath, depth + 1);
            }
            continue;
          }

          let matched = false;
          let matchedPattern = '';

          for (const matcher of matchers) {
            if (matcher.test(relativePath) || matcher.test(fullPath)) {
              matched = true;
              matchedPattern = matcher.getPattern();
              break;
            }
          }

          if (entry.type === 'directory') {
            if (includeDirs) {
              const result: GlobResult = {
                ...entry,
                relativePath,
                matchedPattern: matched ? matchedPattern : null
              };
              results.push(result);
            }
          } else if (matched && includeFiles) {
            const result: GlobResult = {
              ...entry,
              relativePath,
              matchedPattern
            };
            results.push(result);
          }

          // Search sub-directorys recursively
          if (recursive && entry.type === 'directory') {
            await searchDirectory(fullPath, depth + 1);
          }
        }
      } catch (error) {
        if (depth === 0) {
          console.warn(`Cannot access directory: ${dirPath}`, error);
        }
      }
    };

    await searchDirectory(normalizedCwd);
    return results;
  }
  guessMIMEType(path: string) {
    const dataUriMatchResult = this.parseDataURI(path);
    if (dataUriMatchResult) {
      return dataUriMatchResult[1];
    } else {
      return guessMimeType(path);
    }
  }
  /**
   * Mounts another VFS at the specified path.
   *
   * Constraints/Behavior:
   * - Mount path can be an existing directory or non existing directory.
   * - Changes from child VFS will bubble to host namespace (path is rewritten with mount prefix)
   *
   * @param path - The path where to mount the VFS
   * @param vfs - The VFS instance to mount
   */
  async mount(path: string, vfs: VFS) {
    const normalizedPath = PathUtils.normalize(path);

    // Register mount
    this.simpleMounts.set(normalizedPath, vfs);
    this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b) => b.length - a.length);

    // Bubble child's events with host mount prefix
    const callback = (
      type: 'created' | 'deleted' | 'moved' | 'modified',
      subPath: string,
      itemType: 'file' | 'directory'
    ) => {
      const rel = subPath === '/' ? '' : subPath;
      const hostPath = PathUtils.normalize(PathUtils.join(normalizedPath, rel));
      this.onChange(type, hostPath, itemType);
    };
    this.mountChangeCallbacks.set(normalizedPath, callback);
    vfs.on('changed', callback, this);
  }
  /**
   * Unmounts a VFS from the specified path.
   *
   * Behavior:
   * - Removes the mount record.
   * - If the mount directory was auto-created by this VFS and `cleanupOnUnmount` is true,
   *   it will be removed only if it is still empty.
   *
   * @param path - The path to unmount
   * @returns True if a VFS was unmounted, false otherwise
   */
  async unmount(path: string) {
    const normalizedPath = PathUtils.normalize(path);
    const vfs = this.simpleMounts.get(normalizedPath);
    if (!vfs) {
      return false;
    }
    vfs.off('changed', this.mountChangeCallbacks.get(normalizedPath));
    this.simpleMounts.delete(normalizedPath);
    this.mountChangeCallbacks.delete(normalizedPath);

    // Rebuild sorted mount paths
    this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b) => b.length - a.length);

    return true;
  }
  /**
   * Closes file system and release resources
   */
  async close() {
    for (const path of this.simpleMounts.keys()) {
      await this.unmount(path);
    }
    await this.onClose();
  }
  /** @internal */
  protected setReadonly(readonly: boolean) {
    this._readOnly = !!readonly;
  }
  /** @internal */
  protected onClose(): Promise<void> | void {}
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
  protected getMountedVFS(path: string) {
    const normalizedPath = PathUtils.normalize(path);

    // Use sorted mount path so we can matching the longest path
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
   * VFS file changing event
   * @param type - Change type
   * @param path - File path that causes changing
   * @param itemType - File type
   */
  protected onChange(
    type: 'created' | 'deleted' | 'moved' | 'modified',
    path: string,
    itemType: 'file' | 'directory'
  ) {
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
  protected abstract _wipe(): Promise<void>;
  /**
   * Moves/renames a file or directory within the same VFS.
   * Implementation should avoid file copying and use metadata operations only.
   *
   * @param sourcePath - Source path (normalized)
   * @param targetPath - Target path (normalized)
   * @param options - Move options
   */
  protected abstract _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void>;
  /**
   * Calculate target file path preserving relative directory structure
   */
  private calculateTargetPath(sourcePattern: string | string[], sourcePath: string, targetDirectory: string) {
    if (Array.isArray(sourcePattern)) {
      // For explicit file list, just use filename
      const fileName = this.basename(sourcePath);
      return PathUtils.join(targetDirectory, fileName);
    }

    // For glob patterns, preserve relative structure
    const patternDir = this.extractPatternDirectory(sourcePattern);

    const normalizedPatternDir = this.normalizePath(patternDir);
    const normalizedSourcePath = this.normalizePath(sourcePath);

    if (normalizedSourcePath.startsWith(normalizedPatternDir)) {
      const relativePath = PathUtils.relative(normalizedPatternDir, normalizedSourcePath);
      return PathUtils.join(targetDirectory, relativePath);
    } else {
      // Fallback to just filename
      const fileName = this.basename(sourcePath);
      return PathUtils.join(targetDirectory, fileName);
    }
  }
  /**
   * Expand a glob pattern to a list of matching file paths
   */
  private async expandGlobPattern(pattern: string, cwd?: string) {
    const matchedFiles: string[] = [];

    if (pattern.includes('*') || pattern.includes('?')) {
      // It's a glob pattern - use existing glob method
      const globResults = await this.glob(pattern, {
        includeFiles: true,
        includeDirs: true,
        includeHidden: true,
        recursive: pattern.includes('**'),
        cwd: cwd ?? this._cwd
      });

      matchedFiles.push(...globResults.map((result) => result.path));
    } else {
      // It's a regular path
      const normalizedPattern = this.normalizePath(pattern);
      if (await this.exists(normalizedPattern)) {
        const stat = await this.stat(normalizedPattern);
        if (stat.isFile) {
          matchedFiles.push(normalizedPattern);
        }
      }
    }

    return matchedFiles;
  }

  /**
   * Extract the directory part from a glob pattern
   */
  private extractPatternDirectory(pattern: string) {
    // Process absolute path
    if (pattern.startsWith('/')) {
      const parts = pattern.substring(1).split('/'); // 移除开头的 /
      const dirParts: string[] = [];

      for (const part of parts) {
        if (part.includes('*') || part.includes('?')) {
          break;
        }
        dirParts.push(part);
      }

      if (dirParts.length === 0) {
        return '/';
      }

      return '/' + dirParts.join('/');
    } else {
      // Relative path
      const parts = pattern.split('/');
      const dirParts: string[] = [];

      for (const part of parts) {
        if (part.includes('*') || part.includes('?')) {
          break;
        }
        dirParts.push(part);
      }

      return dirParts.length > 0 ? dirParts.join('/') : '.';
    }
  }
  private _validateRootRestrictions(sourcePath: string, targetPath: string) {
    // Can not move root directory
    if (sourcePath === '/') {
      throw new VFSError('Cannot move root directory', 'EINVAL', sourcePath);
    }

    // Can not move to root directory
    if (targetPath === '/') {
      throw new VFSError('Cannot move to root directory', 'EINVAL', targetPath);
    }

    // Can not move to sub-directory of source path
    if (targetPath.startsWith(sourcePath + '/')) {
      throw new VFSError('Cannot move directory to its subdirectory', 'EINVAL', sourcePath);
    }

    const cwd = this.getCwd();

    // Moving CWD is not allowed
    if (sourcePath === cwd) {
      throw new VFSError('Cannot move current working directory', 'EBUSY', sourcePath);
    }

    // Moving parent directory of CWD is not allowed
    if (cwd.startsWith(sourcePath + '/')) {
      throw new VFSError('Cannot move parent directory of current working directory', 'EBUSY', sourcePath);
    }
  }

  private injectDirectMountDirs(dirPath: string, entries: FileMetadata[], options?: ListOptions) {
    const existing = new Set(entries.map((e) => e.name));
    const parentPrefix = dirPath === '/' ? '/' : dirPath + '/';

    for (const mountPath of this.simpleMounts.keys()) {
      if (!mountPath.startsWith(parentPrefix)) {
        continue;
      }
      if (mountPath === dirPath) {
        continue;
      }

      const remainder = mountPath.slice(parentPrefix.length);
      if (remainder.length === 0) {
        continue;
      }

      if (remainder.includes('/')) {
        continue;
      }

      const name = remainder;

      if (existing.has(name)) {
        continue;
      }
      if (options?.includeHidden === false && name.startsWith('.')) {
        continue;
      }

      const meta: FileMetadata = {
        name,
        path: PathUtils.normalize(PathUtils.join(dirPath, name)),
        size: 0,
        type: 'directory',
        created: new Date(0),
        modified: new Date(0)
      };
      entries.push(meta);
      existing.add(name);
    }
    return entries;
  }
  private async _validateTypeCompatibility(sourcePath: string, targetPath: string, options?: MoveOptions) {
    const sourceExists = await this.exists(sourcePath);
    if (!sourceExists) {
      throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
    }

    const sourceStat = await this.stat(sourcePath);

    // Test existence of target path
    const targetExists = await this.exists(targetPath);
    if (targetExists) {
      if (!options?.overwrite) {
        throw new VFSError('Target already exists', 'EEXIST', targetPath);
      }

      const targetStat = await this.stat(targetPath);

      // Must be same type
      if (sourceStat.isFile !== targetStat.isFile || sourceStat.isDirectory !== targetStat.isDirectory) {
        throw new VFSError('Cannot move file to directory or directory to file', 'EISDIR', sourcePath);
      }
    }
  }
}
