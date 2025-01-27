import type { AnimationSet, ModelFetchOptions, Scene, SceneNode, TextureFetchOptions } from '@zephyr3d/scene';
import { AssetManager } from '@zephyr3d/scene';
import { Database } from '../storage/db';
import { HttpRequest } from '@zephyr3d/base';
import type { BaseTexture } from '@zephyr3d/device';

export class AssetStore {
  private static _assetManagers: Record<
    string,
    {
      assetManager: AssetManager;
      path: string;
      nodes: Map<SceneNode, AnimationSet>;
    }
  > = {};
  static readonly modelExtensions = ['.gltf', '.glb'];
  static readonly textureExtensions = ['jpg', 'jpeg', 'png', 'tga', 'dds', 'hdr'];
  static async decompressZip(zip: Blob) {
    return new Promise<Map<string, string>>((resolve, reject) => {
      let worker = new Worker(new URL('./zip.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        switch (e.data.type) {
          case 'success':
            worker?.terminate();
            worker = null;
            const blobMap = e.data.data as Map<string, Blob>;
            const fileMap = new Map<string, string>();
            for (const [k, v] of blobMap) {
              fileMap.set(k, URL.createObjectURL(v));
            }
            resolve(fileMap);
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
  static async release(node: SceneNode) {
    for (const k of Object.getOwnPropertyNames(this._assetManagers)) {
      const assetManager = this._assetManagers[k];
      if (assetManager.nodes.has(node)) {
        assetManager.nodes.get(node)?.dispose();
        assetManager.nodes.delete(node);
        if (assetManager.nodes.size === 0) {
          assetManager.assetManager.purgeCache();
        }
        break;
      }
    }
  }
  static async fetchTexture<T extends BaseTexture>(
    uuid: string,
    options?: TextureFetchOptions<T>
  ): Promise<T> {
    const asset = await Database.getAsset(uuid);
    if (asset?.type !== 'texture') {
      return null;
    }
    let assetManager = this._assetManagers[uuid];
    if (!assetManager) {
      assetManager = {
        path: asset.path,
        assetManager: new AssetManager(),
        nodes: new Map()
      };
      this._assetManagers[uuid] = assetManager;
    }
    const pkg = await Database.getPackage(asset.pkg);
    if (!pkg) {
      return null;
    }
    const blob = await Database.getBlob(pkg.blob);
    if (!blob) {
      return null;
    }
    const fileMap = await this.decompressZip(blob.data);
    const httpRequest = new HttpRequest((url) => fileMap.get(url));
    const texture = await assetManager.assetManager.fetchTexture<T>(
      `/${assetManager.path}`,
      options,
      httpRequest
    );
    for (const url of fileMap.values()) {
      URL.revokeObjectURL(url);
    }
    if (texture) {
      return texture;
    } else {
      throw new Error('Texture asset cannot be loaded');
    }
  }
  static async fetchModel(
    scene: Scene,
    uuid: string,
    options?: ModelFetchOptions
  ): Promise<{ group: SceneNode; animationSet: AnimationSet }> {
    const asset = await Database.getAsset(uuid);
    if (asset?.type !== 'model') {
      return null;
    }
    let assetManager = this._assetManagers[uuid];
    if (!assetManager) {
      assetManager = {
        path: asset.path,
        assetManager: new AssetManager(),
        nodes: new Map()
      };
      this._assetManagers[uuid] = assetManager;
    }
    const pkg = await Database.getPackage(asset.pkg);
    if (!pkg) {
      return null;
    }
    const blob = await Database.getBlob(pkg.blob);
    if (!blob) {
      return null;
    }
    const fileMap = await this.decompressZip(blob.data);
    const httpRequest = new HttpRequest((url) => fileMap.get(url));
    const model = await assetManager.assetManager.fetchModel(
      scene,
      `/${assetManager.path}`,
      options,
      httpRequest
    );
    for (const url of fileMap.values()) {
      URL.revokeObjectURL(url);
    }
    if (model) {
      assetManager.nodes.set(model.group, model.animationSet);
      return model;
    } else {
      throw new Error('Model asset cannot be loaded');
    }
  }
}
