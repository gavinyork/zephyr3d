import { base64ToUint8Array, uint8ArrayToBase64 } from '../utils';
import { PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, MoveOptions, ReadOptions, WriteOptions } from './vfs';
import { VFS, VFSError } from './vfs';

/**
 * IndexedDB-based file system implementation.
 *
 * Provides a virtual file system interface using IndexedDB as the underlying storage.
 * Supports standard file operations like create, read, write, delete, and directory listing.
 *
 * @example
 * ```typescript
 * const fs = new IndexedDBFS('my-app-fs');
 * await fs.writeFile('/hello.txt', 'Hello World!');
 * const content = await fs.readFile('/hello.txt', { encoding: 'utf8' });
 * ```
 *
 * @public
 */
export class IndexedDBFS extends VFS {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly storeName: string;

  /**
   * Creates a new IndexedDB file system.
   *
   * @param dbName - The name of the IndexedDB database to use
   * @param readonly - Whether the file system should be read-only
   */
  constructor(dbName: string, storeName: string, readonly = false) {
    super(readonly);
    this.dbName = dbName;
    this.storeName = storeName;
  }

  protected async _makeDirectory(path: string, recursive: boolean): Promise<void> {
    const parent = PathUtils.dirname(path);

    // Ensure parent directories outside the transaction
    if (parent !== '/' && parent !== path) {
      const parentExists = await this._exists(parent);
      if (!parentExists) {
        if (recursive) {
          await this._makeDirectory(parent, true);
        } else {
          throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
        }
      }
    }

    // Making directory in a transaction
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Test existence
      const existsRequest = store.get(path);
      existsRequest.onsuccess = () => {
        const existing = existsRequest.result;
        if (existing) {
          if (existing.type === 'directory') {
            resolve();
            return;
          } else {
            reject(new VFSError('File exists with same name', 'EEXIST', path));
            return;
          }
        }

        // Create directory
        const now = new Date();
        const metadata = {
          name: PathUtils.basename(path),
          path: path,
          size: 0,
          type: 'directory',
          created: now,
          modified: now,
          parent: PathUtils.dirname(path),
          data: null
        };

        const addRequest = store.add(metadata);
        addRequest.onsuccess = () => resolve();
        addRequest.onerror = () => reject(new VFSError('Failed to create directory', 'EIO', path));
      };

      existsRequest.onerror = () => reject(new VFSError('Failed to check directory existence', 'EIO', path));
    });
  }

  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    return this.dbOperation('readonly', (store) => {
      return new Promise<FileMetadata[]>((resolve, reject) => {
        // Test directory existence
        const dirCheck = store.get(path);
        dirCheck.onsuccess = () => {
          const dirRecord = dirCheck.result;
          if (!dirRecord || dirRecord.type !== 'directory') {
            reject(new VFSError('Directory does not exist', 'ENOENT', path));
            return;
          }

          const results: FileMetadata[] = [];
          const index = store.index('parent');

          if (options?.recursive) {
            const request = store.openCursor();
            request.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
              if (cursor) {
                const record = cursor.value;
                const recordPath = record.path as string;

                if (recordPath !== path && (recordPath.startsWith(path + '/') || record.parent === path)) {
                  const metadata: FileMetadata = {
                    name: record.name,
                    path: recordPath,
                    size: record.size,
                    type: record.type,
                    created: new Date(record.created),
                    modified: new Date(record.modified)
                  };

                  if (this.matchesFilter(metadata, options)) {
                    results.push(metadata);
                  }
                }
                cursor.continue();
              } else {
                resolve(results);
              }
            };
            request.onerror = () => reject(request.error);
          } else {
            const request = index.openCursor(IDBKeyRange.only(path));
            request.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
              if (cursor) {
                const record = cursor.value;
                const metadata: FileMetadata = {
                  name: record.name,
                  path: record.path,
                  size: record.size,
                  type: record.type,
                  created: new Date(record.created),
                  modified: new Date(record.modified)
                };

                if (this.matchesFilter(metadata, options)) {
                  results.push(metadata);
                }
                cursor.continue();
              } else {
                resolve(results);
              }
            };
            request.onerror = () => reject(request.error);
          }
        };
        dirCheck.onerror = () => reject(dirCheck.error);
      });
    });
  }

  protected async _deleteDirectory(path: string, recursive: boolean): Promise<void> {
    const children = await this._readDirectory(path);

    if (children.length > 0 && !recursive) {
      throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
    }

    if (recursive && children.length > 0) {
      for (const child of children) {
        if (child.type === 'directory') {
          await this._deleteDirectory(child.path, true);
        } else {
          await this._deleteFile(child.path);
        }
      }
    }

    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const dirCheck = store.get(path);
        dirCheck.onsuccess = () => {
          const dirRecord = dirCheck.result;
          if (!dirRecord || dirRecord.type !== 'directory') {
            reject(new VFSError('Directory does not exist', 'ENOENT', path));
            return;
          }

          const deleteRequest = store.delete(path);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(new VFSError('Failed to delete directory', 'EIO', path));
        };
        dirCheck.onerror = () => reject(dirCheck.error);
      });
    });
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    return this.dbOperation('readonly', (store) => {
      return new Promise<ArrayBuffer | string>((resolve, reject) => {
        const request = store.get(path);
        request.onsuccess = () => {
          const record = request.result;
          if (!record || record.type !== 'file') {
            reject(new VFSError(`File does not exist: ${path}`, 'ENOENT', path));
            return;
          }

          let data = record.data;
          const requestedEncoding = options?.encoding;

          // Encoding conversion
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

          resolve(data);
        };
        request.onerror = () => reject(new VFSError('Failed to read file', 'EIO', path));
      });
    });
  }

  protected async _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void> {
    const parent = PathUtils.dirname(path);

    if (parent !== '/') {
      const parentExists = await this._exists(parent);
      if (!parentExists) {
        if (options?.create) {
          await this._makeDirectory(parent, true);
        } else {
          throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
        }
      }
    }

    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const existingRequest = store.get(path);
        existingRequest.onsuccess = () => {
          const existingRecord = existingRequest.result;
          let fileData: ArrayBuffer | string = data;

          if (options?.append && existingRecord && existingRecord.type === 'file') {
            const existingData = existingRecord.data;

            if (typeof data === 'string' && typeof existingData === 'string') {
              fileData = existingData + data;
            } else if (data instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
              const combined = new Uint8Array(existingData.byteLength + data.byteLength);
              combined.set(new Uint8Array(existingData), 0);
              combined.set(new Uint8Array(data), existingData.byteLength);
              fileData = combined.buffer;
            } else {
              const existingStr =
                existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
              const newStr = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : data;
              fileData = existingStr + newStr;
            }
          }

          if (options?.encoding === 'base64' && typeof fileData === 'string') {
            try {
              const bytes = base64ToUint8Array(fileData);
              fileData = bytes.buffer;
            } catch {
              reject(new VFSError('Invalid base64 data', 'EINVAL', path));
              return;
            }
          }

          const size =
            typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength;

          const now = new Date();
          const created = existingRecord ? new Date(existingRecord.created) : now;

          const record = {
            name: PathUtils.basename(path),
            path: path,
            size: size,
            type: 'file' as const,
            created: created,
            modified: now,
            parent: parent,
            data: fileData
          };

          const saveRequest = existingRecord ? store.put(record) : store.add(record);
          saveRequest.onsuccess = () => resolve();
          saveRequest.onerror = () =>
            reject(new VFSError(`Failed to ${existingRecord ? 'update' : 'create'} file`, 'EIO', path));
        };

        existingRequest.onerror = () => reject(new VFSError('Failed to check existing file', 'EIO', path));
      });
    });
  }

  protected async _deleteFile(path: string): Promise<void> {
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // Test file existence
        const checkRequest = store.get(path);
        checkRequest.onsuccess = () => {
          const record = checkRequest.result;
          if (!record || record.type !== 'file') {
            reject(new VFSError(`File does not exist: ${path}`, 'ENOENT', path));
            return;
          }

          const deleteRequest = store.delete(path);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(new VFSError('Failed to delete file', 'EIO', path));
        };
        checkRequest.onerror = () => reject(new VFSError('Failed to check file existence', 'EIO', path));
      });
    });
  }

  protected async _exists(path: string): Promise<boolean> {
    return this.dbOperation('readonly', (store) => {
      return new Promise<boolean>((resolve, reject) => {
        const request = store.get(path);
        request.onsuccess = () => {
          resolve(!!request.result);
        };
        request.onerror = () => reject(new VFSError('Failed to check existence', 'EIO', path));
      });
    });
  }

  protected async _stat(path: string): Promise<FileStat> {
    return this.dbOperation('readonly', (store) => {
      return new Promise<FileStat>((resolve, reject) => {
        const request = store.get(path);
        request.onsuccess = () => {
          const record = request.result;
          if (!record) {
            reject(new VFSError('Path does not exist', 'ENOENT', path));
            return;
          }

          resolve({
            size: record.size,
            isFile: record.type === 'file',
            isDirectory: record.type === 'directory',
            created: new Date(record.created),
            modified: new Date(record.modified),
            accessed: new Date(record.modified) // IndexedDB 不跟踪访问时间，使用修改时间
          });
        };
        request.onerror = () => reject(new VFSError('Failed to get file stats', 'EIO', path));
      });
    });
  }

  protected async onClose() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  static async deleteDatabase(name: string) {
    return new Promise<void>((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(name);

      deleteRequest.onsuccess = () => {
        resolve();
      };

      deleteRequest.onerror = () => {
        console.error(`Delete database "${name}" failed:`, deleteRequest.error);
        reject(deleteRequest.error);
      };

      deleteRequest.onblocked = () => {
        console.warn(`Delete database "${name}" blocked`);
      };
    });
  }

  protected async _wipe(): Promise<void> {
    await this.close();
    await IndexedDBFS.deleteDatabase(this.dbName);
  }
  protected async _deleteFileSystem(): Promise<void> {
    await this.close();
    const currentVersion = await this.getCurrentDatabaseVersion();
    return new Promise((resolve, reject) => {
      const newVersion = currentVersion + 1;
      const request = indexedDB.open(this.dbName, newVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (db.objectStoreNames.contains(this.storeName)) {
          try {
            db.deleteObjectStore(this.storeName);
          } catch (error) {
            console.error(`Failed to delete Object Store '${this.storeName}':`, error);
            reject(new VFSError('Failed to delete object store', 'EIO', error?.toString()));
            return;
          }
        } else {
          console.warn(`Object Store '${this.storeName}' does not exist`);
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.close();
        resolve();
      };

      request.onerror = () => {
        reject(new VFSError('Failed to upgrade database for store deletion', 'EIO', request.error?.message));
      };

      request.onblocked = () => {
        reject(new VFSError('Database upgrade blocked - close other connections first', 'EBUSY'));
      };
    });
  }

  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const sourceRequest = store.get(sourcePath);

        sourceRequest.onsuccess = () => {
          const sourceRecord = sourceRequest.result;
          if (!sourceRecord) {
            reject(new VFSError('Source path does not exist', 'ENOENT', sourcePath));
            return;
          }

          const targetRequest = store.get(targetPath);

          targetRequest.onsuccess = () => {
            const targetRecord = targetRequest.result;
            if (targetRecord && !options?.overwrite) {
              reject(new VFSError('Target already exists', 'EEXIST', targetPath));
              return;
            }

            const targetParent = PathUtils.dirname(targetPath);
            const parentRequest = store.get(targetParent);

            parentRequest.onsuccess = () => {
              const parentRecord = parentRequest.result;
              if (!parentRecord || parentRecord.type !== 'directory') {
                reject(new VFSError('Target parent directory does not exist', 'ENOENT', targetParent));
                return;
              }

              if (sourceRecord.type === 'file') {
                this.moveFile(store, sourceRecord, targetPath, targetRecord, options, resolve, reject);
              } else if (sourceRecord.type === 'directory') {
                this.moveDirectory(
                  store,
                  sourcePath,
                  targetPath,
                  sourceRecord,
                  targetRecord,
                  options,
                  resolve,
                  reject
                );
              }
            };

            parentRequest.onerror = () => {
              reject(new VFSError('Failed to check target parent directory', 'EIO', targetParent));
            };
          };

          targetRequest.onerror = () => {
            reject(new VFSError('Failed to check target existence', 'EIO', targetPath));
          };
        };

        sourceRequest.onerror = () => {
          reject(new VFSError('Failed to check source existence', 'EIO', sourcePath));
        };
      });
    });
  }

  private moveFile(
    store: IDBObjectStore,
    sourceRecord: any,
    targetPath: string,
    targetRecord: any,
    options: MoveOptions | undefined,
    resolve: () => void,
    reject: (error: VFSError) => void
  ): void {
    const now = new Date();

    const newRecord = {
      ...sourceRecord,
      name: PathUtils.basename(targetPath),
      path: targetPath,
      parent: PathUtils.dirname(targetPath),
      modified: now
    };

    const handleUpdate = (): void => {
      const addRequest = store.put(newRecord);
      addRequest.onsuccess = () => {
        const deleteRequest = store.delete(sourceRecord.path);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => {
          reject(new VFSError('Failed to delete source file', 'EIO', sourceRecord.path));
        };
      };
      addRequest.onerror = () => {
        reject(new VFSError('Failed to create target file', 'EIO', targetPath));
      };
    };

    if (targetRecord && options?.overwrite) {
      const deleteTargetRequest = store.delete(targetPath);
      deleteTargetRequest.onsuccess = handleUpdate;
      deleteTargetRequest.onerror = () => {
        reject(new VFSError('Failed to delete target file', 'EIO', targetPath));
      };
    } else {
      handleUpdate();
    }
  }

  private moveDirectory(
    store: IDBObjectStore,
    sourcePath: string,
    targetPath: string,
    sourceRecord: any,
    targetRecord: any,
    options: MoveOptions | undefined,
    resolve: () => void,
    reject: (error: VFSError) => void
  ): void {
    const itemsToMove: any[] = [];
    const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';

    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        const record = cursor.value;
        const recordPath = record.path as string;

        if (recordPath === sourcePath || recordPath.startsWith(sourcePrefix)) {
          itemsToMove.push(record);
        }

        cursor.continue();
      } else {
        this.performDirectoryMove(
          store,
          itemsToMove,
          sourcePath,
          targetPath,
          targetRecord,
          options,
          resolve,
          reject
        );
      }
    };

    cursorRequest.onerror = () => {
      reject(new VFSError('Failed to scan directory contents', 'EIO', sourcePath));
    };
  }

  private performDirectoryMove(
    store: IDBObjectStore,
    itemsToMove: any[],
    sourcePath: string,
    targetPath: string,
    targetRecord: any,
    options: MoveOptions | undefined,
    resolve: () => void,
    reject: (error: VFSError) => void
  ): void {
    if (itemsToMove.length === 0) {
      resolve();
      return;
    }

    const now = new Date();
    const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
    const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';

    let processed = 0;
    let hasError = false;

    const processMove = (): void => {
      for (const item of itemsToMove) {
        if (hasError) {
          break;
        }

        const oldPath = item.path;
        let newPath: string;

        if (oldPath === sourcePath) {
          newPath = targetPath;
        } else {
          newPath = oldPath.replace(sourcePrefix, targetPrefix);
        }

        const newRecord = {
          ...item,
          name: PathUtils.basename(newPath),
          path: newPath,
          parent: PathUtils.dirname(newPath),
          modified: now
        };

        const addRequest = store.put(newRecord);

        addRequest.onsuccess = () => {
          const deleteRequest = store.delete(oldPath);

          deleteRequest.onsuccess = () => {
            processed++;
            if (processed === itemsToMove.length) {
              resolve();
            }
          };

          deleteRequest.onerror = () => {
            if (!hasError) {
              hasError = true;
              reject(new VFSError(`Failed to delete source item: ${oldPath}`, 'EIO', oldPath));
            }
          };
        };

        addRequest.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(new VFSError(`Failed to create target item: ${newPath}`, 'EIO', newPath));
          }
        };
      }
    };

    if (targetRecord && options?.overwrite) {
      this.deleteDirectoryContents(
        store,
        targetPath,
        () => {
          processMove();
        },
        reject
      );
    } else {
      processMove();
    }
  }

  private deleteDirectoryContents(
    store: IDBObjectStore,
    dirPath: string,
    onSuccess: () => void,
    onError: (error: VFSError) => void
  ): void {
    const itemsToDelete: string[] = [];
    const dirPrefix = dirPath === '/' ? '/' : dirPath + '/';

    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        const record = cursor.value;
        const recordPath = record.path as string;

        if (recordPath === dirPath || recordPath.startsWith(dirPrefix)) {
          itemsToDelete.push(recordPath);
        }

        cursor.continue();
      } else {
        if (itemsToDelete.length === 0) {
          onSuccess();
          return;
        }

        let deleted = 0;
        let hasError = false;

        for (const pathToDelete of itemsToDelete) {
          if (hasError) {
            break;
          }

          const deleteRequest = store.delete(pathToDelete);

          deleteRequest.onsuccess = () => {
            deleted++;
            if (deleted === itemsToDelete.length) {
              onSuccess();
            }
          };

          deleteRequest.onerror = () => {
            if (!hasError) {
              hasError = true;
              onError(new VFSError(`Failed to delete existing item: ${pathToDelete}`, 'EIO', pathToDelete));
            }
          };
        }
      }
    };

    cursorRequest.onerror = () => {
      onError(new VFSError('Failed to scan existing directory contents', 'EIO', dirPath));
    };
  }

  private async getCurrentDatabaseVersion(): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName);

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const version = db.version;
        db.close();
        resolve(version);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to get database version', 'EIO', request.error?.message));
      };
    });
  }
  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    const { version, storeExists } = await this.getDatabaseInfo();

    if (storeExists) {
      this.db = await this.openDatabase(version);
      await this.ensureRootDirectoryAsync();
      return this.db;
    } else {
      this.db = await this.createObjectStoreAsync(version + 1);
      return this.db;
    }
  }

  private async getDatabaseInfo(): Promise<{ version: number; storeExists: boolean }> {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName);

      request.onsuccess = (event) => {
        const tempDb = (event.target as IDBOpenDBRequest).result;
        const version = tempDb.version;
        const storeExists = tempDb.objectStoreNames.contains(this.storeName);
        tempDb.close();
        resolve({ version, storeExists });
      };

      request.onerror = () => {
        resolve({ version: 0, storeExists: false });
      };
      request.onupgradeneeded = (event) => {
        const tempDb = (event.target as IDBOpenDBRequest).result;
        const version = tempDb.version;
        const storeExists = tempDb.objectStoreNames.contains(this.storeName);
        tempDb.close();
        resolve({ version, storeExists });
      };
    });
  }

  private async openDatabase(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, version);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to open existing database', 'ENOENT'));
      };

      request.onblocked = () => {
        reject(new VFSError('Database open blocked', 'EBUSY'));
      };
    });
  }

  private async createObjectStoreAsync(newVersion: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, newVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        try {
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'path' });
            store.createIndex('type', 'type', { unique: false });
            store.createIndex('parent', 'parent', { unique: false });
            store.createIndex('name', 'name', { unique: false });

            const now = new Date();
            const rootDir = {
              name: '',
              path: '/',
              size: 0,
              type: 'directory',
              created: now,
              modified: now,
              parent: '',
              data: null
            };

            store.add(rootDir);
          }
        } catch (error) {
          console.error(`Failed to create Object Store '${this.storeName}':`, error);
          reject(new VFSError('Failed to create object store', 'EIO', error?.toString()));
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to create database/object store', 'EIO', request.error?.message));
      };

      request.onblocked = () => {
        reject(new VFSError('Database creation blocked - close other connections first', 'EBUSY'));
      };
    });
  }

  private async ensureRootDirectoryAsync(): Promise<void> {
    if (!this.db) {
      throw new VFSError('Database not available', 'EIO');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const checkRequest = store.get('/');

      checkRequest.onsuccess = () => {
        if (!checkRequest.result) {
          const now = new Date();
          const rootDir = {
            name: '',
            path: '/',
            size: 0,
            type: 'directory',
            created: now,
            modified: now,
            parent: '',
            data: null
          };

          const addRequest = store.add(rootDir);
          addRequest.onsuccess = () => {
            resolve();
          };
          addRequest.onerror = () => {
            reject(new VFSError('Failed to create root directory', 'EIO'));
          };
        } else {
          resolve();
        }
      };

      checkRequest.onerror = () => {
        reject(new VFSError('Failed to check root directory', 'EIO'));
      };

      transaction.onerror = () => {
        reject(new VFSError('Failed to check/create root directory', 'EIO', transaction.error?.message));
      };

      transaction.onabort = () => {
        reject(new VFSError('Transaction aborted while checking root directory', 'EIO'));
      };
    });
  }
  private async dbOperation<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest | Promise<T>
  ): Promise<T> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], mode);
      const store = transaction.objectStore(this.storeName);

      transaction.onerror = () =>
        reject(new VFSError('Transaction failed', 'EACCES', transaction.error?.message));

      transaction.onabort = () => reject(new VFSError('Transaction aborted', 'EABORT'));

      transaction.oncomplete = () => {};

      const result = operation(store);

      if (result instanceof Promise) {
        result.then(resolve).catch(reject);
      } else if (result instanceof IDBRequest) {
        result.onsuccess = () => {
          resolve(result.result);
        };
        result.onerror = () => reject(new VFSError('Operation failed', 'EIO', result.error?.message));
      } else {
        resolve(result);
      }
    });
  }

  private matchesFilter(metadata: FileMetadata, options?: ListOptions): boolean {
    if (!options) {
      return true;
    }

    if (!options.includeHidden && metadata.name.startsWith('.')) {
      return false;
    }

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
