import type { FileMetadata, FileStat } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * Null file system.
 *
 * @public
 */
export class NullVFS extends VFS {
  private _dt: Date;
  constructor(readonly = false) {
    super(readonly);
    this._dt = new Date();
  }

  protected async _makeDirectory(): Promise<void> {}

  protected async _readDirectory(): Promise<FileMetadata[]> {
    return [];
  }

  protected async _deleteDirectory(): Promise<void> {}

  protected async _readFile(path: string): Promise<ArrayBuffer | string> {
    throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
  }

  protected async _writeFile(): Promise<void> {}

  protected async _deleteFile(): Promise<void> {}

  protected async _exists(path: string): Promise<boolean> {
    return path === '/';
  }

  protected async _stat(path: string): Promise<FileStat> {
    if (path === '/') {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: this._dt,
        modified: this._dt
      };
    }
    throw new VFSError('Path does not exist', 'ENOENT', path);
  }
  protected async _deleteFileSystem(): Promise<void> {
    return;
  }
  protected async _wipe(): Promise<void> {
    return;
  }
  protected async _move(): Promise<void> {}
}
