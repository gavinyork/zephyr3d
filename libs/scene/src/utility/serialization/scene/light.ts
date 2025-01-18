import type { BaseLight } from '../../../scene/light';
import { DirectionalLight, PointLight, PunctualLight, SpotLight } from '../../../scene/light';
import { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { Vector4 } from '@zephyr3d/base';
import { getSceneNodeClass } from './node';
import type { AssetRegistry } from '../asset/asset';
import { SceneNode } from '../../../scene';
import { ShadowMode } from '../../../shadow';

export function getPunctualLightClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: PunctualLight,
    parent: getSceneNodeClass(assetRegistry),
    className: 'PunctualLight',
    getProps() {
      return [
        {
          name: 'Color',
          type: 'rgb',
          default: { num: [1, 1, 1] },
          get(this: PunctualLight, value) {
            value.num[0] = this.color.x;
            value.num[1] = this.color.y;
            value.num[2] = this.color.z;
          },
          set(this: PunctualLight, value) {
            this.color = new Vector4(value.num[0], value.num[1], value.num[2], 1);
          }
        },
        {
          name: 'Intensity',
          type: 'float',
          default: { num: [1] },
          options: {
            minValue: 0,
            maxValue: 100
          },
          get(this: BaseLight, value) {
            value.num[0] = this.intensity;
          },
          set(this: BaseLight, value) {
            this.intensity = value.num[0];
          }
        },
        {
          name: 'CastShadow',
          type: 'bool',
          default: { bool: [false] },
          get(this: PunctualLight, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: PunctualLight, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'ShadowType',
          type: 'string',
          default: { str: ['hard'] },
          enum: {
            labels: ['Hard', 'PCF', 'PCF-PD', 'VSM', 'ESM'],
            values: ['hard', 'pcf-opt', 'pcf-pd', 'vsm', 'esm']
          },
          get(this: PunctualLight, value) {
            value.str[0] = this.shadow.mode;
          },
          set(this: PunctualLight, value) {
            this.shadow.mode = value.str[0] as ShadowMode;
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowDistance',
          type: 'float',
          default: { num: [2000] },
          options: {
            minValue: 0,
            maxValue: 5000
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.shadowDistance;
          },
          set(this: PunctualLight, value) {
            this.shadow.shadowDistance = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowMapSize',
          type: 'int',
          default: { num: [1024] },
          enum: {
            labels: ['128x128', '256x256', '512x512', '1024x1024', '2048x2048', '4096x4096'],
            values: [128, 256, 512, 1024, 2048, 4096]
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.shadowMapSize;
          },
          set(this: PunctualLight, value) {
            this.shadow.shadowMapSize = value.num[0]
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowDepthBias',
          type: 'float',
          default: { num: [0.5] },
          options: {
            minValue: 0,
            maxValue: 5
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.depthBias;
          },
          set(this: PunctualLight, value) {
            this.shadow.depthBias = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowNormalBias',
          type: 'float',
          default: { num: [0.2] },
          options: {
            minValue: 0,
            maxValue: 5
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.normalBias;
          },
          set(this: PunctualLight, value) {
            this.shadow.normalBias = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowCascades',
          type: 'int',
          default: { num: [1] },
          options: {
            minValue: 1,
            maxValue: 4
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.numShadowCascades;
          },
          set(this: PunctualLight, value) {
            this.shadow.numShadowCascades = value.num[0]
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'PCFKernelSize',
          type: 'int',
          default: { num: [5] },
          enum: {
            labels: ['3x3', '5x5', '7x7'],
            values: [3, 5, 7]
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.pcfKernelSize;
          },
          set(this: PunctualLight, value) {
            this.shadow.pcfKernelSize = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'pcf-opt';
          }
        },
        {
          name: 'PCFSampleCount',
          type: 'int',
          options: {
            minValue: 1,
            maxValue: 128
          },
          default: { num: [12] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.pdSampleCount;
          },
          set(this: PunctualLight, value) {
            this.shadow.pdSampleCount = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'pcf-pd';
          }
        },
        {
          name: 'PCFSampleRadius',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 64
          },
          default: { num: [4] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.pdSampleRadius;
          },
          set(this: PunctualLight, value) {
            this.shadow.pdSampleRadius = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'pcf-pd';
          }
        },
        {
          name: 'VSMBlurKernelSize',
          type: 'int',
          options: {
            minValue: 1,
            maxValue: 33
          },
          default: { num: [5] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.vsmBlurKernelSize;
          },
          set(this: PunctualLight, value) {
            this.shadow.vsmBlurKernelSize = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'vsm';
          }
        },
        {
          name: 'VSMBlurRadius',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 32
          },
          default: { num: [4] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.vsmBlurRadius;
          },
          set(this: PunctualLight, value) {
            this.shadow.vsmBlurRadius = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'vsm';
          }
        },
        {
          name: 'VSMDarkness',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          default: { num: [0.5] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.vsmDarkness;
          },
          set(this: PunctualLight, value) {
            this.shadow.vsmDarkness = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'vsm';
          }
        },
        {
          name: 'ESMDepthScale',
          type: 'float',
          options: {
            minValue: 1,
            maxValue: 2000
          },
          default: { num: [200] },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.esmDepthScale;
          },
          set(this: PunctualLight, value) {
            this.shadow.esmDepthScale = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'esm';
          }
        },
        {
          name: 'ESMBlur',
          type: 'bool',
          default: { bool: [true] },
          get(this: PunctualLight, value) {
            value.bool[0] = this.shadow.esmBlur;
          },
          set(this: PunctualLight, value) {
            this.shadow.esmBlur = value.bool[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'esm';
          }
        },
        {
          name: 'ESMBlurKernelSize',
          type: 'int',
          default: { num: [5] },
          options: {
            minValue: 1,
            maxValue: 33
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.esmBlurKernelSize;
          },
          set(this: PunctualLight, value) {
            this.shadow.esmBlurKernelSize = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'esm' && this.shadow.esmBlur;
          }
        },
        {
          name: 'ESMBlurRadius',
          type: 'float',
          default: { num: [4] },
          options: {
            minValue: 0,
            maxValue: 32
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.esmBlurRadius;
          },
          set(this: PunctualLight, value) {
            this.shadow.esmBlurRadius = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.shadow.mode === 'esm' && this.shadow.esmBlur;
          }
        }
      ];
    }
  };
}
export function getDirectionalLightClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: DirectionalLight,
    parent: getPunctualLightClass(assetRegistry),
    className: 'DirectionalLight',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new DirectionalLight(scene);
      } else if (scene instanceof SceneNode) {
        const batchGroup = new DirectionalLight(scene.scene);
        batchGroup.parent = scene;
        return batchGroup;
      } else {
        return null;
      }
    },
    getProps() {
      return [
        {
          name: 'SunLight',
          type: 'bool',
          default: { bool: [false] },
          get(this: DirectionalLight, value) {
            value.bool[0] = this.sunLight;
          },
          set(this: DirectionalLight, value) {
            this.sunLight = value.bool[0];
          }
        }
      ];
    }
  };
}

export function getPointLightClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: PointLight,
    parent: getPunctualLightClass(assetRegistry),
    className: 'PointLight',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new PointLight(scene);
      } else if (scene instanceof SceneNode) {
        const batchGroup = new PointLight(scene.scene);
        batchGroup.parent = scene;
        return batchGroup;
      } else {
        return null;
      }
    },
    getProps() {
      return [
        {
          name: 'Range',
          type: 'float',
          default: { num: [10] },
          options: {
            minValue: 0,
            maxValue: 1000
          },
          get(this: PointLight, value) {
            value.num[0] = this.range;
          },
          set(this: PointLight, value) {
            this.range = value.num[0];
          }
        }
      ];
    }
  };
}

export function getSpotLightClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: SpotLight,
    parent: getPunctualLightClass(assetRegistry),
    className: 'SpotLight',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new SpotLight(scene);
      } else if (scene instanceof SceneNode) {
        const batchGroup = new SpotLight(scene.scene);
        batchGroup.parent = scene;
        return batchGroup;
      } else {
        return null;
      }
    },
    getProps() {
      return [
        {
          name: 'Range',
          type: 'float',
          default: { num: [10] },
          options: {
            minValue: 0,
            maxValue: 1000
          },
          get(this: SpotLight, value) {
            value.num[0] = this.range;
          },
          set(this: SpotLight, value) {
            this.range = value.num[0];
          }
        },
        {
          name: 'Cutoff',
          type: 'float',
          default: { num: [Math.cos(Math.PI / 4)] },
          options: {
            minValue: 0,
            maxValue: Math.PI
          },
          get(this: SpotLight, value) {
            value.num[0] = this.cutoff;
          },
          set(this: SpotLight, value) {
            this.cutoff = value.num[0];
          }
        }
      ];
    }
  };
}
