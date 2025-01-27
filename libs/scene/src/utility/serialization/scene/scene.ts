import type { Texture2D } from '@zephyr3d/device';
import type { EnvLightType, FogType, SkyType } from '../../../render';
import { Scene } from '../../../scene/scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import { Application } from '../../../app/app';
import { panoramaToCubemap } from '../../panorama';
import { prefilterCubemap } from '../../pmrem';
import { SceneNode } from '../../../scene';
import { AssetNode } from './node';

export function getSceneClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Scene,
    className: 'Scene',
    createFunc() {
      return new Scene();
    },
    getProps() {
      return [
        {
          name: 'EnvLightType',
          type: 'string',
          enum: {
            labels: ['None', 'Constant', 'Hemispheric', 'IBL'],
            values: ['none', 'constant', 'hemisphere', 'ibl']
          },
          default: { str: ['ibl'] },
          get(this: Scene, value) {
            value.str[0] = this.env.light.type;
          },
          set(this: Scene, value) {
            this.env.light.type = value.str[0] as EnvLightType;
          }
        },
        {
          name: 'AmbientColor',
          type: 'rgb',
          default: { num: [0.2, 0.2, 0.2] },
          get(this: Scene, value) {
            const color = this.env.light.ambientColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientColor.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'constant';
          }
        },
        {
          name: 'AmbientUp',
          type: 'rgb',
          default: { num: [0.3, 0.5, 0.8] },
          get(this: Scene, value) {
            const color = this.env.light.ambientUp;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientUp.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'hemisphere';
          }
        },
        {
          name: 'AmbientDown',
          type: 'rgb',
          default: { num: [0.2, 0.2, 0.2] },
          get(this: Scene, value) {
            const color = this.env.light.ambientDown;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientDown.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'hemisphere';
          }
        },
        {
          name: 'EnvLightStrength',
          type: 'float',
          options: { minValue: 0, maxValue: 10 },
          default: { num: [1] },
          get(this: Scene, value) {
            value.num[0] = this.env.light.strength;
          },
          set(this: Scene, value) {
            this.env.light.strength = value.num[0];
          }
        },
        {
          name: 'SkyType',
          type: 'string',
          enum: {
            labels: ['None', 'Color', 'SkyBox', 'Scatter'],
            values: ['none', 'color', 'skybox', 'scatter']
          },
          default: { str: ['scatter'] },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.skyType;
          },
          set(this: Scene, value) {
            this.env.sky.skyType = value.str[0] as SkyType;
          }
        },
        {
          name: 'AutoUpdateIBLMaps',
          type: 'bool',
          default: { bool: [true] },
          get(this: Scene, value) {
            value.bool[0] = this.env.sky.autoUpdateIBLMaps;
          },
          set(this: Scene, value) {
            this.env.sky.autoUpdateIBLMaps = value.bool[0];
          },
          isValid() {
            return this.env.sky.skyType !== 'none';
          }
        },
        {
          name: 'SkyColor',
          type: 'rgb',
          default: { num: [1, 1, 1] },
          isValid() {
            return this.env.sky.skyType === 'color';
          },
          get(this: Scene, value) {
            const color = this.env.sky.skyColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.skyColor.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          }
        },
        {
          name: 'DrawGround',
          type: 'bool',
          default: { bool: [false] },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          },
          get(this: Scene, value) {
            value.bool[0] = this.env.sky.drawGround;
          },
          set(this: Scene, value) {
            this.env.sky.drawGround = value.bool[0];
          }
        },
        {
          name: 'FogType',
          type: 'string',
          enum: {
            labels: ['None', 'Linear', 'Exp', 'Exp2', 'Scatter'],
            values: ['none', 'linear', 'exp', 'exp2', 'scatter']
          },
          default: { str: ['none'] },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.fogType;
          },
          set(this: Scene, value) {
            this.env.sky.fogType = value.str[0] as FogType;
          }
        },
        {
          name: 'FogColor',
          type: 'rgb',
          default: { num: [1, 1, 1] },
          isValid() {
            return this.env.sky.fogType !== 'none' && this.env.sky.fogType !== 'scatter';
          },
          get(this: Scene, value) {
            const color = this.env.sky.fogColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.fogColor.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          }
        },
        {
          name: 'FogTop',
          type: 'float',
          isValid() {
            return this.env.sky.fogType !== 'none' && this.env.sky.fogType !== 'scatter';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogTop;
          },
          set(this: Scene, value) {
            this.env.sky.fogTop = value.num[0];
          }
        },
        {
          name: 'FogStart',
          type: 'float',
          isValid() {
            return this.env.sky.fogType === 'linear';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogStart;
          },
          set(this: Scene, value) {
            this.env.sky.fogStart = value.num[0];
          }
        },
        {
          name: 'FogEnd',
          type: 'float',
          isValid() {
            return this.env.sky.fogType === 'linear';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogEnd;
          },
          set(this: Scene, value) {
            this.env.sky.fogEnd = value.num[0];
          }
        },
        {
          name: 'FogDensity',
          type: 'float',
          options: { minValue: 0, maxValue: 1 },
          default: { num: [0.1] },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogDensity;
          },
          set(this: Scene, value) {
            this.env.sky.fogDensity = value.num[0];
          },
          isValid() {
            return this.env.sky.fogType === 'exp' || this.env.sky.fogType === 'exp2';
          }
        },
        {
          name: 'FogStart',
          type: 'float',
          default: { num: [0] },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogStart;
          },
          set(this: Scene, value) {
            this.env.sky.fogStart = value.num[0];
          },
          isValid() {
            return this.env.sky.fogType === 'linear';
          }
        },
        {
          name: 'FogEnd',
          type: 'float',
          default: { num: [100] },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.fogEnd;
          },
          set(this: Scene, value) {
            this.env.sky.fogEnd = value.num[0];
          },
          isValid() {
            return this.env.sky.fogType === 'linear';
          }
        },
        {
          name: 'AerialPerspectiveDensity',
          type: 'float',
          options: { minValue: 0, maxValue: 100 },
          default: { num: [1] },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.aerialPerspectiveDensity;
          },
          set(this: Scene, value) {
            this.env.sky.aerialPerspectiveDensity = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'Cloudy',
          type: 'float',
          options: { minValue: 0, maxValue: 1 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudy;
          },
          set(this: Scene, value) {
            this.env.sky.cloudy = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'CloudIntensity',
          type: 'float',
          options: { minValue: 0, maxValue: 200 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudIntensity;
          },
          set(this: Scene, value) {
            this.env.sky.cloudIntensity = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'Wind',
          type: 'vec2',
          options: { minValue: -100, maxValue: 100 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.wind.x;
            value.num[1] = this.env.sky.wind.y;
          },
          set(this: Scene, value) {
            this.env.sky.wind.setXY(value.num[0], value.num[1]);
          }
        },
        {
          name: 'PanoramaTexture',
          type: 'object',
          get(this: Scene, value) {
            value.str[0] = this.env.sky.panoramaTextureAsset;
          },
          set(this: Scene, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  if (tex?.isTexture2D()) {
                    tex.name = assetInfo.name;
                    const device = Application.instance.device;
                    const skyBoxTexture =
                      this.env.sky.skyboxTexture ?? device.createCubeTexture('rgba16f', 1024);
                    const radianceMap =
                      this.env.light.radianceMap ?? device.createCubeTexture('rgba16f', 256);
                    const irradianceMap =
                      this.env.light.irradianceMap ??
                      device.createCubeTexture('rgba16f', 64, {
                        samplerOptions: { mipFilter: 'none' }
                      });
                    panoramaToCubemap(tex, skyBoxTexture);
                    prefilterCubemap(skyBoxTexture, 'ggx', radianceMap);
                    prefilterCubemap(skyBoxTexture, 'lambertian', irradianceMap);
                    this.env.sky.skyboxTexture = skyBoxTexture;
                    this.env.light.radianceMap = radianceMap;
                    this.env.light.irradianceMap = irradianceMap;
                    this.env.sky.panoramaTextureAsset = assetId;
                    assetRegistry.releaseAsset(tex);
                  } else {
                    console.error('Invalid skybox texture');
                  }
                });
              }
            }
          }
        },
        {
          name: 'Nodes',
          type: 'object_array',
          hidden: true,
          get(this: Scene, value) {
            value.object = [];
            for (const child of this.rootNode.children) {
              value.object.push(child.get());
            }
          },
          set(this: Scene, value) {
            for (let i = this.rootNode.children.length - 1; i >= 0; i--) {
              const child = this.rootNode.children[i].get();
              if (!value.object.includes(child) && !child.sealed) {
                child.remove();
              }
            }
            for (const child of value.object) {
              if (child instanceof SceneNode) {
                child.parent = this.rootNode;
              } else {
                console.error(`Invalid scene node: ${child}`);
              }
            }
          }
        }
      ];
    }
  };
}
