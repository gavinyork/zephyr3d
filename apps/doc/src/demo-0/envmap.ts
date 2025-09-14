import type { HttpFS } from '@zephyr3d/base';
import type { GPUDataBuffer, Texture2D, TextureCube } from '@zephyr3d/device';
import type { Scene } from '@zephyr3d/scene';
import { DRef } from '@zephyr3d/base';
import { CubemapSHProjector, getDevice } from '@zephyr3d/scene';
import { AssetManager, panoramaToCubemap, prefilterCubemap } from '@zephyr3d/scene';

type EnvMapInfo = {
  path: string;
  maps?: Promise<{ maps: DRef<TextureCube>[]; sh: DRef<GPUDataBuffer> }>;
  sh?: Float32Array;
};

export class EnvMaps {
  private readonly _envMaps: Record<string, EnvMapInfo>;
  private readonly _assetManager: AssetManager;
  private readonly _assetManagerEx: AssetManager;
  private _currentId: string;
  private readonly _shProjector: CubemapSHProjector;
  constructor() {
    this._envMaps = {
      tower: {
        path: 'https://cdn.zephyr3d.org/doc/assets/images/environments/tower.hdr'
      },
      doge2: {
        path: 'https://cdn.zephyr3d.org/doc/assets/images/environments/doge2.hdr'
      },
      'Street night': {
        path: 'https://cdn.zephyr3d.org/doc/assets/images/environments/street_night.hdr'
      },
      forest: {
        path: 'https://cdn.zephyr3d.org/doc/assets/images/environments/forest.hdr'
      }
    };
    this._assetManager = new AssetManager();
    this._assetManagerEx = new AssetManager();
    this._shProjector = new CubemapSHProjector(10000);
    this._currentId = '';
    for (const k in this._envMaps) {
      this._envMaps[k].maps = this.loadEnvMap(this._envMaps[k].path, this._assetManager);
    }
  }
  getIdList(): string[] {
    return Object.keys(this._envMaps);
  }
  getCurrentId(): string {
    return this._currentId;
  }
  async loadEnvMap(
    path: string,
    assetManager: AssetManager
  ): Promise<{ maps: DRef<TextureCube>[]; sh: DRef<GPUDataBuffer> }> {
    const maps = this.createMaps();
    const sh = getDevice().createBuffer(4 * 4 * 9, { usage: 'uniform' });
    try {
      const panorama = await assetManager.fetchTexture<Texture2D>(path);
      panoramaToCubemap(panorama, maps[0]);
      prefilterCubemap(maps[0], 'ggx', maps[1]);
      prefilterCubemap(maps[0], 'lambertian', maps[2]);
      this._shProjector.projectCubemap(maps[2], sh);
    } catch (err) {
      console.error(err);
    }
    return { maps: maps.map((tex) => new DRef(tex)), sh: new DRef(sh) };
  }
  createMaps(): TextureCube[] {
    return [
      getDevice().createCubeTexture('rgba16f', 512),
      getDevice().createCubeTexture('rgba16f', 256),
      getDevice().createCubeTexture('rgba16f', 64, {
        samplerOptions: { mipFilter: 'none' }
      })
    ];
  }
  async selectByPath(path: string, scene: Scene, urlResolver: (url: string) => string) {
    (this._assetManagerEx.vfs as HttpFS).urlResolver = urlResolver;
    const { maps, sh } = await this.loadEnvMap(path, this._assetManagerEx);
    this._currentId = '';
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = maps[0].get();
    scene.env.sky.fogType = 'none';
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = maps[1].get();
    scene.env.light.irradianceMap = maps[2].get();
    scene.env.light.irradianceSH = sh.get();
  }
  async selectById(id: string, scene: Scene) {
    const info = this._envMaps[id];
    if (!info) {
      console.error(`Environment map id not found: ${id}`);
      return;
    }
    this._currentId = id;
    const { maps, sh } = await info.maps;
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = maps[0].get();
    scene.env.sky.fogType = 'none';
    scene.env.light.radianceMap = maps[1].get();
    scene.env.light.irradianceMap = maps[2].get();
    scene.env.light.irradianceSH = sh.get();
  }
}
