import type { Texture2D, TextureCube } from '@zephyr3d/device';
import type { ModelFetchOptions, Scene, TextureFetchOptions } from '@zephyr3d/scene';
import { AssetRegistry } from '@zephyr3d/scene';
import { AssetStore } from '../helpers/assetstore';

export class EditorAssetRegistry extends AssetRegistry {
  async fetchModel(name: string, scene: Scene, options?: ModelFetchOptions) {
    return AssetStore.fetchModel(scene, name, options);
  }
  async fetchTexture<T extends Texture2D | TextureCube>(name: string, options?: TextureFetchOptions<T>) {
    return AssetStore.fetchTexture<T>(name, options);
  }
}
