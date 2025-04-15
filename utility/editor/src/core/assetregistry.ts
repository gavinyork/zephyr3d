import type { Texture2D, TextureCube } from '@zephyr3d/device';
import type {
  AssetInfo,
  EmbeddedAssetInfo,
  ModelFetchOptions,
  Scene,
  TextureFetchOptions
} from '@zephyr3d/scene';
import { AssetRegistry } from '@zephyr3d/scene';
import { AssetStore } from '../helpers/assetstore';
import { Database } from '../storage/db';

export class EditorAssetRegistry extends AssetRegistry {
  async putEmbeddedAssets(assets: EmbeddedAssetInfo[]) {
    return AssetStore.putEmbeddedAssets(assets);
  }
  getAssetInfo(id: string): AssetInfo {
    return Database.getAssetInfo(id);
  }
  protected async doFetchModel(name: string, scene: Scene, options?: ModelFetchOptions) {
    return AssetStore.fetchModel(scene, name, options);
  }
  protected async doFetchTexture<T extends Texture2D | TextureCube>(
    name: string,
    options?: TextureFetchOptions<T>
  ) {
    return AssetStore.fetchTexture<T>(name, options);
  }
  protected async doFetchBinary(name: string): Promise<ArrayBuffer> {
    return AssetStore.fetchBinary(name);
  }
}
