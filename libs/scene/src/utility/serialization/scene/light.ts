import type { BaseLight } from '../../../scene/light';
import { DirectionalLight, PointLight, PunctualLight, RectLight, SpotLight } from '../../../scene/light';
import { defineProps, type SerializableClass } from '../types';
import { AABB, degree2radian, radian2degree, Vector4 } from '@zephyr3d/base';
import { ClipmapTerrain, Mesh, SceneNode } from '../../../scene';
import type { ShadowMode } from '../../../shadow';

/** @internal */
export function getPunctualLightClass(): SerializableClass {
  return {
    ctor: PunctualLight,
    parent: SceneNode,
    name: 'PunctualLight',
    getProps() {
      return defineProps([
        {
          name: 'Color',
          description: 'Light color',
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
          description: 'Light intensity',
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
          description: 'if true, the light cast shadows',
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
          description: 'Which type of shadow this light product',
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
          description: 'Maximum shadow distance',
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
          description: 'Shadow map resolution',
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
          description: 'World space AABB, objects inside this AABB can cast shadows',
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
            this.scene!.rootNode.iterate((child) => {
              if (child instanceof Mesh || child instanceof ClipmapTerrain) {
                if (child.castShadow) {
                  const bbox = child.getWorldBoundingVolume()!.toAABB();
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
          description: 'Shadow depth bias',
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
          description: 'Shadow normal bias',
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
          description: 'Cascade count for CSM',
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
          description: 'Kernel size for PCF shadow',
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
          description: 'Sample count for PCF shadow',
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
          description: 'Sample radius for PCF shadow',
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
          description: 'Blur kernel size of VSM shadow',
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
          description: 'Blur radius for VSM shadow',
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
          description: 'Darkness for VSM shadow',
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
          description: 'Depth scale value for ESM shadow',
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
          description: 'If true, enable bluring for ESM shadow',
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
          description: 'Blur kernel size for ESM shadow',
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
          description: 'Blur radius for ESM shadow',
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
      ]);
    }
  };
}

/** @internal */
export function getDirectionalLightClass(): SerializableClass {
  return {
    ctor: DirectionalLight,
    name: 'DirectionalLight',
    parent: PunctualLight,
    createFunc(ctx: SceneNode) {
      const node = new DirectionalLight(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'SunLight',
          description: 'If true, this light will act as sun light and affect sky atmosphere rendering',
          type: 'bool',
          default: false,
          get(this: DirectionalLight, value) {
            value.bool[0] = this.sunLight;
          },
          set(this: DirectionalLight, value) {
            this.sunLight = value.bool[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getPointLightClass(): SerializableClass {
  return {
    ctor: PointLight,
    name: 'PointLight',
    parent: PunctualLight,
    createFunc(ctx: SceneNode) {
      const node = new PointLight(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Range',
          description: 'Light range in world unit',
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
        },
        {
          name: 'DiffuseScale',
          type: 'float',
          default: 1,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 10
          },
          get(this: PointLight, value) {
            value.num[0] = this.diffuseScale;
          },
          set(this: PointLight, value) {
            this.diffuseScale = value.num[0];
          }
        },
        {
          name: 'SpecularScale',
          type: 'float',
          default: 1,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 10
          },
          get(this: PointLight, value) {
            value.num[0] = this.specularScale;
          },
          set(this: PointLight, value) {
            this.specularScale = value.num[0];
          }
        },
        {
          name: 'SourceRadius',
          type: 'float',
          default: 0,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 100
          },
          get(this: PointLight, value) {
            value.num[0] = this.sourceRadius;
          },
          set(this: PointLight, value) {
            this.sourceRadius = value.num[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getSpotLightClass(): SerializableClass {
  return {
    ctor: SpotLight,
    name: 'SpotLight',
    parent: PunctualLight,
    createFunc(ctx: SceneNode) {
      const node = new SpotLight(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Range',
          description: 'Light range in world unit',
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
          description: 'Beam angle of cone',
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
      ]);
    }
  };
}

/** @internal */
export function getRectLightClass(): SerializableClass {
  return {
    ctor: RectLight,
    name: 'RectLight',
    parent: PunctualLight,
    createFunc(ctx: SceneNode) {
      const node = new RectLight(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Range',
          description: 'Light range in world unit',
          type: 'float',
          default: 10,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 1000
          },
          get(this: RectLight, value) {
            value.num[0] = this.range;
          },
          set(this: RectLight, value) {
            this.range = value.num[0];
          }
        },
        {
          name: 'Width',
          description: 'Width of the light',
          type: 'float',
          default: 1,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 1000
          },
          get(this: RectLight, value) {
            value.num[0] = this.width;
          },
          set(this: RectLight, value) {
            this.width = value.num[0];
          }
        },
        {
          name: 'Height',
          description: 'Height of the light',
          type: 'float',
          default: 1,
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 1000
          },
          get(this: RectLight, value) {
            value.num[0] = this.height;
          },
          set(this: RectLight, value) {
            this.height = value.num[0];
          }
        }
      ]);
    }
  };
}
