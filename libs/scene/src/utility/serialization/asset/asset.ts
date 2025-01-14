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
  allocated: Map<any, string>;
  textureOptions?: TextureFetchOptions<any>;
};

export class AssetRegistry {
  private _assetMap: Map<string, AssetInfo>;
  private _poolId: symbol;
  constructor() {
    this._assetMap = new Map();
    this._poolId = Symbol('AssetRegistry');
  }
  get poolId() {
    return this._poolId;
  }
  getAssetId(asset: any) {
    for (const entry of this._assetMap) {
      const id = entry[1].allocated.get(asset);
      if (id) {
        return id;
      }
    }
    return null;
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
        allocated: new Map()
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
    const model = await this.doFetchModel(name, scene, options, request);
    if (model) {
      const info = this._assetMap.get(name);
      if (info) {
        info.allocated.set(model.group, name);
      }
    }
    return model;
  }
  async fetchTexture<T extends Texture2D | TextureCube>(
    name: string,
    options?: TextureFetchOptions<T>,
    request?: HttpRequest
  ) {
    const texture = await this.doFetchTexture(name, options, request);
    if (texture) {
      const info = this._assetMap.get(name);
      if (info) {
        info.allocated.set(texture, name);
      }
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
          allocated: new Map()
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
  protected async doFetchModel(
    name: string,
    scene: Scene,
    options?: ModelFetchOptions,
    request?: HttpRequest
  ) {
    const info = this._assetMap.get(name);
    if (!info || info.type !== 'model') {
      return null;
    }
    return await info.manager.fetchModel(scene, info.path, options, request);
  }
  protected async doFetchTexture<T extends Texture2D | TextureCube>(
    name: string,
    options?: TextureFetchOptions<T>,
    request?: HttpRequest
  ) {
    const info = this._assetMap.get(name);
    if (!info || info.type !== 'texture') {
      return null;
    }
    return await info.manager.fetchTexture<T>(info.path, options, request);
  }
}
