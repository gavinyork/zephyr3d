import type { AnimationSet, Scene, SceneNode } from '@zephyr3d/scene';
import { AssetManager } from '@zephyr3d/scene';
import { Database } from '../storage/db';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';
import { HttpRequest } from '@zephyr3d/base';

export class ModelAsset {
  private static _assetManagers: Record<
    string,
    {
      assetManager: AssetManager;
      httpRequest: HttpRequest;
      path: string;
      urls: string[];
      nodes: Map<SceneNode, AnimationSet>;
    }
  > = {};
  static readonly extensions = ['.gltf', '.glb'];
  static async decompressZip(zip: Blob) {
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
  static async readZip(blob: Blob): Promise<Map<string, string>> {
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    const fileMap = new Map<string, string>();
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
  static async fetch(scene: Scene, uuid: string): Promise<{ group: SceneNode; animationSet: AnimationSet }> {
    let assetManager = this._assetManagers[uuid];
    if (!assetManager) {
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
      assetManager = {
        urls: [...fileMap.values()],
        path: asset.path,
        httpRequest: new HttpRequest((url) => fileMap.get(url)),
        assetManager: new AssetManager(Symbol(uuid)),
        nodes: new Map()
      };
      this._assetManagers[uuid] = assetManager;
    }
    const model = await assetManager.assetManager.fetchModel(
      scene,
      `/${assetManager.path}`,
      {
        enableInstancing: true
      },
      assetManager.httpRequest
    );
    if (model) {
      assetManager.nodes.set(model.group, model.animationSet);
      return model;
    } else {
      throw new Error('Load asset failed');
    }
  }
}
