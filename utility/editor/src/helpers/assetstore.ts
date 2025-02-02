import type { AnimationSet, ModelFetchOptions, Scene, SceneNode, TextureFetchOptions } from '@zephyr3d/scene';
import { AssetManager } from '@zephyr3d/scene';
import { Database } from '../storage/db';
import { HttpRequest } from '@zephyr3d/base';
import type { BaseTexture } from '@zephyr3d/device';

export class AssetStore {
  private static _assetManager: AssetManager = new AssetManager();
  static readonly modelExtensions = ['.gltf', '.glb'];
  static readonly textureExtensions = ['jpg', 'jpeg', 'png', 'tga', 'dds', 'hdr'];
  static async fetchTexture<T extends BaseTexture>(
    uuid: string,
    options?: TextureFetchOptions<T>
  ): Promise<T> {
    const asset = await Database.getAsset(uuid);
    if (asset?.type !== 'texture') {
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
    const fileMap = new Map(
      [...(await Database.decompressZip(blob.data))].map((val) => [val[0], URL.createObjectURL(val[1])])
    );
    const httpRequest = new HttpRequest((url) => fileMap.get(url));
    const texture = await this._assetManager.fetchTexture<T>(`/${asset.path}`, options, httpRequest);
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
    const pkg = await Database.getPackage(asset.pkg);
    if (!pkg) {
      return null;
    }
    const blob = await Database.getBlob(pkg.blob);
    if (!blob) {
      return null;
    }
    const fileMap = new Map(
      [...(await Database.decompressZip(blob.data))].map((val) => [val[0], URL.createObjectURL(val[1])])
    );
    const httpRequest = new HttpRequest((url) => fileMap.get(url));
    const model = await this._assetManager.fetchModel(scene, `/${asset.path}`, options, httpRequest);
    for (const url of fileMap.values()) {
      URL.revokeObjectURL(url);
    }
    return model;
  }
}
