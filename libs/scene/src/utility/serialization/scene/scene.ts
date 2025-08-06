import type { Texture2D } from '@zephyr3d/device';
import type { EnvLightType, FogType, SkyType } from '../../../render';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { Application } from '../../../app/app';
import { panoramaToCubemap } from '../../panorama';
import { prefilterCubemap } from '../../pmrem';
import { NodeHierarchy } from './node';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { SerializationManager } from '../manager';
import { JSONData } from '../json/number';

export let testJson: object = {
  testNumber: 123,
  testString: 'Hello,world!',
  '.testHiddenString': "You can't see me",
  testObject: {
    '.testHiddenField': 'Hidden',
    testField: 'Field'
  },
  '.testHiddenObject': {
    testField: 'You can not see me'
  }
};

/** @internal */
export function getSceneClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: Scene,
    createFunc() {
      return { obj: new Scene() };
    },
    getProps() {
      return [
        {
          name: 'Name',
          type: 'string',
          default: '',
          isHidden() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = this.name;
          },
          set(this: Scene, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'EnvLightType',
          phase: 0,
          type: 'string',
          options: {
            enum: {
              labels: ['None', 'Constant', 'Hemispheric', 'IBL', 'IBL-SH'],
              values: ['none', 'constant', 'hemisphere', 'ibl', 'ibl-sh']
            }
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
          options: {
            animatable: true
          },
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
          options: {
            animatable: true
          },
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
          options: {
            animatable: true
          },
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
          options: { animatable: true, minValue: 0, maxValue: 10 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.light.strength;
          },
          set(this: Scene, value) {
            this.env.light.strength = value.num[0];
          }
        },
        {
          name: 'SHWindowWeights',
          type: 'vec3',
          options: { minValue: 0, maxValue: 1 },
          default: [1, 1, 1],
          get(this: Scene, value) {
            const weights = this.env.sky.shWindowWeights;
            value.num[0] = weights.x;
            value.num[1] = weights.y;
            value.num[2] = weights.z;
          },
          set(this: Scene, value) {
            this.env.sky.shWindowWeights = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'RadianceConvSamples',
          type: 'int',
          options: { minValue: 1, maxValue: 2048 },
          default: 64,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.radianceConvSamples;
          },
          set(this: Scene, value) {
            this.env.sky.radianceConvSamples = value.num[0];
          }
        },
        {
          name: 'IrradianceConvSamples',
          type: 'int',
          options: { minValue: 1, maxValue: 2048 },
          default: 256,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.irradianceConvSamples;
          },
          set(this: Scene, value) {
            this.env.sky.irradianceConvSamples = value.num[0];
          }
        },
        {
          name: 'SkyType',
          type: 'string',
          phase: 0,
          options: {
            enum: {
              labels: ['None', 'Color', 'SkyBox', 'Scatter'],
              values: ['none', 'color', 'skybox', 'scatter']
            }
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
          name: 'SkyColor',
          type: 'rgb',
          phase: 1,
          default: [1, 1, 1],
          options: {
            animatable: true
          },
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
            this.env.sky.invalidate();
          }
        },
        {
          name: 'FogType',
          type: 'string',
          phase: 0,
          options: {
            enum: {
              labels: ['None', 'Linear', 'Exp', 'Exp2', 'ExponentialHeight'],
              values: ['none', 'linear', 'exp', 'exp2', 'height_fog']
            }
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
          type: 'float',
          name: 'HeightFogDensity',
          default: 0.04,
          options: { group: 'HeightFog', label: 'Density', minValue: 0, maxValue: 1 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDensity;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDensity = value.num[0];
          }
        },
        {
          name: 'HeightFogFalloff',
          type: 'float',
          default: 0.2,
          options: { group: 'HeightFog', label: 'Falloff', minValue: 0, maxValue: 1 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogFalloff;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogFalloff = value.num[0];
          }
        },
        {
          name: 'HeightFogStartHeight',
          type: 'float',
          default: 0,
          options: { group: 'HeightFog', label: 'StartHeight', minValue: 0, maxValue: 1000 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogStartHeight;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogStartHeight = value.num[0];
          }
        },
        {
          name: 'HeightFogColor',
          type: 'rgb',
          phase: 1,
          default: [0, 0, 0],
          options: {
            group: 'HeightFog',
            label: 'FogColor',
            animatable: true
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            const color = this.env.sky.heightFogColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'HeightFogStartDistance',
          type: 'float',
          default: 0,
          options: {
            group: 'HeightFog',
            label: 'StartDistance'
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogStartDistance;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogStartDistance = value.num[0];
          }
        },
        {
          name: 'HeightFogMaxOpacity',
          type: 'float',
          options: { group: 'HeightFog', label: 'MaxOpacity', minValue: 0, maxValue: 1 },
          default: 1,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogMaxOpacity;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogMaxOpacity = value.num[0];
          }
        },
        {
          name: 'HeightFogAtmosphereStrength',
          type: 'float',
          options: { group: 'HeightFog', label: 'AtmosphereStrength', minValue: 0, maxValue: 10 },
          default: 1,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogAtmosphereContribution;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogAtmosphereContribution = value.num[0];
          }
        },
        {
          name: 'HeightFogDirExponent',
          type: 'float',
          default: 4,
          options: { group: 'HeightFog', label: 'DirectionalExponent' },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDirExponent;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDirExponent = value.num[0];
          }
        },
        {
          name: 'HeightFogDirColor',
          type: 'rgb',
          default: [0, 0, 0],
          options: {
            group: 'HeightFog',
            label: 'DirectionalInscattering'
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDirColor.x;
            value.num[1] = this.env.sky.heightFogDirColor.y;
            value.num[2] = this.env.sky.heightFogDirColor.z;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDirColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'AerialPerspectiveDistance',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 1, maxValue: 50000 },
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
          name: 'CameraHeightScale',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 1, maxValue: 1000 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cameraHeightScale;
          },
          set(this: Scene, value) {
            this.env.sky.cameraHeightScale = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AtmosphereExposure',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 8 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.atmosphereExposure;
          },
          set(this: Scene, value) {
            this.env.sky.atmosphereExposure = value.num[0];
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
          options: { animatable: true, minValue: 0, maxValue: 1 },
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
          options: { animatable: true, minValue: 0, maxValue: 200 },
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
          options: { animatable: true, minValue: -100, maxValue: 100 },
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
              let tex: Texture2D;
              try {
                tex = await manager.fetchTexture<Texture2D>(assetId);
              } catch (err) {
                console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                tex = null;
              }
              if (tex?.isTexture2D()) {
                const device = Application.instance.device;
                const skyBoxTexture = this.env.sky.skyboxTexture ?? device.createCubeTexture('rgba16f', 1024);
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
                this.env.sky.invalidate();
                tex.dispose();
              } else {
                console.error('Invalid skybox texture');
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
          isHidden() {
            return true;
          },
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
        },
        {
          name: 'Metadata',
          type: 'object',
          persistent: false,
          options: { objectTypes: [JSONData] },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            console.log(testJson);
            value.object[0] = new JSONData(null, testJson);
          }
        }
      ];
    }
  };
}
