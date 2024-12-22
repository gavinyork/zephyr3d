import { IDBPDatabase, openDB } from 'idb';

export type AssetType = 'model';

export type AssetBlob = {
  uuid?: string;
  mimeType?: string;
  name: string;
  data: Blob;
  metadata: object;
};

export type AssetInfo = {
  uuid?: string;
  name: string;
  type: AssetType;
  blob: string;
  metadata: { zip: boolean };
};

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
  static async addBlob(blob: AssetBlob) {
    const { name, data, metadata } = blob;
    const uuid = this.randomUUID();
    const arrayBuffer = await data.arrayBuffer();
    await this.instance.put(this.DB_NAME_BLOBS, {
      uuid,
      name,
      type: blob.mimeType ?? data.type,
      data: arrayBuffer,
      metadata: JSON.stringify(metadata)
    });
    return uuid;
  }
  static async getBlob(uuid: string): Promise<AssetBlob> {
    const blob = await this.instance.get(this.DB_NAME_BLOBS, uuid);
    return blob
      ? {
          uuid,
          name: blob.name as string,
          data: new Blob([blob.data], { type: blob.type }),
          metadata: JSON.parse(blob.metadata)
        }
      : null;
  }
  static async downloadBlob(uuid: string, zip: boolean) {
    const { data, name } = await this.getBlob(uuid);
    if (data) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = zip ? `${name}.zip` : name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }
  static async deleteBlob(uuid: string, force = false): Promise<boolean> {
    try {
      if (!force) {
        const assets = await this.listAssets();
        const isReferenced = assets.some((asset) => asset.blob === uuid);
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
  static async addAsset(asset: AssetInfo) {
    const { name, type, blob, metadata } = asset;
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_ASSETS, {
      uuid,
      name,
      type,
      blob,
      metadata: JSON.stringify(metadata)
    });
    return uuid;
  }
  static async deleteAsset(uuid: string): Promise<boolean> {
    try {
      await this.instance.delete(this.DB_NAME_ASSETS, uuid);
      return true;
    } catch (error) {
      console.error('Error deleting asset:', error);
      return false;
    }
  }
  static async getAsset(uuid: string): Promise<AssetInfo> {
    const asset = await this.instance.get(this.DB_NAME_ASSETS, uuid);
    return asset
      ? {
          uuid,
          name: asset.name,
          type: asset.type,
          blob: asset.blob,
          metadata: JSON.parse(asset.metadata)
        }
      : null;
  }
  static async listAssets(type?: string): Promise<AssetInfo[]> {
    try {
      let assets: any[];
      if (type) {
        const index = this.instance.transaction(this.DB_NAME_ASSETS).store.index('idxType');
        assets = await index.getAll(type);
      } else {
        assets = await this.instance.getAll(this.DB_NAME_ASSETS);
      }
      return assets.map((asset) => ({
        uuid: asset.uuid,
        name: asset.name,
        type: asset.type,
        blob: asset.blob,
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
  static async updateScene(
    uuid: string,
    updates: {
      name?: string;
      content?: any;
      metadata?: any;
    }
  ): Promise<boolean> {
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
      return scenes.map((scene) => ({
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
