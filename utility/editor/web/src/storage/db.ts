import { IDBPDatabase, openDB } from 'idb';

export class Database {
  static instance: IDBPDatabase = null;
  static readonly DB_NAME = 'zephyr3d-editor';
  static readonly DB_VERSION = 1;
  static readonly DB_NAME_ASSETS = 'assets';
  static readonly DB_NAME_SCENES = 'scenes';
  static async init() {
    if (!this.instance) {
      const that = this;
      this.instance = await openDB(this.DB_NAME, this.DB_VERSION, {
        upgrade(db) {
          const assetStore = db.createObjectStore(that.DB_NAME_ASSETS, { keyPath: 'uuid' });
          assetStore.createIndex('idxType', 'type');
          assetStore.createIndex('idxName', 'name');
          const sceneStore = db.createObjectStore(that.DB_NAME_SCENES, { keyPath: 'uuid' });
          sceneStore.createIndex('idxName', 'name');
        }
      });
    }
  }
  static randomUUID() {
    return crypto.randomUUID();
  }
  static async addAsset(name: string, file: File, type: string, metadata = {}) {
    const uuid = this.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    await this.instance.put(this.DB_NAME_ASSETS, {
      uuid,
      name: name ?? file.name,
      type,
      size: file.size,
      data: arrayBuffer,
      metadata,
      createTime: new Date().toISOString()
    });
    return uuid;
  }
  static async getAsset(uuid: string) {
    return await this.instance.get(this.DB_NAME_ASSETS, uuid);
  }
  static async listAssets() {}
}
