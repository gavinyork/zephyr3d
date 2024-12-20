import { IDBPDatabase, openDB } from 'idb';

export class Database {
  static instance: IDBPDatabase = null;
  static readonly DB_NAME = 'zephyr3d-editor';
  static readonly DB_VERSION = 1;
  static readonly DB_NAME_ASSETS = 'assets';
  static readonly DB_NAME_SCENES = 'scenes';
  static readonly DB_NAME_BLOBS = 'blobs';
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
          const blobStore = db.createObjectStore(that.DB_NAME_BLOBS, { keyPath: 'uuid' });
          blobStore.createIndex('idxName', 'name');
        }
      });
    }
  }
  static randomUUID() {
    return crypto.randomUUID();
  }
  static async addBlob(name: string, data: Blob, metadata = {}) {
    const uuid = this.randomUUID();
    const arrayBuffer = await data.arrayBuffer();
    await this.instance.put(this.DB_NAME_BLOBS, {
      uuid,
      name,
      type: data.type,
      data: arrayBuffer,
      metadata: JSON.stringify(metadata)
    });
    return uuid;
  }
  static async getBlob(uuid: string) {
    const blob = await this.instance.get(this.DB_NAME_BLOBS, uuid);
    if (blob) {
      return {
        uuid: blob.uuid as string,
        name: blob.name as string,
        type: blob.type as string,
        data: new Blob([blob.data], { type: blob.type }),
        metadata: JSON.parse(blob.metadata)
      };
    }
  }
  static async deleteBlob(uuid: string, force = false): Promise<boolean> {
    try {
      if (!force) {
        const assets = await this.listAssets();
        const isReferenced = assets.some(asset => asset.data === uuid);
        if (isReferenced) {
          console.warn(`Blob ${uuid} is still referenced by some assets and cannot be deleted`);
          return false;
        }
      }
      await this.instance.delete(this.DB_NAME_BLOBS, uuid);
      return true;
    } catch (error) {
      console.error('Error deleting blob:', error);
      return false;
    }
  }
  static async addAsset(name: string, uuidBlob: string, type: string, metadata = {}) {
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_ASSETS, {
      uuid,
      name,
      type,
      data: uuidBlob,
      metadata: JSON.stringify(metadata)
    });
    return uuid;
  }
  static async getAsset(uuid: string) {
    return await this.instance.get(this.DB_NAME_ASSETS, uuid);
  }
  static async listAssets(type?: string) {
    try {
      let assets: { uuid: string, name: string, type: string, data: string, metadata: any }[];
      if (type) {
        const index = this.instance.transaction(this.DB_NAME_ASSETS).store.index('idxType');
        assets = await index.getAll(type);
      } else {
        assets = await this.instance.getAll(this.DB_NAME_ASSETS);
      }
      return assets.map(asset => ({
        ...asset,
        metadata: JSON.parse(asset.metadata)
      }));
    } catch (error) {
      console.error(error);
      return [];
    }
  }
  static async addScene(name: string, content: any, metadata = {}) {
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_SCENES, {
      uuid,
      name,
      content: JSON.stringify(content),
      metadata: JSON.stringify(metadata)
    });
    return uuid;
  }
  static async updateScene(uuid: string, updates: {
    name?: string;
    content?: any;
    metadata?: any;
  }): Promise<boolean> {
    try {
      const scene = await this.getScene(uuid);
      if (!scene) {
        return false;
      }
      const updatedScene = {
        ...scene,
        ...updates,
        content: updates.content ? JSON.stringify(updates.content) : scene.content,
        metadata: updates.metadata ? JSON.stringify(updates.metadata) : scene.metadata
      };
      await this.instance.put(this.DB_NAME_SCENES, updatedScene);
      return true;
    } catch (error) {
      console.error('Error updating scene:', error);
      return false;
    }
  }
  static async getScene(uuid: string) {
    try {
      const scene = await this.instance.get(this.DB_NAME_SCENES, uuid);
      if (scene) {
        return {
          ...scene,
          content: JSON.parse(scene.content),
          metadata: JSON.parse(scene.metadata)
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting scene:', error);
      return null;
    }
  }
  static async deleteScene(uuid: string) {
    try {
      await this.instance.delete(this.DB_NAME_SCENES, uuid);
      return true;
    } catch (error) {
      console.error('Error deleting scene:', error);
      return false;
    }
  }
  static async listScenes() {
    try {
      let scenes = await this.instance.getAll(this.DB_NAME_SCENES);
      return scenes.map(scene => ({
        ...scene,
        content: JSON.parse(scene.content),
        metadata: JSON.parse(scene.metadata)
      }));
    } catch (error) {
      console.error('Error listing scenes:', error);
      return [];
    }
  }
}
