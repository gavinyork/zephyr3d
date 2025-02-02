import type { Texture2D, TextureCube } from '@zephyr3d/device';
import type { Scene } from '@zephyr3d/scene';
import {
  Application,
  AssetManager,
  panoramaToCubemap,
  prefilterCubemap,
  projectCubemapCPU
} from '@zephyr3d/scene';

type EnvMapInfo = {
  path: string;
  maps?: Promise<{ maps: TextureCube[]; sh: Float32Array }>;
  sh?: Float32Array;
};

export class EnvMaps {
  private _envMaps: Record<string, EnvMapInfo>;
  private _assetManager: AssetManager;
  private _assetManagerEx: AssetManager;
  private _currentId: string;
  constructor() {
    this._envMaps = {
      tower: {
        path: 'assets/images/environments/tower.hdr'
      },
      doge2: {
        path: 'assets/images/environments/doge2.hdr'
      },
      'Street night': {
        path: 'assets/images/environments/street_night.hdr'
      },
      forest: {
        path: 'assets/images/environments/forest.hdr'
      }
    };
    this._assetManager = new AssetManager();
    this._assetManagerEx = new AssetManager();
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
  ): Promise<{ maps: TextureCube[]; sh: Float32Array }> {
    const maps = this.createMaps();
    const sh = new Float32Array(36);
    try {
      const panorama = await assetManager.fetchTexture<Texture2D>(path);
      panoramaToCubemap(panorama, maps[0]);
      prefilterCubemap(maps[0], 'ggx', maps[1]);
      prefilterCubemap(maps[0], 'lambertian', maps[2]);
      const coeff = await projectCubemapCPU(maps[2]);
      for (let i = 0; i < 9; i++) {
        sh[i * 4 + 0] = coeff[i].x;
        sh[i * 4 + 1] = coeff[i].y;
        sh[i * 4 + 2] = coeff[i].z;
      }
    } catch (err) {
      console.error(err);
    }
    return { maps, sh };
  }
  createMaps(): TextureCube[] {
    return [
      Application.instance.device.createCubeTexture('rgba16f', 512),
      Application.instance.device.createCubeTexture('rgba16f', 256),
      Application.instance.device.createCubeTexture('rgba16f', 64, {
        samplerOptions: { mipFilter: 'none' }
      })
    ];
  }
  async selectByPath(path: string, scene: Scene, urlResolver: (url: string) => string) {
    this._assetManagerEx.httpRequest.urlResolver = urlResolver;
    const maps = await this.loadEnvMap(path, this._assetManagerEx);
    this._currentId = '';
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = maps[0];
    scene.env.sky.fogType = 'none';
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = maps[1];
    scene.env.light.irradianceMap = maps[2];
  }
  async selectById(id: string, scene: Scene) {
    const info = this._envMaps[id];
    if (!info) {
      console.error(`Environment map id not found: ${id}`);
      return;
    }
    this._currentId = id;
    const maps = await info.maps;
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = maps.maps[0];
    scene.env.sky.fogType = 'none';
    scene.env.light.radianceMap = maps.maps[1];
    scene.env.light.irradianceMap = maps.maps[2];
    scene.env.light.irradianceSH = maps.sh;
  }
}
