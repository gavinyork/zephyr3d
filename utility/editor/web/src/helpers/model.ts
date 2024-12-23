import { AnimationSet, AssetManager, SceneNode } from '@zephyr3d/scene';
import { Database } from '../storage/db';

export class ModelAsset {
  private _cache: Record<string, Promise<{ group: SceneNode; animationSet: AnimationSet }[]>>;
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
  async fetch(
    uuid: string,
    assetManager?: AssetManager
  ): Promise<{ group: SceneNode; animationSet: AnimationSet }[]> {
    let model = this._cache[uuid];
    if (model) {
      return model;
    }
    const asset = await Database.getAsset(uuid);
    if (asset.type !== 'model') {
      return null;
    }
    assetManager = assetManager ?? new AssetManager();
    const blob = await Database.getBlob(asset.pkg);
    let files: Record<string, Blob> = {};
    if (asset.metadata.zip) {
      files = await this.decompressZip(blob.data);
    } else {
      files = { '': blob.data };
    }
  }
}
