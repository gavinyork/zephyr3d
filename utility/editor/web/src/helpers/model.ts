import type { AnimationSet, Scene, SceneNode } from '@zephyr3d/scene';
import { AssetManager } from '@zephyr3d/scene';
import { Database } from '../storage/db';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';
import { HttpRequest } from '@zephyr3d/base';

export class ModelAsset {
  private _cache: Record<string, Promise<{ group: SceneNode; animationSet: AnimationSet }>>;
  static readonly extensions = ['.gltf', '.glb'];
  constructor() {
    this._cache = {};
  }
  async decompressZip(zip: Blob) {
    return new Promise<Record<string, Blob>>((resolve, reject) => {
      let worker = new Worker(new URL('./zip.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'success':
            worker?.terminate();
            worker = null;
            resolve(e.data.data as Record<string, Blob>);
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
  async loadModel(files: Record<string, Blob>) {
    const fileMap: Record<string, string> = {};
    for (const k of Object.getOwnPropertyNames(files)) {
      fileMap[`/${k}`] = URL.createObjectURL(files[k]);
    }
  }
  async readZip(blob: Blob): Promise<Map<string, string>> {
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    const fileMap = new Map();
    for (const entry of entries) {
      if (!entry.directory) {
        const blob = await entry.getData(new BlobWriter());
        const fileURL = URL.createObjectURL(blob);
        fileMap.set(`/${entry.filename}`, fileURL);
      }
    }
    await reader.close();
    return fileMap;
  }
  async fetch(
    scene: Scene,
    uuid: string,
    assetManager?: AssetManager
  ): Promise<{ group: SceneNode; animationSet: AnimationSet }> {
    let model = this._cache[uuid];
    if (!model) {
      const asset = await Database.getAsset(uuid);
      if (asset.type !== 'model') {
        return null;
      }
      const pkg = await Database.getPackage(asset.pkg);
      if (!pkg) {
        return null;
      }
      const blob = await Database.getBlob(pkg.blob);
      if (!blob) {
        return null;
      }
      const fileMap = await this.readZip(blob.data);
      assetManager = assetManager ?? new AssetManager();
      const oldResolver = assetManager.httpRequest.urlResolver;
      assetManager.httpRequest.urlResolver = (url) => {
        return fileMap.get(url) || url;
      };
      model = assetManager.fetchModel(
        scene,
        asset.path,
        {
          enableInstancing: true
        },
        new HttpRequest((url) => fileMap.get(url) ?? url)
      );
      assetManager.httpRequest.urlResolver = oldResolver;
      this._cache[uuid] = model;
    }
    return model;
  }
}
