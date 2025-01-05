import type { HttpRequest } from '@zephyr3d/base';
import { AssetManager, type ModelFetchOptions, type TextureFetchOptions } from '../../../asset';
import type { Scene } from '../../../scene';
import type { Texture2D, TextureCube } from '@zephyr3d/device';

export type AssetType = 'model' | 'texture';
export type AssetInfo = {
  name: string;
  type: AssetType;
  path: string;
  manager: AssetManager;
  allocated: Set<any>;
  textureOptions?: TextureFetchOptions<any>;
};

export class AssetRegistry {
  private _assetMap: Map<string, AssetInfo>;
  constructor() {
    this._assetMap = new Map();
  }
  registerAsset(name: string, type: AssetType, path: string) {
    if (this._assetMap.has(name)) {
      console.error(`AssetRegistry.registerAsset() failed: Asset <${name}> already exists`);
    } else {
      this._assetMap.set(name, {
        name,
        type,
        path,
        manager: new AssetManager(),
        allocated: new Set()
      });
    }
  }
  getAssetInfo(name: string) {
    return this._assetMap.get(name);
  }
  getAssetPoolId(name: string) {
    const info = this._assetMap.get(name);
    return info ? info.manager.pool.id : null;
  }
  async fetchModel(name: string, scene: Scene, options?: ModelFetchOptions, request?: HttpRequest) {
    const info = this._assetMap.get(name);
    if (!info || info.type !== 'model') {
      return null;
    }
    const model = await info.manager.fetchModel(scene, info.path, options, request);
    if (model) {
      info.allocated.add(model.group);
    }
    return model;
  }
  async fetchTexture<T extends Texture2D | TextureCube>(
    name: string,
    options?: TextureFetchOptions<T>,
    request?: HttpRequest
  ) {
    const info = this._assetMap.get(name);
    if (!info || info.type !== 'texture') {
      return null;
    }
    const texture = await info.manager.fetchTexture<T>(info.path, options, request);
    if (texture) {
      info.allocated.add(texture);
    }
    return texture;
  }
  releaseAsset(asset: unknown) {
    for (const entry of this._assetMap) {
      const info = entry[1];
      if (info.allocated.has(asset)) {
        info.allocated.delete(asset);
        if (info.allocated.size === 0) {
          info.manager.purgeCache();
        }
        return;
      }
    }
  }
  serialize() {
    const assets: Record<string, { name: string; type: AssetType; path: string }> = {};
    for (const entry of this._assetMap) {
      assets[entry[0]] = {
        name: entry[0],
        type: entry[1].type,
        path: entry[1].path
      };
    }
    return { assets };
  }
  deserialize(json: any) {
    this.purge();
    const assets = json?.assets;
    if (assets) {
      for (const k of Object.getOwnPropertyNames(assets)) {
        const info = assets[k];
        this._assetMap.set(k, {
          name: k,
          type: info.type,
          path: info.path,
          manager: new AssetManager(Symbol(k)),
          allocated: new Set()
        });
      }
    }
  }
  purge() {
    for (const entry of this._assetMap) {
      entry[1].manager.purgeCache();
      entry[1].allocated.clear();
    }
    this._assetMap.clear();
  }
}
