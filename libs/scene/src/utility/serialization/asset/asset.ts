import type { HttpRequest } from '@zephyr3d/base';
import { AssetManager, type ModelFetchOptions, type TextureFetchOptions } from '../../../asset';
import type { Scene } from '../../../scene';
import type { Texture2D, TextureCube } from '@zephyr3d/device';

export type AssetType = 'model' | 'texture' | 'binary';
export type AssetInfo = {
  id: string;
  name: string;
  type: AssetType;
  path: string;
  allocated: WeakMap<any, string>;
  textureOptions?: TextureFetchOptions<any>;
};

export type EmbededAssetInfo = {
  assetId: string;
  pkgId: string;
  path: string;
  data: Blob;
};

export class AssetRegistry {
  private _assetMap: Map<string, AssetInfo>;
  private _assetManager: AssetManager;
  private _baseUrl: string;
  constructor(baseUrl?: string) {
    this._assetMap = new Map();
    this._assetManager = new AssetManager();
    this._baseUrl = baseUrl ?? '';
  }
  async loadFromURL(url: string) {
    try {
      const content = await this._assetManager.fetchTextData(url);
      const json = JSON.parse(content);
      this.deserialize(json);
    } catch (err) {
      console.error(`Load asset registry failed: ${err}`);
    }
  }
  get assetManager() {
    return this._assetManager;
  }
  async putEmbeddedAssets(assets: EmbededAssetInfo[]) {
    console.error('Putting assets not supported');
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
  async fetchBinary(id: string, request?: HttpRequest) {
    const data = await this.doFetchBinary(id, request);
    if (data) {
      const info = this._assetMap.get(id);
      if (info) {
        info.allocated.set(data, id);
      }
    }
    return data;
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
    if (json) {
      for (const k of Object.getOwnPropertyNames(json)) {
        const info = json[k];
        this._assetMap.set(k, {
          id: info.id,
          name: info.name,
          type: info.type,
          path: this.resolveUrl(this._baseUrl, info.path),
          allocated: new Map()
        });
      }
    }
  }
  protected async doFetchBinary(name: string, request?: HttpRequest) {
    const info = this._assetMap.get(name);
    if (!info || info.type !== 'binary') {
      return null;
    }
    return await this._assetManager.fetchBinaryData(info.path, null, request);
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
    return await this._assetManager.fetchModel(scene, info.path, options, request);
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
    return await this._assetManager.fetchTexture<T>(info.path, options, request);
  }
  private resolveUrl(...paths: string[]): string {
    const cleanPaths = paths.filter((path) => path != null && path !== '');
    const processedPaths = cleanPaths.map((path, index) => {
      path = String(path).trim();
      path = path.replace(/^\/+|\/+$/g, '');
      return path;
    });
    return processedPaths.join('/');
  }
}
