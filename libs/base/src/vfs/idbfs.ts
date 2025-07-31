import { guessMimeType, PathUtils } from './common';
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
    super(dbName, readonly);
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async ensureDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    try {
      // 获取数据库信息
      const { version, storeExists } = await this.getDatabaseInfo();

      if (storeExists) {
        // 表已存在，直接打开数据库
        this.db = await this.openDatabase(version);
        await this.ensureRootDirectoryAsync();
        return this.db;
      } else {
        // 表不存在，需要升级数据库版本来创建表
        this.db = await this.createObjectStoreAsync(version + 1);
        return this.db;
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取数据库信息
   */
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
        // 数据库不存在
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

  /**
   * 打开数据库
   */
  private async openDatabase(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, version);

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to open existing database', 'ENOENT'));
      };

      request.onblocked = (ev) => {
        reject(new VFSError('Database open blocked', 'EBUSY'));
      };
    });
  }

  /**
   * 异步创建 Object Store
   */
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

            // 在升级事务中创建根目录
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

      request.onblocked = (ev) => {
        reject(new VFSError('Database creation blocked - close other connections first', 'EBUSY'));
      };
    });
  }

  /**
   * 异步确保根目录存在
   */
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
          // 根目录不存在，创建它
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
  /**
   * 通用数据库操作方法
   */
  private async dbOperation<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest | Promise<T>
  ): Promise<T> {
    // 先确保数据库准备好
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], mode);
      const store = transaction.objectStore(this.storeName);

      transaction.onerror = () =>
        reject(new VFSError('Transaction failed', 'EACCES', transaction.error?.message));

      transaction.onabort = () => reject(new VFSError('Transaction aborted', 'EABORT'));

      // 添加完成监听器确保事务完成
      transaction.oncomplete = () => {
        // 如果操作返回的是简单值，在这里resolve
      };

      const result = operation(store);

      if (result instanceof Promise) {
        result.then(resolve).catch(reject);
      } else if (result instanceof IDBRequest) {
        result.onsuccess = () => {
          resolve(result.result);
        };
        result.onerror = () => reject(new VFSError('Operation failed', 'EIO', result.error?.message));
      } else {
        // 同步操作
        resolve(result);
      }
    });
  }

  /**
   * 匹配过滤器
   */
  private matchesFilter(metadata: FileMetadata, options?: ListOptions): boolean {
    if (!options) {
      return true;
    }

    // 隐藏文件过滤
    if (!options.includeHidden && metadata.name.startsWith('.')) {
      return false;
    }

    // 模式匹配
    if (options.pattern) {
      if (typeof options.pattern === 'string') {
        return metadata.name.includes(options.pattern);
      } else if (options.pattern instanceof RegExp) {
        return options.pattern.test(metadata.name);
      }
    }

    return true;
  }

  protected async _makeDirectory(path: string, recursive: boolean): Promise<void> {
    const parent = PathUtils.dirname(path);

    // 1. 先在事务外检查和创建父目录
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

    // 2. 在事务中处理目录创建
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // 检查目录是否已存在
      const existsRequest = store.get(path);
      existsRequest.onsuccess = () => {
        const existing = existsRequest.result;
        if (existing) {
          if (existing.type === 'directory') {
            resolve(); // 目录已存在，直接返回
            return;
          } else {
            reject(new VFSError('File exists with same name', 'EEXIST', path));
            return;
          }
        }

        // 创建目录
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
        // 首先检查目录是否存在
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
            // 递归列出所有子项
            const request = store.openCursor();
            request.onsuccess = (event) => {
              const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
              if (cursor) {
                const record = cursor.value;
                const recordPath = record.path as string;

                // 检查是否是子路径（包括间接子路径）
                if (recordPath !== path && (recordPath.startsWith(path + '/') || record.parent === path)) {
                  const metadata: FileMetadata = {
                    name: record.name,
                    path: recordPath,
                    size: record.size,
                    type: record.type,
                    created: new Date(record.created),
                    modified: new Date(record.modified),
                    mimeType: record.mimeType
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
            // 只列出直接子项
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
                  modified: new Date(record.modified),
                  mimeType: record.mimeType
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
    // 1. 先在事务外检查目录内容
    const children = await this._readDirectory(path);

    if (children.length > 0 && !recursive) {
      throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
    }

    // 2. 如果需要递归删除，先删除所有子项
    if (recursive && children.length > 0) {
      for (const child of children) {
        if (child.type === 'directory') {
          await this._deleteDirectory(child.path, true);
        } else {
          await this._deleteFile(child.path);
        }
      }
    }

    // 3. 在事务中删除目录本身
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // 检查目录是否存在
        const dirCheck = store.get(path);
        dirCheck.onsuccess = () => {
          const dirRecord = dirCheck.result;
          if (!dirRecord || dirRecord.type !== 'directory') {
            reject(new VFSError('Directory does not exist', 'ENOENT', path));
            return;
          }

          // 删除目录本身
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
            reject(new VFSError('File does not exist', 'ENOENT', path));
            return;
          }

          let data = record.data;

          // 处理编码转换
          if (options?.encoding === 'utf8' && data instanceof ArrayBuffer) {
            data = new TextDecoder().decode(data);
          } else if (options?.encoding === 'base64') {
            if (data instanceof ArrayBuffer) {
              const bytes = new Uint8Array(data);
              data = btoa(String.fromCodePoint(...bytes));
            } else if (typeof data === 'string') {
              data = btoa(data);
            }
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

    // 1. 先在事务外处理父目录检查和创建
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

    // 2. 在事务中处理文件写入
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // 检查现有文件
        const existingRequest = store.get(path);
        existingRequest.onsuccess = () => {
          const existingRecord = existingRequest.result;
          let fileData: ArrayBuffer | string = data;

          // 处理追加模式
          if (options?.append && existingRecord && existingRecord.type === 'file') {
            const existingData = existingRecord.data;

            if (typeof data === 'string' && typeof existingData === 'string') {
              fileData = existingData + data;
            } else if (data instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
              // 合并两个 ArrayBuffer
              const combined = new Uint8Array(existingData.byteLength + data.byteLength);
              combined.set(new Uint8Array(existingData), 0);
              combined.set(new Uint8Array(data), existingData.byteLength);
              fileData = combined.buffer;
            } else {
              // 类型不匹配，转换为统一类型
              const existingStr =
                existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
              const newStr = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : data;
              fileData = existingStr + newStr;
            }
          }

          // 处理编码
          if (options?.encoding === 'base64' && typeof fileData === 'string') {
            try {
              const binaryString = atob(fileData);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.codePointAt(i);
              }
              fileData = bytes.buffer;
            } catch (_error) {
              reject(new VFSError('Invalid base64 data', 'EINVAL', path));
              return;
            }
          }

          // 计算文件大小
          const size =
            typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength;

          const now = new Date();
          const created = existingRecord ? new Date(existingRecord.created) : now;

          // 创建文件记录
          const record = {
            name: PathUtils.basename(path),
            path: path,
            size: size,
            type: 'file' as const,
            created: created,
            modified: now,
            parent: parent,
            data: fileData,
            mimeType: guessMimeType(path)
          };

          // 保存文件
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
        // 首先检查文件是否存在
        const checkRequest = store.get(path);
        checkRequest.onsuccess = () => {
          const record = checkRequest.result;
          if (!record || record.type !== 'file') {
            reject(new VFSError('File does not exist', 'ENOENT', path));
            return;
          }

          // 删除文件
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

  /**
   * 清空整个文件系统
   */
  async clear(): Promise<void> {
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new VFSError('Failed to clear file system', 'EIO'));
      });
    });
  }

  /**
   * 获取文件系统使用情况统计
   */
  async getUsageStats(): Promise<{
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    storageQuota?: number;
    usedStorage?: number;
  }> {
    return this.dbOperation('readonly', (store) => {
      return new Promise((resolve, reject) => {
        let totalFiles = 0;
        let totalDirectories = 0;
        let totalSize = 0;

        const request = store.openCursor();
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const record = cursor.value;
            if (record.type === 'file') {
              totalFiles++;
              totalSize += record.size;
            } else if (record.type === 'directory') {
              totalDirectories++;
            }
            cursor.continue();
          } else {
            // 尝试获取存储配额信息
            if ('storage' in navigator && 'estimate' in navigator.storage) {
              navigator.storage
                .estimate()
                .then((estimate) => {
                  resolve({
                    totalFiles,
                    totalDirectories,
                    totalSize,
                    storageQuota: estimate.quota,
                    usedStorage: estimate.usage
                  });
                })
                .catch(() => {
                  resolve({
                    totalFiles,
                    totalDirectories,
                    totalSize
                  });
                });
            } else {
              resolve({
                totalFiles,
                totalDirectories,
                totalSize
              });
            }
          }
        };
        request.onerror = () => reject(new VFSError('Failed to calculate usage stats', 'EIO'));
      });
    });
  }

  /**
   * 导出文件系统数据为 JSON
   */
  async exportToJSON(): Promise<string> {
    return this.dbOperation('readonly', (store) => {
      return new Promise((resolve, reject) => {
        const exportData: any[] = [];
        const request = store.openCursor();

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor) {
            const record = cursor.value;

            // 对于二进制数据，转换为 base64
            let data = record.data;
            if (data instanceof ArrayBuffer) {
              const bytes = new Uint8Array(data);
              data = btoa(String.fromCodePoint(...bytes));
              record.dataType = 'base64';
            } else {
              record.dataType = 'string';
            }

            exportData.push({
              ...record,
              data: data,
              created: record.created.toISOString(),
              modified: record.modified.toISOString()
            });

            cursor.continue();
          } else {
            resolve(
              JSON.stringify(
                {
                  version: '1.0',
                  filesystem: 'IndexedDBFS',
                  exported: new Date().toISOString(),
                  data: exportData
                },
                null,
                2
              )
            );
          }
        };

        request.onerror = () => reject(new VFSError('Failed to export data', 'EIO'));
      });
    });
  }

  /**
   * 从 JSON 导入文件系统数据
   */
  async importFromJSON(jsonData: string): Promise<void> {
    try {
      const importData = JSON.parse(jsonData);

      if (!importData.data || !Array.isArray(importData.data)) {
        throw new VFSError('Invalid import data format', 'EINVAL');
      }

      return this.dbOperation('readwrite', (store) => {
        return new Promise<void>((resolve, reject) => {
          let processed = 0;
          const total = importData.data.length;

          if (total === 0) {
            resolve();
            return;
          }

          for (const record of importData.data) {
            // 恢复数据格式
            if (record.dataType === 'base64' && record.data) {
              const binaryString = atob(record.data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.codePointAt(i);
              }
              record.data = bytes.buffer;
            }

            // 恢复日期对象
            record.created = new Date(record.created);
            record.modified = new Date(record.modified);

            // 移除临时字段
            delete record.dataType;

            const request = store.put(record);
            request.onsuccess = () => {
              processed++;
              if (processed === total) {
                resolve();
              }
            };
            request.onerror = () => reject(new VFSError(`Failed to import record: ${record.path}`, 'EIO'));
          }
        });
      });
    } catch (_error) {
      throw new VFSError('Failed to parse import data', 'EINVAL');
    }
  }
  async _deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close();
        this.db = null;
      }
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);

      deleteRequest.onsuccess = () => {
        console.log(`数据库 "${this.dbName}" 删除成功`);
        resolve();
      };

      deleteRequest.onerror = () => {
        console.error(`删除数据库 "${this.dbName}" 失败:`, deleteRequest.error);
        reject(deleteRequest.error);
      };

      deleteRequest.onblocked = () => {
        console.warn(`删除数据库 "${this.dbName}" 被阻塞，可能有其他连接正在使用`);
        // 可以选择等待或强制关闭其他连接
      };
    });
  }
  protected async _deleteFileSystem(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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

      request.onblocked = (ev) => {
        reject(new VFSError('Database upgrade blocked - close other connections first', 'EBUSY'));
      };
    });
  }

  // 在 IndexedDBFS 类中添加这个方法

  protected async _move(sourcePath: string, targetPath: string, options?: MoveOptions): Promise<void> {
    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // 首先检查源路径是否存在
        const sourceRequest = store.get(sourcePath);

        sourceRequest.onsuccess = () => {
          const sourceRecord = sourceRequest.result;
          if (!sourceRecord) {
            reject(new VFSError('Source path does not exist', 'ENOENT', sourcePath));
            return;
          }

          // 检查目标是否已存在
          const targetRequest = store.get(targetPath);

          targetRequest.onsuccess = () => {
            const targetRecord = targetRequest.result;
            if (targetRecord && !options?.overwrite) {
              reject(new VFSError('Target already exists', 'EEXIST', targetPath));
              return;
            }

            // 检查目标父目录是否存在
            const targetParent = PathUtils.dirname(targetPath);
            const parentRequest = store.get(targetParent);

            parentRequest.onsuccess = () => {
              const parentRecord = parentRequest.result;
              if (!parentRecord || parentRecord.type !== 'directory') {
                reject(new VFSError('Target parent directory does not exist', 'ENOENT', targetParent));
                return;
              }

              if (sourceRecord.type === 'file') {
                // 移动文件
                this.moveFile(store, sourceRecord, targetPath, targetRecord, options, resolve, reject);
              } else if (sourceRecord.type === 'directory') {
                // 移动目录
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

  /**
   * 移动单个文件
   */
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

    // 创建新的文件记录
    const newRecord = {
      ...sourceRecord,
      name: PathUtils.basename(targetPath),
      path: targetPath,
      parent: PathUtils.dirname(targetPath),
      modified: now
    };

    // 如果目标存在且允许覆盖，先删除目标
    const handleUpdate = () => {
      // 添加新记录
      const addRequest = store.put(newRecord);
      addRequest.onsuccess = () => {
        // 删除源记录
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
      // 先删除目标记录
      const deleteTargetRequest = store.delete(targetPath);
      deleteTargetRequest.onsuccess = handleUpdate;
      deleteTargetRequest.onerror = () => {
        reject(new VFSError('Failed to delete target file', 'EIO', targetPath));
      };
    } else {
      handleUpdate();
    }
  }

  /**
   * 移动目录及其所有子项
   */
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
    // 获取所有需要移动的子项
    const itemsToMove: any[] = [];
    const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';

    const cursorRequest = store.openCursor();

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        const record = cursor.value;
        const recordPath = record.path as string;

        // 收集需要移动的项目（包括源目录本身和所有子项）
        if (recordPath === sourcePath || recordPath.startsWith(sourcePrefix)) {
          itemsToMove.push(record);
        }

        cursor.continue();
      } else {
        // 所有项目收集完成，开始移动
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

  /**
   * 执行目录移动操作
   */
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

    // 如果目标存在且允许覆盖，先删除目标目录的所有内容
    const processMove = () => {
      // 为每个项目创建新记录
      for (const item of itemsToMove) {
        if (hasError) break;

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

        // 添加新记录
        const addRequest = store.put(newRecord);

        addRequest.onsuccess = () => {
          // 删除旧记录
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
      // 需要先删除目标目录的所有内容
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

  /**
   * 删除目录的所有内容（用于覆盖模式）
   */
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

        // 收集需要删除的项目（包括目录本身和所有子项）
        if (recordPath === dirPath || recordPath.startsWith(dirPrefix)) {
          itemsToDelete.push(recordPath);
        }

        cursor.continue();
      } else {
        // 删除所有收集到的项目
        if (itemsToDelete.length === 0) {
          onSuccess();
          return;
        }

        let deleted = 0;
        let hasError = false;

        for (const pathToDelete of itemsToDelete) {
          if (hasError) break;

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
}
