import type { FileMetadata, FileStat, ListOptions, MoveOptions, ReadOptions, WriteOptions } from '@zephyr3d/base';
import { PathUtils, VFS, VFSError } from '@zephyr3d/base';
import { getDesktopAPI, type DesktopFileMetadata, type DesktopFileStat, type DesktopFSScope } from './desktop';

export class ElectronFS extends VFS {
  private readonly scope: DesktopFSScope;

  constructor(scope: DesktopFSScope, readonly = false) {
    super(readonly);
    this.scope = scope;
  }

  protected async _makeDirectory(path: string, recursive: boolean) {
    await this.api().makeDirectory(this.scope, path, recursive);
  }

  protected async _readDirectory(path: string, options?: ListOptions) {
    const entries = await this.api().readDirectory(this.scope, path, {
      recursive: !!options?.recursive
    });
    return entries.map((entry) => this.toFileMetadata(entry)).filter((entry) => this.matchesFilter(entry, options));
  }

  protected async _deleteDirectory(path: string, recursive: boolean) {
    await this.api().deleteDirectory(this.scope, path, recursive);
  }

  protected async _readFile(path: string, options?: ReadOptions) {
    return await this.api().readFile(this.scope, path, options);
  }

  protected async _writeFile(path: string, data: ArrayBuffer | string, options?: WriteOptions) {
    await this.api().writeFile(this.scope, path, data, options);
  }

  protected async _deleteFile(path: string) {
    await this.api().deleteFile(this.scope, path);
  }

  protected async _exists(path: string) {
    return await this.api().exists(this.scope, path);
  }

  protected async _stat(path: string) {
    return this.toFileStat(await this.api().stat(this.scope, path));
  }

  protected async _deleteFileSystem() {
    await this.api().deleteScope(this.scope);
  }

  protected async _wipe() {
    await this._deleteFileSystem();
  }

  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions) {
    await this.api().move(this.scope, sourcePath, targetPath, options);
  }

  private api() {
    const api = getDesktopAPI()?.fs;
    if (!api) {
      throw new VFSError('Electron filesystem bridge is not available', 'ENOSYS');
    }
    return api;
  }

  private toFileMetadata(entry: DesktopFileMetadata): FileMetadata {
    return {
      ...entry,
      created: new Date(entry.created),
      modified: new Date(entry.modified)
    };
  }

  private toFileStat(stat: DesktopFileStat): FileStat {
    return {
      ...stat,
      created: new Date(stat.created),
      modified: new Date(stat.modified),
      accessed: stat.accessed ? new Date(stat.accessed) : undefined
    };
  }

  private matchesFilter(metadata: FileMetadata, options?: ListOptions) {
    if (!options) {
      return true;
    }
    if (!options.includeHidden && metadata.name.startsWith('.')) {
      return false;
    }
    if (options.pattern) {
      const relativePath = metadata.path.startsWith('/') ? metadata.path.slice(1) : metadata.path;
      if (typeof options.pattern === 'string') {
        return metadata.name.includes(options.pattern) || relativePath.includes(options.pattern);
      }
      return options.pattern.test(metadata.name) || options.pattern.test(relativePath);
    }
    return true;
  }
}

export function createElectronProjectFS(uuid: string) {
  return new ElectronFS(`project:${PathUtils.sanitizeFilename(uuid)}`);
}
