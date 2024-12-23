import { IDBPDatabase, openDB } from 'idb';

export type AssetType = 'model';

export type AssetPackage = {
  uuid?: string;
  name: string;
  blob: string;
  size: number;
  metadata?: object;
}

export type AssetBlob = {
  uuid?: string;
  mimeType?: string;
  data: Blob;
};

export type AssetInfo = {
  uuid?: string;
  name: string;
  path: string;
  type: AssetType;
  pkg: string;
  metadata?: object;
};

export class Database {
  static instance: IDBPDatabase = null;
  static readonly DB_NAME = 'zephyr3d-editor';
  static readonly DB_VERSION = 1;
  static readonly DB_NAME_ASSETS = 'assets';
  static readonly DB_NAME_SCENES = 'scenes';
  static readonly DB_NAME_BLOBS = 'blobs';
  static readonly DB_NAME_PACKAGES  = 'packages';
  static async init() {
    if (!this.instance) {
      const that = this;
      this.instance = await openDB(this.DB_NAME, this.DB_VERSION, {
        upgrade(db) {
          const dbAssets = db.createObjectStore(that.DB_NAME_ASSETS, { keyPath: 'uuid' });
          dbAssets.createIndex('idxType', 'type');
          db.createObjectStore(that.DB_NAME_SCENES, { keyPath: 'uuid' });
          db.createObjectStore(that.DB_NAME_BLOBS, { keyPath: 'uuid' });
          db.createObjectStore(that.DB_NAME_PACKAGES, { keyPath: 'uuid' });
        }
      });
    }
  }
  static randomUUID() {
    return crypto.randomUUID();
  }
  static async addPackage(pkg: AssetPackage) {
    const { name, blob, size, metadata } = pkg;
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_PACKAGES, {
      uuid,
      name,
      blob,
      size,
      metadata: JSON.stringify(metadata ?? {})
    });
    return uuid;
  }
  static async getPackage(uuid: string): Promise<AssetPackage> {
    const pkg = await this.instance.get(this.DB_NAME_PACKAGES, uuid);
    return pkg
      ? {
          uuid,
          size: pkg.size as number,
          name: pkg.name as string,
          blob: pkg.blob as string,
          metadata: JSON.parse(pkg.metadata)
        }
      : null;
  }
  static async deletePackage(uuid: string): Promise<boolean> {
    try {
      await this.instance.delete(this.DB_NAME_PACKAGES, uuid);
      return true;
    } catch (error) {
      console.error('Error deleting package:', error);
      return false;
    }
  }
  static async listPackages(): Promise<AssetPackage[]> {
    try {
      const packages = await this.instance.getAll(this.DB_NAME_PACKAGES);
      return packages.map((pkg) => ({
        uuid: pkg.uuid,
        name: pkg.name,
        blob: pkg.blob,
        size: pkg.size,
        metadata: JSON.parse(pkg.metadata)
      }));
    } catch (error) {
      console.error(error);
      return [];
    }
  }
  static async addBlob(blob: AssetBlob) {
    const uuid = this.randomUUID();
    const arrayBuffer = await blob.data.arrayBuffer();
    await this.instance.put(this.DB_NAME_BLOBS, {
      uuid,
      type: blob.mimeType ?? blob.data.type,
      data: arrayBuffer
    });
    return uuid;
  }
  static async getBlob(uuid: string): Promise<AssetBlob> {
    const blob = await this.instance.get(this.DB_NAME_BLOBS, uuid);
    return blob
      ? {
          uuid,
          mimeType: blob.type,
          data: new Blob([blob.data], { type: blob.type })
        }
      : null;
  }
  static async downloadBlob(uuid: string, filename: string) {
    const { data } = await this.getBlob(uuid);
    if (data) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }
  static async deleteBlob(uuid: string, force = false): Promise<boolean> {
    try {
      if (!force) {
        const packages = await this.listPackages();
        const isReferenced = packages.some((pkg) => pkg.blob === uuid);
        if (isReferenced) {
          console.warn(`Blob ${uuid} is still referenced by some packages and cannot be deleted`);
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
    const { name, type, path, pkg, metadata } = asset;
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_ASSETS, {
      uuid,
      name,
      path,
      type,
      pkg,
      metadata: JSON.stringify(metadata ?? {})
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
          pkg: asset.pkg,
          path: asset.path,
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
        pkg: asset.pkg,
        path: asset.path,
        metadata: JSON.parse(asset.metadata)
      }));
    } catch (error) {
      console.error(error);
      return [];
    }
  }
  static async addScene(name: string, content: any, metadata?: object) {
    const uuid = this.randomUUID();
    await this.instance.put(this.DB_NAME_SCENES, {
      uuid,
      name,
      content: JSON.stringify(content),
      metadata: JSON.stringify(metadata ?? {})
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
