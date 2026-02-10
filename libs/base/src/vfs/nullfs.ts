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

  protected async _makeDirectory() {}

  protected async _readDirectory() {
    return [];
  }

  protected async _deleteDirectory() {}

  protected async _readFile(path: string): Promise<ArrayBuffer | string> {
    throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
  }

  protected async _writeFile() {}

  protected async _deleteFile() {}

  protected async _exists(path: string) {
    return path === '/';
  }

  protected async _stat(path: string) {
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
  protected async _deleteFileSystem() {
    return;
  }
  protected async _wipe() {
    return;
  }
  protected async _move() {}
}
