import type { BaseLight } from '../../../scene/light';
import { DirectionalLight, PointLight, PunctualLight, SpotLight } from '../../../scene/light';
import type { SerializableClass } from '../types';
import { AABB, degree2radian, radian2degree, Vector4 } from '@zephyr3d/base';
import type { NodeHierarchy } from './node';
import { ClipmapTerrain, Mesh, SceneNode, Terrain } from '../../../scene';
import type { ShadowMode } from '../../../shadow';

/** @internal */
export function getPunctualLightClass(): SerializableClass {
  return {
    ctor: PunctualLight,
    parent: SceneNode,
    name: 'PunctualLight',
    getProps() {
      return [
        {
          name: 'Color',
          type: 'rgb',
          default: [1, 1, 1],
          options: {
            animatable: true
          },
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
          default: 1,
          options: {
            animatable: true,
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
          phase: 0,
          default: false,
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
          phase: 1,
          default: 'hard',
          options: {
            enum: {
              labels: ['Hard', 'PCF', 'PCF-PD', 'VSM', 'ESM'],
              values: ['hard', 'pcf-opt', 'pcf-pd', 'vsm', 'esm']
            }
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
          phase: 1,
          default: 2000,
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
          phase: 1,
          type: 'int',
          default: 1024,
          options: {
            enum: {
              labels: ['128x128', '256x256', '512x512', '1024x1024', '2048x2048', '4096x4096'],
              values: [128, 256, 512, 1024, 2048, 4096]
            }
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.shadowMapSize;
          },
          set(this: PunctualLight, value) {
            this.shadow.shadowMapSize = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'ShadowRegion',
          phase: 1,
          type: 'object',
          default: null,
          options: {
            edit: 'aabb',
            objectTypes: [AABB]
          },
          isNullable() {
            return true;
          },
          create(this: PunctualLight) {
            const aabb = new AABB();
            aabb.beginExtend();
            this.scene.rootNode.iterate((child) => {
              if (child instanceof Mesh || child instanceof Terrain || child instanceof ClipmapTerrain) {
                if (child.castShadow) {
                  const bbox = child.getWorldBoundingVolume().toAABB();
                  aabb.extend(bbox.minPoint);
                  aabb.extend(bbox.maxPoint);
                }
              }
            });
            if (!aabb.isValid()) {
              aabb.minPoint.setXYZ(-1, -1, -1);
              aabb.maxPoint.setXYZ(1, 1, 1);
            }
            return aabb;
          },
          get(this: PunctualLight, value) {
            value.object[0] = this.shadow.shadowRegion;
          },
          set(this: PunctualLight, value) {
            this.shadow.shadowRegion = value.object[0] as AABB;
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow && this.isDirectionLight();
          }
        },
        {
          name: 'ShadowDepthBias',
          type: 'float',
          phase: 1,
          default: 0.5,
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
          phase: 1,
          default: 0.2,
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
          phase: 1,
          default: 1,
          options: {
            minValue: 1,
            maxValue: 4
          },
          get(this: PunctualLight, value) {
            value.num[0] = this.shadow.numShadowCascades;
          },
          set(this: PunctualLight, value) {
            this.shadow.numShadowCascades = value.num[0];
          },
          isValid(this: PunctualLight) {
            return !!this.castShadow;
          }
        },
        {
          name: 'PCFKernelSize',
          phase: 2,
          type: 'int',
          default: 5,
          options: {
            enum: {
              labels: ['3x3', '5x5', '7x7'],
              values: [3, 5, 7]
            }
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
          phase: 2,
          options: {
            minValue: 1,
            maxValue: 128
          },
          default: 12,
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
          phase: 2,
          options: {
            minValue: 0,
            maxValue: 64
          },
          default: 4,
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
          phase: 2,
          options: {
            minValue: 1,
            maxValue: 33
          },
          default: 5,
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
          phase: 2,
          options: {
            minValue: 0,
            maxValue: 32
          },
          default: 4,
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
          phase: 2,
          options: {
            minValue: 0,
            maxValue: 1
          },
          default: 0.5,
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
          phase: 2,
          options: {
            minValue: 1,
            maxValue: 2000
          },
          default: 200,
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
          phase: 2,
          default: true,
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
          phase: 2,
          default: 5,
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
          phase: 2,
          default: 4,
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

/** @internal */
export function getDirectionalLightClass(): SerializableClass {
  return {
    ctor: DirectionalLight,
    name: 'DirectionalLight',
    parent: PunctualLight,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new DirectionalLight(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'SunLight',
          type: 'bool',
          default: false,
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

/** @internal */
export function getPointLightClass(): SerializableClass {
  return {
    ctor: PointLight,
    name: 'PointLight',
    parent: PunctualLight,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new PointLight(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'Range',
          type: 'float',
          default: 10,
          options: {
            animatable: true,
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

/** @internal */
export function getSpotLightClass(): SerializableClass {
  return {
    ctor: SpotLight,
    name: 'SpotLight',
    parent: PunctualLight,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new SpotLight(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'Range',
          type: 'float',
          default: 10,
          options: {
            animatable: true,
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
          name: 'BeamAngle',
          type: 'float',
          default: 90,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 180
          },
          get(this: SpotLight, value) {
            value.num[0] = radian2degree(Math.acos(this.cutoff) * 2);
          },
          set(this: SpotLight, value) {
            this.cutoff = Math.cos(degree2radian(value.num[0]) * 0.5);
          }
        }
      ];
    }
  };
}
