import type { HttpRequest } from '@zephyr3d/base';
import { AssetManager, type ModelFetchOptions, type TextureFetchOptions } from '../../../asset';
import type { Scene } from '../../../scene';
import type { Texture2D, TextureCube } from '@zephyr3d/device';

/**
 * Asset types
 * @public
 */
export type AssetType = 'model' | 'texture' | 'binary';

/**
 * Asset information
 * @public
 */
export interface AssetInfo {
  /** Asset id */
  id: string;
  /** Asset name */
  name: string;
  /** Asset type */
  type: AssetType;
  /** Asset path */
  path: string;
  /** Texture options if the asset is texture type */
  textureOptions?: TextureFetchOptions<any>;
}

/**
 * Embedded asset information
 * @public
 */
export type EmbeddedAssetInfo = {
  /** Asset type */
  assetType: AssetType;
  /** Asset id */
  assetId: string;
  /** Asset package id */
  pkgId: string;
  /** Asset path */
  path: string;
  /** Asset data */
  data: Blob;
};

/**
 * Asset registry
 * @public
 */
export class AssetRegistry {
  private _assetMap: Map<string, AssetInfo>;
  private _allocated: WeakMap<any, string>;
  private _assetManager: AssetManager;
  private _baseUrl: string;
  constructor(baseUrl?: string) {
    this._assetMap = new Map();
    this._allocated = new WeakMap();
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
  async putEmbeddedAssets(assets: EmbeddedAssetInfo[]) {
    console.error('Putting assets not supported');
  }
  getAssetId(asset: any) {
    return this._allocated.get(asset) ?? null;
  }
  registerAsset(id: string, type: AssetType, path: string, name: string) {
    if (this._assetMap.has(id)) {
      console.error(`AssetRegistry.registerAsset() failed: Asset <${id}> already exists`);
    } else {
      this._assetMap.set(id, {
        id,
        name,
        type,
        path
      });
    }
  }
  getAssetInfo(id: string): AssetInfo {
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
      this._allocated.set(data, id);
    }
    return data;
  }
  async fetchModel(id: string, scene: Scene, options?: ModelFetchOptions, request?: HttpRequest) {
    const model = await this.doFetchModel(id, scene, options, request);
    if (model) {
      this._allocated.set(model.group, id);
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
      this._allocated.set(texture, id);
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
          path: this.resolveUrl(this._baseUrl, info.path)
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
