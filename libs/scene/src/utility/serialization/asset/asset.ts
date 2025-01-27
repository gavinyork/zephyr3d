import type { HttpRequest } from '@zephyr3d/base';
import { AssetManager, type ModelFetchOptions, type TextureFetchOptions } from '../../../asset';
import type { Scene } from '../../../scene';
import type { Texture2D, TextureCube } from '@zephyr3d/device';

export type AssetType = 'model' | 'texture';
export type AssetInfo = {
  id: string;
  name: string;
  type: AssetType;
  path: string;
  manager: AssetManager;
  allocated: WeakMap<any, string>;
  textureOptions?: TextureFetchOptions<any>;
};

export class AssetRegistry {
  private _assetMap: Map<string, AssetInfo>;
  constructor() {
    this._assetMap = new Map();
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
  registerAsset(id: string, type: AssetType, path: string, name: string) {
    if (this._assetMap.has(id)) {
      console.error(`AssetRegistry.registerAsset() failed: Asset <${id}> already exists`);
    } else {
      this._assetMap.set(id, {
        id,
        name,
        type,
        path,
        manager: new AssetManager(),
        allocated: new WeakMap()
      });
    }
  }
  getAssetInfo(id: string) {
    return this._assetMap.get(id);
  }
  renameAsset(id: string, name: string) {
    const info = this._assetMap.get(id);
    if (info) {
      info.name = name;
    }
  }
  async fetchModel(id: string, scene: Scene, options?: ModelFetchOptions, request?: HttpRequest) {
    const model = await this.doFetchModel(id, scene, options, request);
    if (model) {
      const info = this._assetMap.get(id);
      if (info) {
        info.allocated.set(model.group, id);
      }
    }
    return model;
  }
  async fetchTexture<T extends Texture2D | TextureCube>(
    id: string,
    options?: TextureFetchOptions<T>,
    request?: HttpRequest
  ) {
    const texture = await this.doFetchTexture(id, options, request);
    if (texture) {
      const info = this._assetMap.get(id);
      if (info) {
        info.allocated.set(texture, id);
      }
    }
    return texture;
  }
  serialize() {
    const assets: Record<string, { id: string; name: string; type: AssetType; path: string }> = {};
    for (const entry of this._assetMap) {
      assets[entry[0]] = {
        id: entry[0],
        name: entry[1].name,
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
          id: info.id,
          name: info.name,
          type: info.type,
          path: info.path,
          manager: new AssetManager(),
          allocated: new Map()
        });
      }
    }
  }
  purge() {
    for (const entry of this._assetMap) {
      entry[1].manager.purgeCache();
      entry[1].allocated = new WeakMap();
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
