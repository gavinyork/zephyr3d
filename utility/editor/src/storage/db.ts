import type { AssetType } from '@zephyr3d/scene';
import type { IDBPDatabase } from 'idb';
import { openDB } from 'idb';
import type { ZipDownloader } from '../helpers/zipdownload';
import type { ZipWriter } from '@zip.js/zip.js';

export type DBAssetPackage = {
  uuid?: string;
  name: string;
  blob: string;
  size: number;
  metadata?: any;
};

export type DBAssetBlob = {
  uuid?: string;
  mimeType?: string;
  data: Blob;
};

export type DBAssetInfo = {
  uuid?: string;
  name: string;
  path: string;
  thumbnail: string;
  type: AssetType;
  pkg: string;
  metadata?: any;
};

export type DBSceneInfo = {
  uuid?: string;
  name: string;
  content: object;
  metadata?: any;
};

export class Database {
  static instance: IDBPDatabase = null;
  static readonly DB_NAME = 'zephyr3d-editor';
  static readonly DB_VERSION = 1;
  static readonly DB_NAME_ASSETS = 'assets';
  static readonly DB_NAME_SCENES = 'scenes';
  static readonly DB_NAME_BLOBS = 'blobs';
  static readonly DB_NAME_PACKAGES = 'packages';
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
  static async putPackage(pkg: DBAssetPackage) {
    pkg.uuid = pkg.uuid ?? this.randomUUID();
    const { uuid, name, blob, size, metadata } = pkg;
    await this.instance.put(this.DB_NAME_PACKAGES, {
      uuid,
      name,
      blob,
      size,
      metadata: JSON.stringify(metadata ?? {})
    });
    return uuid;
  }
  static async getPackage(uuid: string): Promise<DBAssetPackage> {
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
  static async listPackages(): Promise<DBAssetPackage[]> {
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
  static async putBlob(blob: DBAssetBlob) {
    blob.uuid = blob.uuid ?? this.randomUUID();
    const arrayBuffer = await blob.data.arrayBuffer();
    await this.instance.put(this.DB_NAME_BLOBS, {
      uuid: blob.uuid,
      type: blob.mimeType ?? blob.data.type,
      data: arrayBuffer
    });
    return blob.uuid;
  }
  static async getBlob(uuid: string): Promise<DBAssetBlob> {
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
  static async putAsset(asset: DBAssetInfo) {
    asset.uuid = asset.uuid ?? this.randomUUID();
    const { uuid, name, type, path, thumbnail, pkg, metadata } = asset;
    await this.instance.put(this.DB_NAME_ASSETS, {
      uuid,
      name,
      path,
      type,
      thumbnail,
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
  static async getAsset(uuid: string): Promise<DBAssetInfo> {
    const asset = await this.instance.get(this.DB_NAME_ASSETS, uuid);
    return asset
      ? {
          uuid,
          name: asset.name,
          type: asset.type,
          pkg: asset.pkg,
          path: asset.path,
          thumbnail: asset.thumbnail,
          metadata: JSON.parse(asset.metadata)
        }
      : null;
  }
  static async listAssets(type?: string): Promise<DBAssetInfo[]> {
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
        thumbnail: asset.thumbnail,
        metadata: JSON.parse(asset.metadata)
      }));
    } catch (error) {
      console.error(error);
      return [];
    }
  }
  static async putScene(scene: DBSceneInfo) {
    scene.uuid = scene.uuid ?? this.randomUUID();
    const { uuid, name, content, metadata } = scene;
    await this.instance.put(this.DB_NAME_SCENES, {
      uuid,
      name,
      content: JSON.stringify(content),
      metadata: JSON.stringify(metadata ?? {})
    });
    return uuid;
  }
  static async getScene(uuid: string): Promise<DBSceneInfo> {
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
  static async listScenes(): Promise<DBSceneInfo[]> {
    try {
      const scenes = await this.instance.getAll(this.DB_NAME_SCENES);
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
  private static async copyZipFilesToZip(writer: ZipWriter<any>, source: Blob, path: string) {
    const fileMap = await this.decompressZip(source);
    for (const val of fileMap) {
      const f = val[0].startsWith('/') ? val[0].slice(1) : val[0];
      const name = [path, f].join('/');
      await writer.add(name, val[1].stream());
    }
  }
  static async exportAssets(downloader: ZipDownloader, assets: string[], dirname: string) {
    const pkgDownloaded = new Set<string>();
    const assetRegistry: any = {};
    for (const asset of assets) {
      const info = await this.getAsset(asset);
      if (!info) {
        console.error(`Asset not found: ${asset}`);
        continue;
      }
      if (pkgDownloaded.has(info.pkg)) {
        continue;
      }
      const pkg = await this.getPackage(info.pkg);
      if (!pkg) {
        console.error(`Package not found: ${asset}`);
        continue;
      }
      const { data } = await this.getBlob(pkg.blob);
      if (!data) {
        console.error(`Blob not found: ${asset}`);
      }
      const path = [dirname, pkg.uuid].join('/');
      await this.copyZipFilesToZip(downloader.zipWriter, data, path);
      pkgDownloaded.add(pkg.uuid);

      assetRegistry[info.uuid] = {
        id: info.uuid,
        name: info.name,
        type: info.type,
        path: [path, info.path].join('/')
      };
    }
    const assetIndex = new Blob([JSON.stringify(assetRegistry, null, 2)]).stream();
    await downloader.zipWriter.add([dirname, 'index.json'].join('/'), assetIndex);
  }
  static async decompressZip(zip: Blob) {
    return new Promise<Map<string, Blob>>((resolve, reject) => {
      let worker = new Worker(new URL('./zip.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'success':
            worker?.terminate();
            worker = null;
            resolve(e.data.data as Map<string, Blob>);
            break;
          case 'error':
            worker?.terminate();
            worker = null;
            reject(e.data.error);
            break;
        }
      };
      worker.onerror = (error) => {
        worker?.terminate();
        worker = null;
        reject(error);
      };
      worker.postMessage({
        type: 'decompress',
        zipBlob: zip
      });
    });
  }
  static async compressFiles(
    files: { path: string; file: File }[],
    onsuccess?: () => void,
    onerror?: () => void,
    onprogress?: (current: number, total: number) => void
  ): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      let worker = new Worker(new URL('./zip.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'success':
            worker?.terminate();
            worker = null;
            onsuccess?.();
            resolve(e.data.data as Blob);
            break;
          case 'error':
            worker?.terminate();
            worker = null;
            onerror?.();
            reject(e.data.error);
            break;
          case 'progress':
            onprogress?.(e.data.current, e.data.total);
            break;
        }
      };
      worker.onerror = (error) => {
        worker?.terminate();
        worker = null;
        onerror?.();
        reject(error);
      };
      worker.postMessage({
        type: 'compress',
        files
      });
    });
  }
}
