import { guessMimeType, PathUtils } from './common';
import type { FileMetadata, FileStat, ListOptions, ReadOptions, WriteOptions } from './vfs';
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
    return new Promise((resolve, reject) => {
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
        tempDb.close();
        resolve({ version: 0, storeExists: false });
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
        console.log('openDatabase succeeded');
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to open existing database', 'ENOENT'));
      };

      request.onblocked = (ev) => {
        console.log(ev);
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
            console.log(`Object Store '${this.storeName}' created successfully`);
          }
        } catch (error) {
          console.error(`Failed to create Object Store '${this.storeName}':`, error);
          reject(new VFSError('Failed to create object store', 'EIO', error?.toString()));
        }
      };

      request.onsuccess = () => {
        console.log('createObjectStoreAsync succeeded');
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new VFSError('Failed to create database/object store', 'EIO', request.error?.message));
      };

      request.onblocked = (ev) => {
        console.log(ev);
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
            console.log('Root directory created');
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
          console.log(`${mode} succeeded`);
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
    const normalizedPath = PathUtils.normalize(path);
    const parent = PathUtils.dirname(normalizedPath);

    // 1. 先在事务外检查和创建父目录
    if (parent !== '/' && parent !== normalizedPath) {
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
      const existsRequest = store.get(normalizedPath);
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
          name: PathUtils.basename(normalizedPath),
          path: normalizedPath,
          size: 0,
          type: 'directory',
          created: now,
          modified: now,
          parent: PathUtils.dirname(normalizedPath),
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
    const normalizedPath = PathUtils.normalize(path);

    return this.dbOperation('readonly', (store) => {
      return new Promise<FileMetadata[]>((resolve, reject) => {
        // 首先检查目录是否存在
        const dirCheck = store.get(normalizedPath);
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
                if (
                  recordPath !== normalizedPath &&
                  (recordPath.startsWith(normalizedPath + '/') || record.parent === normalizedPath)
                ) {
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
            const request = index.openCursor(IDBKeyRange.only(normalizedPath));
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
    const normalizedPath = PathUtils.normalize(path);

    // 1. 先在事务外检查目录内容
    const children = await this._readDirectory(normalizedPath);

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
        const dirCheck = store.get(normalizedPath);
        dirCheck.onsuccess = () => {
          const dirRecord = dirCheck.result;
          if (!dirRecord || dirRecord.type !== 'directory') {
            reject(new VFSError('Directory does not exist', 'ENOENT', path));
            return;
          }

          // 删除目录本身
          const deleteRequest = store.delete(normalizedPath);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(new VFSError('Failed to delete directory', 'EIO', path));
        };
        dirCheck.onerror = () => reject(dirCheck.error);
      });
    });
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    const normalizedPath = PathUtils.normalize(path);

    return this.dbOperation('readonly', (store) => {
      return new Promise<ArrayBuffer | string>((resolve, reject) => {
        const request = store.get(normalizedPath);
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
    const normalizedPath = PathUtils.normalize(path);
    const parent = PathUtils.dirname(normalizedPath);

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
        const existingRequest = store.get(normalizedPath);
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
            name: PathUtils.basename(normalizedPath),
            path: normalizedPath,
            size: size,
            type: 'file' as const,
            created: created,
            modified: now,
            parent: parent,
            data: fileData,
            mimeType: guessMimeType(normalizedPath)
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
    const normalizedPath = PathUtils.normalize(path);

    return this.dbOperation('readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // 首先检查文件是否存在
        const checkRequest = store.get(normalizedPath);
        checkRequest.onsuccess = () => {
          const record = checkRequest.result;
          if (!record || record.type !== 'file') {
            reject(new VFSError('File does not exist', 'ENOENT', path));
            return;
          }

          // 删除文件
          const deleteRequest = store.delete(normalizedPath);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => reject(new VFSError('Failed to delete file', 'EIO', path));
        };
        checkRequest.onerror = () => reject(new VFSError('Failed to check file existence', 'EIO', path));
      });
    });
  }

  protected async _exists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalize(path);

    return this.dbOperation('readonly', (store) => {
      return new Promise<boolean>((resolve, reject) => {
        const request = store.get(normalizedPath);
        request.onsuccess = () => {
          resolve(!!request.result);
        };
        request.onerror = () => reject(new VFSError('Failed to check existence', 'EIO', path));
      });
    });
  }

  protected async _stat(path: string): Promise<FileStat> {
    const normalizedPath = PathUtils.normalize(path);

    return this.dbOperation('readonly', (store) => {
      return new Promise<FileStat>((resolve, reject) => {
        const request = store.get(normalizedPath);
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
            console.log(`Object Store '${this.storeName}' deleted successfully`);
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
        console.log(ev);
        reject(new VFSError('Database upgrade blocked - close other connections first', 'EBUSY'));
      };
    });
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
