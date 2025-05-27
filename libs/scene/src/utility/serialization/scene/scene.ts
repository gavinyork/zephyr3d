import type { Texture2D } from '@zephyr3d/device';
import type { EnvLightType, FogType, SkyType } from '../../../render';
import { Scene } from '../../../scene/scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import { Application } from '../../../app/app';
import { panoramaToCubemap } from '../../panorama';
import { prefilterCubemap } from '../../pmrem';
import { NodeHierarchy } from './node';
import { Vector4 } from '@zephyr3d/base';

export function getSceneClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Scene,
    className: 'Scene',
    createFunc() {
      return { obj: new Scene() };
    },
    getProps() {
      return [
        {
          name: 'EnvLightType',
          phase: 0,
          type: 'string',
          enum: {
            labels: ['None', 'Constant', 'Hemispheric', 'IBL'],
            values: ['none', 'constant', 'hemisphere', 'ibl']
          },
          default: 'ibl',
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
          phase: 1,
          default: [0.2, 0.2, 0.2],
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
          phase: 1,
          default: [0.3, 0.5, 0.8],
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
          phase: 1,
          default: [0.2, 0.2, 0.2],
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
          phase: 0,
          options: { minValue: 0, maxValue: 10 },
          default: 1,
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
          phase: 0,
          enum: {
            labels: ['None', 'Color', 'SkyBox', 'Scatter'],
            values: ['none', 'color', 'skybox', 'scatter']
          },
          default: 'scatter',
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
          phase: 1,
          default: true,
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
          phase: 1,
          default: [1, 1, 1],
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
            this.env.sky.skyColor = new Vector4(value.num[0], value.num[1], value.num[2], 1);
          }
        },
        {
          name: 'DrawGround',
          type: 'bool',
          phase: 1,
          default: false,
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
          phase: 0,
          enum: {
            labels: ['None', 'Linear', 'Exp', 'Exp2', 'Scatter'],
            values: ['none', 'linear', 'exp', 'exp2', 'scatter']
          },
          default: 'none',
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
          phase: 1,
          default: [1, 1, 1],
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
          phase: 1,
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
          phase: 1,
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
          phase: 1,
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
          phase: 1,
          options: { minValue: 0, maxValue: 1 },
          default: 0.1,
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
          phase: 1,
          default: 0,
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
          phase: 1,
          default: 100,
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
          phase: 1,
          options: { minValue: 1, maxValue: 50000 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.aerialPerspectiveDistance;
          },
          set(this: Scene, value) {
            this.env.sky.aerialPerspectiveDistance = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'Cloudy',
          type: 'float',
          default: 0.6,
          phase: 1,
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
          default: 40,
          phase: 1,
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
          default: [0, 0],
          phase: 1,
          options: { minValue: -100, maxValue: 100 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.wind.x;
            value.num[1] = this.env.sky.wind.y;
          },
          set(this: Scene, value) {
            this.env.sky.wind.setXY(value.num[0], value.num[1]);
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'PanoramaTexture',
          type: 'object',
          phase: 1,
          get(this: Scene, value) {
            value.str[0] = this.env.sky.panoramaTextureAsset;
          },
          async set(this: Scene, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                let tex: Texture2D;
                try {
                  tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  const device = Application.instance.device;
                  const skyBoxTexture =
                    this.env.sky.skyboxTexture ?? device.createCubeTexture('rgba16f', 1024);
                  const radianceMap = this.env.light.radianceMap ?? device.createCubeTexture('rgba16f', 256);
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
                  tex.dispose();
                } else {
                  console.error('Invalid skybox texture');
                }
              }
            }
          },
          isValid() {
            return this.env.sky.skyType === 'skybox';
          }
        },
        {
          name: 'NodeHierarchy',
          type: 'object',
          hidden: true,
          get(this: Scene, value) {
            value.object = [new NodeHierarchy(this, this.rootNode)];
          },
          set(this: Scene, value) {
            const nodeHierarchy = value.object[0] as NodeHierarchy;
            nodeHierarchy.rootNode.remove();
            for (const child of nodeHierarchy.rootNode.children.slice()) {
              child.get().parent = this.rootNode;
            }
          }
        }
      ];
    }
  };
}
